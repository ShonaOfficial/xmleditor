import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { useAuthAndAi } from '../contexts/AuthAndAiContext';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';

export type NoteTag = 'umum' | 'xml' | 'css' | 'url' | 'ide';

export const NOTE_TAG_LABELS: Record<NoteTag, string> = {
  umum: 'Umum',
  xml: 'XML',
  css: 'CSS',
  url: 'URL / Query',
  ide: 'Ide',
};

export const MAX_NOTE_TITLE_LENGTH = 160;
export const MAX_NOTE_CONTENT_LENGTH = 50000;
export const MAX_NOTE_TEMPLATE_HINT_LENGTH = 120;

export interface CloudNotepadNote {
  id: string;
  title: string;
  content: string;
  tag: NoteTag;
  pinned: boolean;
  templateHint: string;
  createdAtMs: number;
  updatedAtMs: number;
  cloudSyncedAtMs: number | null;
  inCloud: boolean;
  dirty: boolean;
}

interface StoredDraftMap {
  [noteId: string]: CloudNotepadNote;
}

const DRAFT_STORAGE_PREFIX = 'temaloka_notepad_drafts_v1:';

function getStorageKey(uid: string | null | undefined): string {
  return `${DRAFT_STORAGE_PREFIX}${uid || 'guest'}`;
}

export function createSafeNoteId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `note_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeTag(value: unknown): NoteTag {
  if (
    value === 'umum' ||
    value === 'xml' ||
    value === 'css' ||
    value === 'url' ||
    value === 'ide'
  ) {
    return value;
  }
  return 'umum';
}

function loadDraftsForAccount(uid: string | null | undefined): StoredDraftMap {
  try {
    const raw = localStorage.getItem(getStorageKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const result: StoredDraftMap = {};
    for (const [id, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (!val || typeof val !== 'object' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        continue;
      }
      const item = val as Partial<CloudNotepadNote>;
      result[id] = {
        id,
        title: typeof item.title === 'string' ? item.title.slice(0, MAX_NOTE_TITLE_LENGTH) : 'Catatan Tanpa Judul',
        content: typeof item.content === 'string' ? item.content.slice(0, MAX_NOTE_CONTENT_LENGTH) : '',
        tag: normalizeTag(item.tag),
        pinned: Boolean(item.pinned),
        templateHint:
          typeof item.templateHint === 'string'
            ? item.templateHint.slice(0, MAX_NOTE_TEMPLATE_HINT_LENGTH)
            : '',
        createdAtMs: typeof item.createdAtMs === 'number' ? item.createdAtMs : Date.now(),
        updatedAtMs: typeof item.updatedAtMs === 'number' ? item.updatedAtMs : Date.now(),
        cloudSyncedAtMs: typeof item.cloudSyncedAtMs === 'number' ? item.cloudSyncedAtMs : null,
        inCloud: Boolean(item.inCloud),
        dirty: item.dirty !== undefined ? Boolean(item.dirty) : true,
      };
    }
    return result;
  } catch {
    return {};
  }
}

function saveDraftsForAccount(uid: string | null | undefined, map: StoredDraftMap): void {
  try {
    localStorage.setItem(getStorageKey(uid), JSON.stringify(map));
  } catch {
    // Ignore localStorage quota overflow
  }
}

function buildInitialDraftNote(templateHint = ''): CloudNotepadNote {
  const now = Date.now();
  return {
    id: createSafeNoteId(),
    title: 'Catatan Baru',
    content: '',
    tag: 'umum',
    pinned: false,
    templateHint: templateHint.slice(0, MAX_NOTE_TEMPLATE_HINT_LENGTH),
    createdAtMs: now,
    updatedAtMs: now,
    cloudSyncedAtMs: null,
    inCloud: false,
    dirty: true,
  };
}

export function useCloudNotepad(options?: {
  activeTemplateTitle?: string;
  isOfflineMode?: boolean;
}) {
  const {
    user,
    authReady,
    signInWithGoogle,
    engineMode,
    geminiModel,
    onNotify,
  } = useAuthAndAi();

  const activeTemplateTitle = options?.activeTemplateTitle || '';
  const isOfflineMode = Boolean(options?.isOfflineMode);
  const accountUid = user?.uid || null;

  const [cloudNotesMap, setCloudNotesMap] = useState<Record<string, CloudNotepadNote>>({});
  const [draftsMap, setDraftsMap] = useState<StoredDraftMap>(() =>
    loadDraftsForAccount(null)
  );
  const [selectedNoteId, setSelectedNoteId] = useState<string>('');
  const [savingNoteIds, setSavingNoteIds] = useState<Record<string, boolean>>({});
  const [deletingNoteIds, setDeletingNoteIds] = useState<Record<string, boolean>>({});
  const [cloudLoading, setCloudLoading] = useState(false);

  // Load local drafts specific to the active account (guest vs signed-in uid)
  useEffect(() => {
    const loaded = loadDraftsForAccount(accountUid);
    setDraftsMap(loaded);
    setCloudNotesMap({});
    const firstId = Object.keys(loaded)[0] || '';
    setSelectedNoteId(firstId);
  }, [accountUid]);

  // Persist local drafts whenever changed
  useEffect(() => {
    saveDraftsForAccount(accountUid, draftsMap);
  }, [accountUid, draftsMap]);

  // Subscribe to Firestore notes only for the authenticated account
  useEffect(() => {
    if (!authReady || !user) {
      setCloudNotesMap({});
      setCloudLoading(false);
      return;
    }

    setCloudLoading(true);
    const notesPath = `users/${user.uid}/notes`;
    const notesQuery = query(
      collection(db, 'users', user.uid, 'notes'),
      where('uid', '==', user.uid),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      notesQuery,
      (snapshot) => {
        const nextCloud: Record<string, CloudNotepadNote> = {};
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data() as {
            title?: string;
            content?: string;
            tag?: string;
            pinned?: boolean;
            templateHint?: string;
            createdAt?: Timestamp | null;
            updatedAt?: Timestamp | null;
          };
          const createdAtMs =
            data.createdAt && typeof data.createdAt.toMillis === 'function'
              ? data.createdAt.toMillis()
              : Date.now();
          const updatedAtMs =
            data.updatedAt && typeof data.updatedAt.toMillis === 'function'
              ? data.updatedAt.toMillis()
              : createdAtMs;

          nextCloud[docSnap.id] = {
            id: docSnap.id,
            title: (data.title || 'Catatan Tanpa Judul').slice(0, MAX_NOTE_TITLE_LENGTH),
            content: (data.content || '').slice(0, MAX_NOTE_CONTENT_LENGTH),
            tag: normalizeTag(data.tag),
            pinned: Boolean(data.pinned),
            templateHint: (data.templateHint || '').slice(0, MAX_NOTE_TEMPLATE_HINT_LENGTH),
            createdAtMs,
            updatedAtMs,
            cloudSyncedAtMs: updatedAtMs,
            inCloud: true,
            dirty: false,
          };
        }
        setCloudNotesMap(nextCloud);
        setCloudLoading(false);
      },
      (err) => {
        setCloudLoading(false);
        handleFirestoreError(err, OperationType.LIST, notesPath);
      }
    );

    return () => unsubscribe();
  }, [authReady, user]);

  // Merge cloud notes + local drafts (dirty local draft overrides cloud view until saved or discarded)
  const notes = useMemo<CloudNotepadNote[]>(() => {
    const merged: Record<string, CloudNotepadNote> = { ...cloudNotesMap };

    for (const [id, draft] of Object.entries(draftsMap)) {
      const cloudMatch = cloudNotesMap[id];
      if (!cloudMatch) {
        merged[id] = {
          ...draft,
          inCloud: false,
          dirty: true,
        };
      } else if (draft.dirty) {
        merged[id] = {
          ...draft,
          inCloud: true,
          cloudSyncedAtMs: cloudMatch.cloudSyncedAtMs,
          createdAtMs: cloudMatch.createdAtMs,
          dirty: true,
        };
      } else {
        merged[id] = cloudMatch;
      }
    }

    return Object.values(merged).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAtMs - a.updatedAtMs;
    });
  }, [cloudNotesMap, draftsMap]);

  // Keep selectedNoteId valid
  useEffect(() => {
    if (notes.length === 0) {
      if (selectedNoteId) setSelectedNoteId('');
      return;
    }
    const exists = notes.some((n) => n.id === selectedNoteId);
    if (!exists) {
      setSelectedNoteId(notes[0].id);
    }
  }, [notes, selectedNoteId]);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) || null,
    [notes, selectedNoteId]
  );

  const cloudCount = useMemo(
    () => notes.filter((n) => n.inCloud).length,
    [notes]
  );

  const dirtyCount = useMemo(
    () => notes.filter((n) => n.dirty).length,
    [notes]
  );

  const createNewNote = useCallback(
    (prefill?: { title?: string; content?: string; tag?: NoteTag }) => {
      const fresh = buildInitialDraftNote(activeTemplateTitle);
      if (prefill?.title) {
        fresh.title = prefill.title.slice(0, MAX_NOTE_TITLE_LENGTH);
      }
      if (prefill?.content !== undefined) {
        fresh.content = prefill.content.slice(0, MAX_NOTE_CONTENT_LENGTH);
      }
      if (prefill?.tag) {
        fresh.tag = prefill.tag;
      }
      setDraftsMap((prev) => ({
        ...prev,
        [fresh.id]: fresh,
      }));
      setSelectedNoteId(fresh.id);
      return fresh.id;
    },
    [activeTemplateTitle]
  );

  const updateDraftNote = useCallback(
    (
      noteId: string,
      patch: Partial<Pick<CloudNotepadNote, 'title' | 'content' | 'tag' | 'pinned' | 'templateHint'>>
    ) => {
      const existing = notes.find((n) => n.id === noteId);
      if (!existing) return;

      const nextNote: CloudNotepadNote = {
        ...existing,
        ...patch,
        title:
          patch.title !== undefined
            ? patch.title.slice(0, MAX_NOTE_TITLE_LENGTH)
            : existing.title,
        content:
          patch.content !== undefined
            ? patch.content.slice(0, MAX_NOTE_CONTENT_LENGTH)
            : existing.content,
        tag: patch.tag !== undefined ? normalizeTag(patch.tag) : existing.tag,
        templateHint:
          patch.templateHint !== undefined
            ? patch.templateHint.slice(0, MAX_NOTE_TEMPLATE_HINT_LENGTH)
            : existing.templateHint,
        updatedAtMs: Date.now(),
        dirty: true,
      };

      setDraftsMap((prev) => ({
        ...prev,
        [noteId]: nextNote,
      }));
    },
    [notes]
  );

  const ensureUserParentDocument = useCallback(
    async (uid: string, displayName: string, photoURL: string | null) => {
      const userPath = `users/${uid}`;
      const userRef = doc(db, 'users', uid);
      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const payload: Record<string, unknown> = {
            uid,
            displayName: (displayName || 'Pengguna Google').slice(0, 120),
            preferredMode: engineMode,
            preferredGeminiModel: geminiModel,
            preferredLocalRuntime: 'builtin',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (photoURL) {
            payload.photoUrl = photoURL.slice(0, 500);
          }
          await setDoc(userRef, payload);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, userPath);
      }
    },
    [engineMode, geminiModel]
  );

  const saveNoteToCloud = useCallback(
    async (noteId: string): Promise<boolean> => {
      const targetNote = notes.find((n) => n.id === noteId);
      if (!targetNote) return false;

      if (isOfflineMode) {
        onNotify?.(
          'Mode Offline aktif. Catatan disimpan sebagai draft lokal — aktifkan Mode Online untuk Simpan di Cloud.',
          'info'
        );
        return false;
      }

      let currentUser = auth.currentUser;
      if (!currentUser) {
        const signedIn = await signInWithGoogle();
        if (!signedIn || !auth.currentUser) {
          onNotify?.(
            'Catatan tetap aman sebagai draft lokal. Login Google diperlukan untuk menyimpan ke Cloud akun Anda.',
            'info'
          );
          return false;
        }
        currentUser = auth.currentUser;
      }

      const safeId = /^[a-zA-Z0-9_-]{1,128}$/.test(targetNote.id)
        ? targetNote.id
        : createSafeNoteId();
      const normalizedTitle =
        targetNote.title.trim().slice(0, MAX_NOTE_TITLE_LENGTH) || 'Catatan Tanpa Judul';
      const normalizedContent = targetNote.content.slice(0, MAX_NOTE_CONTENT_LENGTH);
      const normalizedTag = normalizeTag(targetNote.tag);
      const normalizedHint = (
        targetNote.templateHint ||
        activeTemplateTitle ||
        ''
      ).slice(0, MAX_NOTE_TEMPLATE_HINT_LENGTH);

      setSavingNoteIds((prev) => ({ ...prev, [noteId]: true }));
      const noteDocPath = `users/${currentUser.uid}/notes/${safeId}`;

      try {
        await ensureUserParentDocument(
          currentUser.uid,
          currentUser.displayName || currentUser.email || 'Pengguna Google',
          currentUser.photoURL
        );

        const noteRef = doc(db, 'users', currentUser.uid, 'notes', safeId);
        const existingCloud = await getDoc(noteRef);

        if (existingCloud.exists()) {
          await updateDoc(noteRef, {
            title: normalizedTitle,
            content: normalizedContent,
            tag: normalizedTag,
            pinned: Boolean(targetNote.pinned),
            templateHint: normalizedHint,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(noteRef, {
            uid: currentUser.uid,
            title: normalizedTitle,
            content: normalizedContent,
            tag: normalizedTag,
            pinned: Boolean(targetNote.pinned),
            templateHint: normalizedHint,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        // Remove dirty local override for this note on the active account (and clean guest copy if just logged in)
        setDraftsMap((prev) => {
          const next = { ...prev };
          delete next[noteId];
          delete next[safeId];
          return next;
        });

        if (accountUid !== currentUser.uid) {
          const guestDrafts = loadDraftsForAccount(null);
          if (guestDrafts[noteId]) {
            delete guestDrafts[noteId];
            saveDraftsForAccount(null, guestDrafts);
          }
        }

        setSelectedNoteId(safeId);
        onNotify?.(
          `Catatan "${normalizedTitle}" tersimpan di Cloud (${currentUser.email || currentUser.displayName || 'Akun Google'}).`,
          'success'
        );
        return true;
      } catch (err) {
        onNotify?.(
          err instanceof Error
            ? `Gagal menyimpan catatan ke Cloud: ${err.message}`
            : 'Gagal menyimpan catatan ke Cloud.',
          'error'
        );
        handleFirestoreError(err, OperationType.WRITE, noteDocPath);
      } finally {
        setSavingNoteIds((prev) => {
          const next = { ...prev };
          delete next[noteId];
          return next;
        });
      }
    },
    [
      accountUid,
      activeTemplateTitle,
      ensureUserParentDocument,
      isOfflineMode,
      notes,
      onNotify,
      signInWithGoogle,
    ]
  );

  const discardLocalChanges = useCallback(
    (noteId: string) => {
      if (!cloudNotesMap[noteId]) return;
      setDraftsMap((prev) => {
        const next = { ...prev };
        delete next[noteId];
        return next;
      });
      onNotify?.('Perubahan lokal dibatalkan, dikembalikan ke versi Cloud.', 'info');
    },
    [cloudNotesMap, onNotify]
  );

  const deleteNote = useCallback(
    async (noteId: string): Promise<boolean> => {
      const target = notes.find((n) => n.id === noteId);
      if (!target) return false;

      if (target.inCloud && auth.currentUser) {
        const noteDocPath = `users/${auth.currentUser.uid}/notes/${noteId}`;
        setDeletingNoteIds((prev) => ({ ...prev, [noteId]: true }));
        try {
          await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'notes', noteId));
        } catch (err) {
          onNotify?.('Gagal menghapus catatan dari Cloud.', 'error');
          setDeletingNoteIds((prev) => {
            const next = { ...prev };
            delete next[noteId];
            return next;
          });
          handleFirestoreError(err, OperationType.DELETE, noteDocPath);
        }
        setDeletingNoteIds((prev) => {
          const next = { ...prev };
          delete next[noteId];
          return next;
        });
      }

      setDraftsMap((prev) => {
        const next = { ...prev };
        delete next[noteId];
        return next;
      });

      onNotify?.(`Catatan "${target.title || 'Tanpa Judul'}" dihapus.`, 'info');
      return true;
    },
    [notes, onNotify]
  );

  return {
    user,
    notes,
    activeNote,
    selectedNoteId,
    setSelectedNoteId,
    cloudLoading,
    cloudCount,
    dirtyCount,
    savingNoteIds,
    deletingNoteIds,
    createNewNote,
    updateDraftNote,
    saveNoteToCloud,
    discardLocalChanges,
    deleteNote,
  };
}
