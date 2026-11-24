import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  FileUp,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import type { ParsedTemplateInfo } from '../types/blogger';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import {
  OFFLINE_AI_RUNTIMES,
  runPageAuditWithOfflineAi,
  type OfflineAiRuntimeId,
  type PageOfflineAiAuditResult,
  type WorkspaceAiPage,
} from '../lib/offlineAiRuntime';
import type { BloggerErrorDiagnosis, SeoMonetizationReport } from '../lib/seoAndErrorAnalyzer';
import { useAuthAndAi } from '../contexts/AuthAndAiContext';
import { getGeminiModelOption } from '../lib/aiEngineCatalog';
import { AiEngineSelectorCard } from './AiEngineSelectorCard';
import { useAppOfflineMode } from '../hooks/usePWA';

interface OfflineAiRuntimeBarProps {
  controller: OfflineAiController;
  page: WorkspaceAiPage;
  xml: string;
  parsedInfo: ParsedTemplateInfo;
  seoReport?: SeoMonetizationReport;
  errorDiagnosis?: BloggerErrorDiagnosis;
  errorInput?: string;
  activeLine?: number;
  onApplySuggestedCss?: (css: string) => void;
  compact?: boolean;
}

const PAGE_LABELS: Record<WorkspaceAiPage, string> = {
  preview: 'Pratinjau Responsif',
  layout: 'Tata Letak Blogger',
  seo: 'SEO & Monetisasi',
  errors: 'Diagnosa Error Studio',
  editor: 'Editor Kode XML',
  inspector: 'Inspektor Aset & Redundansi',
  console: 'Konsol URL & Parameter',
  splitter: 'Splitter & Penyatu XML',
};

export const OfflineAiRuntimeBar: React.FC<OfflineAiRuntimeBarProps> = ({
  controller,
  page,
  xml,
  parsedInfo,
  seoReport,
  errorDiagnosis,
  errorInput,
  activeLine,
  onApplySuggestedCss,
  compact = false,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [auditResult, setAuditResult] = useState<PageOfflineAiAuditResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [barHidden, setBarHidden] = useState(false);
  const { isOfflineMode } = useAppOfflineMode();
  const {
    user,
    engineMode,
    geminiModel,
    quota,
    signInWithGoogle,
    authorizedGeminiFetch,
    setChatOpen,
    onNotify,
  } = useAuthAndAi();

  const useGeminiCloud = !isOfflineMode && engineMode === 'gemini';
  const activeGeminiMeta = getGeminiModelOption(geminiModel);

  // Keep instant zero-latency local baseline synced cleanly when key metrics change
  useEffect(() => {
    let active = true;
    runPageAuditWithOfflineAi(
      { ...controller.config, runtime: 'builtin' },
      page,
      { xml, parsedInfo, seoReport, errorDiagnosis, errorInput, activeLine }
    )
      .then((res) => {
        if (active && (!auditResult || auditResult.page !== page || controller.config.runtime === 'builtin')) {
          setAuditResult(res);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [page, parsedInfo.templateTitle, parsedInfo.widgets.length, parsedInfo.redundancyReport.totalDuplicateCssCount, parsedInfo.redundancyReport.totalDuplicateJsCount, parsedInfo.redundancyReport.unusedCssRules.length]);

  const handleRunDeepAudit = async () => {
    if (useGeminiCloud && !user) {
      onNotify?.('Silakan Login Google terlebih dahulu untuk memakai Gemini Cloud.', 'info');
      const ok = await signInWithGoogle();
      if (!ok) return;
    }

    setIsAnalyzing(true);
    setExpanded(true);
    try {
      if (useGeminiCloud) {
        const contextSummary = [
          `Template: ${parsedInfo.templateTitle} (${(parsedInfo.xmlByteSize / 1024).toFixed(1)} KB, ${parsedInfo.byteBreakdown.lineCount} baris)`,
          `Sections: ${parsedInfo.sections.length}, Widgets: ${parsedInfo.widgets.length}, Variables: ${parsedInfo.variables.length}`,
          `Viewport Meta: ${parsedInfo.hasViewportMeta ? 'Ada' : 'Tidak ada'}, b:skin: ${parsedInfo.hasSkin ? 'Ada' : 'Tidak ada'}`,
          `CSS Mati: ${parsedInfo.redundancyReport.unusedCssRules.length}, Duplikasi CSS/JS: ${parsedInfo.redundancyReport.totalDuplicateCssCount + parsedInfo.redundancyReport.totalDuplicateJsCount}`,
          seoReport
            ? `SEO Score Checks -> Found: ${seoReport.counts.found}, Warning: ${seoReport.counts.warning}, Missing: ${seoReport.counts.missing}, AdSense XML Risk: ${seoReport.hasAdsenseXmlSyntaxRisk}`
            : '',
          errorDiagnosis
            ? `Error XML terdeteksi: ${errorDiagnosis.xmlValidation.issues.length} (${errorDiagnosis.title})`
            : '',
          activeLine ? `Baris aktif editor: ${activeLine}` : '',
          `Cuplikan XML:\n${xml.slice(0, 6000)}`,
        ]
          .filter(Boolean)
          .join('\n');

        const res = await authorizedGeminiFetch<PageOfflineAiAuditResult>(
          '/api/ai/feature-audit',
          { page, contextSummary }
        );
        setAuditResult(res);
        return;
      }

      const res = await runPageAuditWithOfflineAi(controller.config, page, {
        xml,
        parsedInfo,
        seoReport,
        errorDiagnosis,
        errorInput,
        activeLine,
      });
      setAuditResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menjalankan analisis AI.';
      onNotify?.(msg, 'error');
      const fallback = await runPageAuditWithOfflineAi(controller.config, page, {
        xml,
        parsedInfo,
        seoReport,
        errorDiagnosis,
        errorInput,
        activeLine,
      });
      setAuditResult({
        ...fallback,
        fallbackNotice: `${msg} Menampilkan ringkasan Mesin Lokal sebagai cadangan.`,
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (barHidden) {
    return (
      <div className="bg-slate-50 border-b border-slate-200 px-3 sm:px-5 py-1 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2 min-w-0">
          {useGeminiCloud ? (
            <Sparkles className="w-3 h-3 text-blue-600 shrink-0" />
          ) : (
            <Cpu className="w-3 h-3 text-slate-600 shrink-0" />
          )}
          <span className="font-semibold text-slate-700 truncate">
            {useGeminiCloud
              ? `Gemini (${activeGeminiMeta.shortLabel}) · Sisa ${quota.remaining}/${quota.dailyLimit}`
              : `AI Lokal · 0 Kuota`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setBarHidden(false)}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-medium cursor-pointer shrink-0"
        >
          <ChevronDown className="w-3 h-3" />
          <span>Tampilkan Bilah AI</span>
        </button>
      </div>
    );
  }

  return (
    <div className="bg-slate-50/90 border-b border-slate-200 px-3 sm:px-6 py-2">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {useGeminiCloud ? (
              <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            ) : (
              <Cpu className="w-3.5 h-3.5 text-slate-700 shrink-0" />
            )}
            <span className="text-xs font-semibold text-slate-900 truncate">
              {useGeminiCloud
                ? `Gemini · ${activeGeminiMeta.shortLabel}`
                : `AI Lokal · ${controller.activeMeta.shortName}`}
            </span>
          </div>

          {/* Smartphone-visible Quota / Limit Pill */}
          <button
            type="button"
            onClick={controller.openSettings}
            className="sm:hidden px-2 py-0.5 rounded-md border border-slate-200 bg-white text-[10px] font-mono font-semibold text-slate-700 tabular-nums shrink-0 cursor-pointer"
          >
            {useGeminiCloud
              ? user
                ? `Sisa ${quota.remaining}/${quota.dailyLimit}`
                : `Limit ${quota.dailyLimit}/hr`
              : '0 Kuota'}
          </button>

          <span className="text-xs text-slate-500 hidden sm:inline truncate">
            {PAGE_LABELS[page]}
            {useGeminiCloud
              ? user
                ? ` · Sisa Kuota ${quota.remaining}/${quota.dailyLimit}`
                : ' · Perlu Login Google'
              : controller.probeResult
                ? ` · ${controller.probeResult.statusLabel}`
                : ' · 0 Kuota Server'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar shrink-0">
          {!compact && auditResult && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="px-2.5 py-1.5 min-h-[34px] text-[11px] font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              {expanded ? 'Tutup Ringkasan' : 'Audit AI'}
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleRunDeepAudit()}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[34px] text-[11px] font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isAnalyzing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            <span>{isAnalyzing ? 'Menganalisis...' : 'Analisis AI'}</span>
          </button>

          <button
            type="button"
            onClick={() => setChatOpen(true)}
            title="Buka Kolom Chat AI untuk halaman ini"
            className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Chat AI</span>
          </button>

          <button
            type="button"
            onClick={controller.openSettings}
            title="Pilih Mesin AI (Google Gemini atau AI Lokal Perangkat)"
            className="flex items-center gap-1 px-2.5 py-1.5 min-h-[34px] text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Mesin</span>
          </button>

          <button
            type="button"
            onClick={() => setBarHidden(true)}
            title="Sembunyikan bilah AI agar area kerja lebih luas"
            aria-label="Sembunyikan bilah AI"
            className="p-1.5 min-h-[34px] min-w-[32px] flex items-center justify-center text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg shrink-0 cursor-pointer"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && auditResult && (
        <div className="mt-2.5 p-3 rounded-lg bg-white border border-slate-200 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-blue-700">{auditResult.engineLabel}</span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              Tutup
            </button>
          </div>
          {auditResult.fallbackNotice && (
            <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
              {auditResult.fallbackNotice}
            </div>
          )}
          <p className="text-slate-800 font-medium leading-relaxed">{auditResult.summary}</p>
          <ul className="space-y-1 text-[11px] text-slate-600 list-disc pl-4">
            {auditResult.highlights.map((h, i) => (
              <li key={i} className="leading-relaxed">
                {h}
              </li>
            ))}
          </ul>
          {auditResult.suggestedCss && onApplySuggestedCss && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => onApplySuggestedCss(auditResult.suggestedCss || '')}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium rounded-lg cursor-pointer"
              >
                Terapkan Saran CSS Responsif AI
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface OfflineAiRuntimeModalProps {
  controller: OfflineAiController;
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const OfflineAiRuntimeModal: React.FC<OfflineAiRuntimeModalProps> = ({
  controller,
  onNotify,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const { isOfflineMode } = useAppOfflineMode();
  if (!controller.isSettingsOpen) return null;

  const activeMeta = controller.activeMeta;
  const { config, probeResult, isProbing } = controller;

  const selectRuntimeAndProbe = async (id: OfflineAiRuntimeId) => {
    controller.setRuntime(id);
    const res = await controller.runProbe(id);
    onNotify(
      res.available
        ? `Engine ${id} terhubung (${res.statusLabel}).`
        : `${OFFLINE_AI_RUNTIMES.find((r) => r.id === id)?.shortName} dipilih (otomatis fallback ke Mesin Lokal jika belum aktif).`,
      res.available ? 'success' : 'info'
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl max-h-[92dvh] bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Pemilih Mesin AI Hybrid (Gemini Cloud &amp; AI Lokal)
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Pilih Google Gemini (Login Google) atau runtime AI Lokal di perangkat Anda untuk semua fitur TemaLoka.
            </p>
          </div>
          <button
            type="button"
            onClick={controller.closeSettings}
            aria-label="Tutup pengaturan Mesin AI"
            className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <AiEngineSelectorCard
            offlineAi={controller}
            isOfflineMode={isOfflineMode}
            compact
          />

          <div className="pt-1 border-t border-slate-200 space-y-2.5">
            <div className="text-xs font-semibold text-slate-900">
              Daftar Runtime AI Lokal / Perangkat Anda (0 Kuota Server)
            </div>
            {/* Runtime Catalog Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {OFFLINE_AI_RUNTIMES.map((rt) => {
              const selected = config.runtime === rt.id;
              return (
                <button
                  key={rt.id}
                  type="button"
                  onClick={() => selectRuntimeAndProbe(rt.id)}
                  className={`text-left p-3 rounded-lg border transition-colors cursor-pointer space-y-1 ${
                    selected
                      ? 'border-blue-600 bg-blue-50/50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">{rt.name}</span>
                    {selected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">{rt.description}</p>
                </button>
              );
            })}
            </div>
          </div>

          {/* Active Runtime Configuration */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900">
                Pengaturan: {activeMeta.name}
              </div>
              <button
                type="button"
                onClick={() => controller.runProbe()}
                disabled={isProbing}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-800 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isProbing ? 'animate-spin' : ''}`} />
                <span>Uji Koneksi &amp; Deteksi Model</span>
              </button>
            </div>

            {(config.runtime === 'ollama' ||
              config.runtime === 'lmstudio' ||
              config.runtime === 'llamacpp') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-700">
                    Endpoint Lokal Server
                  </label>
                  <input
                    type="text"
                    value={config.endpoints[config.runtime]}
                    onChange={(e) =>
                      controller.updateEndpoint(
                        config.runtime as 'ollama' | 'lmstudio' | 'llamacpp',
                        e.target.value
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                  />
                  {config.runtime === 'lmstudio' && (
                    <div className="flex items-center gap-2 pt-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() =>
                          controller.updateEndpoint('lmstudio', 'http://127.0.0.1:1234/v1')
                        }
                        className="text-blue-700 hover:underline cursor-pointer"
                      >
                        Preset LM Studio (:1234)
                      </button>
                      <span aria-hidden="true">&middot;</span>
                      <button
                        type="button"
                        onClick={() =>
                          controller.updateEndpoint('lmstudio', 'http://127.0.0.1:1337/v1')
                        }
                        className="text-blue-700 hover:underline cursor-pointer"
                      >
                        Preset Jan AI (:1337)
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-700">
                    Nama Model Aktif
                  </label>
                  <input
                    type="text"
                    value={config.models[config.runtime]}
                    onChange={(e) =>
                      controller.updateModel(
                        config.runtime as 'ollama' | 'lmstudio' | 'llamacpp',
                        e.target.value
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                  />
                  {probeResult && probeResult.detectedModels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {probeResult.detectedModels.slice(0, 4).map((mName) => (
                        <button
                          key={mName}
                          type="button"
                          onClick={() =>
                            controller.updateModel(
                              config.runtime as 'ollama' | 'lmstudio' | 'llamacpp',
                              mName
                            )
                          }
                          className="text-[11px] font-mono text-blue-700 hover:underline cursor-pointer"
                        >
                          {mName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {(config.runtime === 'webllm' || config.runtime === 'transformersjs') && (
              <div className="space-y-1.5">
                <label className="block text-[11px] font-medium text-slate-700">
                  ID Model Browser (MLC / Hugging Face ONNX)
                </label>
                <input
                  type="text"
                  value={config.models[config.runtime]}
                  onChange={(e) =>
                    controller.updateModel(
                      config.runtime as 'webllm' | 'transformersjs',
                      e.target.value
                    )
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>
            )}

            {config.runtime === 'mediapipe' && (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-slate-700">
                  Berkas Model Lokal MediaPipe (.task / .bin)
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-medium text-slate-800 cursor-pointer"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    <span>Pilih File .task / .bin dari Perangkat</span>
                  </button>
                  {config.localMediaPipeFileName && (
                    <span className="text-[11px] font-mono text-emerald-700">
                      Terpilih: {config.localMediaPipeFileName}
                    </span>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".task,.bin,.tflite"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      if (f) {
                        controller.attachMediaPipeFile(f);
                        onNotify(`Berkas MediaPipe "${f.name}" diikat ke sesi.`, 'success');
                      }
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
            )}

            {probeResult && (
              <div
                className={`p-2.5 rounded-lg border text-[11px] leading-relaxed ${
                  probeResult.available
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-amber-50 border-amber-200 text-amber-950'
                }`}
              >
                <div className="font-semibold">Status: {probeResult.statusLabel}</div>
                <div>{probeResult.detail}</div>
              </div>
            )}

            <p className="text-[11px] text-slate-500 leading-relaxed">{activeMeta.setupHint}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={controller.closeSettings}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
};
