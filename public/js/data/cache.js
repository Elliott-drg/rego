// Petit cache du navigateur pour les réponses obtenues en ligne (clé -> {valeur, date, taille, source}).
// Stockage : IndexedDB ; si IndexedDB est absent ou refuse de s'ouvrir (navigation privée, quota…),
// tout continue avec un repli en mémoire, vidé à la fermeture de la page.
// À ne pas confondre avec le cache disque du serveur local (.cache/, voir connectors/server.js).
//
//   await cachePut('horizons|…', payload, { source: 'horizons' });
//   const rec = await cacheGet('horizons|…');      // {key, value, date, size, source} ou null
//   await cacheList();  await cacheDelete(key);  await cacheClear();  await cacheSize();  cacheBackend();

const DB_NAME = 'regolith-finder', STORE = 'online-cache';
const memory = new Map();
let dbPromise = null, backend = null;      // 'indexeddb' | 'memory' (connu après la première opération)

function openDb() {
  dbPromise ??= new Promise((resolve) => {
    const fallback = () => { backend = 'memory'; resolve(null); };
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return fallback();
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' }); };
      req.onsuccess = () => {
        const db = req.result;
        // Si un autre onglet demande une mise à niveau ou si le navigateur ferme la base, on repasse en mémoire
        db.onversionchange = () => db.close();
        db.onclose = () => { dbPromise = null; };
        backend = 'indexeddb'; resolve(db);
      };
      req.onerror = fallback; req.onblocked = fallback;
    } catch { fallback(); }
  });
  return dbPromise;
}

/** Exécute une opération sur le magasin ; renvoie undefined (et bascule en mémoire) si IndexedDB échoue. */
async function withStore(mode, fn) {
  const db = await openDb();
  if (!db) return undefined;
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result ?? null);       // null = rien trouvé ; undefined est réservé à l'échec
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('transaction interrompue'));
    });
  } catch {
    backend = 'memory'; dbPromise = Promise.resolve(null);
    return undefined;
  }
}

const byteLength = (value) => new Blob([JSON.stringify(value)]).size;
const summary = ({ key, date, size, source }) => ({ key, date, size, source });

/** @returns {Promise<{key:string, value:any, date:string, size:number, source:string}|null>} */
export async function cacheGet(key) {
  const rec = await withStore('readonly', (s) => s.get(key));
  return (rec === undefined ? memory.get(key) : rec) || null;
}
/** Enregistre une valeur sérialisable en JSON. @returns l'enregistrement sans la valeur. */
export async function cachePut(key, value, { source = '' } = {}) {
  const rec = { key, value, date: new Date().toISOString(), size: byteLength(value), source };
  if ((await withStore('readwrite', (s) => s.put(rec))) === undefined) memory.set(key, rec);
  return summary(rec);
}
/** Liste (sans les valeurs), de la plus récente à la plus ancienne. */
export async function cacheList() {
  const all = await withStore('readonly', (s) => s.getAll());
  return (all === undefined ? [...memory.values()] : all).map(summary).sort((a, b) => (a.date < b.date ? 1 : -1));
}
export async function cacheDelete(key) {
  if ((await withStore('readwrite', (s) => s.delete(key))) === undefined) memory.delete(key);
}
export async function cacheClear() {
  if ((await withStore('readwrite', (s) => s.clear())) === undefined) memory.clear();
}
/** Taille totale en octets (somme des tailles JSON des valeurs). */
export async function cacheSize() { return (await cacheList()).reduce((a, r) => a + r.size, 0); }
/** 'indexeddb' ou 'memory' ; null tant qu'aucune opération n'a eu lieu. */
export function cacheBackend() { return backend; }
