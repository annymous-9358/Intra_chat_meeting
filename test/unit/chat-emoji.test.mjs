import { ok } from '../helpers.mjs';
import { gameRoute } from '../../lib/games.mjs';
const m = new Map(); const store = { get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); }, list: async p => [...m.keys()].filter(k => k.startsWith(p)) };
const ctx = { store, room: 'floor', user: { uid: 'u1', name: 'K' }, group: {}, announce: async () => {} };
const seen = {}; let sameClue = 0, again = 0;
for (let k = 0; k < 60; k++) {
  await gameRoute('start', { kind: 'emoji' }, ctx); await gameRoute('begin', {}, ctx);
  const g = m.get('gs/floor'); const a = g.secret.answer;
  if (seen[a]) { again++; if (seen[a] === g.data.emoji) sameClue++; }
  seen[a] = g.data.emoji;
  if (k < 4) console.log(g.data.cat, '|', g.data.emoji, '|', a);
  await gameRoute('end', {}, ctx); await gameRoute('end', {}, ctx);
}
ok(sameClue === 0, `60 chat rounds: ${Object.keys(seen).length} different answers, ${again} came back, ${sameClue} with the same emojis`);
