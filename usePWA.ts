import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const OFFLINE_MODE_STORAGE_KEY = 'temaloka_manual_offline_mode_v1';

let pwaUpdateAvailableState = false;
let pwaUpdateHandler: ((reloadPage?: boolean) => Promise<void>) | null = null;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let manualOfflineState = false;

try {
  manualOfflineState = localStorage.getItem(OFFLINE_MODE_STORAGE_KEY) === '1';
} catch {
  manualOfflineState = false;
}

const pwaListeners = new Set<() => void>();
const installListeners = new Set<() => void>();
const offlineModeListeners = new Set<() => void>();

function emitPwaUpdate(): void {
  pwaListeners.forEach((fn) => fn());
}

function emitInstallUpdate(): void {
  installListeners.forEach((fn) => fn());
}

function emitOfflineModeUpdate(): void {
  offlineModeListeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    emitInstallUpdate();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    emitInstallUpdate();
  });
}

export function notifyPWANeedRefresh(needsRefresh: boolean): void {
  pwaUpdateAvailableState = needsRefresh;
  emitPwaUpdate();
}

export function setPWAUpdateHandler(handler: (reloadPage?: boolean) => Promise<void>): void {
  pwaUpdateHandler = handler;
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}

export function useOfflineSyncReload() {
  const isOnline = useOnlineStatus();
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(pwaUpdateAvailableState);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    const listener = () => setUpdateAvailable(pwaUpdateAvailableState);
    pwaListeners.add(listener);
    return () => {
      pwaListeners.delete(listener);
    };
  }, []);

  const syncOnlineToOfflineAndReload = useCallback(async (): Promise<{
    synced: boolean;
    reason?: 'offline';
  }> => {
    if (!isOnline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return { synced: false, reason: 'offline' };
    }

    setIsSyncing(true);
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update().catch(() => {});
        }
      }
      if (pwaUpdateHandler) {
        await pwaUpdateHandler(true).catch(() => {});
      }
      window.setTimeout(() => {
        window.location.reload();
      }, 250);
      return { synced: true };
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline]);

  return {
    isSyncing,
    updateAvailable,
    syncOnlineToOfflineAndReload,
  };
}

export function usePWAInstall() {
  const [isInstallable, setIsInstallable] = useState<boolean>(() => Boolean(deferredInstallPrompt));
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  });

  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as Window & { MSStream?: unknown }).MSStream;

  useEffect(() => {
    const listener = () => {
      setIsInstallable(Boolean(deferredInstallPrompt));
      setIsInstalled(
        window.matchMedia?.('(display-mode: standalone)').matches ||
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true
      );
    };
    installListeners.add(listener);
    return () => {
      installListeners.delete(listener);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredInstallPrompt) return;
    try {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        deferredInstallPrompt = null;
        setIsInstalled(true);
        setIsInstallable(false);
      }
    } catch {
      // ignore install cancellation errors
    }
  }, []);

  return {
    isInstallable,
    isInstalled,
    isIOS,
    install,
  };
}

export function useAppOfflineMode() {
  const browserOnline = useOnlineStatus();
  const [manualOffline, setManualOffline] = useState<boolean>(manualOfflineState);
  const [offlineCacheReady, setOfflineCacheReady] = useState<boolean>(false);

  useEffect(() => {
    const listener = () => setManualOffline(manualOfflineState);
    offlineModeListeners.add(listener);
    return () => {
      offlineModeListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          setOfflineCacheReady(Boolean(reg?.active));
        })
        .catch(() => {});
    }
  }, []);

  const setOfflineMode = useCallback(
    (nextOffline: boolean): { changed: boolean; nextOffline: boolean; reason?: 'no-network' } => {
      if (!nextOffline && !browserOnline) {
        return { changed: false, nextOffline: true, reason: 'no-network' };
      }
      manualOfflineState = nextOffline;
      try {
        localStorage.setItem(OFFLINE_MODE_STORAGE_KEY, nextOffline ? '1' : '0');
      } catch {
        // ignore storage error
      }
      emitOfflineModeUpdate();
      return { changed: true, nextOffline };
    },
    [browserOnline]
  );

  const toggleOfflineMode = useCallback(() => {
    return setOfflineMode(!manualOfflineState);
  }, [setOfflineMode]);

  const isOfflineMode = !browserOnline || manualOffline;

  return {
    browserOnline,
    manualOffline,
    isOfflineMode,
    offlineCacheReady,
    setOfflineMode,
    toggleOfflineMode,
  };
}
