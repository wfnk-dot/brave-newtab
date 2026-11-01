// Tiny IndexedDB wrapper. Uploaded backgrounds (which can be large videos)
// live here, inside the extension. Nothing ever leaves the computer.
//
// Record shape:
//   { id, name, kind: 'video' | 'image', type, blob, poster (data: URL), width, height, added }
(function () {
  const DB_NAME = 'brave-newtab';
  const STORE = 'backgrounds';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function run(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = fn(store);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Saving was cancelled (the disk may be full).'));
    }));
  }

  window.BgDB = {
    put: (rec) => run('readwrite', (s) => s.put(rec)),
    get: (id) => run('readonly', (s) => s.get(id)),
    remove: (id) => run('readwrite', (s) => s.delete(id)),
    // Library listing without loading the big files into memory.
    list: () => open().then((db) => new Promise((resolve, reject) => {
      const out = [];
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const { id, name, kind, poster, added } = cur.value;
        out.push({ id, name, kind, poster, added });
        cur.continue();
      };
      tx.oncomplete = () => resolve(out.sort((a, b) => a.added - b.added));
      tx.onerror = () => reject(tx.error);
    })),
  };
})();
