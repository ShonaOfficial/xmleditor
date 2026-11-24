import React, { useState } from 'react';
import { Loader2, Plus, RotateCcw, ShieldCheck, X } from 'lucide-react';
import type { AutoDetectedSafelistPrefix } from '../lib/xmlWorkerEngine';

interface SafelistPrefixManagerProps {
  chips: AutoDetectedSafelistPrefix[];
  cssPrefixRuleCounts?: Record<string, number>;
  isScanning?: boolean;
  isDark?: boolean;
  onAddManualPrefix: (rawPrefix: string) => void;
  onRemovePrefix: (prefix: string) => void;
  onResetAutoDetect: () => void;
}

export function normalizeSafelistInput(raw: string): string {
  const cleaned = raw.trim().replace(/^[,;\s]+|[,;\s]+$/g, '');
  if (!cleaned) return '';
  const withoutMultipleDots = cleaned.replace(/^\.+/, '');
  if (!withoutMultipleDots) return '';
  return `.${withoutMultipleDots}`;
}

export const SafelistPrefixManager: React.FC<SafelistPrefixManagerProps> = ({
  chips,
  cssPrefixRuleCounts = {},
  isScanning = false,
  isDark = false,
  onAddManualPrefix,
  onRemovePrefix,
  onResetAutoDetect,
}) => {
  const [inputVal, setInputVal] = useState('');

  const commitInput = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => normalizeSafelistInput(s))
      .filter(Boolean);
    for (const p of parts) {
      onAddManualPrefix(p);
    }
    setInputVal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inputVal.trim()) {
        commitInput(inputVal);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.includes(',')) {
      const segments = val.split(',');
      const last = segments.pop() ?? '';
      const toCommit = segments.join(',');
      if (toCommit.trim()) {
        const parts = toCommit
          .split(',')
          .map((s) => normalizeSafelistInput(s))
          .filter(Boolean);
        for (const p of parts) {
          onAddManualPrefix(p);
        }
      }
      setInputVal(last);
      return;
    }
    setInputVal(val);
  };

  return (
    <div
      className={`p-3 rounded-lg border space-y-2.5 ${
        isDark
          ? 'bg-slate-900/70 border-slate-700/80 text-slate-200'
          : 'bg-white border-slate-200 text-slate-800'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="font-semibold">Safelist Prefix Aktif</span>
          <span
            className={`font-mono text-[11px] tabular-nums ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            ({chips.length} terlindungi)
          </span>
          {isScanning && (
            <span className="inline-flex items-center gap-1 text-[11px] text-blue-600 font-medium">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Memindai...</span>
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={isScanning}
          onClick={onResetAutoDetect}
          title="Pindai ulang XML dan kembalikan daftar safelist hasil auto-detect"
          className={`px-2.5 py-1 text-[11px] font-medium rounded-md border flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 transition-colors ${
            isDark
              ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset Auto-Detect</span>
        </button>
      </div>

      <p className={`text-[11px] leading-snug ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        Otomatis terdeteksi dari pencocokan silang CSS (<span className="font-mono">&lt;style&gt;</span>/<span className="font-mono">&lt;b:skin&gt;</span>) dengan DOM dinamis <span className="font-mono">&lt;script&gt;</span> &amp; tag Blogger (<span className="font-mono">expr:class</span>/<span className="font-mono">&lt;b:class&gt;</span>). Seluruh aturan CSS (termasuk <span className="font-mono">:hover</span>, <span className="font-mono">::before</span>, <span className="font-mono">@media</span>) dengan prefix aktif tidak akan dihapus.
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => {
          const lookupCount =
            chip.cssRuleCount > 0
              ? chip.cssRuleCount
              : cssPrefixRuleCounts[chip.prefix.toLowerCase()] || 0;
          const isAuto = chip.source === 'auto';
          const isState = chip.kind === 'state';
          const titleText =
            chip.matchedTokensSample.length > 0
              ? `Contoh selector: ${chip.matchedTokensSample.join(', ')}`
              : `Prefix ${chip.prefix}`;

          return (
            <span
              key={chip.prefix.toLowerCase()}
              title={titleText}
              className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md border text-[11px] font-mono transition-colors ${
                isDark
                  ? isAuto
                    ? isState
                      ? 'bg-amber-950/50 border-amber-700/60 text-amber-200'
                      : 'bg-blue-950/60 border-blue-700/60 text-blue-200'
                    : 'bg-slate-800 border-slate-600 text-slate-200'
                  : isAuto
                    ? isState
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-blue-50 border-blue-200 text-blue-900'
                    : 'bg-slate-100 border-slate-300 text-slate-800'
              }`}
            >
              <span>
                {isAuto ? '✨ ' : ''}
                {chip.prefix}
                {lookupCount > 0 ? ` (${lookupCount} CSS)` : ''}
              </span>
              <button
                type="button"
                onClick={() => onRemovePrefix(chip.prefix)}
                aria-label={`Hapus ${chip.prefix} dari safelist`}
                title={`Hapus ${chip.prefix} dari safelist`}
                className={`p-0.5 rounded hover:bg-black/10 cursor-pointer ${
                  isDark ? 'text-slate-300 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}

        {chips.length === 0 && !isScanning && (
          <span className={`text-[11px] italic ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Belum ada prefix aktif — ketik manual di bawah/samping atau klik Reset Auto-Detect.
          </span>
        )}

        {/* Inline manual prefix input beside chips */}
        <div className="flex items-center gap-1 min-w-[210px] flex-1 max-w-xs">
          <input
            type="text"
            value={inputVal}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="+ Tambah prefix (Enter / koma)"
            aria-label="Tambah prefix safelist manual"
            className={`w-full px-2.5 py-1 text-[11px] font-mono border rounded-md focus:outline-none transition-colors ${
              isDark
                ? 'bg-slate-950 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500'
                : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600'
            }`}
          />
          {inputVal.trim().length > 0 && (
            <button
              type="button"
              onClick={() => commitInput(inputVal)}
              aria-label="Tambahkan prefix"
              className="px-2 py-1 text-[11px] font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center gap-0.5 shrink-0 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Tambah</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
