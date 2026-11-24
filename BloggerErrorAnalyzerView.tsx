import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  FileCode2,
  Loader2,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react';
import type { ParsedTemplateInfo } from '../types/blogger';
import { diagnoseBloggerStudioErrorOffline } from '../lib/seoAndErrorAnalyzer';
import {
  scanBloggerSpecificRules,
  validateBloggerXmlOffline,
} from '../lib/xmlOfflineTools';
import {
  runIterativeAutoFixWorker,
  type WorkerProgressInfo,
} from '../lib/xmlWorkerEngine';
import { summarizeErrorWithOfflineAi } from '../lib/offlineAiEngine';
import type { OfflineAiController } from '../hooks/useOfflineAiRuntime';
import { OfflineAiRuntimeBar } from './OfflineAiRuntimeBar';

interface BloggerErrorAnalyzerViewProps {
  xml: string;
  parsedInfo: ParsedTemplateInfo;
  offlineAi: OfflineAiController;
  onUpdateXml: (nextXml: string, feedbackMessage: string) => void;
  onJumpToEditorLine: (line?: number | null) => void;
}

const SAMPLE_ERRORS = [
  {
    label: 'Error "&" URL / Fonts',
    text: 'org.xml.sax.SAXParseException; lineNumber: 12; columnNumber: 84; The reference to entity "display" must end with the \';\' delimiter.',
  },
  {
    label: 'Error AdSense "async"',
    text: 'org.xml.sax.SAXParseException; lineNumber: 18; columnNumber: 12; Attribute name "async" associated with an element type "script" must be followed by the \' = \' character.',
  },
  {
    label: 'Error Tag <meta> / </link>',
    text: 'org.xml.sax.SAXParseException; lineNumber: 9; columnNumber: 3; The element type "meta" must be terminated by the matching end-tag "</meta>".',
  },
  {
    label: 'Error JavaScript / CDATA',
    text: 'org.xml.sax.SAXParseException; lineNumber: 45; columnNumber: 14; The content of elements must consist of well-formed character data or markup.',
  },
];

export const BloggerErrorAnalyzerView: React.FC<BloggerErrorAnalyzerViewProps> = ({
  xml,
  parsedInfo,
  offlineAi,
  onUpdateXml,
  onJumpToEditorLine,
}) => {
  const [errorInput, setErrorInput] = useState('');
  const [lastFixes, setLastFixes] = useState<string[]>([]);
  const [lastFixMeta, setLastFixMeta] = useState<{
    rounds: number;
    domValid: boolean;
    durationMs: number;
  } | null>(null);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [autoFixProgress, setAutoFixProgress] = useState<WorkerProgressInfo | null>(null);
  const [copiedScanAll, setCopiedScanAll] = useState(false);
  const [copiedIssueIdx, setCopiedIssueIdx] = useState<number | null>(null);
  const workerCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      workerCancelRef.current?.();
    };
  }, []);

  const xmlValidation = useMemo(() => validateBloggerXmlOffline(xml), [xml]);
  const bloggerRuleSummary = useMemo(() => scanBloggerSpecificRules(xml), [xml]);
  const totalRuleIssues =
    bloggerRuleSummary.unescapedAmpCount +
    bloggerRuleSummary.cdataIssueCount +
    bloggerRuleSummary.quoteCollisionCount +
    bloggerRuleSummary.duplicateIdCount;

  const diagnosis = useMemo(
    () => diagnoseBloggerStudioErrorOffline(errorInput, xml, xmlValidation),
    [errorInput, xml, xmlValidation]
  );

  const aiInsight = useMemo(
    () => summarizeErrorWithOfflineAi(diagnosis, parsedInfo),
    [diagnosis, parsedInfo]
  );

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyAllScanResults = async () => {
    const issues = diagnosis.xmlValidation.issues;
    const header = `Hasil Scan XML Aktif Saat Ini (Offline) — ${parsedInfo.templateTitle} (${issues.length} temuan)`;
    const body =
      issues.length === 0
        ? 'Status: Valid — Tidak ada error sintaks terdeteksi pada template XML yang dimuat.'
        : issues
            .map((iss, idx) => {
              const loc = `Baris ${iss.line}${iss.column ? `, Kolom ${iss.column}` : ''}`;
              const sev = iss.severity === 'error' ? 'ERROR' : 'PERINGATAN';
              const snip = iss.snippet ? `\n   Cuplikan: ${iss.snippet}` : '';
              return `${idx + 1}. [${sev}] ${loc} (${iss.code}): ${iss.message}${snip}`;
            })
            .join('\n');

    const ok = await copyTextToClipboard(`${header}\n${body}`);
    if (ok) {
      setCopiedScanAll(true);
      window.setTimeout(() => setCopiedScanAll(false), 1800);
    }
  };

  const handleCopySingleIssue = async (idx: number) => {
    const iss = diagnosis.xmlValidation.issues[idx];
    if (!iss) return;
    const loc = `Baris ${iss.line}${iss.column ? `, Kolom ${iss.column}` : ''}`;
    const sev = iss.severity === 'error' ? 'ERROR' : 'PERINGATAN';
    const text = `[${sev}] ${loc} (${iss.code}): ${iss.message}${
      iss.snippet ? `\nCuplikan: ${iss.snippet}` : ''
    }`;
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedIssueIdx(idx);
      window.setTimeout(() => {
        setCopiedIssueIdx((prev) => (prev === idx ? null : prev));
      }, 1800);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setErrorInput(text);
        setLastFixes([]);
        setLastFixMeta(null);
      }
    } catch {
      // Clipboard API might require direct user paste
    }
  };

  const handleCancelAutoFix = () => {
    workerCancelRef.current?.();
    workerCancelRef.current = null;
    setIsAutoFixing(false);
    setAutoFixProgress(null);
  };

  const handleApplyOfflineFix = async () => {
    if (isAutoFixing) return;
    setIsAutoFixing(true);
    setLastFixMeta(null);
    setAutoFixProgress({
      phase: 'autofix',
      percent: 10,
      message: 'Memulai Auto-Fix XML (Putaran 1/10)...',
      round: 1,
      maxRounds: 10,
    });

    const job = runIterativeAutoFixWorker(xml, (p) => setAutoFixProgress(p), 10);
    workerCancelRef.current = job.cancel;

    try {
      const res = await job.promise;
      if (workerCancelRef.current !== job.cancel) return;
      workerCancelRef.current = null;
      setIsAutoFixing(false);
      setAutoFixProgress(null);
      setLastFixes(res.fixesApplied);
      setLastFixMeta({
        rounds: res.roundsExecuted,
        domValid: res.domParserValid,
        durationMs: res.durationMs,
      });

      if (res.fixesApplied.length === 0 && res.fixedXml === xml) {
        onUpdateXml(
          xml,
          res.domParserValid
            ? 'XML sudah valid menurut DOMParser("text/xml"). Tidak ada perbaikan diperlukan.'
            : 'Pemeriksaan selesai: pola error spesifik masih membutuhkan peninjauan baris yang disorot.'
        );
        return;
      }

      onUpdateXml(
        res.fixedXml,
        `Auto-Fix XML selesai (${res.roundsExecuted} putaran, ${res.fixesApplied.length} perbaikan, ${res.domParserValid ? 'Valid XML' : 'Butuh Tinjauan'}).`
      );
    } catch (err) {
      workerCancelRef.current = null;
      setIsAutoFixing(false);
      setAutoFixProgress(null);
      onUpdateXml(
        xml,
        err instanceof Error ? err.message : 'Auto-Fix XML dibatalkan atau gagal.'
      );
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#F8FAFC] overflow-hidden">
      <OfflineAiRuntimeBar
        controller={offlineAi}
        page="errors"
        xml={xml}
        parsedInfo={parsedInfo}
        errorDiagnosis={diagnosis}
        errorInput={errorInput}
      />

      {/* Top Bar */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
            <span className="truncate">Detektor Notifikasi Error Studio Blogger (Offline)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tempel pesan error merah dari halaman Edit HTML Blogger agar penyebab, baris XML, dan Auto-Fix iteratif Web Worker langsung dijalankan.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            disabled={isAutoFixing}
            onClick={handleApplyOfflineFix}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isAutoFixing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wrench className="w-3.5 h-3.5" />
            )}
            <span>
              {isAutoFixing ? 'Memperbaiki XML...' : 'Perbaiki Otomatis (Web Worker)'}
            </span>
          </button>
          {isAutoFixing && (
            <button
              type="button"
              onClick={handleCancelAutoFix}
              className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Batal</span>
            </button>
          )}
        </div>
      </div>

      {isAutoFixing && autoFixProgress && (
        <div className="px-3 sm:px-6 py-2.5 bg-blue-50 border-b border-blue-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between text-xs font-medium text-blue-950">
                <span className="truncate">{autoFixProgress.message}</span>
                <span className="font-mono tabular-nums shrink-0 ml-2">
                  {autoFixProgress.percent}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-blue-200/70 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-150"
                  style={{ width: `${Math.min(100, Math.max(5, autoFixProgress.percent))}%` }}
                />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancelAutoFix}
            className="px-2.5 py-1 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-red-200 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
          >
            Batal
          </button>
        </div>
      )}

      {/* Main Responsive Two-Column Workbench */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-start">
          {/* Left Column: Error Notification Input */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="blogger-error-paste" className="text-xs font-semibold text-slate-900">
                Tempel Notifikasi Error Blogger di Sini
              </label>
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>Tempel Papan Klip</span>
              </button>
            </div>

            <textarea
              id="blogger-error-paste"
              rows={6}
              value={errorInput}
              onChange={(e) => {
                setErrorInput(e.target.value);
                setLastFixes([]);
              }}
              spellCheck={false}
              placeholder="Contoh:&#10;org.xml.sax.SAXParseException; lineNumber: 42; columnNumber: 18; The reference to entity &quot;family&quot; must end with the ';' delimiter."
              className="w-full p-3 font-mono text-xs leading-relaxed bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 resize-y"
            />

            <div className="space-y-2">
              <div className="text-[11px] font-medium text-slate-500">
                Contoh Error Studio Blogger Umum (Klik untuk Uji):
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SAMPLE_ERRORS.map((sample) => (
                  <button
                    key={sample.label}
                    type="button"
                    onClick={() => {
                      setErrorInput(sample.text);
                      setLastFixes([]);
                    }}
                    className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4-Point Blogger-Specific XML Rules & One-Click Fix */}
            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-900">
                  Pemeriksa Aturan XML Blogger (4 Titik)
                </span>
                {totalRuleIssues > 0 ? (
                  <button
                    type="button"
                    disabled={isAutoFixing}
                    onClick={handleApplyOfflineFix}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[11px] font-medium rounded-md flex items-center gap-1 cursor-pointer"
                  >
                    <Wrench className="w-3 h-3" />
                    <span>Perbaiki Otomatis (One-Click Fix)</span>
                  </button>
                ) : (
                  <span className="text-[11px] font-medium text-emerald-700">
                    Semua aturan Blogger aman
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {[
                  {
                    label: 'Karakter "&" URL/Atribut',
                    count: bloggerRuleSummary.unescapedAmpCount,
                  },
                  {
                    label: 'Integritas <![CDATA[...]]>',
                    count: bloggerRuleSummary.cdataIssueCount,
                  },
                  {
                    label: 'Benturan Kutip cond/expr:*',
                    count: bloggerRuleSummary.quoteCollisionCount,
                  },
                  {
                    label: 'Duplikat ID Section/Widget',
                    count: bloggerRuleSummary.duplicateIdCount,
                  },
                ].map((chk) => (
                  <div
                    key={chk.label}
                    className={`p-2 rounded-lg border flex items-center justify-between gap-1.5 ${
                      chk.count > 0
                        ? 'bg-red-50/70 border-red-200 text-red-900'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <span className="truncate font-medium">{chk.label}</span>
                    <span
                      className={`font-mono tabular-nums font-semibold shrink-0 ${
                        chk.count > 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {chk.count > 0 ? `${chk.count}x` : 'OK'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Active XML Validator Summary */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-800">
                  Hasil Scan XML Aktif Saat Ini (Offline)
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`font-mono tabular-nums text-[11px] font-semibold ${
                      diagnosis.xmlValidation.isValid ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {diagnosis.xmlValidation.issues.length} temuan
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyAllScanResults()}
                    title="Salin seluruh hasil scan XML ke papan klip"
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition-colors cursor-pointer"
                  >
                    {copiedScanAll ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-700">Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Salin Hasil</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {diagnosis.xmlValidation.issues.length === 0 ? (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2 select-text">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Tidak ada error sintaks terdeteksi pada template XML yang dimuat.</span>
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {diagnosis.xmlValidation.issues.map((issue, idx) => (
                    <div key={idx} className="p-2.5 text-xs space-y-1 select-text">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono tabular-nums text-[11px] font-semibold text-red-700">
                          Baris {issue.line}
                          {issue.column ? `:${issue.column}` : ''}
                        </span>
                        <div className="flex items-center gap-2.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleCopySingleIssue(idx)}
                            title="Salin notifikasi error ini"
                            className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            {copiedIssueIdx === idx ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span className="text-emerald-700">Tersalin</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Salin</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onJumpToEditorLine(issue.line)}
                            className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                          >
                            Lihat di Editor &rarr;
                          </button>
                        </div>
                      </div>
                      <div className="text-slate-700 leading-relaxed">{issue.message}</div>
                      {issue.snippet && (
                        <code className="block font-mono text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 truncate">
                          {issue.snippet}
                        </code>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Instant Offline Diagnosis & Line Context */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
                    {diagnosis.category}
                  </div>
                  <h3 className="text-sm sm:text-base font-semibold text-slate-900">
                    {diagnosis.title}
                  </h3>
                </div>

                {diagnosis.extractedLine && (
                  <div className="font-mono text-xs tabular-nums bg-red-50 border border-red-200 text-red-800 px-3 py-1 rounded-lg">
                    Baris {diagnosis.extractedLine}
                    {diagnosis.extractedColumn ? ` : Kolom ${diagnosis.extractedColumn}` : ''}
                  </div>
                )}
              </div>

              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                {diagnosis.explanation}
              </p>

              {/* Offline AI Correlation Insight */}
              <div className="p-3.5 rounded-lg bg-blue-50/70 border border-blue-200 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-blue-900">
                    Analisis Korelasi AI Offline
                  </span>
                  <span className="text-[11px] font-medium text-blue-800">
                    {aiInsight.autoFixConfidence}
                  </span>
                </div>
                {aiInsight.correlationHints.map((hint, i) => (
                  <p key={i} className="text-xs text-blue-950 leading-relaxed">
                    &bull; {hint}
                  </p>
                ))}
              </div>

              {/* Extracted Code Context Around Target Line */}
              {diagnosis.codeContext.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Cuplikan Kode XML Sekitar Baris {diagnosis.extractedLine}
                    </span>
                    <button
                      type="button"
                      onClick={() => onJumpToEditorLine(diagnosis.extractedLine)}
                      className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                      <span>Buka di Editor XML</span>
                    </button>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-900 text-slate-100 overflow-x-auto font-mono text-[11px] leading-relaxed">
                    {diagnosis.codeContext.map((row) => (
                      <div
                        key={row.lineNumber}
                        className={`flex px-3 py-1 ${
                          row.isTarget ? 'bg-red-500/25 text-white font-medium' : 'text-slate-300'
                        }`}
                      >
                        <span className="w-10 shrink-0 select-none text-slate-500 tabular-nums">
                          {row.lineNumber}
                        </span>
                        <span className="whitespace-pre">{row.text || ' '}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actionable Fix Steps */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-900">Langkah Perbaikan Cepat:</div>
                <ul className="space-y-1.5 text-xs text-slate-700">
                  {diagnosis.stepsToFix.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {(lastFixes.length > 0 || lastFixMeta) && (
                <div
                  className={`p-3 rounded-lg border space-y-1.5 ${
                    lastFixMeta?.domValid
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                    <span className={lastFixMeta?.domValid ? 'text-emerald-900' : 'text-amber-900'}>
                      {lastFixMeta?.domValid
                        ? 'Auto-Fix Iteratif Berhasil — Lolos Validasi DOMParser("text/xml")'
                        : 'Auto-Fix Iteratif Selesai — Masih Ada Baris yang Perlu Tinjauan'}
                    </span>
                    {lastFixMeta && (
                      <span className="font-mono text-[11px] tabular-nums text-slate-600">
                        {lastFixMeta.rounds} putaran &middot; {lastFixMeta.durationMs} ms
                      </span>
                    )}
                  </div>
                  {lastFixes.length > 0 && (
                    <ul
                      className={`list-disc pl-4 text-xs space-y-0.5 ${
                        lastFixMeta?.domValid ? 'text-emerald-800' : 'text-amber-800'
                      }`}
                    >
                      {lastFixes.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isAutoFixing}
                  onClick={handleApplyOfflineFix}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isAutoFixing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Wrench className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isAutoFixing
                      ? 'Memperbaiki (Web Worker)...'
                      : 'Jalankan Auto-Fix Iteratif Sekarang'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onJumpToEditorLine(diagnosis.extractedLine)}
                  className="px-4 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-800 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Edit Manual di Editor XML
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
