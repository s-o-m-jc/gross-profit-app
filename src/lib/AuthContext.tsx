/**
 * 派遣事業 粗利・経理管理システム
 * Supabase認証コンテキスト
 *
 * セッション(ログイン状態)と、profilesテーブルから取得したrole('admin'|'viewer')・
 * company_id(viewerの場合のみ)を一元管理する。
 * - 未ログイン: session === null
 * - ログイン済だがprofilesレコードが未作成: profile === null かつ profileError あり
 *   (管理者がSupabaseダッシュボードでprofilesレコードを作成するまでアプリを使えない)
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadForSession = async (nextSession: Session | null) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setProfileError(null);
        setLoading(false);
        return;
      }
      const { profile: p, error } = await fetchProfile(nextSession.user.id, nextSession.user.email ?? null);
      if (cancelled) return;
      setProfile(p);
      setProfileError(error);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      loadForSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      loadForSession(nextSession);
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
    loading,
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
