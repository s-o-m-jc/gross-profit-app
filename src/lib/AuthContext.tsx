/**
 * 派遣事業 粗利・経理管理システム
 * Supabase認証コンテキスト
 *
 * セッション(ログイン状態)と、profilesテーブルから取得したrole('super_admin'|'branch_admin'|
 * 'general'|'accounting')・company_id(super_admin以外は必須)を一元管理する。
 * - 未ログイン: session === null
 * - ログイン済だがprofilesレコードが未作成: profile === null
 *   (★2026-10-09追加: この場合、myRegistrationRequestで申請状況(無し/承認待ち/却下)を判別する。
 *   「無し」なら本人がロール・拠点を選んで申請するフォームを、「承認待ち」なら待機画面を、
 *   「却下」なら却下理由と再申請ボタンを、App.tsx側で表示する。)
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

export type UserRole = 'super_admin' | 'branch_admin' | 'general' | 'accounting';

/** 本人が申請できるロール(super_adminは既存の全管理者が直接付与するため申請対象外) */
export type RequestableRole = 'branch_admin' | 'general' | 'accounting';

export interface Profile {
  id: string;
  email: string | null;
  role: UserRole;
  companyId: CompanyId | null;
}

export interface MyRegistrationRequest {
  id: string;
  requestedRole: RequestableRole;
  requestedCompanyId: CompanyId;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  createdAt: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** 認証状態・プロフィールの初回読み込み中かどうか */
  loading: boolean;
  /** profilesテーブルの取得に失敗した場合(未作成 or 権限エラー)のメッセージ */
  profileError: string | null;
  /** profile===nullの場合の、本人の最新の登録申請(無ければnull)。2026-10-09追加。 */
  myRegistrationRequest: MyRegistrationRequest | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** メール確認付きのサインアップ(2026-10-09追加)。確認メールのリンクをクリックするまでログインできない。 */
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  /** 希望ロール・拠点を指定して登録申請する(2026-10-09追加)。却下後の再申請もこれで行う。 */
  submitRegistrationRequest: (role: RequestableRole, companyId: CompanyId) => Promise<{ error: string | null }>;
  /** profile・myRegistrationRequestを再取得する(承認待ち画面のポーリング・手動再確認用)。 */
  refreshAccessStatus: () => Promise<void>;
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
        'このアカウントにはまだ利用権限が設定されていません。希望するロール・拠点を指定して申請してください。',
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

/**
 * 本人の最新の登録申請を1件取得する(無ければnull)。profileが取得できなかった場合にのみ呼ぶ
 * (承認済みなら通常はprofilesが存在するはずだが、念のためstatusも見て判定する)。
 */
async function fetchMyRegistrationRequest(userId: string): Promise<MyRegistrationRequest | null> {
  const { data, error } = await supabase
    .from('registration_requests')
    .select('id, requested_role, requested_company_id, status, rejection_reason, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    requestedRole: data.requested_role as RequestableRole,
    requestedCompanyId: data.requested_company_id as CompanyId,
    status: data.status as 'pending' | 'approved' | 'rejected',
    rejectionReason: data.rejection_reason ?? null,
    createdAt: data.created_at,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [myRegistrationRequest, setMyRegistrationRequest] = useState<MyRegistrationRequest | null>(null);
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
          setMyRegistrationRequest(null);
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
        // ★2026-10-09追加: 本人の登録申請の状況も取得する(申請フォーム/承認待ち/却下のどれを
        // 出すかをApp.tsx側で判定するため)。
        const myReq = await fetchMyRegistrationRequest(nextSession.user.id);
        if (!cancelled) setMyRegistrationRequest(myReq);
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
        setMyRegistrationRequest(null);
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
        setMyRegistrationRequest(null);
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

  // ★2026-10-09追加: メール確認付きサインアップ。確認メールのリンクをクリックするまで
  // supabase.auth側でログイン不可(セッションが発行されない)。
  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      return { error: error.message };
    }
    return { error: null };
  }, []);

  // ★2026-10-09追加: profile・myRegistrationRequestを明示的に再取得する。承認待ち画面の
  // ポーリング・「再確認」ボタン・申請直後の表示切替に使う。applyProfile(useEffect内)とは別の
  // 独立した実装にしてあり、認証クラッシュ対策の既存ロジック(ファイル冒頭コメント参照)には触れない。
  const refreshAccessStatus = useCallback(async () => {
    if (!session) return;
    const { profile: p, error } = await fetchProfile(session.user.id, session.user.email ?? null);
    if (p) {
      loadedProfileUserIdRef.current = session.user.id;
      profileRef.current = p;
      setProfile(p);
      setProfileError(null);
      setMyRegistrationRequest(null);
      return;
    }
    setProfileError(error);
    const myReq = await fetchMyRegistrationRequest(session.user.id);
    setMyRegistrationRequest(myReq);
  }, [session]);

  // ★2026-10-09追加: 希望ロール・拠点を指定して登録申請する。却下後の再申請もこれで行う
  // (却下済みの行はstatus='rejected'のまま残るため、新しいpending行を作れる)。
  const submitRegistrationRequest = useCallback(
    async (role: RequestableRole, companyId: CompanyId) => {
      if (!session) return { error: 'ログインしていません。' };
      const { error } = await supabase.from('registration_requests').insert({
        user_id: session.user.id,
        email: session.user.email ?? '',
        requested_role: role,
        requested_company_id: companyId,
      });
      if (error) {
        return { error: error.message };
      }
      await refreshAccessStatus();
      return { error: null };
    },
    [session, refreshAccessStatus]
  );

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    // プロフィール未取得のまま取得中の間も「読み込み中」として扱い、「アカウント設定が未完了です」
    // 画面が一瞬表示されてから本体に切り替わる(不要なマウント/アンマウント)のを防ぐ。
    loading: initialLoading || (profileFetching && profile === null),
    profileError,
    myRegistrationRequest,
    signIn,
    signOut,
    signUp,
    submitRegistrationRequest,
    refreshAccessStatus,
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
