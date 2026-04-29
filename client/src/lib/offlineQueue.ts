// Offline outbox for receipt uploads.
//
// When a PM submits an expense and the network call fails (no signal at the
// job site, server bouncing, etc.), we stash the FormData payload — including
// the receipt blob — in IndexedDB and replay it later. The UI shows a
// pending count so the user knows it's safely queued.
//
// We do NOT use a Service Worker fetch interceptor because:
//   1. We want the UI to react to "queued vs sent" — easier to drive from
//      page-level code than from postMessage.
//   2. Receipt uploads carry a Bearer token. A SW would have to broker the
//      token, which is fragile across login sessions.
//
// Caller contract: `queueOrPostExpense(formData)` returns either
//   { ok: true, sent: true,  expense }   — request succeeded
//   { ok: true, sent: false, queuedAt }  — saved locally, will retry
//   { ok: false, error }                  — non-network failure (4xx/5xx)

const DB_NAME = 'newterra-offline';
const STORE = 'pending-uploads';
const DB_VERSION = 1;

interface QueuedRequest {
  id?: number;
  url: string;
  // Serialised FormData entries: array of [name, valueOrFile]. File entries
  // hold a Blob + filename so we can rebuild the FormData on retry.
  entries: Array<[string, string | { blob: Blob; filename: string }]>;
  createdAt: number;
  // Last attempt timestamp + error so the UI can surface why it's stuck.
  lastAttemptAt?: number;
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    Promise.resolve(fn(store))
      .then((result) => {
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
      .catch((err) => {
        try {
          tx.abort();
        } catch {
          // ignore
        }
        db.close();
        reject(err);
      });
  });
}

async function serializeFormData(form: FormData): Promise<QueuedRequest['entries']> {
  const out: QueuedRequest['entries'] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      out.push([name, value]);
    } else {
      // value is a File/Blob.
      const file = value as File;
      const blob = file.slice(0, file.size, file.type || 'application/octet-stream');
      out.push([name, { blob, filename: file.name || 'upload' }]);
    }
  }
  return out;
}

function rebuildFormData(entries: QueuedRequest['entries']): FormData {
  const fd = new FormData();
  for (const [name, value] of entries) {
    if (typeof value === 'string') {
      fd.append(name, value);
    } else {
      fd.append(name, new File([value.blob], value.filename, { type: value.blob.type }));
    }
  }
  return fd;
}

function authHeaders(): Record<string, string> {
  const token = (sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token'));
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface SendResult {
  ok: true;
  sent: true;
  expense: unknown;
}
export interface QueuedResult {
  ok: true;
  sent: false;
  queuedAt: number;
}
export interface FailureResult {
  ok: false;
  error: string;
  status?: number;
}

export type QueueOrPostResult = SendResult | QueuedResult | FailureResult;

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/**
 * Try to POST a multipart receipt upload. If the network is down, queue it
 * locally and return immediately. Caller should call replayQueue() on
 * window.online or app boot.
 */
export async function queueOrPostExpense(form: FormData): Promise<QueueOrPostResult> {
  const url = `${API_BASE}/api/finance/expenses`;
  if (!navigator.onLine) {
    return queueLocally(url, form);
  }
  try {
    const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: form });
    if (!res.ok) {
      // 4xx / 5xx — surface to the caller; we don't auto-queue server errors
      // because the request payload is probably invalid.
      const body = await res.json().catch(() => null);
      return { ok: false, status: res.status, error: body?.error ?? res.statusText };
    }
    const expense = await res.json();
    return { ok: true, sent: true, expense };
  } catch (err) {
    // fetch threw → treated as network failure; queue locally.
    return queueLocally(url, form, err instanceof Error ? err.message : 'network failure');
  }
}

async function queueLocally(url: string, form: FormData, lastError?: string): Promise<QueuedResult> {
  const entries = await serializeFormData(form);
  const createdAt = Date.now();
  await withStore('readwrite', (store) => {
    store.add({ url, entries, createdAt, lastError } as QueuedRequest);
  });
  return { ok: true, sent: false, queuedAt: createdAt };
}

export async function pendingCount(): Promise<number> {
  return withStore('readonly', (store) => new Promise<number>((resolve, reject) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/**
 * Walk the queue and try each request. Successes are removed; failures stay
 * with an updated lastAttemptAt + lastError. Returns counts.
 */
export async function replayQueue(): Promise<{ sent: number; failed: number; remaining: number }> {
  const all = await withStore<QueuedRequest[]>('readonly', (store) =>
    new Promise<QueuedRequest[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as QueuedRequest[]);
      req.onerror = () => reject(req.error);
    }),
  );
  let sent = 0;
  let failed = 0;
  for (const item of all) {
    try {
      const res = await fetch(item.url, {
        method: 'POST',
        headers: authHeaders(),
        body: rebuildFormData(item.entries),
      });
      if (res.ok) {
        await withStore('readwrite', (store) => {
          if (item.id != null) store.delete(item.id);
        });
        sent += 1;
      } else {
        const body = await res.json().catch(() => null);
        await withStore('readwrite', (store) => {
          if (item.id != null) {
            store.put({
              ...item,
              lastAttemptAt: Date.now(),
              lastError: body?.error ?? res.statusText,
            });
          }
        });
        failed += 1;
      }
    } catch (err) {
      await withStore('readwrite', (store) => {
        if (item.id != null) {
          store.put({
            ...item,
            lastAttemptAt: Date.now(),
            lastError: err instanceof Error ? err.message : 'network failure',
          });
        }
      });
      failed += 1;
    }
  }
  const remaining = await pendingCount();
  return { sent, failed, remaining };
}
