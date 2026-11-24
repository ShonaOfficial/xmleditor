import React, { useMemo, useState } from 'react';
import {
  Camera,
  Download,
  History,
  RotateCcw,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import type { XmlSnapshotRecord } from '../lib/snapshotStore';
import {
  canShareXmlFile,
  downloadXmlFile,
  shareXmlFileViaNavigator,
} from '../lib/bloggerCompiler';

interface SnapshotHistoryDrawerProps {
  isOpen: boolean;
  snapshots: XmlSnapshotRecord[];
  currentXmlBytes: number;
  templateTitle: string;
  onClose: () => void;
  onCreateManualSnapshot: (label: string) => void;
  onRestoreSnapshot: (snapshot: XmlSnapshotRecord) => void;
  onDeleteSnapshot: (id: string) => void;
  onClearAll: () => void;
}

function formatBytesLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatTimestamp(ts: number): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

const CATEGORY_LABELS: Record<XmlSnapshotRecord['category'], string> = {
  auto: 'Otomatis',
  manual: 'Manual',
  autofix: 'Auto-Fix',
  cleaner: 'Pembersih',
  layout: 'Tata Letak',
  editor: 'Editor',
  import: 'Impor',
};

export const SnapshotHistoryDrawer: React.FC<SnapshotHistoryDrawerProps> = ({
  isOpen,
  snapshots,
  currentXmlBytes,
  templateTitle,
  onClose,
  onCreateManualSnapshot,
  onRestoreSnapshot,
  onDeleteSnapshot,
  onClearAll,
}) => {
  const [manualLabel, setManualLabel] = useState('');
  const canShareMobile = useMemo(() => canShareXmlFile(), []);

  if (!isOpen) return null;

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const label =
      manualLabel.trim() ||
      `Titik Simpan Manual (${formatTimestamp(Date.now())})`;
    onCreateManualSnapshot(label);
    setManualLabel('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl max-h-[90dvh] bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Riwayat Snapshot Lokal (IndexedDB)</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
              Menyimpan cadangan XML hingga ukuran besar (&gt; 1.5 MB) langsung di IndexedDB perangkat. XML aktif: {formatBytesLabel(currentXmlBytes)}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup riwayat snapshot"
            className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Manual Snapshot Bar */}
        <form
          onSubmit={handleSaveSubmit}
          className="px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap sm:flex-nowrap items-center gap-2"
        >
          <input
            type="text"
            value={manualLabel}
            onChange={(e) => setManualLabel(e.target.value)}
            placeholder="Label snapshot (mis: Sebelum bersihkan CSS)"
            className="flex-1 min-w-[200px] px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Simpan Snapshot Sekarang</span>
          </button>
        </form>

        {/* Snapshot List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5">
          {snapshots.length === 0 ? (
            <div className="p-8 text-center border border-slate-200 rounded-xl bg-slate-50/70 space-y-2">
              <p className="text-xs font-semibold text-slate-800">
                Belum ada snapshot tersimpan di IndexedDB
              </p>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
                Snapshot otomatis dibuat sebelum Auto-Fix, pembersihan CSS/JS, atau perubahan besar lainnya. Klik &quot;Simpan Snapshot Sekarang&quot; di atas untuk membuat titik pemulihan manual.
              </p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
              {snapshots.map((snap) => (
                <div
                  key={snap.id}
                  className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 transition-colors"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-slate-900 truncate">
                        {snap.label}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {CATEGORY_LABELS[snap.category] || snap.category}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 flex flex-wrap items-center gap-x-2">
                      <span>{formatTimestamp(snap.createdAt)}</span>
                      <span aria-hidden="true">&middot;</span>
                      <span>{formatBytesLabel(snap.byteSize)}</span>
                      <span aria-hidden="true">&middot;</span>
                      <span>{snap.lineCount.toLocaleString('id-ID')} baris</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onRestoreSnapshot(snap)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Pulihkan</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadXmlFile(snap.xml, `${templateTitle}-snapshot`)}
                      title="Unduh snapshot ini sebagai .xml"
                      className="p-1.5 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    {canShareMobile && (
                      <button
                        type="button"
                        onClick={() => void shareXmlFileViaNavigator(snap.xml, `${templateTitle}-snapshot`)}
                        title="Simpan via Share HP"
                        className="p-1.5 text-emerald-700 hover:text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteSnapshot(snap.id)}
                      title="Hapus snapshot"
                      className="p-1.5 text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          {snapshots.length > 0 ? (
            <button
              type="button"
              onClick={onClearAll}
              className="text-xs font-medium text-red-700 hover:underline cursor-pointer"
            >
              Hapus Semua Snapshot ({snapshots.length})
            </button>
          ) : (
            <span className="text-[11px] text-slate-500">100% offline di IndexedDB browser</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
