import { ok } from '../helpers.mjs';
import { handle, runScheduler } from '../../lib/chat.mjs';
const m = new Map(); const sent = []; const files = new Map();
const store = { list: async p => [...m.keys()].filter(k => k.startsWith(p)), get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); }, setFile: async (k, d) => { files.set(k, d); }, getFile: async () => null, delFile: async k => { files.delete(k); } };
const opts = { pushSender: async (sub, payload) => sent.push({ to: sub.endpoint.split('/').pop(), ...JSON.parse(payload) }) };
const hdr = (u, extra = {}) => ({ authorization: 'Bearer ' + u.token, 'x-chat-device': (u.uid + 'a'.repeat(40)).slice(0, 32).replace(/[^a-f0-9]/g, 'b'), ...extra });
const call = async (route, body = {}, u) => { const r = await handle(new Request('https://x/api/' + route, { method: 'POST', headers: u ? hdr(u) : {}, body: JSON.stringify(body) }), store, opts); return [r.status, await r.json()]; };
const signup = async (un, name) => { const [, d] = await call('auth/signup', { username: un, name, password: 'secret1' }); return { token: d.token, uid: d.user.uid }; };
const K = await signup('kunik', 'Kunik'), H = await signup('himanshu', 'Himanshu'), C = await signup('chin', 'Chin');
import { _answerFor, tttBot } from '../../lib/challenges.mjs';
let s, d;
const today = new Date().toISOString().slice(0, 10), ymd = n => { const t = new Date(); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const mk = async (kind, ptsPer) => { const [, x] = await call('challenge/create', { title: 'G ' + kind, publishAt: ymd(-1), start: ymd(-1), end: ymd(5), today, activity: { per: 'day', target: 8000, every: 1000, points: 5 }, tasks: [], game: { kind, perDay: 5, ptsPer, mode: 'best' } }, K); await call('challenge/join', { id: x.challenge.id, today }, H); return x.challenge.id; };
// no challenge chat any more
let id = await mk('bubbles', 1);
[, d] = await call('rooms', {}, K); ok(!d.rooms.some(r => r.room.startsWith('cx-')), 'no challenge chat room is created');
[, d] = await call('challenge/game/start', { id, today }, H); let sid = d.sid; ok(d.secs === 30 && d.seed, 'bubble pop: 30-second round');
[s] = await call('challenge/game/finish', { id, sid, score: 500, today }, H); ok(s === 400, 'impossible bubble score rejected');
[, d] = await call('challenge/game/start', { id, today }, H); sid = d.sid; { const x = m.get(`cgs/${sid}`); x.at -= 30_000; m.set(`cgs/${sid}`, x); }
[s, d] = await call('challenge/game/finish', { id, sid, score: 52, today }, H); ok(s === 200 && d.points === 52, 'realistic bubble score accepted');
// Emoji Guess
id = await mk('emoji', 5);
[, d] = await call('challenge/game/start', { id, today }, H); sid = d.sid; ok(d.secs === 90 && d.puzzle?.emoji && !('answer' in d.puzzle), 'emoji: first puzzle, no answer sent');
const sess0 = m.get(`cgs/${sid}`);
[, d] = await call('challenge/game/move', { id, sid, guess: 'zzzz wrong', today }, H); ok(d.tryAgain && d.score === 0, 'wrong guess: try again');
[, d] = await call('challenge/game/move', { id, sid, guess: _answerFor('emoji', sess0, 0).toUpperCase() + '!', today }, H); ok(d.correct && d.score === 1 && d.next?.i === 1, 'right guess (any case/punctuation) scores and gives next');
[, d] = await call('challenge/game/move', { id, sid, skip: true, today }, H); ok(d.correct === false && d.answer === _answerFor('emoji', sess0, 1), 'skip reveals the answer');
[, d] = await call('challenge/game/move', { id, sid, guess: _answerFor('emoji', sess0, 2), today }, H);
[s, d] = await call('challenge/game/finish', { id, sid, score: 999, today }, H); ok(s === 200 && d.score === 2 && d.points === 10, 'emoji score comes from the server (2 × 5 pts), not the app');
{ const x = m.get(`cgs/${sid}`); } 
[, d] = await call('challenge/game/start', { id, today }, H); sid = d.sid; { const x = m.get(`cgs/${sid}`); x.at -= 100_000; m.set(`cgs/${sid}`, x); }
[, d] = await call('challenge/game/move', { id, sid, guess: 'x', today }, H); ok(d.over, 'guesses after time is up are refused');
// Word Scramble
id = await mk('scramble', 3);
[, d] = await call('challenge/game/start', { id, today }, H); sid = d.sid; const ss = m.get(`cgs/${sid}`).seed, w0 = _answerFor('scramble', { seed: ss }, 0);
ok(d.word.letters !== w0 && [...d.word.letters].sort().join('') === [...w0].sort().join(''), 'scramble: letters shuffled');
[, d] = await call('challenge/game/move', { id, sid, guess: w0, today }, H); ok(d.correct && d.score === 1, 'scramble: right word scores');
[s, d] = await call('challenge/game/finish', { id, sid, today }, H); ok(s === 200 && d.points === 3, 'scramble points');
// Rock Paper Scissors
id = await mk('rps', 2);
[, d] = await call('challenge/game/start', { id, today }, H); sid = d.sid; ok(d.rounds === 10, 'rps: 10 rounds');
[s] = await call('challenge/game/move', { id, sid, choice: 'lizard', today }, H); ok(s === 400, 'rps: bad choice rejected');
let tot = 0, last;
for (let k = 0; k < 10; k++) { [, last] = await call('challenge/game/move', { id, sid, choice: ['rock', 'paper', 'scissors'][k % 3], today }, H); tot += last.result === 'win' ? 2 : last.result === 'draw' ? 1 : 0; }
ok(last.over && last.score === tot, 'rps: server keeps score over 10 rounds');
[, d] = await call('challenge/game/move', { id, sid, choice: 'rock', today }, H); ok(d.over && d.score === tot, 'rps: no 11th round');
[s, d] = await call('challenge/game/finish', { id, sid, today }, H); ok(s === 200 && d.score === tot && d.points === tot * 2, 'rps final score ' + tot);
// Tic-tac-toe
ok(tttBot(['O', 'O', null, 'X', 'X', null, null, null, null]) === 2, 'ttt bot takes a win'); ok(tttBot(['X', 'X', null, null, 'O', null, null, null, null]) === 2, 'ttt bot blocks');
id = await mk('ttt', 3);
const play = youFirst => { const b = Array(9).fill(null), mv = []; const W = b => { for (const [a, c, e] of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]) if (b[a] && b[a] === b[c] && b[a] === b[e]) return b[a]; return b.every(Boolean) ? 'draw' : null; };
  if (!youFirst) b[tttBot(b)] = 'O'; while (!W(b)) { const i = b.findIndex(x => !x); b[i] = 'X'; mv.push(i); if (W(b)) break; b[tttBot(b)] = 'O'; } return [mv, W(b)]; };
const games = [], res = []; for (let k = 0; k < 5; k++) { const [mv, r] = play(k % 2 === 0); games.push(mv); res.push(r); }
const exp = res.filter(r => r === 'X').length * 3 + res.filter(r => r === 'draw').length;
[, d] = await call('challenge/game/start', { id, today }, H); sid = d.sid; ok(d.games === 5, 'ttt: 5 games');
[s, d] = await call('challenge/game/finish', { id, sid, games, today }, H); ok(s === 200 && d.score === 0, 'ttt: 5 games in no time scores 0');
[, d] = await call('challenge/game/start', { id, today }, H); sid = d.sid; { const x = m.get(`cgs/${sid}`); x.at -= 60_000; m.set(`cgs/${sid}`, x); }
[s, d] = await call('challenge/game/finish', { id, sid, games, today }, H); ok(s === 200 && d.score === exp, `ttt: replayed games score ${exp} (${res.join(',')})`);
[, d] = await call('challenge/game/start', { id, today }, H); sid = d.sid; { const x = m.get(`cgs/${sid}`); x.at -= 60_000; m.set(`cgs/${sid}`, x); }
[s, d] = await call('challenge/game/finish', { id, sid, games: [[4, 4, 4]], today }, H); ok(s === 200 && d.score === 0, 'ttt: illegal moves score nothing');
[, d] = await call('challenge/get', { id, today }, H); ok(d.board?.rows?.find(r => r.uid === H.uid)?.gamePts >= 0 || d.board, 'leaderboard available');
[, d] = await call('challenge/game/start', { id, today }, H); sid = d.sid; { const x = m.get(`cgs/${sid}`); x.at -= 60_000; m.set(`cgs/${sid}`, x); }
[s, d] = await call('challenge/game/finish', { id, sid, games: [[0, 8, 6, 3]], today }, H); ok(s === 200 && d.score === 3 && d.detail === '1 won, 0 drawn of 1', 'ttt: a real fork win scores 3 — ' + d.detail);
// emoji clue sets rotate and fresh puzzles come first
{ const { EMOJI } = await import('../../lib/games.mjs');
  ok(EMOJI.length >= 120 && EMOJI.every(e => Array.isArray(e[1]) && e[1].length === 3), `${EMOJI.length} puzzles, each with 3 clue sets`);
  const cats = new Set(EMOJI.map(e => e[0])); ok(cats.has('Indian TV show') && cats.has('English TV series') && cats.has('Hindi song'), 'specific categories: ' + [...cats].join(', '));
  const ans = EMOJI.map(e => e[2].toLowerCase()); ok(new Set(ans).size === ans.length, 'no duplicate answers');
  const emo = EMOJI.flatMap(e => e[1]); ok(new Set(emo).size === emo.length, 'no clue set used twice');
  id = await mk('emoji', 5);
  const shown = {}; let repeats = 0, sameClue = 0;
  for (let k = 0; k < 5; k++) {
    [, d] = await call('challenge/game/start', { id, today }, C.uid ? H : H); if (d.error) { await call('challenge/join', { id, today }, C); }
    const ss2 = m.get(`cgs/${d.sid}`); if (!ss2) continue;
    for (const [i, v] of ss2.puzzles) { if (shown[i] !== undefined) { repeats++; if (shown[i] === v) sameClue++; } shown[i] = v; }
  }
  ok(repeats === 0, `5 games × 12 puzzles: no puzzle repeated (${Object.keys(shown).length} distinct)`);
  const { emojiChoose } = await import('../../lib/games.mjs');
  const seen = {}; const last = {}; let bad = 0;
  for (let k = 0; k < 2000; k++) { const { i, v } = emojiChoose(seen); if (last[i] !== undefined && last[i] === v) bad++; last[i] = v; }
  ok(bad === 0, 'when a puzzle comes back it always has a different set of emojis');
}
// close-guess hints
{ id = await mk('emoji', 5); [, d] = await call('challenge/game/start', { id, today }, H); const sx = m.get(`cgs/${d.sid}`), a = _answerFor('emoji', sx, 0);
  const typo = a.length > 4 ? a.slice(0, -2) + a.slice(-1) : a + 'x';
  [, d] = await call('challenge/game/move', { id, sid: d.sid, guess: typo, today }, H); ok(d.tryAgain && d.hint && /close|spelling|almost|words|start/i.test(d.msg), `typo "${typo}" → ${d.msg}`);
  ok(!JSON.stringify(d).toLowerCase().includes(a.toLowerCase()), 'the hint never contains the answer');
}
{ const { guessHint } = await import('../../lib/games.mjs');
  ok(guessHint('zzzzzz', ['Sholay']).hint === null, 'unrelated guess: plain try again');
  ok(guessHint('walkign', ['walking'], { letters: true }).msg.includes('letters'), 'scramble: right letters, wrong order');
}
{ [, d] = await call('challenge/create', { title: 'Snd', publishAt: ymd(-1), start: ymd(-1), end: ymd(5), today, activity: { per: 'day', target: 8000, every: 1000, points: 5 }, tasks: [], game: { kind: 'emoji', perDay: 3, ptsPer: 5, mode: 'best', sounds: { wrong: 'bruh', right: 'ftp://x' } } }, K);
  const cid = d.challenge.id; [, d] = await call('challenge/get', { id: cid, today }, K);
  ok(d.challenge.game.sounds.wrong === 'bruh' && d.challenge.game.sounds.right === 'crore', 'challenge game keeps its sounds (bad value → default)'); }
