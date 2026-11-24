// Mini-games played inside a chat: Imposter, Mafia, Clip Recall, Emoji Guess, Would You Rather,
// Tic-tac-toe and Rock-paper-scissors. One game per chat at a time.
//   gs/<room>                          the game (public state + secrets that are never sent as-is)
//   gp/<room>/<gameId>/<step>/<uid>    one player's move for a step (separate keys: simultaneous moves never clash)
// Timed steps move on when every player has moved, or when the timer runs out (checked whenever someone looks).
import crypto from 'node:crypto';
import { PUZZLES } from './emoji-puzzles.mjs';

const now = () => Date.now();
const rid = () => crypto.randomBytes(5).toString('hex');
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const pick = a => a[crypto.randomInt(a.length)];
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
export const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// How close a wrong guess is, without giving the answer away → { hint, msg }
const lev = (a, b) => { const d = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; };
export function guessHint(guess, answers, { letters = false } = {}) {
  const g = norm(guess).replace(/^the /, ''); if (!g) return { hint: null, msg: 'Type a guess' };
  let words = null, start = false, extra = false;
  for (const a0 of answers) {
    const a = norm(a0).replace(/^the /, ''); if (!a) continue;
    if (letters && g.replace(/ /g, '').split('').sort().join('') === a.split('').sort().join('')) return { hint: 'close', msg: 'Right letters — try another order' };
    if (lev(g, a) <= Math.max(1, Math.round(a.length / 4))) return { hint: 'close', msg: 'So close! Check the spelling' };
    const aw = a.split(' ').filter(w => w.length > 1), gw = g.split(' ');
    const left = [...gw], hit = aw.filter(w => { const k = left.findIndex(x => x === w || (x.length > 3 && lev(x, w) <= 1)); if (k < 0) return false; left.splice(k, 1); return true; }).length;   // each typed word counts once
    if (aw.length && hit === aw.length) extra = true;
    else if (hit && aw.length > 1 && (!words || hit > words[0])) words = [hit, aw.length];
    if (g.length >= 3 && a.startsWith(g)) start = true;
  }
  if (extra) return { hint: 'close', msg: 'Almost — just type the name' };
  if (words) return { hint: 'words', msg: `Close! You have ${words[0]} of ${words[1]} words right` };
  if (start) return { hint: 'start', msg: 'Good start — keep going' };
  return { hint: null, msg: 'Not quite — try again' };
}

/* ---------- content (titles and everyday words; no copyrighted media) ---------- */
const WORDS = [
  ['Food', 'Pizza'], ['Food', 'Samosa'], ['Food', 'Biryani'], ['Food', 'Pani puri'], ['Food', 'Ice cream'], ['Food', 'Maggi'], ['Food', 'Dosa'], ['Food', 'Chai'],
  ['Place', 'Beach'], ['Place', 'Airport'], ['Place', 'Hospital'], ['Place', 'Cinema hall'], ['Place', 'Railway station'], ['Place', 'Gym'], ['Place', 'Temple'], ['Place', 'Office'],
  ['Animal', 'Elephant'], ['Animal', 'Penguin'], ['Animal', 'Cat'], ['Animal', 'Monkey'], ['Animal', 'Giraffe'], ['Animal', 'Shark'],
  ['Sport', 'Cricket'], ['Sport', 'Football'], ['Sport', 'Badminton'], ['Sport', 'Chess'], ['Sport', 'Kabaddi'], ['Sport', 'Swimming'],
  ['Thing', 'Umbrella'], ['Thing', 'Mobile phone'], ['Thing', 'Pressure cooker'], ['Thing', 'Ceiling fan'], ['Thing', 'Toothbrush'], ['Thing', 'Laptop'], ['Thing', 'Mirror'],
  ['Job', 'Doctor'], ['Job', 'Pilot'], ['Job', 'Chef'], ['Job', 'Teacher'], ['Job', 'Police officer'], ['Job', 'Software engineer'],
  ['Festival', 'Diwali'], ['Festival', 'Holi'], ['Festival', 'Christmas'], ['Festival', 'Eid'], ['Festival', 'Navratri'],
  ['Vehicle', 'Auto rickshaw'], ['Vehicle', 'Bicycle'], ['Vehicle', 'Metro'], ['Vehicle', 'Helicopter'],
];
// [category, [emoji clue sets], answer, ...other accepted answers] — see emoji-puzzles.mjs
export const EMOJI = PUZZLES.map(([cat, answer, sets, ...alts]) => [cat, sets, answer, ...alts]);
// Pick the puzzle seen longest ago (never-seen first) and show it with a different clue set than last time.
//   seen: { [puzzle index]: [last clue set, time] } — kept per chat room / per challenge player
export function emojiChoose(seen, skip = new Set(), rand = Math.random) {
  const cand = EMOJI.map((_, i) => i).filter(i => !skip.has(i));
  const pool = cand.length ? cand : EMOJI.map((_, i) => i);
  const age = i => seen[i]?.[1] || 0, oldest = [...pool].sort((a, b) => age(a) - age(b));
  const few = oldest.slice(0, Math.max(8, Math.ceil(oldest.length / 3)));        // random among the least recently seen
  const i = few[Math.floor(rand() * few.length)], sets = EMOJI[i][1];
  const v = seen[i] ? (seen[i][0] + 1) % sets.length : Math.floor(rand() * sets.length);
  seen[i] = [v, Date.now()];
  return { i, v, emoji: sets[v] };
}

const WYR = [
  ['Always be 10 minutes late', 'Always be 20 minutes early'], ['Live without music', 'Live without movies'], ['Only eat chai & biscuits', 'Never drink chai again'],
  ['Read minds', 'Be invisible'], ['Work from home forever', 'Work from office forever'], ['Have unlimited mobile data', 'Have unlimited food'],
  ['Be famous', 'Be rich'], ['Travel to the past', 'Travel to the future'], ['Never use social media', 'Never watch TV/OTT'], ['Live in the mountains', 'Live by the beach'],
  ['Have a pet dog', 'Have a pet cat'], ['Give up sweets', 'Give up spicy food'], ['Be the best player in a losing team', 'Be the worst player in a winning team'],
  ['Speak every language', 'Play every instrument'], ['Have a 3-day weekend', 'Have a 4-hour workday'], ['Always win arguments', 'Always win games'],
  ['Watch only Bollywood', 'Watch only Hollywood'], ['Talk to animals', 'Talk to aliens'], ['Have no phone for a month', 'Have no AC for a summer'],
  ['Eat only street food', 'Eat only home food'], ['Know when you will die', 'Know how you will die'], ['Be a superhero', 'Be a wizard'],
];

const T = { pick: 90_000, tell: 75_000, judge: 30_000, mafia: 45_000, doctor: 30_000, detective: 30_000, fake: 9_000, clue: 90_000, vote: 60_000, guess: 30_000, night: 75_000, day: 150_000, setup: 240_000, watch: 22_000, answer: 120_000, cvote: 60_000, egues: 40_000, ereveal: 7_000, wpick: 25_000, wreveal: 8_000, rthrow: 60_000, rreveal: 4_000 };

/* ---------- the games ---------- */
const GAMES = {
  imposter: { name: 'Imposter', min: 3, max: 12, rounds: 3, set: { rounds: [1, 10], timer: 'clue', secs: [30, 180], timeLabel: 'Time to give clues' }, group: true, dm: false,
    desc: 'Everyone gets the same secret word except the imposter. Give one-word clues, then vote out the faker.' },
  mafia: { name: 'Mafia', min: 4, max: 16, rounds: 1, set: { timer: 'day', secs: [60, 300], timeLabel: 'Day discussion time' }, group: true, dm: false,
    desc: 'Secret roles: Mafia, Doctor, Detective and Villagers. Mafia strikes at night; everyone votes by day.' },
  episode: { name: 'Episode Recall', min: 2, max: 20, rounds: 0, set: { timer: 'tell', secs: [30, 180], timeLabel: 'Time to tell the storyline' }, group: true, dm: false,
    desc: 'Take turns: pick an episode number, watch a 15–20 s clip, then tell its storyline out loud. Everyone votes if you got it right.' },
  emoji: { name: 'Emoji Guess', min: 1, max: 30, rounds: 5, set: { rounds: [3, 20], timer: 'egues', secs: [15, 120], timeLabel: 'Time per puzzle' }, group: true, dm: true,
    desc: 'Guess the movie, show or song from emojis. Fastest correct answers score.' },
  wyr: { name: 'Would You Rather', min: 2, max: 30, rounds: 5, set: { rounds: [3, 20], timer: 'wpick', secs: [10, 60], timeLabel: 'Time to pick' }, group: true, dm: true,
    desc: 'Pick a side and see who agrees with you.' },
  ttt: { name: 'Tic-tac-toe', min: 2, max: 2, rounds: 0, group: true, dm: true,
    desc: 'Classic three in a row. Two players.' },
  rps: { name: 'Rock Paper Scissors', min: 2, max: 2, rounds: 0, win: 3, set: { wins: [1, 5], timer: 'rthrow', secs: [10, 60], timeLabel: 'Time per throw' }, group: true, dm: true,
    desc: 'First to 3 wins (you can change it). Two players.' },
};
export const GAME_LIST = Object.entries(GAMES).map(([kind, g]) => ({ kind, name: g.name, min: g.min, max: g.max, desc: g.desc, group: g.group, dm: g.dm,
  set: g.set ? { ...g.set, defRounds: g.set.rounds ? g.rounds : undefined, defWins: g.set.wins ? g.win : undefined, defSecs: T[g.set.timer] / 1000 } : null }));
// Feedback sounds: built-in ones (made in the app) or a clip the starter uploaded (/api/file/<id>)
export const SOUNDS = { wrong: ['fahh', 'buzzer', 'trombone', 'bruh', 'off'], right: ['crore', 'ding', 'coin', 'tada', 'off'] };
export function cleanSounds(x) {
  const pick = (v, list, def) => typeof v === 'string' && (list.includes(v) || /^\/api\/file\/[a-f0-9]{24}$/.test(v)) ? v : def;
  return { wrong: pick(x?.wrong, SOUNDS.wrong, 'fahh'), right: pick(x?.right, SOUNDS.right, 'crore') };
}
// The starter's choices (rounds / wins / seconds), kept inside the allowed range
function gameCfg(kind, body) {
  const st = GAMES[kind].set; if (!st) return { sounds: cleanSounds(body.sounds) };
  const clamp = (v, [lo, hi]) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : undefined; };
  const cfg = { rounds: st.rounds ? clamp(body.rounds, st.rounds) : undefined, wins: st.wins ? clamp(body.wins, st.wins) : undefined, secs: clamp(body.secs, st.secs) };
  cfg.sounds = cleanSounds(body.sounds);
  return cfg;
}
const roundsOf = g => g.cfg?.rounds || GAMES[g.kind].rounds;
const winsOf = g => g.cfg?.wins || GAMES[g.kind].win;
const tt = (g, k) => (GAMES[g.kind].set?.timer === k && g.cfg?.secs ? g.cfg.secs * 1000 : T[k]);   // a timer, using the starter's choice

const SAY = {
  mafia: 'The city goes to sleep. Everyone, close your eyes. Mafia, wake up — choose someone to eliminate.',
  doctor: 'Mafia, close your eyes. Doctor, wake up — choose someone to save.',
  detective: 'Doctor, close your eyes. Detective, wake up — choose someone to investigate.',
};

/** Load, auto-advance on timers, and return the game (or null). */
export async function loadGame(store, room, ctx) {
  const g = await store.get(`gs/${room}`);
  if (!g) return null;
  if (g.phase !== 'over' && g.deadline && now() >= g.deadline) { await advance(store, room, g, ctx, true); }
  return (await store.get(`gs/${room}`)) || null;
}

async function save(store, room, g) { g.updatedAt = now(); await store.set(`gs/${room}`, g); await store.set(`v/${room}`, { v: `${String(now()).padStart(13, '0')}-${rid()}` }); }
const stepKey = (g, step) => `r${g.round}-n${g.data?.night || 0}-${step}`;   // Mafia repeats night/day within one round
async function moves(store, room, g, step) {
  const keys = await store.list(`gp/${room}/${g.id}/${stepKey(g, step)}/`);
  const out = {};
  for (const k of keys) { const v = await store.get(k); if (v) out[k.split('/').pop()] = v; }
  return out;
}
const setMove = (store, room, g, step, uid, v) => store.set(`gp/${room}/${g.id}/${stepKey(g, step)}/${uid}`, { ...v, at: now() });
const addPts = (g, uid, n) => { g.scores[uid] = (g.scores[uid] || 0) + n; };
const nameOf = (g, uid) => g.players.find(p => p.uid === uid)?.name || 'Someone';
const topVoted = votes => {          // { voter: target } → unique top target or null on a tie
  const c = {}; for (const t of Object.values(votes)) if (t) c[t] = (c[t] || 0) + 1;
  const best = Math.max(0, ...Object.values(c)); const tops = Object.keys(c).filter(k => c[k] === best);
  return { top: best && tops.length === 1 ? tops[0] : null, counts: c };
};

/* ---------- starting a round ---------- */
async function beginRound(store, room, g) {
  g.round++;
  const ids = g.players.map(p => p.uid);
  g.data = {}; g.secret = {};
  switch (g.kind) {
    case 'imposter': {
      const [cat, word] = pick(WORDS);
      g.secret = { imposter: pick(ids), word };
      g.data = { cat, order: shuffle(ids) };
      g.phase = 'clue'; g.deadline = now() + tt(g, 'clue'); break;
    }
    case 'mafia': {
      const n = ids.length, s = shuffle(ids), roles = {};
      const mafiaN = n >= 7 ? 2 : 1;
      s.forEach((u, i) => { roles[u] = i < mafiaN ? 'mafia' : i === mafiaN ? 'detective' : (i === mafiaN + 1 && n >= 5) ? 'doctor' : 'villager'; });
      g.secret = { roles, checks: {}, night: {} };
      g.data = { alive: ids, night: 1, events: [] };
      nightStep(g, 'mafia'); break;
    }
    case 'episode': {
      const teller = ids[(g.round - 1) % ids.length];
      g.data = { teller, series: g.series };
      g.phase = 'pick'; g.deadline = now() + T.pick; break;
    }
    case 'emoji': {
      const seen = (await store.get(`ev/${room}`)) || {};             // which puzzles/clue sets this chat has had
      const { i, emoji } = emojiChoose(seen, new Set(g.usedEmoji || []));
      await store.set(`ev/${room}`, seen);
      g.usedEmoji = [...(g.usedEmoji || []), i].slice(-40);
      const [cat, , answer, ...alts] = EMOJI[i];
      g.secret = { answer, alts };
      g.data = { cat, emoji, letters: answer.replace(/[^A-Za-z0-9 ]/g, '').split(' ').map(w => w.length).join(' + ') };
      g.phase = 'guess'; g.deadline = now() + tt(g, 'egues'); break;
    }
    case 'wyr': {
      const used = new Set(g.usedWyr || []);
      const pool = WYR.map((e, i) => i).filter(i => !used.has(i));
      const i = pick(pool.length ? pool : WYR.map((e, k) => k));
      g.usedWyr = [...used, i].slice(-30);
      g.data = { a: WYR[i][0], b: WYR[i][1] };
      g.phase = 'pick'; g.deadline = now() + tt(g, 'wpick'); break;
    }
    case 'ttt': {
      const [p1, p2] = g.round % 2 ? ids : [ids[1], ids[0]];
      g.data = { board: Array(9).fill(null), x: p1, o: p2, turn: p1 };
      g.phase = 'play'; g.deadline = 0; break;
    }
    case 'rps': {
      g.data = { wins: Object.fromEntries(ids.map(u => [u, 0])), last: g.data?.last || null, throwNo: 1 };
      g.phase = 'throw'; g.deadline = now() + tt(g, 'rthrow'); break;
    }
  }
}

/* ---------- moving on (all moved, timer, or host) ---------- */
async function advance(store, room, g, ctx, timedOut = false) {
  const ids = g.players.map(p => p.uid);
  switch (g.kind) {
    case 'imposter': {
      if (g.phase === 'clue') {
        const m = await moves(store, room, g, 'clue');
        g.data.clues = Object.fromEntries(g.data.order.map(u => [u, m[u]?.text || '—']));
        g.phase = 'vote'; g.deadline = now() + T.vote; break;
      }
      if (g.phase === 'vote') {
        const m = await moves(store, room, g, 'vote');
        const { top, counts } = topVoted(Object.fromEntries(Object.entries(m).map(([u, v]) => [u, v.target])));
        g.data.votes = Object.fromEntries(Object.entries(m).map(([u, v]) => [u, v.target]));
        g.data.counts = counts; g.data.caught = top === g.secret.imposter;
        if (g.data.caught) { g.phase = 'guess'; g.deadline = now() + T.guess; }
        else { addPts(g, g.secret.imposter, 2); g.data.result = 'escaped'; reveal(g); }
        break;
      }
      if (g.phase === 'guess') {
        const m = await moves(store, room, g, 'guess'), gs = m[g.secret.imposter]?.text || '';
        g.data.guess = gs;
        if (gs && norm(gs) === norm(g.secret.word)) { addPts(g, g.secret.imposter, 2); g.data.result = 'stole'; }
        else { for (const u of ids) if (u !== g.secret.imposter) addPts(g, u, 1); g.data.result = 'caught'; }
        reveal(g); break;
      }
      break;
    }
    case 'mafia': {
      const roles = g.secret.roles, alive = g.data.alive;
      if (g.phase === 'mafia') {
        const m = await moves(store, room, g, 'mafia');
        const kills = Object.fromEntries(Object.entries(m).filter(([u]) => alive.includes(u) && roles[u] === 'mafia').map(([u, v]) => [u, v.target]));
        g.secret.night.kill = topVoted(kills).top || Object.values(kills)[0] || null;
        nightStep(g, 'doctor'); break;
      }
      if (g.phase === 'doctor') {
        const m = await moves(store, room, g, 'doctor');
        g.secret.night.save = Object.entries(m).find(([u]) => alive.includes(u) && roles[u] === 'doctor')?.[1]?.target || null;
        nightStep(g, 'detective'); break;
      }
      if (g.phase === 'detective') {
        const m = await moves(store, room, g, 'detective');
        const [du, dv] = Object.entries(m).find(([u]) => alive.includes(u) && roles[u] === 'detective') || [];
        if (du && dv?.target) (g.secret.checks[du] ||= []).push({ uid: dv.target, mafia: roles[dv.target] === 'mafia', night: g.data.night });
        // dawn
        const victim = g.secret.night.kill, saved = !!victim && victim === g.secret.night.save;
        const died = victim && !saved ? victim : null;
        if (died) g.data.alive = alive.filter(u => u !== died);
        g.data.events.push({ t: 'night', night: g.data.night, died, saved });
        g.secret.night = {};
        if (!checkMafiaWin(g)) {
          g.phase = 'day'; g.data.awake = null; g.deadline = now() + tt(g, 'day');
          g.data.say = `Everyone, wake up! ${died ? `Last night the mafia killed ${nameOf(g, died)}.` : saved ? 'The mafia attacked — but the doctor saved them!' : 'Nobody died last night.'} Talk it over, then vote.`;
        } else g.data.say = g.data.winner === 'town' ? 'The town wins — the mafia is gone!' : 'The mafia wins — they took over the city.';
        break;
      }
      if (g.phase === 'day') {
        const m = await moves(store, room, g, 'day');
        const votes = Object.fromEntries(Object.entries(m).filter(([u]) => alive.includes(u)).map(([u, v]) => [u, v.target === 'skip' ? null : v.target]));
        const { top } = topVoted(votes);
        if (top) g.data.alive = alive.filter(u => u !== top);
        g.data.events.push({ t: 'day', night: g.data.night, out: top, role: top ? roles[top] : null, votes });
        if (!checkMafiaWin(g)) { g.data.night++; nightStep(g, 'mafia'); }
        else g.data.say = (top ? `${nameOf(g, top)} was voted out — they were ${roles[top]}. ` : '') + (g.data.winner === 'town' ? 'The town wins!' : 'The mafia wins!');
        break;
      }
      break;
    }
    case 'episode': {
      if (g.phase === 'pick') { g.data.skipped = true; reveal(g); break; }          // no episode picked in time
      if (g.phase === 'watch') { g.phase = 'tell'; g.deadline = now() + tt(g, 'tell'); break; }
      if (g.phase === 'tell') { g.phase = 'judge'; g.deadline = now() + T.judge; break; }
      if (g.phase === 'judge') {
        const m = await moves(store, room, g, 'judge');
        const yes = Object.values(m).filter(v => v.verdict === 'yes').length, no = Object.values(m).filter(v => v.verdict === 'no').length;
        const right = yes > no;
        if (right) addPts(g, g.data.teller, 3);
        for (const [u, v] of Object.entries(m)) if ((v.verdict === 'yes') === right && yes !== no) addPts(g, u, 1);   // judges who agreed with the room
        g.data.yes = yes; g.data.no = no; g.data.right = right;
        reveal(g); break;
      }
      break;
    }
    case 'emoji': {
      if (g.phase === 'guess') { reveal(g); g.deadline = now() + T.ereveal; break; }
      if (g.phase === 'reveal') {
        if (g.round >= roundsOf(g)) await finish(store, room, g, ctx); else await beginRound(store, room, g);
        break;
      }
      break;
    }
    case 'wyr': {
      if (g.phase === 'pick') {
        const m = await moves(store, room, g, 'pick');
        const picks = Object.fromEntries(Object.entries(m).map(([u, v]) => [u, v.choice]));
        const a = Object.values(picks).filter(x => x === 'a').length, b = Object.values(picks).filter(x => x === 'b').length;
        if (a !== b) for (const [u, c] of Object.entries(picks)) if ((a > b) === (c === 'a')) addPts(g, u, 1);   // the crowd wins
        g.data.picks = picks; reveal(g); g.deadline = now() + T.wreveal; break;
      }
      if (g.phase === 'reveal') {
        if (g.round >= roundsOf(g)) await finish(store, room, g, ctx); else await beginRound(store, room, g);
        break;
      }
      break;
    }
    case 'rps': {
      if (g.phase === 'throw') {
        const m = await moves(store, room, g, 'throw' + g.data.throwNo);
        const [p1, p2] = ids, a = m[p1]?.hand, b = m[p2]?.hand;
        if (!a || !b) {               // timed out: whoever threw wins the point
          if (a && !b) g.data.wins[p1]++; else if (b && !a) g.data.wins[p2]++;
        } else if (a !== b) {
          const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
          g.data.wins[beats[a] === b ? p1 : p2]++;
        }
        g.data.last = { [p1]: a || null, [p2]: b || null };
        const champ = ids.find(u => g.data.wins[u] >= winsOf(g));
        if (champ) { addPts(g, champ, 1); g.data.champ = champ; reveal(g); }
        else { g.phase = 'shown'; g.deadline = now() + T.rreveal; }
        break;
      }
      if (g.phase === 'shown') { g.data.throwNo++; g.phase = 'throw'; g.deadline = now() + tt(g, 'rthrow'); break; }
      break;
    }
  }
  await save(store, room, g);
}
function reveal(g) { g.phase = 'reveal'; g.deadline = 0; }
// Night in turns: the narrator calls each role. A role that's dead (or not in this game) is still called and
// waited for briefly, so nobody can tell who's gone from the timing.
function nightStep(g, role) {
  const alive = g.data.alive, roles = g.secret.roles;
  const present = alive.some(u => roles[u] === role);
  g.phase = role; g.data.awake = role;
  const last = g.data.events[g.data.events.length - 1];
  g.data.say = (role === 'mafia' && last?.t === 'day' ? (last.out ? `${nameOf(g, last.out)} was voted out — they were ${last.role}. ` : 'Nobody was voted out. ') : '') + SAY[role];
  g.deadline = now() + (present ? T[role] : T.fake);
}
function checkMafiaWin(g) {
  const roles = g.secret.roles, alive = g.data.alive;
  const mafia = alive.filter(u => roles[u] === 'mafia').length, town = alive.length - mafia;
  const winner = mafia === 0 ? 'town' : mafia >= town ? 'mafia' : null;
  if (!winner) return false;
  g.data.winner = winner;
  for (const p of g.players) if ((roles[p.uid] === 'mafia') === (winner === 'mafia')) addPts(g, p.uid, 3);
  reveal(g);
  return true;
}
async function finish(store, room, g, ctx) {
  g.phase = 'over'; g.deadline = 0;
  const best = Math.max(0, ...Object.values(g.scores));
  const winners = g.players.filter(p => (g.scores[p.uid] || 0) === best && best > 0).map(p => p.name);
  g.data.final = true;
  if (!g.round) await ctx?.announce?.(`${GAMES[g.kind].name} was cancelled`);
  else await ctx?.announce?.(winners.length ? `${GAMES[g.kind].name} is over — ${winners.join(' & ')} won with ${best} point${best === 1 ? '' : 's'}` : `${GAMES[g.kind].name} is over`);
  for (const k of await store.list(`gp/${room}/${g.id}/`)) await store.del(k);
}

/* ---------- what one player sees ---------- */
export function gameView(g, uid) {
  if (!g) return null;
  const me = g.players.some(p => p.uid === uid);
  const v = { id: g.id, kind: g.kind, name: GAMES[g.kind].name, phase: g.phase, host: g.host, hostName: g.hostName, players: g.players, scores: g.scores,
    round: g.round, rounds: roundsOf(g) || null, cfg: { secs: GAMES[g.kind].set ? tt(g, GAMES[g.kind].set.timer) / 1000 : null, wins: GAMES[g.kind].win ? winsOf(g) : null, timeLabel: GAMES[g.kind].set?.timeLabel || null, sounds: cleanSounds(g.cfg?.sounds) }, deadline: g.deadline || 0, now: now(), joined: me, data: { ...g.data }, you: {} };
  const s = g.secret || {};
  switch (g.kind) {
    case 'imposter':
      if (g.phase === 'reveal' || g.phase === 'over') { v.data.word = s.word; v.data.imposter = s.imposter; }
      else if (me) v.you = s.imposter === uid ? { imposter: true } : { word: s.word };
      if (g.phase === 'guess') v.data.imposter = s.imposter;
      break;
    case 'mafia': {
      const role = s.roles?.[uid];
      if (role) v.you = { role, alive: g.data.alive.includes(uid) };
      if (role === 'mafia') v.you.team = Object.keys(s.roles).filter(u => s.roles[u] === 'mafia');
      if (role === 'detective') v.you.checks = s.checks?.[uid] || [];
      v.you.awake = !!role && v.data.awake === role && g.data.alive.includes(uid);
      if (g.phase === 'reveal' || g.phase === 'over') v.data.roles = s.roles;
      break;
    }
    case 'episode':
      if (g.phase === 'reveal' || g.phase === 'over') v.data.videoTitle = s.videoTitle || '';
      v.you = { teller: uid === g.data.teller };
      break;
    case 'emoji':
      if (g.phase === 'reveal' || g.phase === 'over') v.data.answer = s.answer;
      break;
  }
  return v;
}

/* ---------- requests ---------- */
// ctx: { store, room, user, group, isAdmin, announce(text) }
export async function gameRoute(action, body, ctx) {
  const { store, room, user, group } = ctx;
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  let g = await loadGame(store, room, ctx);
  const dm = !!group?.dm;

  if (action === 'list') return json({ games: GAME_LIST.filter(x => dm ? x.dm : x.group) });

  if (action === 'start') {
    const kind = body.kind;
    const def = GAMES[kind];
    if (!def || !(dm ? def.dm : def.group)) return json({ error: 'That game isn’t available here' }, 400);
    if (g && g.phase !== 'over') return json({ error: `${GAMES[g.kind].name} is already running — end it first`, code: 'busy' }, 409);
    g = { id: rid(), kind, cfg: gameCfg(kind, body), host: user.uid, hostName: user.name, phase: 'lobby', players: [{ uid: user.uid, name: user.name }], scores: {}, round: 0, deadline: 0, createdAt: now(), data: {}, secret: {},
      series: kind === 'episode' ? (clean(body.series, 60) || 'Taarak Mehta Ka Ooltah Chashmah') : undefined, maxEp: kind === 'episode' ? Math.max(1, Math.min(Math.round(Number(body.maxEp) || 0) || 4000, 20000)) : undefined };
    await save(store, room, g);
    await ctx.announce(`${user.name} started ${def.name} — tap to join`, { game: kind });
    return json({ game: gameView(g, user.uid) });
  }
  if (!g) return json({ error: 'No game is running', code: 'none' }, 404);
  const def = GAMES[g.kind], uid = user.uid, isHost = uid === g.host, inGame = g.players.some(p => p.uid === uid);
  // Episode Recall: remember which country each player is in, so picked clips play for everyone
  const cc = [ctx.country, body.region].map(x => String(x || '').toUpperCase()).find(x => /^[A-Z]{2}$/.test(x));
  if (g.kind === 'episode' && cc && inGame && g.cc?.[uid] !== cc) { g.cc = { ...(g.cc || {}), [uid]: cc }; await store.set(`gs/${room}`, g); }

  if (action === 'end') {
    if (!isHost && !ctx.isAdmin) return json({ error: 'Only the person who started the game (or an admin) can end it' }, 403);
    if (g.phase === 'over') { await store.del(`gs/${room}`); return json({ ok: true }); }
    await finish(store, room, g, ctx); await save(store, room, g);
    return json({ game: gameView(g, uid) });
  }
  if (action === 'join') {
    if (g.phase !== 'lobby') return json({ error: 'This game already started — join the next one' }, 409);
    if (inGame) return json({ game: gameView(g, uid) });
    if (g.players.length >= def.max) return json({ error: `This game is full (${def.max} players)` }, 409);
    g.players.push({ uid, name: user.name }); await save(store, room, g);
    return json({ game: gameView(g, uid) });
  }
  if (action === 'leave') {
    if (g.phase !== 'lobby' || isHost) return json({ error: 'You can only leave before it starts (the host ends it)' }, 409);
    g.players = g.players.filter(p => p.uid !== uid); await save(store, room, g);
    return json({ game: gameView(g, uid) });
  }
  if (action === 'begin') {
    if (!isHost) return json({ error: 'Only the host can start' }, 403);
    if (g.phase !== 'lobby') return json({ error: 'Already started' }, 409);
    if (g.players.length < def.min) return json({ error: `${def.name} needs at least ${def.min} players` }, 400);
    await beginRound(store, room, g); await save(store, room, g);
    return json({ game: gameView(g, uid) });
  }
  if (action === 'next') {
    if (!isHost && !(g.kind === 'episode' && uid === g.data.teller)) return json({ error: 'Only the host can start the next round' }, 403);
    if (g.phase !== 'reveal') return json({ error: 'Finish this round first' }, 409);
    const rounds = g.kind === 'episode' ? g.players.length : roundsOf(g);
    if (g.kind === 'mafia' || (rounds && g.round >= rounds && !body.more)) { await finish(store, room, g, ctx); }
    else await beginRound(store, room, g);
    await save(store, room, g);
    return json({ game: gameView(g, uid) });
  }
  if (action !== 'move') return json({ error: 'Not found' }, 404);
  if (!inGame) return json({ error: 'You’re not in this game — join the next one' }, 403);

  // ---- moves ----
  const ids = g.players.map(p => p.uid);
  const done = async step => (Object.keys(await moves(store, room, g, step)).length);
  const respond = async (extra = {}) => json({ ok: true, ...extra, game: gameView((await store.get(`gs/${room}`)) || g, uid) });
  switch (g.kind) {
    case 'imposter': {
      if (g.phase === 'clue') {
        const text = clean(body.text, 24).split(/\s+/).slice(0, 2).join(' ');
        if (!text) return json({ error: 'Type a one-word clue' }, 400);
        await setMove(store, room, g, 'clue', uid, { text });
        if (await done('clue') >= ids.length) await advance(store, room, g, ctx); else await save(store, room, g);
        return respond();
      }
      if (g.phase === 'vote') {
        if (!ids.includes(body.target) || body.target === uid) return json({ error: 'Vote for another player' }, 400);
        await setMove(store, room, g, 'vote', uid, { target: body.target });
        if (await done('vote') >= ids.length) await advance(store, room, g, ctx); else await save(store, room, g);
        return respond();
      }
      if (g.phase === 'guess') {
        if (uid !== g.secret.imposter) return json({ error: 'Only the imposter guesses now' }, 403);
        await setMove(store, room, g, 'guess', uid, { text: clean(body.text, 40) });
        await advance(store, room, g, ctx); return respond();
      }
      break;
    }
    case 'mafia': {
      const role = g.secret.roles[uid], alive = g.data.alive;
      if (!alive.includes(uid)) return json({ error: 'You’re out — watch how it ends!' }, 403);
      if (['mafia', 'doctor', 'detective'].includes(g.phase)) {
        if (role !== g.phase) return json({ error: 'Shh — it’s night. Keep your eyes closed.' }, 403);
        if (!alive.includes(body.target)) return json({ error: 'Pick someone still in the game' }, 400);
        if (role === 'mafia' && g.secret.roles[body.target] === 'mafia') return json({ error: 'That’s your teammate' }, 400);
        if (role === 'detective' && body.target === uid) return json({ error: 'Check someone else' }, 400);
        await setMove(store, room, g, g.phase, uid, { target: body.target });
        const m = await moves(store, room, g, g.phase);
        if (alive.filter(u => g.secret.roles[u] === role).every(u => m[u])) await advance(store, room, g, ctx); else await save(store, room, g);
        return respond();
      }
      if (g.phase === 'day') {
        if (body.target !== 'skip' && !alive.includes(body.target)) return json({ error: 'Pick someone still in the game (or skip)' }, 400);
        await setMove(store, room, g, 'day', uid, { target: body.target });
        const m = await moves(store, room, g, 'day');
        if (alive.every(u => m[u])) await advance(store, room, g, ctx); else await save(store, room, g);
        return respond();
      }
      break;
    }
    case 'episode': {
      const teller = g.data.teller;
      if (g.phase === 'pick') {
        if (uid !== teller) return json({ error: `It’s ${nameOf(g, teller)}’s turn to pick` }, 403);
        let vid = null, title = '', dur = 0, ep = null;
        if (body.url) { vid = youtubeId(body.url); if (!vid) return json({ error: 'That isn’t a YouTube link' }, 400); }
        else {
          if (!ctx.youtubeKey) return json({ error: 'Episode search isn’t set up yet — paste a YouTube link for the episode instead', code: 'no_search' }, 400);
          ep = body.random ? 1 + crypto.randomInt(g.maxEp || 4000) : Math.round(Number(body.episode));
          if (!(ep >= 1 && ep <= 20000)) return json({ error: 'Pick an episode number' }, 400);
          let found = null;
          try { found = await findEpisode(ctx.youtubeKey, g.series, ep, { regions: Object.values(g.cc || {}), exclude: g.badClips || [] }); }
          catch (e) { return json({ error: `YouTube search isn’t working right now (${e.message}) — paste a YouTube link instead`, code: 'no_search' }, 502); }
          if (!found) return json({ error: `Couldn’t find a playable episode ${ep} on YouTube here — try another number or tap Random`, code: 'not_found' }, 404);
          ({ id: vid, title, dur } = found);
        }
        const len = 15 + crypto.randomInt(6);                       // 15–20 seconds
        const start = dur > 120 ? 30 + crypto.randomInt(Math.max(1, dur - 90)) : Math.max(0, Math.round(Number(body.start) || 0));
        g.data.clip = { id: vid, start, dur: len }; g.data.episode = ep; g.data.notice = null; g.data.retries = 0;
        g.secret.videoTitle = title || (ep ? `Episode ${ep}` : '');
        g.phase = 'watch'; g.deadline = now() + (len + 6) * 1000;
        await save(store, room, g); return respond();
      }
      // A player's YouTube player said the clip can't play (blocked in their country, removed, not embeddable):
      // try another upload of the same episode, otherwise send the teller back to pick another one.
      if ((g.phase === 'watch' || g.phase === 'tell') && body.clipFailed) {
        const bad = g.data.clip?.id;
        if (!bad || body.clipId !== bad) return respond();          // already handled
        g.badClips = [...new Set([...(g.badClips || []), bad])].slice(-50);
        let found = null;
        if (g.data.episode && ctx.youtubeKey && (g.data.retries || 0) < 3) {
          try { found = await findEpisode(ctx.youtubeKey, g.series, g.data.episode, { regions: Object.values(g.cc || {}), exclude: g.badClips }); } catch {}
        }
        if (found) {
          const len = g.data.clip.dur;
          g.data.clip = { id: found.id, start: found.dur > 120 ? 30 + crypto.randomInt(Math.max(1, found.dur - 90)) : 0, dur: len };
          g.data.retries = (g.data.retries || 0) + 1; g.secret.videoTitle = found.title;
          g.phase = 'watch'; g.deadline = now() + (len + 6) * 1000;
        } else {
          g.data.notice = `${g.data.episode ? `Episode ${g.data.episode}` : 'That video'} can’t play here — pick another one`;
          g.data.clip = null; g.data.episode = null; g.phase = 'pick'; g.deadline = now() + T.pick;
        }
        await save(store, room, g); return respond();
      }
      if (g.phase === 'tell') {               // the teller finished telling the story (they talk on the walkie-talkie; typing is optional)
        if (uid !== teller) return json({ error: `${nameOf(g, teller)} is telling the story` }, 403);
        if (body.text) g.data.told = clean(body.text, 400);
        if (body.done) { g.phase = 'judge'; g.deadline = now() + T.judge; }
        await save(store, room, g); return respond();
      }
      if (g.phase === 'judge') {
        if (uid === teller) return json({ error: 'The others decide if you got it right' }, 400);
        if (!['yes', 'no'].includes(body.verdict)) return json({ error: 'Vote ✓ or ✗' }, 400);
        await setMove(store, room, g, 'judge', uid, { verdict: body.verdict });
        if (await done('judge') >= ids.length - 1) await advance(store, room, g, ctx); else await save(store, room, g);
        return respond();
      }
      break;
    }
    case 'emoji': {
      if (g.phase !== 'guess') return json({ error: 'Wait for the next puzzle' }, 409);
      const t = norm(body.text);
      if (!t) return json({ error: 'Type a guess' }, 400);
      const m = await moves(store, room, g, 'solved');
      if (m[uid]) return json({ ok: true, correct: true, already: true });
      const ok = [g.secret.answer, ...g.secret.alts].some(a => norm(a) === t || (norm(a).replace(/^the /, '') === t.replace(/^the /, '')));
      if (!ok) return json({ ok: true, correct: false, ...guessHint(t, [g.secret.answer, ...g.secret.alts]) });
      await setMove(store, room, g, 'solved', uid, {});
      const place = Object.keys(m).length;            // 0-based order
      addPts(g, uid, Math.max(1, 3 - place));
      (g.data.solved ||= []).push(uid);
      if (g.data.solved.length >= ids.length) await advance(store, room, g, ctx); else await save(store, room, g);
      return respond({ correct: true });
    }
    case 'wyr': {
      if (g.phase !== 'pick' || !['a', 'b'].includes(body.choice)) return json({ error: 'Pick A or B' }, 400);
      await setMove(store, room, g, 'pick', uid, { choice: body.choice });
      if (await done('pick') >= ids.length) await advance(store, room, g, ctx); else await save(store, room, g);
      return respond();
    }
    case 'ttt': {
      if (g.phase !== 'play') return json({ error: 'Round over — the host can start another' }, 409);
      if (g.data.turn !== uid) return json({ error: 'Not your turn' }, 409);
      const i = Number(body.i);
      if (!(i >= 0 && i < 9) || g.data.board[i]) return json({ error: 'Pick an empty square' }, 400);
      const mark = uid === g.data.x ? 'X' : 'O';
      g.data.board[i] = mark;
      const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
      const line = L.find(l => l.every(k => g.data.board[k] === mark));
      if (line) { g.data.line = line; g.data.winner = uid; addPts(g, uid, 1); reveal(g); }
      else if (g.data.board.every(Boolean)) { g.data.draw = true; reveal(g); }
      else g.data.turn = uid === g.data.x ? g.data.o : g.data.x;
      await save(store, room, g); return respond();
    }
    case 'rps': {
      if (g.phase !== 'throw' || !['rock', 'paper', 'scissors'].includes(body.hand)) return json({ error: 'Pick rock, paper or scissors' }, 400);
      await setMove(store, room, g, 'throw' + g.data.throwNo, uid, { hand: body.hand });
      if (await done('throw' + g.data.throwNo) >= 2) await advance(store, room, g, ctx); else await save(store, room, g);
      return respond();
    }
  }
  return json({ error: 'You can’t do that right now' }, 409);
}

export function youtubeId(url) {
  const s = String(url || '').trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(s) ? s : null);
}

// Find "<series> Episode <n>" on YouTube (embeddable videos only). Needs a YouTube Data API key.
const isoSecs = d => { const m = String(d || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
// regions: two-letter country codes of the players; exclude: video ids that already failed to play
export async function findEpisode(key, series, ep, { regions = [], exclude = [] } = {}) {
  regions = [...new Set(regions.filter(r => /^[A-Z]{2}$/.test(r)))];
  const params = { part: 'snippet', type: 'video', videoEmbeddable: 'true', videoSyndicated: 'true', maxResults: '15', q: `${series} Episode ${ep}`, key };
  if (regions.length === 1) params.regionCode = regions[0];          // only videos viewable in that country
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${new URLSearchParams(params)}`);
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error?.message?.replace(/<[^>]+>/g, '').slice(0, 90) || e?.error?.errors?.[0]?.reason || 'error ' + r.status); }
  const items = (await r.json()).items || [];
  const hasNum = t => new RegExp(`(^|[^0-9])${ep}([^0-9]|$)`).test(t);
  const cands = items.filter(i => i.id?.videoId && hasNum(i.snippet?.title || '') && !exclude.includes(i.id.videoId)).slice(0, 10);
  if (!cands.length) return null;
  const v = await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'contentDetails,snippet,status', id: cands.map(c => c.id.videoId).join(','), key })}`);
  const details = new Map((v.ok ? ((await v.json()).items || []) : []).map(it => [it.id, it]));
  for (const c of cands) {
    const it = details.get(c.id.videoId);
    if (!it) continue;                                                 // removed / private
    if (it.status?.embeddable === false || it.status?.privacyStatus === 'private' || it.status?.uploadStatus === 'rejected') continue;
    const rr = it.contentDetails?.regionRestriction;
    if (rr?.allowed && regions.some(x => !rr.allowed.includes(x))) continue;   // not allowed in a player's country
    if (rr?.blocked && regions.some(x => rr.blocked.includes(x))) continue;    // blocked in a player's country
    if (it.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') continue;   // age-restricted videos don't play embedded
    return { id: it.id, title: it.snippet?.title || c.snippet.title, dur: isoSecs(it.contentDetails?.duration) };
  }
  return null;
}
