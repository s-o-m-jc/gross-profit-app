/**
 * 派遣事業 粗利・経理管理システム
 * ログイン画面 (メールアドレス + パスワード)
 */

import React, { useState } from 'react';
import { Calculator, LogIn, AlertCircle, UserPlus, Mail } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

export const LoginPage: React.FC = () => {
  const { signIn, signUp } = useAuth();
  // ★2026-10-09追加: 「ログイン」と「新規登録(サインアップ)」のタブ切り替え。
  // サインアップ後はメール確認が必要なため、ここではまだ利用権限の申請はできない
  // (確認メールのリンクをクリック→ログイン後、App.tsx側で申請フォームを表示する)。
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [signUpDone, setSignUpDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('メールアドレスとパスワードを入力してください。');
      return;
    }
    setSubmitting(true);
    setError('');
    if (mode === 'signIn') {
      const { error: signInError } = await signIn(email.trim(), password);
      setSubmitting(false);
      if (signInError) {
        setError('ログインに失敗しました。メールアドレスまたはパスワードが正しくありません。');
      }
      return;
    }
    if (password.length < 6) {
      setSubmitting(false);
      setError('パスワードは6文字以上で入力してください。');
      return;
    }
    const { error: signUpError } = await signUp(email.trim(), password);
    setSubmitting(false);
    if (signUpError) {
      setError(`登録に失敗しました: ${signUpError}`);
      return;
    }
    setSignUpDone(true);
  };

  if (signUpDone) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <Mail className="w-8 h-8 text-indigo-600 mx-auto mb-3" />
          <h1 className="text-sm font-bold text-slate-900 mb-2">確認メールを送信しました</h1>
          <p className="text-xs text-slate-600 mb-4">
            {email} 宛に確認メールを送信しました。メール内のリンクをクリックしてログインしてください。
            ログイン後、利用したいロール・拠点を申請する画面が表示されます。
          </p>
          <button
            onClick={() => {
              setSignUpDone(false);
              setMode('signIn');
            }}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold"
          >
            ログイン画面へ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-slate-200 p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="p-3 bg-indigo-600 rounded-lg text-white shadow-inner mb-3">
            <Calculator className="w-7 h-7" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 text-center">
            派遣事業 粗利・経理管理システム
          </h1>
          <p className="text-xs text-slate-500 mt-1">ログインしてください</p>
        </div>

        <div className="flex border border-slate-200 rounded-lg mb-5 p-0.5 bg-slate-100">
          <button
            type="button"
            onClick={() => {
              setMode('signIn');
              setError('');
            }}
            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${
              mode === 'signIn' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            ログイン
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signUp');
              setError('');
            }}
            className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${
              mode === 'signUp' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            新規登録(申請)
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 block mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-full"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 block mb-1">
              パスワード
            </label>
            <input
              type="password"
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-full"
            />
          </div>

          {error && (
            <div className="flex items-start space-x-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center space-x-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold shadow-sm transition-colors"
          >
            {mode === 'signIn' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            <span>
              {submitting
                ? mode === 'signIn'
                  ? 'ログイン中...'
                  : '登録中...'
                : mode === 'signIn'
                  ? 'ログイン'
                  : '新規登録'}
            </span>
          </button>
        </form>

        <p className="text-[11px] text-slate-400 mt-6 text-center">
          {mode === 'signIn'
            ? 'アカウントをお持ちでない場合は、上の「新規登録(申請)」から登録してください。'
            : '登録後、確認メールのリンクをクリックし、ログインしてから利用権限(ロール・拠点)を申請してください。'}
        </p>
      </div>
    </div>
  );
};
