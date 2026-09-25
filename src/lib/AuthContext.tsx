/**
 * 派遣事業 粗利・経理管理システム
 * Supabase認証コンテキスト
 *
 * セッション(ログイン状態)と、profilesテーブルから取得したrole('admin'|'viewer')・
 * company_id(viewerの場合のみ)を一元管理する。
 * - 未ログイン: session === null
 * - ログイン済だがprofilesレコードが未作成: profile === null かつ profileError あり
 *   (管理者がSupabaseダッシュボードでprofilesレコードを作成するまでアプリを使えない)
 *
 * ★2026-09-26修正(本番のremoveChildクラッシュ対策・調査結果に基づく):
 * 本番で繰り返し発生していた "NotFoundError: Failed to execute 'removeChild'" は、
 * コンポーネントスタック(div → AppShell → App → AuthProvider → ErrorBoundary)の照合により
 * 「AppShellの一番外側のdivの削除に失敗している」=「AppShellがアンマウントされる瞬間の
 * クラッシュ」と判明した。その引き金が、旧実装の以下2点だった:
 *   1. onAuthStateChangeが、TOKEN_REFRESHED・SIGNED_IN(タブ復帰時)を含む全イベントで
 *      profilesの再取得を行っており、一時的な取得失敗(ネットワーク瞬断・DB高負荷時の
 *      statement timeout等)でsetProfile(null)となる。App.tsxはprofileがnullになると
 *      AppShellを外して「アカウント設定が未完了です」画面へ切り替えるため、ここで
 *      AppShellごとアンマウントされていた。
 *   2. onAuthStateChangeのコールバック内で他のSupabase呼び出し(profilesのselect)を
 *      直接awaitしていた(Supabase公式が避けるよう推奨している書き方。認証ロックを
 *      保持したまま別の呼び出しを待つため、デッドロック・タイムアウトを招きうる)。
 * 対策として、(a)同じユーザーのままのイベントではプロフィールを読み直さない、
 * (b)取得に失敗しても既存のプロフィールをnullにしない、(c)コールバック内のSupabase呼び出しは
 * setTimeout(…, 0)で後回しにする、(d)初回読み込み完了後はloadingをtrueに戻さない、を実装した。
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import { CompanyId } from '../config/companies';

export type UserRole = 'admin' | 'viewer';

export interface Profile {
  id: string;
  email: string | null;
  role: UserRole;
  companyId: CompanyId | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** 認証状態・プロフィールの初回読み込み中かどうか */
  loading: boolean;
  /** profilesテーブルの取得に失敗した場合(未作成 or 権限エラー)のメッセージ */
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * ★2026-09-26追加(診断用): 最後に受け取った認証イベント名と受信時刻。
 * ErrorBoundaryはAuthProviderの「外側」にある(main.tsx参照)ためContextからは参照できないので、
 * モジュールスコープの変数で共有する。次に描画エラーが起きたとき、直前にどの認証イベントが
 * 起きていたかをconsole.errorに出力して原因追跡に使う(ErrorBoundary.tsx参照)。
 */
let lastAuthEvent: AuthChangeEvent | 'INITIAL_GET_SESSION' | null = null;
let lastAuthEventAt: string | null = null;

export function getLastAuthEventInfo(): { event: string | null; at: string | null } {
  return { event: lastAuthEvent, at: lastAuthEventAt };
}

async function fetchProfile(userId: string, email: string | null): Promise<{ profile: Profile | null; error: string | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, role, company_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { profile: null, error: `プロフィールの取得に失敗しました: ${error.message}` };
  }
  if (!data) {
    return {
      profile: null,
      error:
        'このアカウントにはprofilesレコードが設定されていません。管理者にSupabaseダッシュボードでの' +
        'アカウント設定(role・company_id)を依頼してください。',
    };
  }
  return {
    profile: {
      id: data.id,
      email: data.email ?? email,
      role: data.role as UserRole,
      companyId: (data.company_id as CompanyId) ?? null,
    },
    error: null,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  // 初回読み込み(getSession + 必要ならprofiles取得)が完了するまでtrue。
  // ★一度falseになった後は二度とtrueに戻さない(下記finishInitialLoading参照)。
  const [initialLoading, setInitialLoading] = useState(true);
  // プロフィール取得が進行中かどうか。プロフィール未取得のまま取得中の間は、App.tsxに
  // 「読み込み中」を表示させる(profile===nullのまま描画すると「アカウント設定が未完了です」
  // 画面が一瞬表示され、直後にAppShellへ切り替わる=不要なマウント/アンマウントが発生するため)。
  const [profileFetching, setProfileFetching] = useState(false);

  // 現在のprofile・取得済みユーザーIDを、effect内のコールバックから最新値で参照するためのref
  // (stateを直接参照するとクロージャが古い値を掴んでしまう)。
  const profileRef = useRef<Profile | null>(null);
  const loadedProfileUserIdRef = useRef<string | null>(null);
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    // 現在プロフィール取得中のユーザーID(同一ユーザーへの二重取得を抑止するため)。
    // ★refではなくeffectインスタンスのローカル変数にしている: refにすると、開発時の
    // StrictModeによる二重マウントで「1回目のマウントが取得中(refに残る)のままcancelされ、
    // 2回目のマウントが二重取得の抑止に引っかかって永久に読み込み中のまま」という状態に
    // なりうる。抑止したいのは同じeffectインスタンス内の同時実行(getSessionの解決 と
    // INITIAL_SESSIONイベント)だけなので、スコープもeffectインスタンスに合わせる。
    let fetchingUserId: string | null = null;

    /** 初回読み込みの完了。一度完了したら二度とloadingをtrueに戻さない。 */
    const finishInitialLoading = () => {
      if (initialLoadDoneRef.current) return;
      initialLoadDoneRef.current = true;
      setInitialLoading(false);
    };

    /**
     * profilesを取得してstateへ反映する。
     * ★取得に失敗した場合、既に取得済みのプロフィールがあるなら絶対にnullへ戻さない
     * (AppShellのアンマウント=removeChildクラッシュを防ぐための最重要ポイント)。
     */
    const applyProfile = async (nextSession: Session) => {
      // 二重取得の抑止。Supabase v2は購読開始時にINITIAL_SESSIONイベントを発火するため、
      // 下のgetSession()の解決とonAuthStateChangeの初回イベントが同じセッションについて
      // ほぼ同時に届きうる。既に同じユーザーのプロフィールを取得済み、または取得中の場合は
      // 何もしない(同じ内容のselectを2回投げない)。
      if (loadedProfileUserIdRef.current === nextSession.user.id && profileRef.current) {
        finishInitialLoading();
        return;
      }
      if (fetchingUserId === nextSession.user.id) return;
      fetchingUserId = nextSession.user.id;
      setProfileFetching(true);
      try {
        const { profile: p, error } = await fetchProfile(nextSession.user.id, nextSession.user.email ?? null);
        if (cancelled) return;
        if (p) {
          loadedProfileUserIdRef.current = nextSession.user.id;
          profileRef.current = p;
          setProfile(p);
          setProfileError(null);
          return;
        }
        if (profileRef.current) {
          // 一時的な失敗。取得済みのプロフィールを保持して画面を維持する
          // (ここでnullにすると、それまで表示できていた画面が丸ごと差し替わってしまう)。
          console.warn('プロフィールの再取得に失敗しましたが、取得済みの権限情報を保持して表示を継続します:', error);
          return;
        }
        // 一度も取得できていない場合のみ、未設定エラーとして扱う(App.tsxが案内画面を表示する)。
        loadedProfileUserIdRef.current = null;
        setProfile(null);
        setProfileError(error);
      } finally {
        if (fetchingUserId === nextSession.user.id) {
          fetchingUserId = null;
        }
        if (!cancelled) {
          setProfileFetching(false);
          finishInitialLoading();
        }
      }
    };

    // 初回: 保存済みセッションの復元。ここはonAuthStateChangeのコールバック内ではないため、
    // そのままawaitして問題ない。
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      lastAuthEvent = 'INITIAL_GET_SESSION';
      lastAuthEventAt = new Date().toISOString();
      setSession(data.session);
      if (!data.session) {
        setProfile(null);
        setProfileError(null);
        finishInitialLoading();
        return;
      }
      void applyProfile(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      lastAuthEvent = event;
      lastAuthEventAt = new Date().toISOString();

      // セッション自体は常に最新化する(トークン更新を反映するため)。
      setSession(nextSession);

      if (!nextSession) {
        // サインアウト・セッション失効。ログイン画面へ戻すためプロフィールもクリアする。
        loadedProfileUserIdRef.current = null;
        profileRef.current = null;
        setProfile(null);
        setProfileError(null);
        finishInitialLoading();
        return;
      }

      // ★同じユーザーのままのイベント(TOKEN_REFRESHED / SIGNED_IN(タブ復帰時) / USER_UPDATED 等)
      // では、プロフィールを読み直さない。読み直すと一時的な取得失敗でprofileがnullになり、
      // AppShellごとアンマウントされてクラッシュする(ファイル冒頭のコメント参照)。
      // 判定はイベント名ではなく「同じユーザーIDで、既にプロフィールを取得済みか」で行う
      // (将来Supabaseがイベント種別を追加しても安全側に倒れるため)。
      const isSameUserWithProfile =
        loadedProfileUserIdRef.current === nextSession.user.id && profileRef.current !== null;
      if (isSameUserWithProfile) {
        finishInitialLoading();
        return;
      }

      // ユーザーが変わった、またはプロフィール未取得の場合のみ取得する。
      // ★Supabase公式の推奨に従い、コールバック内で他のSupabase呼び出しを直接awaitせず、
      // setTimeout(…, 0)でコールバックを抜けた後に実行する(認証ロックを保持したまま
      // 別の呼び出しを待つことによるデッドロック・タイムアウトを避ける)。
      setTimeout(() => {
        if (cancelled) return;
        void applyProfile(nextSession);
      }, 0);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { error: error.message };
    }
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    // プロフィール未取得のまま取得中の間も「読み込み中」として扱い、「アカウント設定が未完了です」
    // 画面が一瞬表示されてから本体に切り替わる(不要なマウント/アンマウント)のを防ぐ。
    loading: initialLoading || (profileFetching && profile === null),
    profileError,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthはAuthProviderの内側で使用してください');
  }
  return ctx;
}
