import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Crosshair, MapPin } from 'lucide-react';
import type { AiSignatureFinding } from '../lib/aiSignatureDetector';

interface AiSignatureLocationMapProps {
  xml: string;
  findings: AiSignatureFinding[];
  onJumpToLine: (line: number) => void;
  onHighlightCard?: (findingId: string) => void;
}

interface ZoneSpan {
  label: string;
  startPct: number;
  widthPct: number;
  startLine: number;
  endLine: number;
  bgClass: string;
}

export const AiSignatureLocationMap: React.FC<AiSignatureLocationMapProps> = ({
  xml,
  findings,
  onJumpToLine,
  onHighlightCard,
}) => {
  const [hoveredFindingId, setHoveredFindingId] = useState<string | null>(null);
  const [selectedBucketIdx, setSelectedBucketIdx] = useState<number | null>(null);

  const { totalLines, zoneSpans, buckets, sortedFindings } = useMemo(() => {
    const lines = xml ? xml.split('\n') : [''];
    const total = Math.max(1, lines.length);

    const findLineOf = (regex: RegExp): number | null => {
      const m = regex.exec(xml);
      if (!m) return null;
      return xml.slice(0, m.index).split('\n').length;
    };

    const headLine = findLineOf(/<head\b/i) ?? 1;
    const skinLine = findLineOf(/<b:skin\b/i) ?? Math.min(total, headLine + 10);
    const bodyLine = findLineOf(/<body\b/i) ?? Math.floor(total * 0.35);
    const footerLine = findLineOf(/<footer\b|<script\b(?=[^>]*>[\s\S]{80,})/i) ?? Math.floor(total * 0.8);

    const points = [
      { label: 'XML & Head', line: 1, bgClass: 'bg-slate-100' },
      { label: '<b:skin> / CSS', line: Math.max(2, skinLine), bgClass: 'bg-blue-50/70' },
      { label: 'Body & Widget', line: Math.max(skinLine + 1, bodyLine), bgClass: 'bg-slate-50' },
      { label: 'Script & Footer', line: Math.max(bodyLine + 1, footerLine), bgClass: 'bg-slate-100/80' },
    ].filter((p, idx, arr) => idx === 0 || (p.line <= total && p.line > arr[idx - 1].line));

    const spans: ZoneSpan[] = points.map((p, idx) => {
      const nextLine = idx + 1 < points.length ? points[idx + 1].line - 1 : total;
      const startPct = ((p.line - 1) / total) * 100;
      const endPct = (nextLine / total) * 100;
      return {
        label: p.label,
        startPct,
        widthPct: Math.max(2, endPct - startPct),
        startLine: p.line,
        endLine: Math.max(p.line, nextLine),
        bgClass: p.bgClass,
      };
    });

    const bucketCount = 32;
    const step = Math.max(1, Math.ceil(total / bucketCount));
    const bucketList = Array.from({ length: bucketCount }, (_, i) => {
      const startLine = i * step + 1;
      const endLine = Math.min(total, (i + 1) * step);
      const items = findings.filter((f) => f.line >= startLine && f.line <= endLine);
      const hasHigh = items.some((f) => f.confidence === 'tinggi');
      const hasMedium = items.some((f) => f.confidence === 'sedang');
      return {
        index: i,
        startLine,
        endLine,
        items,
        hasHigh,
        hasMedium,
      };
    }).filter((b) => b.startLine <= total);

    const sorted = [...findings].sort((a, b) => a.line - b.line);

    return {
      totalLines: total,
      zoneSpans: spans,
      buckets: bucketList,
      sortedFindings: sorted,
    };
  }, [xml, findings]);

  const activeHovered = useMemo(() => {
    if (!hoveredFindingId) return sortedFindings[0] ?? null;
    return sortedFindings.find((f) => f.id === hoveredFindingId) ?? sortedFindings[0] ?? null;
  }, [hoveredFindingId, sortedFindings]);

  const selectedBucket =
    selectedBucketIdx !== null ? buckets.find((b) => b.index === selectedBucketIdx) ?? null : null;

  return (
    <section
      aria-label="Peta Lokasi Visual Tanda Tangan AI dalam XML"
      className="p-4 sm:p-5 rounded-xl border border-slate-200 bg-white space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-slate-700 shrink-0" />
            <h4 className="text-sm font-semibold text-slate-900">
              Peta Lokasi Tanda Tangan AI dalam Dokumen XML
            </h4>
          </div>
          <p className="text-xs text-slate-500">
            Klik penanda baris atau blok segmen di peta grafis di bawah untuk melompat langsung ke baris tersebut di{' '}
            <strong className="text-slate-700">Editor XML</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 tabular-nums shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-amber-600 inline-block" aria-hidden="true" />
            <span>Tanda Tangan Kuat</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" aria-hidden="true" />
            <span>Indikasi AI</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-slate-500 inline-block" aria-hidden="true" />
            <span>Sinyal Gaya</span>
          </span>
          <span className="font-mono text-slate-500">Total {totalLines.toLocaleString('id-ID')} baris</span>
        </div>
      </div>

      {findings.length === 0 ? (
        <div className="p-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 text-xs text-slate-600 flex items-center justify-between gap-3">
          <span>
            Peta dokumen bersih — belum ada koordinat tanda tangan AI yang terdeteksi di {totalLines} baris XML.
          </span>
          <button
            type="button"
            onClick={() => onJumpToLine(1)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shrink-0 cursor-pointer"
          >
            Buka Baris 1 di Editor
          </button>
        </div>
      ) : (
        <>
          {/* 1. Interactive SVG Proportional Document Timeline Map */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 tabular-nums">
              <span>Baris 1 (Awal XML)</span>
              <span>Baris {Math.max(1, Math.round(totalLines / 2)).toLocaleString('id-ID')}</span>
              <span>Baris {totalLines.toLocaleString('id-ID')} (Akhir XML)</span>
            </div>

            <div className="relative h-20 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden select-none">
              {/* Background structural zone bands */}
              <div className="absolute inset-0 flex">
                {zoneSpans.map((span, idx) => (
                  <div
                    key={idx}
                    style={{ width: `${span.widthPct}%` }}
                    className={`h-full border-r last:border-r-0 border-slate-200/80 px-2 pt-1.5 overflow-hidden ${span.bgClass}`}
                    title={`${span.label} (Baris ${span.startLine}–${span.endLine})`}
                  >
                    <span className="block text-[10px] font-mono text-slate-500 truncate">
                      {span.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Center horizontal axis track */}
              <div
                className="absolute left-2 right-2 bottom-5 h-1.5 rounded bg-slate-200/90"
                aria-hidden="true"
              />

              {/* Clickable pin markers positioned by exact line ratio */}
              {sortedFindings.map((finding, idx) => {
                const rawPct = totalLines <= 1 ? 50 : ((finding.line - 1) / (totalLines - 1)) * 100;
                const leftPct = Math.min(98.5, Math.max(1.5, rawPct));
                const tierRow = idx % 2 === 0 ? 'bottom-3' : 'bottom-7';
                const pinColor =
                  finding.confidence === 'tinggi'
                    ? 'bg-amber-600 hover:bg-amber-700 border-white'
                    : finding.confidence === 'sedang'
                      ? 'bg-blue-600 hover:bg-blue-700 border-white'
                      : 'bg-slate-600 hover:bg-slate-800 border-white';
                const isActive = activeHovered?.id === finding.id;

                return (
                  <button
                    key={finding.id}
                    type="button"
                    onMouseEnter={() => setHoveredFindingId(finding.id)}
                    onFocus={() => setHoveredFindingId(finding.id)}
                    onClick={() => {
                      onHighlightCard?.(finding.id);
                      onJumpToLine(finding.line);
                    }}
                    style={{ left: `${leftPct}%` }}
                    aria-label={`Lompat ke baris ${finding.line}: ${finding.sourceTool} di zona ${finding.zone}`}
                    title={`Baris ${finding.line} · ${finding.sourceTool} (${finding.zone}) — Klik untuk buka Editor XML`}
                    className={`absolute -translate-x-1/2 ${tierRow} group cursor-pointer focus:outline-none z-10`}
                  >
                    <span
                      className={`block w-3.5 h-3.5 rounded-sm border-2 shadow-xs transition-transform ${pinColor} ${
                        isActive ? 'scale-125 ring-2 ring-slate-900/20' : 'group-hover:scale-125'
                      }`}
                    />
                    <span
                      className={`block w-px h-3 mx-auto ${
                        finding.confidence === 'tinggi'
                          ? 'bg-amber-600/70'
                          : finding.confidence === 'sedang'
                            ? 'bg-blue-600/70'
                            : 'bg-slate-500/70'
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Clickable Document Segment Heatmap Blocks */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-600">
              <span className="font-medium">Peta Blok Segmen XML (Klik blok berwarna untuk melompat):</span>
              {selectedBucket && selectedBucket.items.length > 0 && (
                <span className="font-mono text-slate-500 tabular-nums">
                  Segmen Brs {selectedBucket.startLine}–{selectedBucket.endLine}: {selectedBucket.items.length} temuan
                </span>
              )}
            </div>
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
            >
              {buckets.map((bucket) => {
                const count = bucket.items.length;
                const hasFindings = count > 0;
                const colorCls = !hasFindings
                  ? 'bg-slate-100 hover:bg-slate-200 border-slate-200'
                  : bucket.hasHigh
                    ? 'bg-amber-500 hover:bg-amber-600 border-amber-600 text-white'
                    : bucket.hasMedium
                      ? 'bg-blue-500 hover:bg-blue-600 border-blue-600 text-white'
                      : 'bg-slate-500 hover:bg-slate-600 border-slate-600 text-white';

                return (
                  <button
                    key={bucket.index}
                    type="button"
                    onMouseEnter={() => {
                      setSelectedBucketIdx(bucket.index);
                      if (bucket.items[0]) setHoveredFindingId(bucket.items[0].id);
                    }}
                    onClick={() => {
                      const targetLine = bucket.items[0]?.line ?? bucket.startLine;
                      if (bucket.items[0]) onHighlightCard?.(bucket.items[0].id);
                      onJumpToLine(targetLine);
                    }}
                    title={
                      hasFindings
                        ? `Baris ${bucket.startLine}–${bucket.endLine}: ${count} tanda tangan AI (Baris pertama: ${bucket.items[0].line}). Klik untuk lompat ke Editor XML.`
                        : `Baris ${bucket.startLine}–${bucket.endLine}: Bersih. Klik untuk buka baris ${bucket.startLine}.`
                    }
                    className={`h-7 rounded border text-[10px] font-mono tabular-nums flex items-center justify-center transition-colors cursor-pointer ${colorCls}`}
                  >
                    {hasFindings ? count : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Active Coordinate Readout + Quick Line Coordinate Buttons */}
          <div className="pt-2 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {activeHovered && (
              <div className="flex items-start gap-2.5 min-w-0 flex-1 text-xs">
                <Crosshair className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="min-w-0 space-y-0.5">
                  <div className="font-semibold text-slate-900 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono tabular-nums text-blue-700">Baris {activeHovered.line}</span>
                    <span className="text-slate-400" aria-hidden="true">&middot;</span>
                    <span>{activeHovered.sourceTool}</span>
                    <span className="text-slate-400" aria-hidden="true">&middot;</span>
                    <span className="font-mono text-slate-600">{activeHovered.zone}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono truncate">
                    {activeHovered.rawSnippet.replace(/\s+/g, ' ').slice(0, 120)}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {sortedFindings.slice(0, 10).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onMouseEnter={() => setHoveredFindingId(f.id)}
                  onClick={() => {
                    onHighlightCard?.(f.id);
                    onJumpToLine(f.line);
                  }}
                  className={`px-2.5 py-1.5 rounded-md border text-[11px] font-mono tabular-nums flex items-center gap-1 transition-colors cursor-pointer ${
                    f.confidence === 'tinggi'
                      ? 'bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-900'
                      : f.confidence === 'sedang'
                        ? 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-900'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                  }`}
                >
                  <span>Brs {f.line}</span>
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              ))}
              {sortedFindings.length > 10 && (
                <span className="text-[11px] text-slate-500 font-mono px-1">
                  +{sortedFindings.length - 10} lokasi lain
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
};
