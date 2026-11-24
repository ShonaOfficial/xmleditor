import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Cpu, LogOut, Sparkles, User as UserIcon } from 'lucide-react';
import { useAuthAndAi } from '../contexts/AuthAndAiContext';
import { getGeminiModelOption } from '../lib/aiEngineCatalog';

interface GoogleAccountButtonProps {
  isOfflineMode?: boolean;
}

const GoogleGIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

export const GoogleAccountButton: React.FC<GoogleAccountButtonProps> = ({
  isOfflineMode = false,
}) => {
  const {
    user,
    authReady,
    isSigningIn,
    signInWithGoogle,
    signOutGoogle,
    engineMode,
    setEngineMode,
    geminiModel,
    quota,
  } = useAuthAndAi();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  if (!authReady) {
    return (
      <div className="h-9 w-20 sm:w-24 rounded-lg bg-slate-100 animate-pulse shrink-0" />
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => void signInWithGoogle()}
        disabled={isSigningIn || isOfflineMode}
        title={
          isOfflineMode
            ? 'Mode Offline aktif. Hubungkan internet untuk Login Google.'
            : `Masuk dengan akun Google untuk memakai Gemini Cloud (Limit ${quota.dailyLimit}/hari per akun)`
        }
        className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 min-h-[38px] sm:min-h-[34px] text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
      >
        <GoogleGIcon className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">
          {isSigningIn ? 'Menghubungkan...' : 'Masuk Google'}
        </span>
        <span className="sm:hidden">{isSigningIn ? '...' : 'Masuk'}</span>
        <span
          className="px-1 py-0.5 text-[10px] font-mono tabular-nums rounded bg-slate-100 text-slate-600"
          title="Kuota harian per akun Google"
        >
          {quota.dailyLimit}
        </span>
      </button>
    );
  }

  const shortName =
    (user.displayName || user.email || 'Akun').split(' ')[0].slice(0, 14);
  const activeModelMeta = getGeminiModelOption(geminiModel);
  const pct = Math.min(100, Math.round((quota.usedCount / Math.max(1, quota.dailyLimit)) * 100));

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        title={`Akun ${shortName} · Sisa Kuota Gemini ${quota.remaining}/${quota.dailyLimit}`}
        className="flex items-center gap-1.5 px-2 py-1 min-h-[38px] sm:min-h-[34px] text-xs font-medium text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={shortName}
            referrerPolicy="no-referrer"
            className="w-5 h-5 rounded-full object-cover border border-slate-200 shrink-0"
          />
        ) : (
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
            <UserIcon className="w-3 h-3" />
          </span>
        )}
        <span className="hidden md:inline max-w-[90px] truncate">{shortName}</span>
        <span
          className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold tabular-nums rounded border ${
            quota.remaining <= 3
              ? 'bg-rose-50 border-rose-200 text-rose-700'
              : 'bg-white border-slate-200 text-slate-700'
          }`}
          title="Sisa kuota Gemini harian akun ini"
        >
          {quota.remaining}/{quota.dailyLimit}
        </span>
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      {menuOpen && (
        <div className="fixed left-3 right-3 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3.5 space-y-3 text-xs">
          <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-100">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={shortName}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
                <UserIcon className="w-4 h-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900 truncate">
                {user.displayName || 'Pengguna Google'}
              </div>
              <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
            </div>
          </div>

          <div className="space-y-1.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-700">Sisa Kuota Harian Gemini</span>
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                Sisa {quota.remaining}/{quota.dailyLimit} (Terpakai {quota.usedCount})
              </span>
            </div>
            <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  pct >= 90 ? 'bg-rose-600' : pct >= 70 ? 'bg-amber-500' : 'bg-blue-600'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Mesin aktif: <strong>{engineMode === 'gemini' ? activeModelMeta.label : 'AI Lokal'}</strong>. Beralih ke <strong>AI Lokal</strong> kapan saja untuk 0 kuota server.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => {
                setEngineMode('local');
                setMenuOpen(false);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 min-h-[40px] px-2.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                engineMode === 'local'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>AI Lokal</span>
            </button>
            <button
              type="button"
              disabled={isOfflineMode}
              onClick={() => {
                setEngineMode('gemini');
                setMenuOpen(false);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 min-h-[40px] px-2.5 rounded-lg border text-[11px] font-semibold cursor-pointer disabled:opacity-50 ${
                engineMode === 'gemini' && !isOfflineMode
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{activeModelMeta.shortLabel}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              void signOutGoogle();
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 min-h-[40px] px-3 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-[11px] font-semibold cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar Akun Google</span>
          </button>
        </div>
      )}
    </div>
  );
};
