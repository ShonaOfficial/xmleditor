import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, Smartphone, Wifi, WifiOff, X } from 'lucide-react';
import {
  useAppOfflineMode,
  useOfflineSyncReload,
  useOnlineStatus,
  usePWAInstall,
} from '../hooks/usePWA';

interface OfflineSyncReloadButtonProps {
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const OfflineSyncReloadButton: React.FC<OfflineSyncReloadButtonProps> = ({ onNotify }) => {
  const isOnline = useOnlineStatus();
  const { isSyncing, updateAvailable, syncOnlineToOfflineAndReload } = useOfflineSyncReload();

  const handleClick = async () => {
    const result = await syncOnlineToOfflineAndReload();
    if (!result.synced && result.reason === 'offline') {
      onNotify(
        'Anda sedang offline. Hubungkan ke internet sebentar untuk menyinkronkan pembaruan ke cache offline.',
        'error'
      );
      return;
    }
    onNotify('Memperbarui halaman & menyinkronkan cache offline terbaru...', 'success');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isSyncing}
      title={
        isOnline
          ? 'Muat ulang dan perbarui versi online ke penyimpanan offline'
          : 'Sedang offline — hubungkan internet untuk memperbarui versi online'
      }
      aria-label="Perbarui halaman online ke offline"
      className={`flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
        updateAvailable
          ? 'border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
      <span className="hidden md:inline">
        {updateAvailable ? 'Update & Muat Ulang' : 'Perbarui Offline'}
      </span>
      <span className="hidden sm:inline md:hidden">Muat Ulang</span>
    </button>
  );
};

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Pasang Offline</span>
        <span className="sm:hidden">Pasang</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Pasang App</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-5 border border-slate-200 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Pasang TemaLoka di iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Tutup panduan"
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                1. Ketuk tombol <strong>Bagikan (Share)</strong> di bilah Safari.
                <br />
                2. Gulir ke bawah lalu pilih <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>.
                <br />
                3. Buka kembali tanpa kuota untuk mengedit XML secara offline penuh.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                Mengerti
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

interface OnlineOfflineToggleProps {
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const OnlineOfflineToggle: React.FC<OnlineOfflineToggleProps> = ({ onNotify }) => {
  const { browserOnline, isOfflineMode, offlineCacheReady, toggleOfflineMode } =
    useAppOfflineMode();

  const handleToggle = () => {
    const res = toggleOfflineMode();
    if (!res.changed && res.reason === 'no-network') {
      onNotify(
        'Koneksi internet perangkat terputus. Hubungkan jaringan terlebih dahulu untuk masuk Mode Online.',
        'error'
      );
      return;
    }

    if (res.nextOffline) {
      onNotify(
        'Mode Offline diaktifkan. Pratinjau, editor XML, dan AI berjalan 100% lokal tanpa memuat aset eksternal.',
        'info'
      );
    } else {
      onNotify(
        'Mode Online aktif. Halaman dapat memuat font CDN, URL Blogspot langsung, dan sinkronisasi.',
        'success'
      );
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOfflineMode}
      onClick={handleToggle}
      title={
        isOfflineMode
          ? browserOnline
            ? 'Mode Offline Aktif — Klik untuk beralih ke Mode Online'
            : 'Perangkat Offline — Tidak ada koneksi internet'
          : offlineCacheReady
            ? 'Halaman Online & Cache Offline Siap — Klik untuk beralih ke Mode Offline'
            : 'Halaman Online (Kunjungan aktif) — Klik untuk beralih ke Mode Offline'
      }
      aria-label={isOfflineMode ? 'Matikan Mode Offline, beralih ke Online' : 'Aktifkan Mode Offline'}
      className={`flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
        isOfflineMode
          ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
          : 'border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-100/70'
      }`}
    >
      {isOfflineMode ? (
        <WifiOff className="w-3.5 h-3.5 shrink-0 text-amber-700" />
      ) : (
        <Wifi className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
      )}
      <span className="hidden sm:inline">{isOfflineMode ? 'Mode Offline' : 'Mode Online'}</span>
      <span className="sm:hidden">{isOfflineMode ? 'Offline' : 'Online'}</span>

      {/* Visual Toggle Switch Track */}
      <span
        aria-hidden="true"
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
          isOfflineMode ? 'bg-amber-600' : 'bg-emerald-600/30'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-xs transition-transform ${
            isOfflineMode ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
};

export const OfflineIndicator: React.FC<{
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}> = ({ onNotify }) => {
  const { browserOnline, manualOffline, isOfflineMode, setOfflineMode } = useAppOfflineMode();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isOfflineMode) {
      setDismissed(false);
      return;
    }
    setDismissed(false);
    const timer = window.setTimeout(() => {
      setDismissed(true);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [isOfflineMode, manualOffline, browserOnline]);

  if (!isOfflineMode || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-40 max-w-[calc(100vw-2rem)] flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 shadow-sm"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0 text-amber-700" />
      <span>
        {manualOffline && browserOnline
          ? 'Mode Offline Aktif — Pratinjau & alat lokal berjalan tanpa akses jaringan eksternal.'
          : 'Perangkat Offline — Semua alat lokal & pratinjau tetap berjalan normal.'}
      </span>
      {manualOffline && browserOnline && (
        <button
          type="button"
          onClick={() => {
            setOfflineMode(false);
            onNotify?.('Mode Online diaktifkan kembali.', 'success');
          }}
          className="px-2 py-0.5 text-[11px] font-semibold bg-amber-900 text-white hover:bg-amber-800 rounded cursor-pointer"
        >
          Aktifkan Online
        </button>
      )}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Tutup notifikasi mode offline"
        title="Tutup notifikasi"
        className="ml-1 p-1 rounded text-amber-800/70 hover:text-amber-950 hover:bg-amber-200/60 transition-colors cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
