// Shared bits for the test suites (run with `npm test`). Each suite prints PASS/FAIL lines; any FAIL fails the file.
export const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
// In-memory store with the same interface as the real ones (get/set/list/del + files)
export function memStore() {
  const m = new Map(), files = new Map();
  const store = {
    list: async p => [...m.keys()].filter(k => k.startsWith(p)),
    get: async k => structuredClone(m.get(k) ?? null),
    set: async (k, v) => { m.set(k, structuredClone(v)); },
    del: async k => { m.delete(k); },
    setFile: async (k, d, type) => { files.set(k, { data: d, type }); },
    getFile: async k => files.get(k) ?? null,
    delFile: async k => { files.delete(k); },
  };
  return { m, files, store };
}
