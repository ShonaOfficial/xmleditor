import React, { useMemo } from 'react';
import { GitCompare } from 'lucide-react';
import { computeSideBySideDiffHunks } from '../lib/xmlFeatureTools';

interface DiffViewerPanelProps {
  beforeText: string;
  afterText: string;
  beforeLabel?: string;
  afterLabel?: string;
  isDark?: boolean;
  maxTotalRows?: number;
}

export const DiffViewerPanel: React.FC<DiffViewerPanelProps> = ({
  beforeText,
  afterText,
  beforeLabel = 'Sebelum',
  afterLabel = 'Sesudah',
  isDark = false,
  maxTotalRows = 200,
}) => {
  const diff = useMemo(
    () => computeSideBySideDiffHunks(beforeText, afterText, { maxTotalRows, contextLines: 2 }),
    [beforeText, afterText, maxTotalRows]
  );

  if (beforeText === afterText || diff.rows.length === 0) {
    return null;
  }

  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'
      }`}
    >
      <div
        className={`px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-[11px] ${
          isDark
            ? 'border-slate-700 bg-slate-900 text-slate-200'
            : 'border-slate-200 bg-slate-50 text-slate-800'
        }`}
      >
        <div className="flex items-center gap-1.5 font-semibold">
          <GitCompare className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span>Perbandingan Kode (Side-by-Side Diff)</span>
        </div>
        <div className="flex items-center gap-3 font-mono tabular-nums text-[11px]">
          <span className={isDark ? 'text-red-400' : 'text-red-700'}>
            -{diff.totalRemovedLines} baris
          </span>
          <span className={isDark ? 'text-emerald-400' : 'text-emerald-700'}>
            +{diff.totalAddedLines} baris
          </span>
          <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
            {diff.totalChangedHunks} blok berubah
          </span>
        </div>
      </div>

      {/* Column Headers */}
      <div
        className={`grid grid-cols-1 md:grid-cols-2 border-b text-[10px] font-semibold ${
          isDark
            ? 'border-slate-800 bg-slate-950/60 text-slate-400'
            : 'border-slate-200 bg-slate-50/70 text-slate-600'
        }`}
      >
        <div className="px-3 py-1.5 md:border-r md:border-slate-200/40">{beforeLabel}</div>
        <div className="px-3 py-1.5">{afterLabel}</div>
      </div>

      {/* Diff Rows */}
      <div className="max-h-72 overflow-y-auto font-mono text-[11px] leading-relaxed divide-y divide-slate-200/30">
        {diff.rows.map((row, idx) => {
          if (row.kind === 'hunk-gap') {
            return (
              <div
                key={idx}
                className={`px-3 py-1 text-center text-[10px] italic ${
                  isDark ? 'bg-slate-800/70 text-slate-400' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {row.leftText}
              </div>
            );
          }

          const leftBg =
            row.kind === 'removed' || row.kind === 'changed'
              ? isDark
                ? 'bg-red-950/45 text-red-200'
                : 'bg-red-50/90 text-red-950'
              : isDark
                ? 'text-slate-400'
                : 'text-slate-600';

          const rightBg =
            row.kind === 'added' || row.kind === 'changed'
              ? isDark
                ? 'bg-emerald-950/45 text-emerald-200'
                : 'bg-emerald-50/90 text-emerald-950'
              : isDark
                ? 'text-slate-400'
                : 'text-slate-600';

          return (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-2">
              <div
                className={`flex items-start px-2 py-0.5 md:border-r ${
                  isDark ? 'md:border-slate-800' : 'md:border-slate-200'
                } ${leftBg}`}
              >
                <span className="w-10 shrink-0 select-none text-[10px] opacity-55 tabular-nums pr-2 text-right">
                  {row.leftLine ?? ''}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                  {row.leftText || ' '}
                </span>
              </div>
              <div className={`flex items-start px-2 py-0.5 ${rightBg}`}>
                <span className="w-10 shrink-0 select-none text-[10px] opacity-55 tabular-nums pr-2 text-right">
                  {row.rightLine ?? ''}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                  {row.rightText || ' '}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {diff.truncated && (
        <div
          className={`px-3 py-1.5 text-[10px] border-t ${
            isDark
              ? 'border-slate-800 bg-slate-950/50 text-slate-400'
              : 'border-slate-200 bg-slate-50 text-slate-500'
          }`}
        >
          Menampilkan {maxTotalRows} baris perubahan teratas agar tampilan tetap ringan &amp; bebas lag.
        </div>
      )}
    </div>
  );
};
