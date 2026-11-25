// Storage on Cloudflare D1 (SQLite): the same get/set/list/del/file interface as Netlify Blobs and the LAN file store.
//   kv(k, v)                     one JSON record per key
//   files(k, part, type, data)   uploaded files, split into parts (D1 rows are limited in size)
// entries() reads a whole prefix in one query, so a chat poll costs a handful of queries instead of one per record.
export const D1_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS files (k TEXT NOT NULL, part INTEGER NOT NULL, type TEXT, data BLOB, PRIMARY KEY (k, part)) WITHOUT ROWID',
];
const PART = 512 * 1024;
const END = '￿';                       // upper bound for "starts with" range scans (keys are ASCII)
const parse = v => { try { return JSON.parse(v); } catch { return null; } };
const bytes = d => d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : Array.isArray(d) ? Uint8Array.from(d) : new Uint8Array(d?.buffer || d || []);

let ready = null;                            // tables checked once per Worker instance, not per request
export function d1Adapter(db) {
  const init = () => (ready ||= db.batch(D1_SCHEMA.map(q => db.prepare(q))).catch(e => { ready = null; throw e; }));
  const q = async (sql, ...args) => { await init(); return db.prepare(sql).bind(...args); };
  return {
    list: async prefix => (await (await q('SELECT k FROM kv WHERE k >= ?1 AND k < ?2', prefix, prefix + END)).all()).results.map(r => r.k),
    get: async key => { const r = await (await q('SELECT v FROM kv WHERE k = ?1', key)).first(); return r ? parse(r.v) : null; },
    set: async (key, value) => { await (await q('INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v', key, JSON.stringify(value))).run(); },
    del: async key => { await (await q('DELETE FROM kv WHERE k = ?1', key)).run(); },
    // [[key, value], …] for every key under prefix (optionally only keys after `after`, or only the last `last`)
    entries: async (prefix, { after, last } = {}) => {
      let rows;
      if (last) rows = (await (await q('SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 ORDER BY k DESC LIMIT ?3', prefix, prefix + END, last)).all()).results.reverse();
      else if (after && after >= prefix) rows = (await (await q('SELECT k, v FROM kv WHERE k > ?1 AND k < ?2 ORDER BY k', after, prefix + END)).all()).results;
      else rows = (await (await q('SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 ORDER BY k', prefix, prefix + END)).all()).results;
      return rows.filter(r => r.k.startsWith(prefix)).map(r => [r.k, parse(r.v)]);
    },
    setFile: async (key, data, type) => {
      await init();
      const b = bytes(data), stmts = [db.prepare('DELETE FROM files WHERE k = ?1').bind(key)];
      for (let i = 0, part = 0; i < Math.max(b.length, 1); i += PART, part++) stmts.push(db.prepare('INSERT INTO files (k, part, type, data) VALUES (?1, ?2, ?3, ?4)').bind(key, part, type || 'application/octet-stream', b.subarray(i, i + PART)));
      await db.batch(stmts);
    },
    getFile: async key => {
      const rows = (await (await q('SELECT type, data FROM files WHERE k = ?1 ORDER BY part', key)).all()).results;
      if (!rows.length) return null;
      const parts = rows.map(r => bytes(r.data)), out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
      return { data: out, type: rows[0].type || 'application/octet-stream' };
    },
    delFile: async key => { await (await q('DELETE FROM files WHERE k = ?1', key)).run(); },
  };
}
