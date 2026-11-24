export type SnapshotCategory =
  | 'auto'
  | 'manual'
  | 'autofix'
  | 'cleaner'
  | 'layout'
  | 'editor'
  | 'import';

export interface XmlSnapshotRecord {
  id: string;
  label: string;
  category: SnapshotCategory;
  xml: string;
  byteSize: number;
  lineCount: number;
  createdAt: number;
  fingerprint: string;
}

const DB_NAME = 'temaloka_xml_snapshots_db';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const MAX_SNAPSHOTS = 35;

let memoryFallbackStore: XmlSnapshotRecord[] = [];

function computeQuickFingerprint(xml: string): string {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(xml.length / 2048));
  for (let i = 0; i < xml.length; i += step) {
    hash ^= xml.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${xml.length}:${(hash >>> 0).toString(16)}`;
}

function getUtf8ByteSize(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return text.length;
}

function openSnapshotDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function listXmlSnapshots(): Promise<XmlSnapshotRecord[]> {
  const db = await openSnapshotDb();
  if (!db) {
    return [...memoryFallbackStore].sort((a, b) => b.createdAt - a.createdAt);
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (Array.isArray(req.result) ? req.result : []) as XmlSnapshotRecord[];
        items.sort((a, b) => b.createdAt - a.createdAt);
        resolve(items);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function saveXmlSnapshot(input: {
  xml: string;
  label: string;
  category?: SnapshotCategory;
  force?: boolean;
}): Promise<XmlSnapshotRecord | null> {
  const { xml, label, category = 'auto', force = false } = input;
  if (!xml.trim()) return null;

  const existing = await listXmlSnapshots();
  const fingerprint = computeQuickFingerprint(xml);

  if (!force && existing.length > 0 && existing[0].fingerprint === fingerprint) {
    return existing[0];
  }

  const record: XmlSnapshotRecord = {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: label.trim() || 'Snapshot XML',
    category,
    xml,
    byteSize: getUtf8ByteSize(xml),
    lineCount: xml.split(/\r?\n/).length,
    createdAt: Date.now(),
    fingerprint,
  };

  const db = await openSnapshotDb();
  if (!db) {
    memoryFallbackStore = [record, ...memoryFallbackStore].slice(0, MAX_SNAPSHOTS);
    return record;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);

      const allAfter = [record, ...existing];
      if (allAfter.length > MAX_SNAPSHOTS) {
        const toDelete = allAfter.slice(MAX_SNAPSHOTS);
        for (const oldItem of toDelete) {
          store.delete(oldItem.id);
        }
      }

      tx.oncomplete = () => resolve(record);
      tx.onerror = () => resolve(record);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteXmlSnapshot(id: string): Promise<void> {
  const db = await openSnapshotDb();
  if (!db) {
    memoryFallbackStore = memoryFallbackStore.filter((item) => item.id !== id);
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearAllXmlSnapshots(): Promise<void> {
  const db = await openSnapshotDb();
  if (!db) {
    memoryFallbackStore = [];
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
