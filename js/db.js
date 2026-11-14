// Strength Log — on-device storage (IndexedDB, with localStorage as a fallback).
// Everything lives in one small key/value store: 'settings', 'workouts', 'draft'.

const DB_NAME = 'strength-log';
const STORE = 'kv';
let dbPromise = null;
let useLocal = false;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  }).catch((err) => {
    console.warn('IndexedDB unavailable, using localStorage', err);
    useLocal = true;
    return null;
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function get(key) {
  const db = await openDb();
  if (useLocal || !db) {
    const raw = localStorage.getItem(DB_NAME + ':' + key);
    return raw == null ? undefined : JSON.parse(raw);
  }
  return tx(db, 'readonly', (s) => s.get(key));
}

export async function set(key, value) {
  const db = await openDb();
  if (useLocal || !db) {
    if (value === undefined) localStorage.removeItem(DB_NAME + ':' + key);
    else localStorage.setItem(DB_NAME + ':' + key, JSON.stringify(value));
    return;
  }
  // Store plain JSON copies so nothing live from the UI ends up in the database.
  const plain = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  return tx(db, 'readwrite', (s) => (plain === undefined ? s.delete(key) : s.put(plain, key)));
}

/** Ask the browser not to clear our data when the phone is low on space. */
export async function persist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) {
    /* not supported */
  }
  return false;
}

export function backend() {
  return useLocal ? 'localStorage' : 'IndexedDB';
}
