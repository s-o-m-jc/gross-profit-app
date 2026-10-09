/**
 * 派遣事業 粗利・経理管理システム
 * 登録申請の承認待ち一覧モーダル(2026-10-09追加)
 *
 * super_admin: 全件(全ロール・全拠点)の承認待ち申請を表示・承認・却下できる。
 * branch_admin: 自拠点宛の「一般」申請のみ表示・承認・却下できる(RLSで絞られる)。
 * 承認・却下はいずれもSECURITY DEFINER関数(approve_registration_request/
 * reject_registration_request)経由(DBの行を直接UPDATEするポリシーは設けていない)。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { X, Check, XCircle, Loader2, Inbox } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { COMPANIES, CompanyId } from '../config/companies';
import { RequestableRole } from '../lib/AuthContext';

interface PendingRequest {
  id: string;
  email: string;
  requestedRole: RequestableRole;
  requestedCompanyId: CompanyId;
  createdAt: string;
}

const ROLE_LABELS: Record<RequestableRole, string> = {
  branch_admin: '拠点管理者',
  general: '一般',
  accounting: '経理担当者',
};

interface ApprovalInboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 承認・却下が発生したら親(App.tsx)に伝える(ヘッダーのバッジ件数の再取得用) */
  onChanged: () => void;
}

export const ApprovalInboxModal: React.FC<ApprovalInboxModalProps> = ({ isOpen, onClose, onChanged }) => {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: fetchError } = await supabase
      .from('registration_requests')
      .select('id, email, requested_role, requested_company_id, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    setLoading(false);
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setRequests(
      (data ?? []).map((r) => ({
        id: r.id,
        email: r.email,
        requestedRole: r.requested_role as RequestableRole,
        requestedCompanyId: r.requested_company_id as CompanyId,
        createdAt: r.created_at,
      }))
    );
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    setError('');
    const { error: rpcError } = await supabase.rpc('approve_registration_request', { p_request_id: id });
    setProcessingId(null);
    if (rpcError) {
      setError(`承認に失敗しました: ${rpcError.message}`);
      return;
    }
    await load();
    onChanged();
  };

  const handleReject = async (id: string) => {
    setProcessingId(id);
    setError('');
    const { error: rpcError } = await supabase.rpc('reject_registration_request', {
      p_request_id: id,
      p_reason: rejectReason.trim() || null,
    });
    setProcessingId(null);
    setRejectingId(null);
    setRejectReason('');
    if (rpcError) {
      setError(`却下に失敗しました: ${rpcError.message}`);
      return;
    }
    await load();
    onChanged();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="w-4 h-4 text-indigo-600" />
            登録申請の承認待ち
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              読み込み中...
            </div>
          )}
          {error && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              {error}
            </div>
          )}
          {!loading && requests.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-8">承認待ちの申請はありません。</p>
          )}
          {requests.map((r) => (
            <div key={r.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-900">{r.email}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    希望ロール: <strong>{ROLE_LABELS[r.requestedRole]}</strong> / 希望拠点:{' '}
                    <strong>{COMPANIES.find((c) => c.id === r.requestedCompanyId)?.name ?? r.requestedCompanyId}</strong>
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    申請日時: {new Date(r.createdAt).toLocaleString('ja-JP')}
                  </p>
                </div>
              </div>

              {rejectingId === r.id ? (
                <div className="space-y-2 pt-1">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="却下理由(任意)"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-rose-400"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReject(r.id)}
                      disabled={processingId === r.id}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white rounded text-xs font-bold"
                    >
                      却下を確定
                    </button>
                    <button
                      onClick={() => {
                        setRejectingId(null);
                        setRejectReason('');
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-xs font-bold"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => handleApprove(r.id)}
                    disabled={processingId === r.id}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded text-xs font-bold"
                  >
                    {processingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    承認
                  </button>
                  <button
                    onClick={() => setRejectingId(r.id)}
                    disabled={processingId === r.id}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-600 rounded text-xs font-bold"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    却下
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
