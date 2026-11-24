import React, { useRef, useState } from 'react';
import {
  Bot,
  Check,
  Code2,
  FileUp,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
} from 'lucide-react';
import type { AiSignatureReport } from '../lib/aiSignatureDetector';

interface AiSignatureAutoBarProps {
  report: AiSignatureReport;
  sourceLabel?: string;
  hasCustomTemplateLoaded: boolean;
  isActiveAiTab: boolean;
  hasBulkUndo: boolean;
  onOpenAiTab: () => void;
  onQuickCleanAll: () => void;
  onQuickCustomizeAuthor: (customAuthor: string) => void;
  onUndoBulkClean: () => void;
  onJumpToFirstLine: (line: number) => void;
  onUploadXmlFile?: (file: File) => void;
}

export const AiSignatureAutoBar: React.FC<AiSignatureAutoBarProps> = ({
  report,
  sourceLabel,
  hasCustomTemplateLoaded,
  isActiveAiTab,
  hasBulkUndo,
  onOpenAiTab,
  onQuickCleanAll,
  onQuickCustomizeAuthor,
  onUndoBulkClean,
  onJumpToFirstLine,
  onUploadXmlFile,
}) => {
  const [showQuickRename, setShowQuickRename] = useState(false);
  const [customAuthorInput, setCustomAuthorInput] = useState('');
  const quickFileRef = useRef<HTMLInputElement>(null);

  const firstFinding = report.findings[0] ?? null;
  const isSigned = report.verdict === 'ai-signed';
  const isAssisted = report.verdict === 'ai-assisted';

  const containerStyle = isSigned
    ? 'border-amber-200 bg-amber-50/70'
    : isAssisted
      ? 'border-blue-200 bg-blue-50/70'
      : 'border-emerald-200 bg-emerald-50/60';

  const badgeStyle = isSigned
    ? 'bg-amber-100 text-amber-900 border-amber-300'
    : isAssisted
      ? 'bg-blue-100 text-blue-900 border-blue-300'
      : 'bg-emerald-100 text-emerald-900 border-emerald-300';

  const statusText = isSigned
    ? 'Dibuat / Ditandatangani AI'
    : isAssisted
      ? 'Terindikasi Jejak AI'
      : 'Bukan Output AI';

  return (
    <div className={`rounded-xl border px-3 py-2.5 space-y-2 transition-colors ${containerStyle}`}>
      {onUploadXmlFile && (
        <input
          ref={quickFileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUploadXmlFile(file);
            e.target.value = '';
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Auto-scan Verdict & Origin Summary */}
        <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
          <div className="mt-0.5 sm:mt-0 shrink-0">
            {isSigned ? (
              <Bot className="w-4 h-4 text-amber-700" />
            ) : isAssisted ? (
              <ShieldAlert className="w-4 h-4 text-blue-700" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wide text-slate-500">
                Pemindai Otomatis AI Signature:
              </span>
              <span
                className={`px-1.5 py-0.5 text-[11px] font-semibold rounded border ${badgeStyle}`}
              >
                {statusText}
              </span>
              {report.findings.length > 0 && (
                <span className="text-[11px] font-mono font-semibold text-slate-800 tabular-nums">
                  {report.confidenceScore}% &middot; {report.findings.length} bagian ditandai
                </span>
              )}
              {report.detectedGenerators.length > 0 && (
                <span className="text-[11px] font-medium text-amber-900 truncate">
                  ({report.detectedGenerators.slice(0, 3).join(', ')}
                  {report.detectedGenerators.length > 3
                    ? ` +${report.detectedGenerators.length - 3}`
                    : ''}
                  )
                </span>
              )}
            </div>

            <div className="text-[11px] text-slate-600 truncate">
              {sourceLabel ? `XML aktif: ${sourceLabel}` : 'XML aktif siap dipindai'}
              {!hasCustomTemplateLoaded && ' (preset bawaan)'}
              {firstFinding
                ? ` · Jejak pertama di baris ${firstFinding.line} (${firstFinding.zone})`
                : ' · Tidak ada komentar, meta, atribut, atau watermark AI tersembunyi'}
            </div>
          </div>
        </div>

        {/* Right: Quick-Access Modification Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {onUploadXmlFile && !hasCustomTemplateLoaded && (
            <button
              type="button"
              onClick={() => quickFileRef.current?.click()}
              className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-white hover:bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>Unggah .xml</span>
            </button>
          )}

          {report.findings.length > 0 && (
            <>
              {!isActiveAiTab && (
                <button
                  type="button"
                  onClick={onOpenAiTab}
                  className="px-2.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Modifikasi Kode AI ({report.findings.length})</span>
                </button>
              )}

              {firstFinding && (
                <button
                  type="button"
                  onClick={() => onJumpToFirstLine(firstFinding.line)}
                  title={`Buka langsung bagian output AI di Editor XML (Baris ${firstFinding.line})`}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Code2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Edit Baris {firstFinding.line}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowQuickRename((v) => !v)}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5 text-amber-600" />
                <span>Ganti Kredit AI</span>
              </button>

              <button
                type="button"
                onClick={onQuickCleanAll}
                className="px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-red-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Semua Signature</span>
              </button>
            </>
          )}

          {report.findings.length === 0 && !isActiveAiTab && (
            <button
              type="button"
              onClick={onOpenAiTab}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              <span>Detail Scan AI</span>
            </button>
          )}

          {hasBulkUndo && (
            <button
              type="button"
              onClick={onUndoBulkClean}
              className="px-2.5 py-1.5 text-xs font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Quick Attribution Replacement Strip */}
      {showQuickRename && report.findings.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onQuickCustomizeAuthor(customAuthorInput || 'Tim Tema Blog');
            setShowQuickRename(false);
          }}
          className="pt-2 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center gap-2"
        >
          <span className="text-[11px] font-medium text-slate-700 shrink-0">
            Ubah seluruh kredit/komentar AI menjadi nama pembuat Anda:
          </span>
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <input
              type="text"
              value={customAuthorInput}
              onChange={(e) => setCustomAuthorInput(e.target.value)}
              placeholder="Contoh: Studio Tema Saya / Nama Blog Anda"
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Terapkan ke XML</span>
            </button>
            <button
              type="button"
              onClick={() => setShowQuickRename(false)}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 text-xs rounded-lg cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
