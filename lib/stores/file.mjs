// Storage for the LAN server: an in-memory key/value map saved to <dir>/store.json (a second after changes, and on
// shutdown via flush()), with uploaded files in <dir>/files/<id> and their type kept in the map.
import fs from 'node:fs';
import path from 'node:path';

export function fileStore(dir) {
  const DATA_FILE = path.join(dir, 'store.json');
  const FILES_DIR = path.join(dir, 'files');
  const data = new Map();
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')))) data.set(k, v); } catch {}
  let timer;
  const saveNow = () => { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(Object.fromEntries(data))); };
  const saveSoon = () => { clearTimeout(timer); timer = setTimeout(saveNow, 1000); };
  return {
    list: async prefix => [...data.keys()].filter(k => k.startsWith(prefix)),
    get: async key => data.get(key) ?? null,
    set: async (key, value) => { data.set(key, value); if (!key.startsWith('p/')) saveSoon(); },
    del: async key => { data.delete(key); saveSoon(); },
    // Uploaded files live in <dir>/files/<id>; their type is kept in the key/value store
    setFile: async (key, buf, type) => {
      fs.mkdirSync(FILES_DIR, { recursive: true });
      fs.writeFileSync(path.join(FILES_DIR, key.slice(2)), buf);
      data.set(key, { type }); saveSoon();
    },
    getFile: async key => {
      const meta = data.get(key);
      if (!meta) return null;
      try { return { data: fs.readFileSync(path.join(FILES_DIR, key.slice(2))), type: meta.type }; } catch { return null; }
    },
    delFile: async key => { data.delete(key); fs.rm(path.join(FILES_DIR, key.slice(2)), { force: true }, () => {}); saveSoon(); },
    flush: () => { clearTimeout(timer); saveNow(); },          // write everything now (on shutdown)
  };
}
