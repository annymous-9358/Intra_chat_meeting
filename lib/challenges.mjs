// Challenges (step challenges like a company "Stepathon"): anyone can create one with a banner, publish / start / end
// dates, a steps activity (daily or weekly target, points for every N steps, a daily step cap, target bonus), a
// tie-breaker and daily tasks. The leaderboard is recalculated every 15 minutes (scheduler) or on Refresh, and keeps
// the previous ranks so everyone sees who moved up or down and when it was last updated.
import crypto from 'node:crypto';
import { EMOJI, norm, emojiChoose, guessHint, cleanSounds } from './games.mjs';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CID = /^[a-z0-9]{10}$/;
const TID = /^[a-z0-9]{6}$/;
const LOCAL_FILE = /^\/api\/file\/([a-f0-9]{24})$/;
export const BOARD_EVERY_MS = 15 * 60_000;
const rid = n => crypto.randomBytes(16).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, n);
const dayShift = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const todayUtc = () => new Date().toISOString().slice(0, 10);
const num = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

function status(ch, today) {
  if (today < ch.publishAt) return 'draft';            // not published yet (only the creator sees it)
  if (today < ch.start) return 'upcoming';
  if (today > ch.end) return 'ended';
  return 'live';
}

// Validate and normalise a challenge from the create / edit form
function parseChallenge(body, old) {
  const title = clean(body.title, 60);
  if (!title) return { error: 'Give the challenge a name' };
  const start = String(body.start || ''), end = String(body.end || ''), publishAt = String(body.publishAt || start);
  if (![start, end, publishAt].every(d => DAY.test(d))) return { error: 'Pick publish, start and end dates' };
  if (end < start) return { error: 'The end date must be on or after the start date' };
  if (publishAt > start) return { error: 'Publish on or before the start date, so people can join' };
  const days = Math.round((new Date(end) - new Date(start)) / 864e5) + 1;
  if (days > 366) return { error: 'Challenges can last up to a year' };
  const a = body.activity || {};
  const activity = {
    type: 'steps',
    per: a.per === 'week' ? 'week' : 'day',
    target: num(a.target, 0, a.per === 'week' ? 700000 : 100000, 8000),
    every: num(a.every, 1, 100000, 1000),           // every N counted steps …
    points: num(a.points, 0, 10000, 5),             // … earn P points
    cap: num(a.cap, 0, 100000, 0),                  // daily step cap (0 = no cap); steps above it don't count
    bonus: num(a.bonus, 0, 10000, 0),               // extra points for each day / week the target is reached
  };
  const tiebreak = ['steps', 'days', 'joined'].includes(body.tiebreak) ? body.tiebreak : 'steps';
  const tasks = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 12).map(t => {
    const kind = t.kind === 'check' ? 'check' : 'steps';
    const title = clean(t.title, 60) || (kind === 'steps' ? `Walk ${Number(t.target || 0).toLocaleString('en-US')} steps` : '');
    if (!title) return null;
    return { id: TID.test(t.id || '') ? t.id : rid(6), kind, title, target: kind === 'steps' ? num(t.target, 100, 100000, 5000) : 0, points: num(t.points, 0, 10000, 10) };
  }).filter(Boolean);
  const room = typeof body.audience === 'string' && /^[a-z0-9_-]{1,40}$/.test(body.audience) ? body.audience : null;   // a group, or everyone
  let game = null;
  if (body.game && GAME_KINDS[body.game.kind]) {
    const g = body.game, def = GAME_KINDS[g.kind];
    game = { kind: g.kind, perDay: num(g.perDay, 1, 10, 3), ptsPer: Math.min(1000, Math.max(0.01, Math.round((Number(g.ptsPer) || def.ptsPer) * 100) / 100)), mode: g.mode === 'sum' ? 'sum' : 'best', sounds: cleanSounds(g.sounds) };
  }
  return { ch: { ...(old || {}), title, desc: cleanText(body.desc, 600), publishAt, start, end, activity, tiebreak, tasks, game, audience: room ? { room } : 'all' } };
}

// Day-by-day points statement for one participant. recs: { 'YYYY-MM-DD': steps | { steps, at } }
function ledger(ch, recs, mem, today) {
  const a = ch.activity, last = today < ch.end ? today : ch.end;
  const days = [], weeks = {};
  let gamePts = 0, gameBest = 0;
  let steps = 0, stepPts = 0, bonus = 0, taskPts = 0, targetDays = 0, streak = 0, best = 0, run = 0, bestDay = null;
  for (let d = ch.start; d <= last; d = dayShift(d, 1)) {
    const rec = recs[d], raw = typeof rec === 'number' ? rec : rec?.steps || 0, at = typeof rec === 'object' ? rec?.at || null : null;
    const counted = a.cap ? Math.min(raw, a.cap) : raw;
    const day = { date: d, raw, counted, capped: !!a.cap && raw > a.cap, stepPts: Math.floor(counted / a.every) * a.points, bonus: 0, tasks: [], at };
    steps += counted; stepPts += day.stepPts;
    const hit = a.per === 'day' ? !!a.target && counted >= a.target : !!a.target && counted >= a.target / 7;
    if (a.per === 'day' && hit) { day.bonus = a.bonus; bonus += a.bonus; targetDays++; }
    run = hit ? run + 1 : 0; best = Math.max(best, run);
    if (a.per === 'week') { const wk = Math.floor((new Date(d) - new Date(ch.start)) / (7 * 864e5)); const w = weeks[wk] ||= { week: wk + 1, start: d, end: d, steps: 0, at: null }; w.end = d; w.steps += counted; if (at && (!w.at || at > w.at)) w.at = at; }
    for (const t of ch.tasks) {
      const done = t.kind === 'steps' ? raw >= t.target : (mem?.tasks?.[d] || []).includes(t.id);
      if (done) { day.tasks.push({ id: t.id, title: t.title, kind: t.kind, points: t.points, at: t.kind === 'steps' ? at : mem?.taskAt?.[d]?.[t.id] || null }); taskPts += t.points; }
    }
    if (ch.game) {
      const plays = (mem?.games?.[d] || []).filter(p => p.kind === ch.game.kind);
      if (plays.length) {
        const score = ch.game.mode === 'sum' ? plays.reduce((x, p) => x + p.score, 0) : Math.max(...plays.map(p => p.score));
        day.game = { kind: ch.game.kind, score, points: Math.floor(score * ch.game.ptsPer), plays: plays.map(p => ({ score: p.score, at: p.at, detail: p.detail })) };
        gamePts += day.game.points; gameBest = Math.max(gameBest, ...plays.map(p => p.score));
      }
    }
    day.total = day.stepPts + day.bonus + day.tasks.reduce((x, y) => x + y.points, 0) + (day.game?.points || 0);
    if (raw && (!bestDay || counted > bestDay.steps)) bestDay = { date: d, steps: counted };
    days.push(day);
  }
  // the current streak counts today only once it's reached; otherwise it runs up to yesterday
  for (let i = days.length - 1; i >= 0; i--) {
    const x = days[i], hit = a.target && x.counted >= (a.per === 'day' ? a.target : a.target / 7);
    if (hit) streak++; else if (x.date === today && i === days.length - 1) continue; else break;
  }
  const weekBonus = [];
  if (a.per === 'week') for (const w of Object.values(weeks)) if (a.target && w.steps >= a.target) { weekBonus.push({ ...w, bonus: a.bonus }); bonus += a.bonus; targetDays++; }
  const points = stepPts + bonus + taskPts + gamePts;
  return { days, weekBonus, steps, points, targetDays, gameBest, totals: { stepPts, bonus, taskPts, gamePts }, streak, bestStreak: best, bestDay, activeDays: days.filter(x => x.raw).length };
}
function scoreFor(ch, days, mem, today) {
  const l = ledger(ch, days, mem, today);
  return { steps: l.steps, points: l.points, targetDays: l.targetDays, streak: l.streak, level: levelFor(ch, l.points).idx, gameBest: l.gameBest, gamePts: l.totals.gamePts };
}
// Levels: a share of the best possible score for this challenge (every day on target with every task done)
export const LEVELS = [['Starter', 0], ['Bronze', .1], ['Silver', .25], ['Gold', .5], ['Platinum', .75], ['Diamond', .9]];
function levelFor(ch, points) {
  const a = ch.activity, days = Math.round((new Date(ch.end) - new Date(ch.start)) / 864e5) + 1;
  const ref = a.per === 'day' ? (a.target || 8000) : (a.target ? a.target / 7 : 8000);
  const dayPts = Math.floor(Math.min(ref, a.cap || Infinity) / a.every) * a.points + (a.per === 'day' ? a.bonus : a.bonus / 7) + ch.tasks.reduce((x, t) => x + t.points, 0) + (ch.game ? Math.floor(GAME_KINDS[ch.game.kind].good * ch.game.ptsPer * (ch.game.mode === 'sum' ? ch.game.perDay : 1)) : 0);
  const perfect = Math.max(1, Math.round(dayPts * days));
  let idx = 0; LEVELS.forEach(([, f], i) => { if (points >= Math.ceil(perfect * f)) idx = i; });
  const next = LEVELS[idx + 1];
  return { idx, name: LEVELS[idx][0], min: Math.ceil(perfect * LEVELS[idx][1]), next: next ? { name: next[0], min: Math.ceil(perfect * next[1]) } : null, perfect };
}

async function canSee(store, ch, uid) {
  if (ch.createdBy === uid) return true;
  if (status(ch, todayUtc()) === 'draft') return false;
  if (ch.audience === 'all') return true;
  return !!(await store.get(`mb/${ch.audience.room}/${uid}`));
}

// Recalculate the leaderboard snapshot (keeps everyone's previous rank for ▲/▼)
export async function computeBoard(store, ch, { stepDays }) {
  const today = todayUtc();
  const memKeys = await store.list(`cgm/${ch.id}/`);
  const mems = (await Promise.all(memKeys.map(k => store.get(k)))).filter(m => m?.uid);
  const old = (await store.get(`cgl/${ch.id}`)) || { rows: [] };
  const prevRank = new Map(old.rows.map(r => [r.uid, r.rank]));
  const rows = (await Promise.all(mems.map(async m => {
    const u = await store.get(`u/${m.uid}`); if (!u) return null;
    const s = scoreFor(ch, await stepDays(store, m.uid), m, today);
    return { uid: m.uid, name: u.name, photo: u.photo || null, ...s, joinedAt: m.joinedAt };
  }))).filter(Boolean);
  const tb = { steps: (a, b) => b.steps - a.steps, days: (a, b) => b.targetDays - a.targetDays || b.steps - a.steps, joined: (a, b) => a.joinedAt - b.joinedAt }[ch.tiebreak];
  rows.sort((a, b) => b.points - a.points || tb(a, b) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; r.prev = prevRank.get(r.uid) ?? null; });
  const snap = { at: Date.now(), rows };
  await store.set(`cgl/${ch.id}`, snap);
  return snap;
}

export async function refreshBoards(store, deps) {
  const today = todayUtc();
  let n = 0;
  for (const k of await store.list('cg/')) {
    const ch = await store.get(k); if (!ch) continue;
    if (today < dayShift(ch.start, -1) || today > dayShift(ch.end, 2)) continue;     // only around the live dates
    const snap = await store.get(`cgl/${ch.id}`);
    if (snap && Date.now() - snap.at < BOARD_EVERY_MS - 30_000) continue;
    await computeBoard(store, ch, deps); n++;
  }
  return n;
}

const view = (ch, me, extra = {}) => ({ game: ch.game || null, gameRecord: ch.gameRecord || null, id: ch.id, title: ch.title, desc: ch.desc, banner: ch.banner || null, publishAt: ch.publishAt, start: ch.start, end: ch.end,
  activity: ch.activity, tiebreak: ch.tiebreak, tasks: ch.tasks, audience: ch.audience, createdBy: ch.createdBy, createdName: ch.createdName,
  mine: ch.createdBy === me, status: status(ch, todayUtc()), ...extra });


// ---------- Challenge games (single player; scores checked on the server) ----------
export const GAME_KINDS = {
  math: { name: 'Quick Math', ptsPer: 2, good: 20, secs: 60 },          // score = correct answers in 60 s
  reaction: { name: 'Reaction Time', ptsPer: 0.05, good: 700, rounds: 5 }, // score = 1000 − average reaction ms
  memory: { name: 'Memory Path', ptsPer: 5, good: 8, max: 25 },           // score = longest path repeated
  // fun arcade games: the score can't be replayed on the server, so it's checked against how long the game really lasted
  bubbles: { name: 'Bubble Pop', ptsPer: 1, good: 45, secs: 30, maxRate: 7, fun: true },   // pops in 30 s (golden = 3)
  dash: { name: 'Step Dash', ptsPer: 0.5, good: 80, maxRate: 14, fun: true },              // metres run
  stack: { name: 'Tower Stack', ptsPer: 3, good: 15, maxRate: 3, fun: true },            // blocks stacked
  // single-player versions of the chat games (answers and moves are checked on the server as you play)
  emoji: { name: 'Emoji Guess', ptsPer: 5, good: 6, secs: 90, count: 12 },                 // puzzles solved in 90 s
  scramble: { name: 'Word Scramble', ptsPer: 3, good: 8, secs: 75, count: 20 },            // words unscrambled in 75 s
  rps: { name: 'Rock Paper Scissors', ptsPer: 2, good: 12, rounds: 10 },                   // 2 per win, 1 per draw vs the computer
  ttt: { name: 'Tic-tac-toe', ptsPer: 3, good: 9, games: 5 },                              // 3 per win, 1 per draw vs the computer
};
const WORDS = ['walking', 'sneaker', 'stairs', 'healthy', 'marathon', 'balance', 'stretch', 'morning', 'journey', 'mountain', 'sunrise', 'energy',
  'meeting', 'laptop', 'coffee', 'teamwork', 'holiday', 'weekend', 'picnic', 'rainbow', 'garden', 'monsoon', 'cricket', 'festival', 'cycling',
  'dancing', 'birthday', 'library', 'kitchen', 'traffic', 'airport', 'station', 'football', 'swimming', 'yoga', 'water', 'pillow', 'jacket',
  'window', 'pocket', 'rocket', 'planet', 'office', 'answer', 'puzzle', 'winner', 'smile', 'friend', 'family', 'travel'];
const shuffleWord = (w, r) => { let x; do { const a = w.split(''); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } x = a.join(''); } while (x === w); return x; };
// Tic-tac-toe computer: win, block, centre, corners, sides (the same rules run in the app, so games can be replayed here)
const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const tttWinner = b => { for (const [a, c, d] of TTT_LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; return b.every(Boolean) ? 'draw' : null; };
export function tttBot(b) {
  const free = i => !b[i];
  for (const who of ['O', 'X']) for (const [a, c, d] of TTT_LINES) { const line = [a, c, d], mine = line.filter(i => b[i] === who).length, empty = line.filter(free); if (mine === 2 && empty.length === 1) return empty[0]; }
  if (free(4)) return 4;
  for (const i of [0, 2, 6, 8, 1, 3, 5, 7]) if (free(i)) return i;
  return -1;
}
function tttReplay(moves, youFirst) {           // moves: your cells in order → 'X' | 'O' | 'draw' | null (unfinished/illegal)
  const b = Array(9).fill(null); let k = 0;
  if (!youFirst) b[tttBot(b)] = 'O';
  while (!tttWinner(b)) {
    const m = Number(moves[k++]); if (!(m >= 0 && m < 9) || b[m]) return null;
    b[m] = 'X'; if (tttWinner(b)) break;
    b[tttBot(b)] = 'O';
  }
  return tttWinner(b);
}
function prng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mathProblems(seed, n = 80) {
  const r = prng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const lvl = Math.min(3, Math.floor(i / 8)), op = ['+', '-', '×'][Math.floor(r() * (lvl ? 3 : 2))];
    let a, b;
    if (op === '×') { a = 2 + Math.floor(r() * (5 + lvl * 3)); b = 2 + Math.floor(r() * 9); }
    else { a = 3 + Math.floor(r() * (15 + lvl * 30)); b = 2 + Math.floor(r() * (10 + lvl * 25)); if (op === '-' && b > a) [a, b] = [b, a]; }
    out.push({ a, b, op, ans: op === '+' ? a + b : op === '-' ? a - b : a * b });
  }
  return out;
}
const emojiPick = (sess, i) => { const [k, v] = sess.puzzles[i], e = EMOJI[k]; return { i, cat: e[0], emoji: e[1][v], letters: e[2].replace(/[^a-z0-9]/gi, '').length, words: e[2].split(/\s+/).length }; };
const wordIndex = (seed, i) => { const r = prng(seed + 7), order = WORDS.map((_, k) => k); for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; } return order[i % order.length]; };
const scramblePick = (seed, i) => ({ i, letters: shuffleWord(WORDS[wordIndex(seed, i)], prng(seed + i * 13 + 1)), len: WORDS[wordIndex(seed, i)].length });
const memoryPath = (seed, n = 25) => { const r = prng(seed), out = []; for (let i = 0; i < n; i++) { let t; do t = Math.floor(r() * 9); while (out.length && t === out[out.length - 1]); out.push(t); } return out; };
async function gameAction(action, { store, body, ch, me, today, user }) {
  const g = ch.game; if (!g) return json({ error: 'This challenge has no game' }, 400);
  const mem = await store.get(`cgm/${ch.id}/${me}`); if (!mem) return json({ error: 'Join the challenge to play' }, 400);
  if (today < ch.start || today > ch.end) return json({ error: today < ch.start ? 'The game opens when the challenge starts' : 'This challenge has ended' }, 400);
  const plays = (mem.games?.[today] || []).filter(p => p.kind === g.kind);
  const started = Math.max(plays.length, mem.gstarts?.[today] || 0);     // a game you start and quit still uses a play
  if (action === 'start') {
    if (started >= g.perDay) return json({ error: `You’ve used all ${g.perDay} play${g.perDay > 1 ? 's' : ''} for today — come back tomorrow`, code: 'no_plays' }, 400);
    const sid = rid(16), seed = crypto.randomInt(1, 2 ** 31);
    const sess = { uid: me, ch: ch.id, kind: g.kind, seed, at: Date.now(), day: today };
    if (g.kind === 'emoji') {           // fresh puzzles first, and a new set of emojis for any you've had before
      const seen = mem.emojiSeen || {}, picked = new Set();
      sess.puzzles = Array.from({ length: GAME_KINDS.emoji.count }, () => { const { i, v } = emojiChoose(seen, picked); picked.add(i); return [i, v]; });
      mem.emojiSeen = seen;
    }
    await store.set(`cgs/${sid}`, sess);
    mem.gstarts = { [today]: started + 1 }; await store.set(`cgm/${ch.id}/${me}`, mem);
    const payload = g.kind === 'math' ? { problems: mathProblems(seed).map(({ a, b, op }) => ({ a, b, op })), secs: GAME_KINDS.math.secs }
      : g.kind === 'memory' ? { path: memoryPath(seed) } : g.kind === 'reaction' ? { rounds: GAME_KINDS.reaction.rounds }
      : g.kind === 'emoji' ? { secs: GAME_KINDS.emoji.secs, puzzle: emojiPick(sess, 0) }
      : g.kind === 'scramble' ? { secs: GAME_KINDS.scramble.secs, word: scramblePick(seed, 0) }
      : g.kind === 'rps' ? { rounds: GAME_KINDS.rps.rounds } : g.kind === 'ttt' ? { games: GAME_KINDS.ttt.games }
      : { seed, secs: GAME_KINDS[g.kind].secs || null };
    return json({ sid, kind: g.kind, ...payload, playsLeft: g.perDay - started - 1 });
  }
  if (action === 'move') {       // Emoji Guess / Word Scramble / Rock Paper Scissors: one answer or choice at a time
    const sid = String(body.sid || ''), sess = /^[a-z0-9]{16}$/.test(sid) && await store.get(`cgs/${sid}`);
    if (!sess || sess.uid !== me || sess.ch !== ch.id) return json({ error: 'This game session expired — start a new one' }, 400);
    const st = sess.st ||= { i: 0, score: 0, log: [] }, def = GAME_KINDS[sess.kind];
    if (def.secs && Date.now() - sess.at > (def.secs + 5) * 1000) return json({ ok: true, over: true, score: st.score });
    let res = {};
    if (sess.kind === 'emoji' || sess.kind === 'scramble') {
      if (st.i >= def.count) return json({ ok: true, over: true, score: st.score });
      const ans = sess.kind === 'emoji' ? EMOJI[sess.puzzles[st.i][0]] : null, word = sess.kind === 'scramble' ? WORDS[wordIndex(sess.seed, st.i)] : null;
      const accepted = sess.kind === 'emoji' ? [ans[2], ...ans.slice(3)].map(norm) : [word];
      if (body.skip) { res = { correct: false, answer: sess.kind === 'emoji' ? ans[2] : word }; st.i++; }
      else {
        const guess = norm(String(body.guess || '').slice(0, 60));
        if (!guess) return json({ error: 'Type a guess' }, 400);
        if (accepted.includes(guess) || (sess.kind === 'emoji' && accepted.some(a => a.replace(/^the /, '') === guess.replace(/^the /, '')))) { st.score++; st.i++; res = { correct: true, answer: sess.kind === 'emoji' ? ans[2] : word }; }
        else return json({ ok: true, correct: false, tryAgain: true, score: st.score, ...guessHint(guess, sess.kind === 'emoji' ? [ans[2], ...ans.slice(3)] : [word], { letters: sess.kind === 'scramble' }) });
      }
      const over = st.i >= def.count;
      res.next = over ? null : sess.kind === 'emoji' ? emojiPick(sess, st.i) : scramblePick(sess.seed, st.i);
      await store.set(`cgs/${sid}`, sess);
      return json({ ok: true, ...res, score: st.score, over });
    }
    if (sess.kind === 'rps') {
      if (st.i >= def.rounds) return json({ ok: true, over: true, score: st.score });
      const you = ['rock', 'paper', 'scissors'].indexOf(body.choice); if (you < 0) return json({ error: 'Pick rock, paper or scissors' }, 400);
      const bot = crypto.randomInt(3), out = you === bot ? 'draw' : (you - bot + 3) % 3 === 1 ? 'win' : 'lose';
      st.score += out === 'win' ? 2 : out === 'draw' ? 1 : 0; st.i++; st.log.push(out);
      await store.set(`cgs/${sid}`, sess);
      return json({ ok: true, bot: ['rock', 'paper', 'scissors'][bot], result: out, score: st.score, round: st.i, over: st.i >= def.rounds });
    }
    return json({ error: 'Not a turn-based game' }, 400);
  }
  if (action === 'finish') {
    const sid = String(body.sid || ''), sess = /^[a-z0-9]{16}$/.test(sid) && await store.get(`cgs/${sid}`);
    if (!sess || sess.uid !== me || sess.ch !== ch.id) return json({ error: 'This game session expired — start a new one' }, 400);
    await store.del(`cgs/${sid}`);                                    // one result per session
    const took = Date.now() - sess.at;
    let score = 0, detail = '';
    if (sess.kind === 'math') {
      if (took > (GAME_KINDS.math.secs + 15) * 1000) return json({ error: 'Time’s up — that round took too long' }, 400);
      const probs = mathProblems(sess.seed), ans = Array.isArray(body.answers) ? body.answers.slice(0, probs.length) : [];
      score = ans.filter((v, i) => Number(v) === probs[i].ans).length; detail = `${score} correct of ${ans.length}`;
    } else if (sess.kind === 'reaction') {
      const t = (Array.isArray(body.times) ? body.times : []).map(Number).slice(0, GAME_KINDS.reaction.rounds);
      if (t.length !== GAME_KINDS.reaction.rounds || t.some(x => !(x >= 100 && x <= 3000))) return json({ error: 'That round didn’t finish properly — try again' }, 400);
      if (took < t.reduce((x, y) => x + y, 0)) return json({ error: 'That result doesn’t add up — try again' }, 400);
      const avg = Math.round(t.reduce((x, y) => x + y, 0) / t.length); score = Math.max(0, 1000 - avg); detail = `average ${avg} ms`;
    } else if (['emoji', 'scramble', 'rps'].includes(sess.kind)) {
      score = sess.st?.score || 0;
      detail = sess.kind === 'rps' ? `${(sess.st?.log || []).filter(x => x === 'win').length} won, ${(sess.st?.log || []).filter(x => x === 'draw').length} drawn of ${(sess.st?.log || []).length}` : `${score} solved`;
    } else if (sess.kind === 'ttt') {
      const games = (Array.isArray(body.games) ? body.games : []).slice(0, GAME_KINDS.ttt.games);
      let w = 0, dr = 0;
      for (let k = 0; k < games.length; k++) { const r = Array.isArray(games[k]) ? tttReplay(games[k], k % 2 === 0) : null; if (r === 'X') w++; else if (r === 'draw') dr++; else if (r === null) break; }
      if (took < games.flat().length * 250) { w = 0; dr = 0; }    // each of your taps (plus the computer's reply) takes real time
      score = w * 3 + dr; detail = `${w} won, ${dr} drawn of ${games.length}`;
    } else if (GAME_KINDS[sess.kind].fun) {
      const def = GAME_KINDS[sess.kind], secs = took / 1000, sc = Math.round(Number(body.score));
      if (!(sc >= 0)) return json({ error: 'That game didn’t finish properly — try again' }, 400);
      if (def.secs && secs > def.secs + 20) return json({ error: 'Time’s up — that round took too long' }, 400);
      if (sc > def.maxRate * secs + 5) return json({ error: 'That score doesn’t add up — try again' }, 400);
      score = sc; detail = sess.kind === 'bubbles' ? `${sc} popped` : sess.kind === 'dash' ? `${sc} m run` : `${sc} blocks high`;
    } else {
      const path = memoryPath(sess.seed), lv = Array.isArray(body.levels) ? body.levels.slice(0, GAME_KINDS.memory.max) : [];
      for (let i = 0; i < lv.length; i++) { const want = path.slice(0, i + 1); if (Array.isArray(lv[i]) && lv[i].length === want.length && lv[i].every((x, j) => Number(x) === want[j])) score = i + 1; else break; }
      if (took < score * 600) score = 0;                              // can't watch and repeat that fast
      detail = `path of ${score}`;
    }
    const fresh = await store.get(`cgm/${ch.id}/${me}`);
    const day = sess.day, list = [...(fresh.games?.[day] || []), { kind: sess.kind, score, at: Date.now(), detail }];
    fresh.games = { ...(fresh.games || {}), [day]: list };
    await store.set(`cgm/${ch.id}/${me}`, fresh);
    const best = Math.max(...list.filter(p => p.kind === g.kind).map(p => p.score));
    if (score > 0 && score > (ch.gameRecord?.score || 0)) {
      ch.gameRecord = { uid: me, name: user.name, score, at: Date.now() };
      await store.set(`cg/${ch.id}`, ch);
    }
    return json({ ok: true, score, detail, best, points: Math.floor((g.mode === 'sum' ? list.filter(p => p.kind === g.kind).reduce((x, p) => x + p.score, 0) : best) * g.ptsPer),
      playsLeft: Math.max(0, g.perDay - Math.max(list.filter(p => p.kind === g.kind).length, fresh.gstarts?.[day] || 0)) });
  }
  return json({ error: 'Not found' }, 404);
}

export async function challengeRoute(action, { store, body, user, stepDays, today: clientToday }) {
  const me = user.uid;
  const today = DAY.test(clientToday || '') ? clientToday : todayUtc();
  const load = async () => { const id = String(body.id || ''); const ch = CID.test(id) && await store.get(`cg/${id}`); return ch && await canSee(store, ch, me) ? ch : null; };

  if (action === 'list') {
    const out = [];
    for (const k of await store.list('cg/')) {
      const ch = await store.get(k); if (!ch || !(await canSee(store, ch, me))) continue;
      const [count, joined] = await Promise.all([store.list(`cgm/${ch.id}/`).then(x => x.length), store.get(`cgm/${ch.id}/${me}`)]);
      out.push(view(ch, me, { participants: count, joined: !!joined }));
    }
    const order = { live: 0, upcoming: 1, draft: 2, ended: 3 };
    out.sort((a, b) => order[a.status] - order[b.status] || (a.status === 'ended' ? b.end.localeCompare(a.end) : a.start.localeCompare(b.start)));
    return json({ challenges: out });
  }

  if (action === 'create' || action === 'update') {
    let old = null;
    if (action === 'update') { old = await load(); if (!old) return json({ error: 'Challenge not found' }, 404); if (old.createdBy !== me) return json({ error: 'Only the person who created it can edit it' }, 403); }
    const { ch, error } = parseChallenge(body, old);
    if (error) return json({ error }, 400);
    if (ch.audience !== 'all' && !(await store.get(`mb/${ch.audience.room}/${me}`))) return json({ error: 'You can only make a challenge for a group you’re in' }, 403);
    if (typeof body.banner === 'string' && LOCAL_FILE.test(body.banner)) {
      if (old?.banner && old.banner !== body.banner) { const id = old.banner.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`); }
      ch.banner = body.banner;
    } else if (body.banner === null && old?.banner) { const id = old.banner.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`); ch.banner = null; }
    if (!old) Object.assign(ch, { id: rid(10), createdBy: me, createdName: user.name, created: Date.now() });
    await store.set(`cg/${ch.id}`, ch);
    if (!old) await store.set(`cgm/${ch.id}/${me}`, { uid: me, joinedAt: Date.now(), tasks: {} });    // the creator takes part
    await store.del(`cgl/${ch.id}`).catch(() => {});
    return json({ challenge: view(ch, me) });
  }

  const ch = await load();
  if (!ch) return json({ error: 'Challenge not found' }, 404);

  if (action === 'get') {
    let snap = await store.get(`cgl/${ch.id}`);
    if (!snap || (status(ch, today) === 'live' && Date.now() - snap.at > BOARD_EVERY_MS)) snap = await computeBoard(store, ch, { stepDays });
    const mem = await store.get(`cgm/${ch.id}/${me}`);
    const tz = Number(body.tz);
    if (mem && Number.isFinite(tz) && Math.abs(tz) <= 840 && mem.tz !== Math.round(tz)) { mem.tz = Math.round(tz); await store.set(`cgm/${ch.id}/${me}`, mem); }
    const days = await stepDays(store, me);
    const todayRaw = days[today] || 0;
    const tasks = ch.tasks.map(t => ({ ...t, done: t.kind === 'steps' ? todayRaw >= t.target : (mem?.tasks?.[today] || []).includes(t.id), progress: t.kind === 'steps' ? Math.min(todayRaw, t.target) : null }));
    // this week's / today's progress towards the target
    const a = ch.activity, capped = d => a.cap ? Math.min(days[d] || 0, a.cap) : (days[d] || 0);
    let period = capped(today);
    if (a.per === 'week') { const wk = Math.floor((new Date(today) - new Date(ch.start)) / (7 * 864e5)); period = 0; for (let i = 0; i < 7; i++) { const d = dayShift(ch.start, wk * 7 + i); if (d <= today && d >= ch.start && d <= ch.end) period += capped(d); } }
    const all = body.all === true;
    const snapRow = snap.rows.find(r => r.uid === me) || null;
    const myL = mem ? ledger(ch, days, mem, today) : null;
    const mine = myL ? { level: levelFor(ch, myL.points), streak: myL.streak, bestStreak: myL.bestStreak, targetDays: myL.targetDays, todayPts: myL.days.at(-1)?.date === today ? myL.days.at(-1).total : 0 } : null;
    const gPlays = ch.game && mem ? (mem.games?.[today] || []).filter(p => p.kind === ch.game.kind) : [], gStarted = Math.max(gPlays.length, mem?.gstarts?.[today] || 0);
    const gameToday = ch.game ? { ...ch.game, name: GAME_KINDS[ch.game.kind].name, plays: gPlays.length, playsLeft: Math.max(0, ch.game.perDay - gStarted), best: gPlays.length ? Math.max(...gPlays.map(p => p.score)) : null, allBest: myL?.gameBest || 0 } : null;
    return json({ challenge: view(ch, me, { participants: snap.rows.length }), gameToday, joined: !!mem, notify: mem ? mem.notify !== false : false, today, todaySteps: todayRaw, period, mine, levels: LEVELS.map(x => x[0]),
      // your own steps and points are always live; your rank comes from the last leaderboard update
      tasks, board: { at: snap.at, total: snap.rows.length, rows: all ? snap.rows : snap.rows.slice(0, 10),
        me: myL ? { ...(snapRow || { uid: me, name: user.name, photo: user.photo || null, rank: null }), steps: myL.steps, points: myL.points, streak: myL.streak, level: mine.level.idx } : snapRow } });
  }

  // Your points statement: every day's steps, points, bonus and tasks, and when each was credited
  if (action === 'history') {
    const mem = await store.get(`cgm/${ch.id}/${me}`); if (!mem) return json({ error: 'Join the challenge to see your points' }, 400);
    const recs = {}; const last = today < ch.end ? today : ch.end;
    for (let d = ch.start; d <= last; d = dayShift(d, 1)) { const r = await store.get(`sp/${me}/${d}`); if (r) recs[d] = { steps: r.steps || 0, at: r.at || null }; }
    const l = ledger(ch, recs, mem, today);
    return json({ ...l, days: l.days.slice().reverse(), level: levelFor(ch, l.points), joinedAt: mem.joinedAt });
  }
  // Someone's public summary (tap a leaderboard row)
  if (action === 'member') {
    const uid = String(body.uid || '');
    const mem = /^[a-f0-9]{24}$/.test(uid) && await store.get(`cgm/${ch.id}/${uid}`); if (!mem) return json({ error: 'Not in this challenge' }, 404);
    const u = await store.get(`u/${uid}`); if (!u) return json({ error: 'Not found' }, 404);
    const l = ledger(ch, await stepDays(store, uid), mem, today);
    const snap = await store.get(`cgl/${ch.id}`), row = snap?.rows.find(r => r.uid === uid);
    return json({ uid, name: u.name, photo: u.photo || null, rank: row?.rank || null, points: l.points, steps: l.steps, targetDays: l.targetDays, streak: l.streak,
      bestStreak: l.bestStreak, bestDay: l.bestDay, activeDays: l.activeDays, avg: l.activeDays ? Math.round(l.steps / l.days.length) : 0, level: levelFor(ch, l.points),
      week: l.days.slice(-7).map(x => ({ date: x.date, steps: x.counted })), joinedAt: mem.joinedAt });
  }

  if (action === 'refresh') {
    const snap = await store.get(`cgl/${ch.id}`);
    if (!snap || Date.now() - snap.at > 60_000) await computeBoard(store, ch, { stepDays });     // at most once a minute
    return challengeRoute('get', { store, body, user, stepDays, today: clientToday });
  }

  if (action === 'join') {
    const st = status(ch, today);
    if (st === 'ended') return json({ error: 'This challenge has ended' }, 400);
    if (st === 'draft' && ch.createdBy !== me) return json({ error: 'This challenge isn’t open yet' }, 400);
    if (!(await store.get(`cgm/${ch.id}/${me}`))) await store.set(`cgm/${ch.id}/${me}`, { uid: me, joinedAt: Date.now(), tasks: {}, tz: Number.isFinite(Number(body.tz)) ? Math.round(Number(body.tz)) : undefined });
    await computeBoard(store, ch, { stepDays });
    return json({ ok: true });
  }

  if (action === 'leave') {
    if (ch.createdBy === me) return json({ error: 'You created this challenge — delete it instead' }, 400);
    await store.del(`cgm/${ch.id}/${me}`);
    await computeBoard(store, ch, { stepDays });
    return json({ ok: true });
  }

  if (action === 'task') {       // tick a daily check-off task (today, or yesterday if you forgot)
    const mem = await store.get(`cgm/${ch.id}/${me}`); if (!mem) return json({ error: 'Join the challenge first' }, 400);
    const t = ch.tasks.find(x => x.id === body.task && x.kind === 'check'); if (!t) return json({ error: 'Task not found' }, 404);
    const d = body.date === dayShift(today, -1) ? body.date : today;
    if (d < ch.start || d > ch.end) return json({ error: 'The challenge isn’t running that day' }, 400);
    const done = new Set(mem.tasks?.[d] || []);
    body.done === false ? done.delete(t.id) : done.add(t.id);
    mem.tasks = { ...(mem.tasks || {}), [d]: [...done] };
    mem.taskAt = { ...(mem.taskAt || {}), [d]: { ...(mem.taskAt?.[d] || {}), [t.id]: body.done === false ? undefined : Date.now() } };
    await store.set(`cgm/${ch.id}/${me}`, mem);
    return json({ ok: true, done: [...done] });
  }

  if (action === 'game/start' || action === 'game/finish' || action === 'game/move') {
    const res = await gameAction(action.slice(5), { store, body, ch, me, today, user });
    if (action === 'game/finish' && res.status === 200) await computeBoard(store, ch, { stepDays });   // leaderboard updates right away
    return res;
  }

  if (action === 'notify') {     // this challenge's reminders on/off for you
    const mem = await store.get(`cgm/${ch.id}/${me}`); if (!mem) return json({ error: 'Join the challenge first' }, 400);
    mem.notify = body.on !== false; await store.set(`cgm/${ch.id}/${me}`, mem);
    return json({ ok: true, notify: mem.notify });
  }

  if (action === 'delete') {
    if (ch.createdBy !== me) return json({ error: 'Only the person who created it can delete it' }, 403);
    for (const k of await store.list(`cgm/${ch.id}/`)) await store.del(k);
    await store.del(`cgl/${ch.id}`); await store.del(`cg/${ch.id}`);
    const fid = ch.banner?.match(LOCAL_FILE)?.[1]; if (fid) await store.delFile(`f/${fid}`);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

// ---------- Challenge notifications (kept rare on purpose) ----------
// • "starts tomorrow" (once) • "2 days left" (once) • "you moved up to #N" (top 10, at most once a day)
// • "you're N steps from today's target" (evenings, at most once a day)
// Never more than 2 a day per person across all challenges, only 8 AM–9 PM in their timezone, and each challenge can be muted.
export const NOTIFY_EVERY_MS = 15 * 60_000;
const DAILY_LIMIT = 2;
export async function challengeNotifications(store, { stepDays, notify, now = Date.now() }) {
  const last = await store.get('cfg/cn-last');
  if (last && now - last.at < NOTIFY_EVERY_MS - 30_000) return 0;
  await store.set('cfg/cn-last', { at: now });
  let sent = 0;
  const utcToday = new Date(now).toISOString().slice(0, 10);
  for (const k of await store.list('cg/')) {
    const ch = await store.get(k); if (!ch) continue;
    if (utcToday < dayShift(ch.start, -2) || utcToday > dayShift(ch.end, 1) || utcToday < dayShift(ch.publishAt, -1)) continue;
    const snap = await store.get(`cgl/${ch.id}`);
    const rows = new Map((snap?.rows || []).map(r => [r.uid, r]));
    for (const mk of await store.list(`cgm/${ch.id}/`)) {
      const mem = await store.get(mk); if (!mem?.uid || mem.notify === false) continue;
      const tz = Number.isFinite(mem.tz) ? mem.tz : -330;                // default: India time
      const local = new Date(now - tz * 60_000), hour = local.getUTCHours(), today = local.toISOString().slice(0, 10);
      if (hour < 8 || hour >= 21) continue;                              // quiet hours
      if (today < ch.publishAt) continue;
      const capKey = `cn/${mem.uid}/${today}`, cap = (await store.get(capKey)) || { n: 0 };
      if (cap.n >= DAILY_LIMIT) continue;
      const s0 = mem.sent || {}, row = rows.get(mem.uid), a = ch.activity;
      let msg = null, mark = null;
      const daysLeft = Math.round((new Date(ch.end) - new Date(today)) / 864e5);
      if (today === dayShift(ch.start, -1) && !s0.tomorrow) {
        msg = { title: 'Challenge starts tomorrow', body: `${ch.title} starts tomorrow${a.target ? ` — target ${a.target.toLocaleString('en-US')} steps a ${a.per}` : ''}. Get ready!` }; mark = { tomorrow: true };
      } else if (today >= ch.start && daysLeft === 2 && !s0.twoLeft) {
        msg = { title: '2 days left', body: `Only 2 days left in ${ch.title}${row ? `. You’re #${row.rank} with ${row.points.toLocaleString('en-US')} points` : ''} — finish strong!` }; mark = { twoLeft: true };
      } else if (row?.prev && row.rank < row.prev && row.rank <= 10 && s0.rankDay !== today && row.rank !== s0.lastRank && today >= ch.start && today <= ch.end) {
        msg = { title: `You moved up to #${row.rank}`, body: `in ${ch.title} — ${row.points.toLocaleString('en-US')} points. Keep going!` }; mark = { rankDay: today, lastRank: row.rank };
      } else if (a.per === 'day' && a.target && today >= ch.start && today <= ch.end && hour >= 17 && s0.nearDay !== today) {
        const raw = (await stepDays(store, mem.uid))[today] || 0, counted = a.cap ? Math.min(raw, a.cap) : raw, gap = a.target - counted;
        if (gap > 0 && gap <= 1500) { msg = { title: `You’re ${gap.toLocaleString('en-US')} steps from today’s target`, body: `${ch.title}: a short walk${a.bonus ? ` earns the +${a.bonus} bonus` : ' gets you there'}.` }; mark = { nearDay: today }; }
      }
      if (!msg) continue;
      mem.sent = { ...s0, ...mark }; await store.set(mk, mem);
      await store.set(capKey, { n: cap.n + 1 });
      await notify(mem.uid, { type: 'challenge', room: '', title: msg.title, body: msg.body, url: `/#/challenge/${ch.id}` });
      sent++;
    }
  }
  return sent;
}
// for tests: the answer to puzzle i of a session
export const _answerFor = (kind, sess, i) => kind === 'emoji' ? EMOJI[sess.puzzles[i][0]][2] : WORDS[wordIndex(sess.seed, i)];
