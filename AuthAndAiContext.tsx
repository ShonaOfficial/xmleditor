import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  DAILY_GEMINI_QUOTA_LIMIT,
  isCallableGeminiModel,
  type AiEngineMode,
  type CallableGeminiModelId,
} from '../lib/aiEngineCatalog';

export interface QuotaStatus {
  dateKey: string;
  usedCount: number;
  dailyLimit: number;
  remaining: number;
}

export interface AiChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  engineLabel: string;
  modelId: string;
  suggestedCss?: string;
  pageContext: string;
  createdAtMs: number;
}

export interface GeminiXmlPartAttachment {
  id: string;
  index: number;
  total: number;
  filename: string;
  title: string;
  byteSize: number;
  lineCount: number;
  content: string;
}

interface AuthAndAiContextValue {
  user: User | null;
  authReady: boolean;
  isSigningIn: boolean;
  signInWithGoogle: () => Promise<boolean>;
  signOutGoogle: () => Promise<void>;
  engineMode: AiEngineMode;
  setEngineMode: (mode: AiEngineMode) => void;
  geminiModel: CallableGeminiModelId;
  setGeminiModel: (model: string) => void;
  quota: QuotaStatus;
  chatMessages: AiChatMessageItem[];
  isChatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  toggleChatOpen: () => void;
  attachedXmlParts: GeminiXmlPartAttachment[];
  attachXmlPartsToGemini: (
    parts: GeminiXmlPartAttachment[],
    options?: { replace?: boolean; openChat?: boolean; switchToGemini?: boolean }
  ) => void;
  removeAttachedXmlPart: (partId: string) => void;
  clearAttachedXmlParts: () => void;
  appendChatMessages: (
    userMsg: Omit<AiChatMessageItem, 'id' | 'createdAtMs'>,
    assistantMsg: Omit<AiChatMessageItem, 'id' | 'createdAtMs'>
  ) => Promise<void>;
  clearChatMessages: () => Promise<void>;
  authorizedGeminiFetch: <T = Record<string, unknown>>(
    endpoint: string,
    payload: Record<string, unknown>,
    options?: { overrideModel?: CallableGeminiModelId }
  ) => Promise<T>;
  onNotify?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const LOCAL_PREF_KEY = 'temaloka_hybrid_ai_prefs_v1';
const LOCAL_CHAT_KEY = 'temaloka_local_ai_chat_v1';

function getUtcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadLocalPrefs(): {
  engineMode: AiEngineMode;
  geminiModel: CallableGeminiModelId;
} {
  try {
    const raw = localStorage.getItem(LOCAL_PREF_KEY);
    if (!raw) return { engineMode: 'local', geminiModel: 'gemini-3.1-flash-lite' };
    const parsed = JSON.parse(raw) as {
      engineMode?: string;
      geminiModel?: string;
    };
    return {
      engineMode: parsed.engineMode === 'gemini' ? 'gemini' : 'local',
      geminiModel: isCallableGeminiModel(parsed.geminiModel || '')
        ? (parsed.geminiModel as CallableGeminiModelId)
        : 'gemini-3.1-flash-lite',
    };
  } catch {
    return { engineMode: 'local', geminiModel: 'gemini-3.1-flash-lite' };
  }
}

function loadLocalChat(): AiChatMessageItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-40) : [];
  } catch {
    return [];
  }
}

const AuthAndAiContext = createContext<AuthAndAiContextValue | null>(null);

export const AuthAndAiProvider: React.FC<{
  children: React.ReactNode;
  onNotify?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}> = ({ children, onNotify }) => {
  const initialPrefs = useMemo(() => loadLocalPrefs(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [engineMode, setEngineModeState] = useState<AiEngineMode>(initialPrefs.engineMode);
  const [geminiModel, setGeminiModelState] = useState<CallableGeminiModelId>(
    initialPrefs.geminiModel
  );
  const [quota, setQuota] = useState<QuotaStatus>(() => ({
    dateKey: getUtcDateKey(),
    usedCount: 0,
    dailyLimit: DAILY_GEMINI_QUOTA_LIMIT,
    remaining: DAILY_GEMINI_QUOTA_LIMIT,
  }));
  const [remoteChatMessages, setRemoteChatMessages] = useState<AiChatMessageItem[]>([]);
  const [localChatMessages, setLocalChatMessages] = useState<AiChatMessageItem[]>(loadLocalChat);
  const [isChatOpen, setChatOpen] = useState(false);
  const [attachedXmlParts, setAttachedXmlParts] = useState<GeminiXmlPartAttachment[]>([]);

  // Persist local preferences
  useEffect(() => {
    try {
      localStorage.setItem(
        LOCAL_PREF_KEY,
        JSON.stringify({ engineMode, geminiModel })
      );
    } catch {
      // ignore
    }
  }, [engineMode, geminiModel]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_CHAT_KEY, JSON.stringify(localChatMessages.slice(-40)));
    } catch {
      // ignore
    }
  }, [localChatMessages]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Ensure Firestore user document & sync preferences, quota, and chat messages when signed in
  useEffect(() => {
    if (!authReady || !user) {
      setRemoteChatMessages([]);
      setQuota({
        dateKey: getUtcDateKey(),
        usedCount: 0,
        dailyLimit: DAILY_GEMINI_QUOTA_LIMIT,
        remaining: DAILY_GEMINI_QUOTA_LIMIT,
      });
      return;
    }

    const userDocPath = `users/${user.uid}`;
    const userRef = doc(db, 'users', user.uid);
    const dateKey = getUtcDateKey();
    const quotaPath = `users/${user.uid}/quotas/${dateKey}`;
    const quotaRef = doc(db, 'users', user.uid, 'quotas', dateKey);

    let cancelled = false;

    const bootstrapUserProfile = async () => {
      try {
        const snap = await getDoc(userRef);
        if (!snap.exists() && !cancelled) {
          const payload: Record<string, unknown> = {
            uid: user.uid,
            displayName: (user.displayName || user.email || 'Pengguna Google').slice(0, 120),
            preferredMode: engineMode,
            preferredGeminiModel: geminiModel,
            preferredLocalRuntime: 'builtin',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (user.photoURL) {
            payload.photoUrl = user.photoURL.slice(0, 500);
          }
          await setDoc(userRef, payload);
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('permission')) {
          handleFirestoreError(err, OperationType.WRITE, userDocPath);
        }
      }

      // Sync server memory quota status
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/ai/quota-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ model: geminiModel }),
        });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { quota?: QuotaStatus };
          if (data.quota) {
            setQuota((prev) => ({
              dateKey: data.quota!.dateKey,
              usedCount: Math.max(prev.usedCount, data.quota!.usedCount),
              dailyLimit: data.quota!.dailyLimit,
              remaining: Math.min(prev.remaining, data.quota!.remaining),
            }));
          }
        }
      } catch {
        // ignore network hiccup
      }
    };

    void bootstrapUserProfile();

    const unsubUser = onSnapshot(
      userRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as {
          preferredMode?: string;
          preferredGeminiModel?: string;
        };
        if (data.preferredMode === 'local' || data.preferredMode === 'gemini') {
          setEngineModeState(data.preferredMode);
        }
        if (data.preferredGeminiModel && isCallableGeminiModel(data.preferredGeminiModel)) {
          setGeminiModelState(data.preferredGeminiModel);
        } else if (data.preferredGeminiModel === 'gemini-4-hydrogen') {
          setGeminiModelState('gemini-3.1-flash-lite');
          void updateDoc(userRef, {
            preferredGeminiModel: 'gemini-3.1-flash-lite',
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, userDocPath);
      }
    );

    const unsubQuota = onSnapshot(
      quotaRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as {
          dateKey?: string;
          usedCount?: number;
          dailyLimit?: number;
        };
        const used = typeof data.usedCount === 'number' ? data.usedCount : 0;
        const limitVal =
          typeof data.dailyLimit === 'number' ? data.dailyLimit : DAILY_GEMINI_QUOTA_LIMIT;
        setQuota({
          dateKey: data.dateKey || dateKey,
          usedCount: used,
          dailyLimit: limitVal,
          remaining: Math.max(0, limitVal - used),
        });
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, quotaPath);
      }
    );

    const chatCollectionPath = `users/${user.uid}/chatMessages`;
    const chatQuery = query(
      collection(db, 'users', user.uid, 'chatMessages'),
      where('uid', '==', user.uid),
      limit(80)
    );

    const unsubChat = onSnapshot(
      chatQuery,
      (snapshot) => {
        const items: AiChatMessageItem[] = snapshot.docs.map((d) => {
          const data = d.data() as {
            role?: string;
            content?: string;
            engineLabel?: string;
            modelId?: string;
            suggestedCss?: string;
            pageContext?: string;
            createdAt?: Timestamp | null;
          };
          const createdAtMs =
            data.createdAt && typeof data.createdAt.toMillis === 'function'
              ? data.createdAt.toMillis()
              : Date.now();
          return {
            id: d.id,
            role: data.role === 'assistant' ? 'assistant' : 'user',
            content: data.content || '',
            engineLabel: data.engineLabel || 'AI',
            modelId: data.modelId || 'gemini-3.1-flash-lite',
            suggestedCss: data.suggestedCss,
            pageContext: data.pageContext || 'preview',
            createdAtMs,
          };
        });
        items.sort((a, b) => a.createdAtMs - b.createdAtMs);
        setRemoteChatMessages(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, chatCollectionPath);
      }
    );

    return () => {
      cancelled = true;
      unsubUser();
      unsubQuota();
      unsubChat();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user?.uid]);

  const persistUserPref = useCallback(
    async (patch: { preferredMode?: AiEngineMode; preferredGeminiModel?: CallableGeminiModelId }) => {
      if (!user) return;
      const userPath = `users/${user.uid}`;
      const userRef = doc(db, 'users', user.uid);
      try {
        await updateDoc(userRef, {
          ...patch,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn('Could not sync preference update:', err);
      }
    },
    [user]
  );

  const setEngineMode = useCallback(
    (mode: AiEngineMode) => {
      setEngineModeState(mode);
      void persistUserPref({ preferredMode: mode });
    },
    [persistUserPref]
  );

  const setGeminiModel = useCallback(
    (model: string) => {
      if (!isCallableGeminiModel(model)) {
        onNotify?.('Model ini membutuhkan akun Gemini yang Pro.', 'info');
        return;
      }
      setGeminiModelState(model);
      setEngineModeState('gemini');
      void persistUserPref({ preferredMode: 'gemini', preferredGeminiModel: model });
    },
    [onNotify, persistUserPref]
  );

  const signInWithGoogle = useCallback(async (): Promise<boolean> => {
    setIsSigningIn(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user) {
        onNotify?.(
          `Berhasil masuk sebagai ${cred.user.displayName || cred.user.email || 'Akun Google'}.`,
          'success'
        );
        return true;
      }
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal masuk dengan Google.';
      if (/popup-closed-by-user/i.test(msg)) {
        onNotify?.('Popup Login Google ditutup sebelum selesai.', 'info');
      } else {
        onNotify?.(`Gagal Login Google: ${msg}`, 'error');
      }
      return false;
    } finally {
      setIsSigningIn(false);
    }
  }, [onNotify]);

  const signOutGoogle = useCallback(async () => {
    try {
      await signOut(auth);
      setEngineModeState('local');
      onNotify?.('Anda telah keluar dari akun Google. Mode dialihkan ke AI Lokal.', 'info');
    } catch (err) {
      onNotify?.(
        err instanceof Error ? err.message : 'Gagal keluar dari akun Google.',
        'error'
      );
    }
  }, [onNotify]);

  const syncQuotaDoc = useCallback(
    async (serverQuota: QuotaStatus, modelUsed: string) => {
      setQuota(serverQuota);
      if (!user) return;
      const quotaPath = `users/${user.uid}/quotas/${serverQuota.dateKey}`;
      const quotaRef = doc(db, 'users', user.uid, 'quotas', serverQuota.dateKey);
      try {
        const existingSnap = await getDoc(quotaRef);
        if (!existingSnap.exists()) {
          await setDoc(quotaRef, {
            uid: user.uid,
            dateKey: serverQuota.dateKey,
            usedCount: Math.min(serverQuota.usedCount, DAILY_GEMINI_QUOTA_LIMIT),
            dailyLimit: DAILY_GEMINI_QUOTA_LIMIT,
            lastModel: modelUsed.slice(0, 64),
            updatedAt: serverTimestamp(),
          });
        } else {
          const prevUsed = Number(existingSnap.data()?.usedCount || 0);
          const nextUsed = Math.min(
            DAILY_GEMINI_QUOTA_LIMIT,
            Math.max(prevUsed, Math.min(prevUsed + 1, serverQuota.usedCount))
          );
          await updateDoc(quotaRef, {
            usedCount: nextUsed,
            lastModel: modelUsed.slice(0, 64),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('permission')) {
          handleFirestoreError(err, OperationType.WRITE, quotaPath);
        }
      }
    },
    [user]
  );

  const authorizedGeminiFetch = useCallback(
    async <T = Record<string, unknown>>(
      endpoint: string,
      payload: Record<string, unknown>,
      options?: { overrideModel?: CallableGeminiModelId }
    ): Promise<T> => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Silakan Login Google terlebih dahulu untuk memakai Gemini Cloud.');
      }

      const selectedModel = options?.overrideModel || geminiModel;
      const idToken = await currentUser.getIdToken();

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          ...payload,
          model: selectedModel,
        }),
      });

      const data = (await res.json()) as T & {
        error?: string;
        code?: string;
        quota?: QuotaStatus;
      };

      if (data?.quota) {
        void syncQuotaDoc(data.quota, selectedModel);
      }

      if (!res.ok) {
        throw new Error(data?.error || `Permintaan Gemini gagal (HTTP ${res.status}).`);
      }

      return data;
    },
    [geminiModel, syncQuotaDoc]
  );

  const appendChatMessages = useCallback(
    async (
      userMsg: Omit<AiChatMessageItem, 'id' | 'createdAtMs'>,
      assistantMsg: Omit<AiChatMessageItem, 'id' | 'createdAtMs'>
    ) => {
      const now = Date.now();
      if (!user) {
        setLocalChatMessages((prev) => [
          ...prev.slice(-38),
          { ...userMsg, id: `local-u-${now}`, createdAtMs: now },
          { ...assistantMsg, id: `local-a-${now + 1}`, createdAtMs: now + 1 },
        ]);
        return;
      }

      const chatColPath = `users/${user.uid}/chatMessages`;
      const makeDocId = (prefix: string) =>
        `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const saveOne = async (
        id: string,
        item: Omit<AiChatMessageItem, 'id' | 'createdAtMs'>
      ) => {
        const ref = doc(db, 'users', user.uid, 'chatMessages', id);
        const docPayload: Record<string, unknown> = {
          uid: user.uid,
          role: item.role,
          content: item.content.slice(0, 12000),
          engineLabel: item.engineLabel.slice(0, 100),
          modelId: item.modelId.slice(0, 64),
          pageContext: item.pageContext.slice(0, 32),
          createdAt: serverTimestamp(),
        };
        if (item.suggestedCss && item.suggestedCss.trim()) {
          docPayload.suggestedCss = item.suggestedCss.trim().slice(0, 6000);
        }
        try {
          await setDoc(ref, docPayload);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `${chatColPath}/${id}`);
        }
      };

      await saveOne(makeDocId('usr'), userMsg);
      await saveOne(makeDocId('ast'), assistantMsg);
    },
    [user]
  );

  const clearChatMessages = useCallback(async () => {
    if (!user) {
      setLocalChatMessages([]);
      onNotify?.('Riwayat Chat AI lokal dibersihkan.', 'info');
      return;
    }
    const chatColPath = `users/${user.uid}/chatMessages`;
    try {
      const q = query(
        collection(db, 'users', user.uid, 'chatMessages'),
        where('uid', '==', user.uid),
        limit(80)
      );
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      onNotify?.('Riwayat Chat AI akun Google Anda dibersihkan.', 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, chatColPath);
    }
  }, [onNotify, user]);

  const toggleChatOpen = useCallback(() => {
    setChatOpen((v) => !v);
  }, []);

  const attachXmlPartsToGemini = useCallback(
    (
      parts: GeminiXmlPartAttachment[],
      options?: { replace?: boolean; openChat?: boolean; switchToGemini?: boolean }
    ) => {
      const valid = parts.filter((p) => p && typeof p.content === 'string' && p.content.length > 0);
      if (valid.length === 0) return;

      setAttachedXmlParts((prev) => {
        if (options?.replace) {
          return valid;
        }
        const byId = new Map<string, GeminiXmlPartAttachment>();
        for (const item of prev) {
          byId.set(item.id, item);
        }
        for (const item of valid) {
          byId.set(item.id, item);
        }
        return Array.from(byId.values()).sort((a, b) => a.index - b.index);
      });

      if (options?.switchToGemini !== false) {
        setEngineModeState('gemini');
        void persistUserPref({ preferredMode: 'gemini' });
      }
      if (options?.openChat !== false) {
        setChatOpen(true);
      }
    },
    [persistUserPref]
  );

  const removeAttachedXmlPart = useCallback((partId: string) => {
    setAttachedXmlParts((prev) => prev.filter((p) => p.id !== partId));
  }, []);

  const clearAttachedXmlParts = useCallback(() => {
    setAttachedXmlParts([]);
  }, []);

  const chatMessages = user ? remoteChatMessages : localChatMessages;

  const value: AuthAndAiContextValue = {
    user,
    authReady,
    isSigningIn,
    signInWithGoogle,
    signOutGoogle,
    engineMode,
    setEngineMode,
    geminiModel,
    setGeminiModel,
    quota,
    chatMessages,
    isChatOpen,
    setChatOpen,
    toggleChatOpen,
    attachedXmlParts,
    attachXmlPartsToGemini,
    removeAttachedXmlPart,
    clearAttachedXmlParts,
    appendChatMessages,
    clearChatMessages,
    authorizedGeminiFetch,
    onNotify,
  };

  return (
    <AuthAndAiContext.Provider value={value}>
      {children}
    </AuthAndAiContext.Provider>
  );
};

export function useAuthAndAi(): AuthAndAiContextValue {
  const ctx = useContext(AuthAndAiContext);
  if (!ctx) {
    throw new Error('useAuthAndAi must be used inside AuthAndAiProvider.');
  }
  return ctx;
}
