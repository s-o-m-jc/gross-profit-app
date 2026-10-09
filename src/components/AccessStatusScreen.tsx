/**
 * 派遣事業 粗利・経理管理システム
 * 利用権限の申請・承認待ち・却下画面(2026-10-09追加)
 *
 * profile === null(=まだ利用権限が無い)の場合にApp.tsxから表示する。
 * - 申請が無い: 希望ロール・拠点を選んで申請するフォーム
 * - 申請がpending: 承認待ち画面(30秒ごとに自動で状況を再確認する)
 * - 申請がrejected: 却下理由を表示し、再申請できるようにする
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Clock, LogOut, RefreshCw, Send, XCircle } from 'lucide-react';
import { useAuth, RequestableRole } from '../lib/AuthContext';
import { COMPANIES, CompanyId } from '../config/companies';

const ROLE_LABELS: Record<RequestableRole, string> = {
  branch_admin: '拠点管理者(全拠点閲覧・自拠点の「一般」申請の承認)',
  general: '一般(自拠点のみ閲覧)',
  accounting: '経理担当者(自拠点のみ閲覧・編集・CSV入出力)',
};

const POLL_INTERVAL_MS = 30_000;

export const AccessStatusScreen: React.FC = () => {
  const { myRegistrationRequest, profileError, signOut, submitRegistrationRequest, refreshAccessStatus } = useAuth();

  // 承認待ち(pending)の間は30秒ごとに自動で再確認する(承認/却下されたら画面が自動で切り替わる)。
  useEffect(() => {
    if (myRegistrationRequest?.status !== 'pending') return;
    const timer = setInterval(() => {
      void refreshAccessStatus();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [myRegistrationRequest?.status, refreshAccessStatus]);

  if (myRegistrationRequest?.status === 'pending') {
    return (
      <StatusCard icon={<Clock className="w-8 h-8 text-amber-500" />} title="承認待ちです">
        <p className="text-xs text-slate-600 mb-1">
          希望ロール: <strong>{ROLE_LABELS[myRegistrationRequest.requestedRole]}</strong>
        </p>
        <p className="text-xs text-slate-600 mb-4">
          希望拠点: <strong>{COMPANIES.find((c) => c.id === myRegistrationRequest.requestedCompanyId)?.name ?? myRegistrationRequest.requestedCompanyId}</strong>
        </p>
        <p className="text-xs text-slate-500 mb-4">
          管理者が承認するまでお待ちください。この画面は自動的に状況を確認します。
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => void refreshAccessStatus()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            今すぐ再確認
          </button>
          <button
            onClick={() => signOut()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold"
          >
            <LogOut className="w-3.5 h-3.5" />
            ログアウト
          </button>
        </div>
      </StatusCard>
    );
  }

  if (myRegistrationRequest?.status === 'rejected') {
    return (
      <RequestForm
        banner={
          <div className="flex items-start space-x-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 mb-4">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              前回の申請は却下されました。
              {myRegistrationRequest.rejectionReason && `(理由: ${myRegistrationRequest.rejectionReason})`}
              内容を確認して再度申請してください。
            </span>
          </div>
        }
        onSubmit={submitRegistrationRequest}
        onSignOut={signOut}
      />
    );
  }

  // 申請が存在しない(通常のケース。profileErrorはあるがmyRegistrationRequestがnull)
  return (
    <RequestForm
      banner={
        profileError ? (
          <div className="flex items-start space-x-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 mb-4">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{profileError}</span>
          </div>
        ) : null
      }
      onSubmit={submitRegistrationRequest}
      onSignOut={signOut}
    />
  );
};

const StatusCard: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
  icon,
  title,
  children,
}) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
    <div className="max-w-md bg-white rounded-xl shadow-sm border border-slate-200 p-6 text-center">
      <div className="mx-auto mb-3 flex justify-center">{icon}</div>
      <h1 className="text-sm font-bold text-slate-900 mb-3">{title}</h1>
      {children}
    </div>
  </div>
);

const RequestForm: React.FC<{
  banner: React.ReactNode;
  onSubmit: (role: RequestableRole, companyId: CompanyId) => Promise<{ error: string | null }>;
  onSignOut: () => void;
}> = ({ banner, onSubmit, onSignOut }) => {
  const [role, setRole] = useState<RequestableRole>('general');
  const [companyId, setCompanyId] = useState<CompanyId>(COMPANIES[0].id);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const { error: submitError } = await onSubmit(role, companyId);
    setSubmitting(false);
    if (submitError) setError(submitError);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h1 className="text-sm font-bold text-slate-900 mb-1 text-center">利用権限の申請</h1>
        <p className="text-xs text-slate-500 mb-4 text-center">
          希望するロール・拠点を選んで申請してください。管理者が承認すると利用できます。
        </p>
        {banner}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 block mb-1">希望ロール</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RequestableRole)}
              className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="general">一般(自拠点のみ閲覧)</option>
              <option value="branch_admin">拠点管理者(全拠点閲覧・自拠点の「一般」申請の承認)</option>
              <option value="accounting">経理担当者(自拠点のみ閲覧・編集・CSV入出力)</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 block mb-1">希望拠点</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value as CompanyId)}
              className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {COMPANIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">
              「拠点管理者」「経理担当者」の申請は全管理者のみ承認できます。「一般」の申請はここで選んだ拠点の拠点管理者、または全管理者が承認できます。
            </p>
          </div>

          {error && (
            <div className="flex items-start space-x-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center space-x-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-sm font-bold shadow-sm transition-colors"
          >
            <Send className="w-4 h-4" />
            <span>{submitting ? '申請中...' : '申請する'}</span>
          </button>
        </form>

        <button
          onClick={onSignOut}
          className="w-full mt-3 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-bold"
        >
          <LogOut className="w-3.5 h-3.5" />
          ログアウト
        </button>
      </div>
    </div>
  );
};
