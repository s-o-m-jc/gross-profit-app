/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calculator,
  Table,
  BarChart2,
  ShieldAlert,
  FileSpreadsheet,
  Loader2,
  AlertTriangle,
  Wallet,
} from 'lucide-react';
import { Header } from './components/Header';
import { CsvUploader } from './components/CsvUploader';
import { MonthlyDataPanel } from './components/MonthlyDataPanel';
import { ChangeHistoryPanel } from './components/ChangeHistoryPanel';
import { ManualAdjustmentsPanel } from './components/ManualAdjustmentsPanel';
import { RetirementPanel } from './components/RetirementPanel';
import { MonthlyCalculationTable } from './components/MonthlyCalculationTable';
import { StaffPayrollDetail } from './components/StaffPayrollDetail';
import { AnomalyAuditPanel } from './components/AnomalyAuditPanel';
import { FiscalYearAnalytics } from './components/FiscalYearAnalytics';
import { MCodeReferenceModal } from './components/MCodeReferenceModal';
import { ExportModal } from './components/ExportModal';
import { LoginPage } from './components/LoginPage';

import {
  PayrollRow,
  BillingRow,
  InvoicePrintRow,
  RetirementRow,
  LeaveCompensationRow,
  LeaveAllowanceRow,
  NextMonthAdjustmentRow,
} from './types';
import { calculateGrossProfit, calculateFiscalYearSummary, getFiscalYearMonths } from './utils/calculator';
import { COMPANIES, DEFAULT_COMPANY_ID, getCompanyConfig, CompanyId } from './config/companies';
import {
  AppMonthlyData,
  CompanyMonthlyData,
  MonthlyDataState,
  ManualEntryCategory,
  initialAppMonthlyData,
  flattenCompanyMonths,
  mergeGroupedRowsIntoCompanyMonths,
  mergeSampleDataIntoCompanyMonths,
  clearCompanyMonths,
  groupByTargetMonth,
  hasAnyData,
  addManualEntryRow,
  removeManualEntryRow,
} from './utils/monthlyData';
import { loadAppState, saveAppState } from './utils/persistence';
import { fetchMonthlyDataForCompanies, replaceCompanyMonthlyData } from './utils/supabaseSync';
import { downloadBackupFile, parseBackupFile } from './utils/backupFile';
import { useAuth, Profile } from './lib/AuthContext';

/**
 * ★2026-08-26: 拠点ごとの項目対応表の整理が終わるまで、休業分補償・休業手当・次月調整の
 * 手入力調整パネルは実運用では使わない方針となったため、UI表示のみ一時的にオフにする。
 * データモデル・保存ロジック(addManualEntryRow/removeManualEntryRow等)はそのまま残しており、
 * このフラグをtrueに戻せば即座に再表示できる。
 */
const SHOW_MANUAL_ADJUSTMENTS_PANEL = false;

/**
 * 決算開始月(会社ごとに異なる。src/config/companiesの設定テーブル参照)から、
 * 決算期セレクタの選択肢を組み立てる。
 * 3社確定値(要件整理12章): 大阪人材=07 / 四国人材=10 / 松山人材=09。
 */
function buildFiscalYearOptions(
  startMonthStr: string,
  count: number = 3
): { value: string; label: string }[] {
  const startMonth = parseInt(startMonthStr, 10) || 4;
  const currentYear = new Date().getFullYear();

  return Array.from({ length: count }, (_, i) => {
    const year = currentYear - i;
    const endMonth = startMonth === 1 ? 12 : startMonth - 1;
    const endYear = startMonth === 1 ? year : year + 1;
    const mm = (n: number) => String(n).padStart(2, '0');
    const value = `${year}-${mm(startMonth)}`;
    const label =
      startMonth === 4
        ? `${year}年度 (${year}/04〜${endYear}/03)`
        : `${year}年${startMonth}月期 (${year}/${mm(startMonth)}〜${endYear}/${mm(endMonth)})`;
    return { value, label };
  });
}

/**
 * 認証ゲート: 未ログイン時はログイン画面、profiles未設定時はエラー画面を表示し、
 * ログイン済み・権限確定後のみ本体(AppShell)を描画する。
 */
export default function App() {
  const { session, profile, loading, profileError, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-500 text-sm">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        読み込み中...
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
        <div className="max-w-md bg-white rounded-xl shadow-sm border border-rose-200 p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
          <h1 className="text-sm font-bold text-slate-900 mb-2">アカウント設定が未完了です</h1>
          <p className="text-xs text-slate-600 mb-4">
            {profileError || 'このアカウントには利用権限が設定されていません。'}
          </p>
          <button
            onClick={() => signOut()}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold"
          >
            ログアウト
          </button>
        </div>
      </div>
    );
  }

  return <AppShell profile={profile} onSignOut={signOut} />;
}

interface AppShellProps {
  profile: Profile;
  onSignOut: () => void;
}

function AppShell({ profile, onSignOut }: AppShellProps) {
  // adminは全社・全機能(編集含む)。viewerは自分のcompany_idの会社のみ・閲覧専用。
  const canEdit = profile.role === 'admin';
  const visibleCompanies = useMemo(
    () => (canEdit ? COMPANIES : COMPANIES.filter((c) => c.id === profile.companyId)),
    [canEdit, profile.companyId]
  );

  // Vite環境変数からの読み込み (Vite環境ルール厳守)。会社名・決算開始月は会社ごとに切り替える値のため、
  // 環境変数ではなくsrc/config/companiesの設定テーブルから取得する (アプリ全体共通の値のみ環境変数を使う)。
  const defaultTaxRate = Number(import.meta.env.VITE_DEFAULT_TAX_RATE || '0.1');
  const defaultLowMarginThreshold = Number(
    import.meta.env.VITE_LOW_MARGIN_THRESHOLD || '10'
  );

  // 選択中の会社 (adminは3社を切り替え、viewerは自社に固定)
  const [selectedCompanyId, setSelectedCompanyId] = useState<CompanyId>(
    canEdit ? DEFAULT_COMPANY_ID : (profile.companyId as CompanyId) || DEFAULT_COMPANY_ID
  );
  const selectedCompany = useMemo(() => getCompanyConfig(selectedCompanyId), [selectedCompanyId]);

  const fiscalYearOptions = useMemo(
    () => buildFiscalYearOptions(selectedCompany.fiscalStartMonth),
    [selectedCompany.fiscalStartMonth]
  );

  // ステート
  // 会社ID → 対象月(YYYY-MM) → {payrollRows, billingRows, invoiceRows, retirementRows} の
  // 2段階キー構造。毎月新しいCSVを追加アップロードしながら決算期を通して使い続けられるよう、
  // 月ごとのデータを蓄積する。★2026-08-26: メインの保存先はSupabase(monthly_dataテーブル)。
  // IndexedDBはオフライン閲覧用のローカルキャッシュとして残す(src/utils/persistence.ts参照)。
  const [monthlyData, setMonthlyData] = useState<AppMonthlyData>(initialAppMonthlyData);
  // Supabase(または、失敗時はIndexedDBキャッシュ)からの初回読込が完了したかどうか。
  // 完了前は自動保存を走らせない(復元前の空の初期値で保存済みデータを上書きしてしまうのを防ぐ)。
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  // Supabaseへの接続に失敗し、IndexedDBキャッシュ(閲覧専用)にフォールバックしたかどうか
  const [isOffline, setIsOffline] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // CSVアップロードの「取り消し」機能用。アップロード直前(1操作分のみ)の会社の月別データを保持する。
  // 会社を切り替えると別会社のスナップショットは無効化する(canUndoの判定でcompanyId一致を必須にする)。
  const [undoSnapshot, setUndoSnapshot] = useState<{
    companyId: CompanyId;
    companyMonths: CompanyMonthlyData;
    label: string;
  } | null>(null);

  const selectedCompanyMonths = monthlyData[selectedCompanyId];
  // 選択中の会社の全月のデータを1つのフラットな束にまとめる(粗利計算エンジンへの入力用)。
  // calculator.tsの結合ロジックはtargetMonthをキーの一部にしているため、複数月分を
  // まとめて渡しても月をまたいで誤結合することはない(20日締重複統合・複数契約検知も月単位で判定)。
  const flattened = useMemo(() => flattenCompanyMonths(selectedCompanyMonths), [selectedCompanyMonths]);
  const {
    payrollRows,
    billingRows,
    invoiceRows,
    retirementRows,
    leaveCompensationRows,
    leaveAllowanceRows,
    nextMonthAdjustmentRows,
  } = flattened;

  const [taxRate, setTaxRate] = useState<number>(defaultTaxRate);
  const [fiscalYear, setFiscalYear] = useState<string>(fiscalYearOptions[0].value);
  const [activeTab, setActiveTab] = useState<'monthly' | 'staffPayroll' | 'fiscal' | 'audit'>('monthly');
  // 月次粗利明細一覧の「年間(決算期)」表示切替用: 選択中の決算期に属する12ヶ月分の対象年月一覧とラベル
  const fiscalYearMonths = useMemo(() => getFiscalYearMonths(fiscalYear, 12), [fiscalYear]);
  const fiscalYearLabel = useMemo(
    () => fiscalYearOptions.find((opt) => opt.value === fiscalYear)?.label ?? fiscalYear,
    [fiscalYearOptions, fiscalYear]
  );

  // モーダル表示フラグ
  const [isMCodeGuideOpen, setIsMCodeGuideOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // 選択中の会社の決算期開始月が変わった(=会社を切り替えた)ら、決算期セレクタの値が
  // 新しい選択肢に存在しない場合のみ既定値(先頭の選択肢)にリセットする。
  useEffect(() => {
    if (!fiscalYearOptions.some((opt) => opt.value === fiscalYear)) {
      setFiscalYear(fiscalYearOptions[0].value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiscalYearOptions]);

  // 直前に読み込み/保存したmonthlyDataを保持し、Supabaseへの差分保存(会社単位)や
  // 二重保存の抑止に使う(参照が変わった会社だけを保存対象にする)。
  const prevMonthlyDataRef = useRef<AppMonthlyData>(monthlyData);

  // 起動時: Supabaseから自分が閲覧可能な会社(adminは全社/viewerは自社)のデータを読み込む。
  // 失敗時(オフライン等)はIndexedDBキャッシュにフォールバックする。
  useEffect(() => {
    let cancelled = false;
    const allowedCompanyIds = visibleCompanies.map((c) => c.id);

    (async () => {
      try {
        const remote = await fetchMonthlyDataForCompanies(allowedCompanyIds);
        if (cancelled) return;
        setMonthlyData(remote);
        prevMonthlyDataRef.current = remote;
        setIsOffline(false);
        setSyncError(null);
        // 管理者かつ本当にデータが1件も無い(初回利用)場合のみ、四国人材へサンプルデータを
        // 自動投入する(従来のIndexedDB単体運用時の挙動を踏襲した初回オンボーディング用)。
        if (canEdit && !hasAnyData(remote) && allowedCompanyIds.includes(DEFAULT_COMPANY_ID)) {
          const withSample = {
            ...remote,
            [DEFAULT_COMPANY_ID]: mergeSampleDataIntoCompanyMonths(remote[DEFAULT_COMPANY_ID]),
          };
          setMonthlyData(withSample);
        }
        // ローカルキャッシュも最新化しておく(次回オフライン時のフォールバック用)
        await saveAppState({ monthlyData: remote, selectedCompanyId });
      } catch (e) {
        console.warn('Supabaseからの読込に失敗しました。ローカルキャッシュを表示します:', e);
        if (cancelled) return;
        const cached = await loadAppState();
        if (cached && hasAnyData(cached.monthlyData)) {
          const merged = initialAppMonthlyData();
          allowedCompanyIds.forEach((id) => {
            merged[id] = cached.monthlyData[id] || {};
          });
          setMonthlyData(merged);
          prevMonthlyDataRef.current = merged;
        }
        setIsOffline(true);
        setSyncError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setIsDataLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // profile(会社の閲覧範囲)は起動時に確定しており変化しないため、初回のみ実行する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自動保存: monthlyDataが変わるたび、変化があった会社だけをSupabaseへ反映する(adminのみ。
  // viewerは編集操作自体がUI上できず、RLSでも書き込みが拒否されるため実行しない)。
  // 併せてIndexedDBキャッシュ(オフライン閲覧用)も常に最新化する。
  useEffect(() => {
    if (!isDataLoaded) return;
    const timer = setTimeout(async () => {
      if (canEdit && !isOffline) {
        const prev = prevMonthlyDataRef.current;
        const changedCompanies = COMPANIES.filter((c) => monthlyData[c.id] !== prev[c.id]);
        for (const company of changedCompanies) {
          try {
            await replaceCompanyMonthlyData(company.id, monthlyData[company.id]);
            setSyncError(null);
          } catch (e) {
            console.error('Supabaseへの保存に失敗しました:', e);
            setSyncError(e instanceof Error ? e.message : String(e));
          }
        }
        prevMonthlyDataRef.current = monthlyData;
      }
      saveAppState({ monthlyData, selectedCompanyId });
    }, 500);
    return () => clearTimeout(timer);
  }, [monthlyData, selectedCompanyId, isDataLoaded, canEdit, isOffline]);

  // 選択中の会社・該当する対象月のバケツだけを更新するアップロードハンドラ群。
  // 同一月への再アップロードは、その月のそのカテゴリだけをクリーンに置き換える
  // (他の月・他のカテゴリ・他社のデータには一切触れない)。
  // ★2026-08-26: 誤って別のCSVをアップロードした場合に備え、適用前の状態を1操作分だけ
  // undoSnapshotに保持しておく(CsvUploaderの「直前のアップロードを取り消す」ボタン用)。
  const handlePayrollLoaded = (rows: PayrollRow[]) => {
    setUndoSnapshot({ companyId: selectedCompanyId, companyMonths: selectedCompanyMonths, label: `給与データCSV読込 (${selectedCompany.name})` });
    setMonthlyData((prev) => ({
      ...prev,
      [selectedCompanyId]: mergeGroupedRowsIntoCompanyMonths(
        prev[selectedCompanyId],
        'payrollRows',
        groupByTargetMonth(rows)
      ),
    }));
  };
  const handleBillingLoaded = (rows: BillingRow[]) => {
    setUndoSnapshot({ companyId: selectedCompanyId, companyMonths: selectedCompanyMonths, label: `請求データCSV読込 (${selectedCompany.name})` });
    setMonthlyData((prev) => ({
      ...prev,
      [selectedCompanyId]: mergeGroupedRowsIntoCompanyMonths(
        prev[selectedCompanyId],
        'billingRows',
        groupByTargetMonth(rows)
      ),
    }));
  };
  // 請求書印刷CSVも、請求支払一覧CSVと同じくファイル名から対象月を取得し(11-2章)、
  // 他の3カテゴリと同じ月バケツ方式で保持する。
  const handleInvoiceLoaded = (rows: InvoicePrintRow[]) => {
    setUndoSnapshot({ companyId: selectedCompanyId, companyMonths: selectedCompanyMonths, label: `請求書印刷CSV読込 (${selectedCompany.name})` });
    setMonthlyData((prev) => ({
      ...prev,
      [selectedCompanyId]: mergeGroupedRowsIntoCompanyMonths(
        prev[selectedCompanyId],
        'invoiceRows',
        groupByTargetMonth(rows)
      ),
    }));
  };
  const handleUndoLastCsvUpload = () => {
    if (!undoSnapshot || undoSnapshot.companyId !== selectedCompanyId) return;
    setMonthlyData((prev) => ({ ...prev, [undoSnapshot.companyId]: undoSnapshot.companyMonths }));
    setUndoSnapshot(null);
  };

  // 15章: 手入力調整項目(休業分補償・休業手当・次月調整)の追加/削除ハンドラ群。
  // CSVカテゴリと違い、対象月のバケツ内の他の手入力行を保持したまま1件ずつ追加/削除する。
  const handleAddManualEntry = <K extends ManualEntryCategory>(
    category: K,
    row: MonthlyDataState[K][number]
  ) => {
    setMonthlyData((prev) => ({
      ...prev,
      [selectedCompanyId]: addManualEntryRow(prev[selectedCompanyId], category, row.targetMonth, row),
    }));
  };
  const handleRemoveManualEntry = (category: ManualEntryCategory, month: string, rowId: string) => {
    setMonthlyData((prev) => ({
      ...prev,
      [selectedCompanyId]: removeManualEntryRow(prev[selectedCompanyId], category, month, rowId),
    }));
  };

  const handleAddLeaveCompensation = (row: LeaveCompensationRow) =>
    handleAddManualEntry('leaveCompensationRows', row);
  const handleRemoveLeaveCompensation = (row: LeaveCompensationRow) =>
    handleRemoveManualEntry('leaveCompensationRows', row.targetMonth, row.id);
  const handleAddLeaveAllowance = (row: LeaveAllowanceRow) =>
    handleAddManualEntry('leaveAllowanceRows', row);
  const handleRemoveLeaveAllowance = (row: LeaveAllowanceRow) =>
    handleRemoveManualEntry('leaveAllowanceRows', row.targetMonth, row.id);
  const handleAddNextMonthAdjustment = (row: NextMonthAdjustmentRow) =>
    handleAddManualEntry('nextMonthAdjustmentRows', row);
  const handleRemoveNextMonthAdjustment = (row: NextMonthAdjustmentRow) =>
    handleRemoveManualEntry('nextMonthAdjustmentRows', row.targetMonth, row.id);
  // 退職金配賦(★2026-08-26: CSV取込から手入力方式に変更。休業分補償等と同じく1件ずつ追加/削除する)
  const handleAddRetirement = (row: RetirementRow) => handleAddManualEntry('retirementRows', row);
  const handleRemoveRetirement = (row: RetirementRow) =>
    handleRemoveManualEntry('retirementRows', row.targetMonth, row.id);

  const handleLoadSampleData = () => {
    setMonthlyData((prev) => ({
      ...prev,
      [selectedCompanyId]: mergeSampleDataIntoCompanyMonths(prev[selectedCompanyId]),
    }));
  };

  const handleClearAll = () => {
    if (
      !window.confirm(
        `${selectedCompany.name}の全月のデータを削除します。この操作は元に戻せません(Supabase上のデータも削除されます)。よろしいですか？`
      )
    ) {
      return;
    }
    setMonthlyData((prev) => clearCompanyMonths(prev, selectedCompanyId));
  };

  // プロジェクトデータ(閲覧可能な会社・全月)をJSONファイルに保存/読込する
  // (PCの乗り換え・ブラウザ変更時に、このファイルを新環境へ持ち込んで読み込む運用を想定)
  const handleSaveToFile = () => {
    downloadBackupFile(monthlyData);
  };

  const handleLoadFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = (e.target?.result as string) || '';
        const restored = parseBackupFile(text);
        if (
          !window.confirm(
            '現在のすべてのデータ(閲覧可能な会社・全月)を、選択したファイルの内容で上書きします。よろしいですか？'
          )
        ) {
          return;
        }
        setMonthlyData((prev) => {
          const merged = { ...prev };
          visibleCompanies.forEach((c) => {
            merged[c.id] = restored[c.id] || {};
          });
          return merged;
        });
      } catch (err) {
        window.alert(`読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  // 仕様書 v1.1 に基づく自動計算エンジン実行 (選択中の会社の全月のデータを対象)
  const calculatedResults = useMemo(() => {
    return calculateGrossProfit(
      payrollRows,
      billingRows,
      invoiceRows,
      retirementRows,
      taxRate,
      leaveCompensationRows,
      leaveAllowanceRows,
      nextMonthAdjustmentRows
    );
  }, [
    payrollRows,
    billingRows,
    invoiceRows,
    retirementRows,
    taxRate,
    leaveCompensationRows,
    leaveAllowanceRows,
    nextMonthAdjustmentRows,
  ]);

  // 決算期サマリー計算 (calculateFiscalYearSummary自身が、渡された全月のデータの中から
  // 選択中の決算期の12ヶ月分だけをtargetMonthで絞り込む。計算ロジック自体は変更していない)
  const fiscalSummary = useMemo(() => {
    return calculateFiscalYearSummary(calculatedResults, payrollRows, fiscalYear, 12);
  }, [calculatedResults, payrollRows, fiscalYear]);

  if (!isDataLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-500 text-sm">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        読み込み中...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 antialiased selection:bg-indigo-500 selection:text-white">
      {/* ヘッダー */}
      <Header
        companyName={selectedCompany.name}
        companies={visibleCompanies}
        selectedCompanyId={selectedCompanyId}
        onCompanyChange={setSelectedCompanyId}
        canSwitchCompany={canEdit}
        taxRate={taxRate}
        onTaxRateChange={setTaxRate}
        fiscalYear={fiscalYear}
        onFiscalYearChange={setFiscalYear}
        fiscalYearOptions={fiscalYearOptions}
        onLoadSampleData={handleLoadSampleData}
        onOpenMCodeGuide={() => setIsMCodeGuideOpen(true)}
        alertCount={fiscalSummary.alertCount}
        totalBillingCount={calculatedResults.length}
        canEdit={canEdit}
        userEmail={profile.email}
        userRole={profile.role}
        onSignOut={onSignOut}
      />

      {/* オフライン/同期エラーの通知バナー */}
      {(isOffline || syncError) && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
          <div className="flex items-start space-x-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {isOffline
                ? 'Supabaseに接続できないため、ローカルキャッシュのデータを表示しています(閲覧のみ・最新の変更が反映されていない可能性があります)。'
                : `Supabaseへの保存でエラーが発生しました: ${syncError}`}
            </span>
          </div>
        </div>
      )}

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* データ管理パネル (月別データ一覧・ファイル保存/読込) */}
        <MonthlyDataPanel
          companyName={selectedCompany.name}
          companyMonths={selectedCompanyMonths}
          onSaveToFile={handleSaveToFile}
          onLoadFromFile={handleLoadFromFile}
          canEdit={canEdit}
        />

        {/* 変更履歴(自動バックアップ)パネル。adminのみ(RLSでもadminのみ参照可) */}
        {canEdit && !isOffline && (
          <ChangeHistoryPanel companyId={selectedCompanyId} companyName={selectedCompany.name} />
        )}

        {/* 手入力調整パネル (休業分補償・休業手当・次月調整)
            ★2026-08-26: 拠点ごとの項目対応表の整理が終わるまでUI非表示(SHOW_MANUAL_ADJUSTMENTS_PANEL参照) */}
        {SHOW_MANUAL_ADJUSTMENTS_PANEL && (
          <ManualAdjustmentsPanel
            companyName={selectedCompany.name}
            companyMonths={selectedCompanyMonths}
            onAddLeaveCompensation={handleAddLeaveCompensation}
            onRemoveLeaveCompensation={handleRemoveLeaveCompensation}
            onAddLeaveAllowance={handleAddLeaveAllowance}
            onRemoveLeaveAllowance={handleRemoveLeaveAllowance}
            onAddNextMonthAdjustment={handleAddNextMonthAdjustment}
            onRemoveNextMonthAdjustment={handleRemoveNextMonthAdjustment}
            canEdit={canEdit}
          />
        )}

        {/* 退職金配賦 手入力パネル (★2026-08-26: CSV取込から手入力方式に変更) */}
        <RetirementPanel
          companyName={selectedCompany.name}
          companyMonths={selectedCompanyMonths}
          onAdd={handleAddRetirement}
          onRemove={handleRemoveRetirement}
          canEdit={canEdit}
        />

        {/* CSVアップローダー (閲覧専用ユーザーには表示しない) */}
        {canEdit && (
          <CsvUploader
            payrollRows={payrollRows}
            billingRows={billingRows}
            invoiceRows={invoiceRows}
            onPayrollLoaded={handlePayrollLoaded}
            onBillingLoaded={handleBillingLoaded}
            onInvoiceLoaded={handleInvoiceLoaded}
            onClearAll={handleClearAll}
            canUndo={!!undoSnapshot && undoSnapshot.companyId === selectedCompanyId}
            undoLabel={undoSnapshot?.label}
            onUndo={handleUndoLastCsvUpload}
          />
        )}

        {/* ナビゲーションタブ */}
        <div className="flex items-center justify-between mb-6 border-b border-slate-200 pb-2">
          <div className="flex space-x-2">
            <button
              onClick={() => setActiveTab('monthly')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'monthly'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <Table className="w-4 h-4" />
              <span>月次粗利明細一覧 ({calculatedResults.length}件)</span>
            </button>

            <button
              onClick={() => setActiveTab('staffPayroll')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'staffPayroll'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <Wallet className="w-4 h-4" />
              <span>スタッフ給与明細</span>
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all relative ${
                activeTab === 'audit'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>数値検証 & 監査アラート</span>
              {fiscalSummary.alertCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-rose-500 text-white font-mono">
                  {fiscalSummary.alertCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('fiscal')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'fiscal'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <BarChart2 className="w-4 h-4" />
              <span>決算期 (年間) 集計・グラフ</span>
            </button>
          </div>

          <button
            onClick={() => setIsExportModalOpen(true)}
            className="hidden sm:inline-flex items-center space-x-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>結果出力 (CSV/Excel)</span>
          </button>
        </div>

        {/* タブ 1: 月次粗利明細一覧 */}
        {activeTab === 'monthly' && (
          <MonthlyCalculationTable
            results={calculatedResults}
            taxRate={taxRate}
            lowMarginThreshold={defaultLowMarginThreshold}
            onExportCsv={() => setIsExportModalOpen(true)}
            fiscalYearMonths={fiscalYearMonths}
            fiscalYearLabel={fiscalYearLabel}
          />
        )}

        {/* タブ: スタッフ給与明細 (★2026-08-27新設、22章タスク1) */}
        {activeTab === 'staffPayroll' && <StaffPayrollDetail payrollRows={payrollRows} />}

        {/* タブ 2: 数値検証 & 監査アラート */}
        {activeTab === 'audit' && (
          <AnomalyAuditPanel
            results={calculatedResults}
            lowMarginThreshold={defaultLowMarginThreshold}
          />
        )}

        {/* タブ 3: 決算期 (年間) 集計 */}
        {activeTab === 'fiscal' && (
          <FiscalYearAnalytics summary={fiscalSummary} />
        )}
      </main>

      {/* フッター */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12 text-slate-500 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <Calculator className="w-4 h-4 text-indigo-600" />
            <span className="font-bold text-slate-700">
              派遣事業 粗利・経理管理システム v1.1
            </span>
            <span className="text-slate-400">| SME Consultant & Power Query Spec</span>
          </div>

          <div className="text-slate-400 text-center md:text-right">
            計算基準: 粗利益（税抜）＝ 請求額(税抜) − 支払給与 − 社保負担 − 雇用保険 − 駐車場代 − 退職金配賦
          </div>
        </div>
      </footer>

      {/* Mコード解説モーダル */}
      <MCodeReferenceModal
        isOpen={isMCodeGuideOpen}
        onClose={() => setIsMCodeGuideOpen(false)}
      />

      {/* エクスポートモーダル */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        results={calculatedResults}
      />
    </div>
  );
}
