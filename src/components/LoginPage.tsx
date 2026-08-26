/**
 * 派遣事業 粗利・経理管理システム
 * ログイン画面 (メールアドレス + パスワード)
 */

import React, { useState } from 'react';
import { Calculator, LogIn, AlertCircle } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

export const LoginPage: React.FC = () => {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('メールアドレスとパスワードを入力してください。');
      return;
    }
    setSubmitting(true);
    setError('');
    const { error: signInError } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (signInError) {
      setError('ログインに失敗しました。メールアドレスまたはパスワードが正しくありません。');
    }
  };

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
              autoComplete="current-password"
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
            <LogIn className="w-4 h-4" />
            <span>{submitting ? 'ログイン中...' : 'ログイン'}</span>
          </button>
        </form>

        <p className="text-[11px] text-slate-400 mt-6 text-center">
          アカウントをお持ちでない場合は、管理者にお問い合わせください。
        </p>
      </div>
    </div>
  );
};
