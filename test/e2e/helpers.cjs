// Shared bits for the browser tests (Playwright). Each test gets the app's URL as argv[2] and an output folder for
// screenshots as argv[3]; it prints PASS/FAIL lines and a page error or a thrown error counts as a failure.
const { chromium, devices } = require('playwright');

const URL = process.argv[2] || process.env.E2E_URL || 'http://localhost:3000';
const OUT = process.argv[3] || require('node:path').join(__dirname, '.out');
const RUN = Date.now().toString(36).slice(-4);
const expect = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

async function phone(browser, { webauthn = false } = {}) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => expect(false, 'page error: ' + e.message));
  if (webauthn) {          // a virtual fingerprint reader (passkeys)
    const cdp = await ctx.newCDPSession(page); await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  }
  return page;
}
async function signup(page, name = 'Kunik Jain', user = 'k') {
  await page.goto(URL); await page.click('#tabSignup');
  await page.fill('#username', user + RUN); await page.fill('#name', name); await page.fill('#password', 'secret1');
  await page.click('#loginBtn'); await page.waitForSelector('#app:not(.hidden)');
}
// Answer the app's popup (optionally typing into its field)
async function modal(page, value) { await page.waitForSelector('#modal[open]'); if (value !== undefined) await page.fill('#modalInput', value); await page.click('#modalOk'); await page.waitForTimeout(350); }
// A challenge with a single-player game; returns its id
const makeChallenge = (page, kind, extra = {}) => page.evaluate(([k, x]) => api('challenge/create', { room: 'general', title: 'Test ' + k, publishAt: localDay(), start: localDay(), end: localDay(), today: localDay(),
  activity: { per: 'day', target: 8000, every: 1000, points: 5 }, tasks: [], game: { kind: k, perDay: 3, ptsPer: 1, mode: 'best', ...x } }).then(r => r.challenge.id), [kind, extra]);
async function playChallengeGame(page, id) {
  await page.evaluate(i => openChallenge(i), id); await page.waitForSelector('.cg-card button'); await page.click('.cg-card button');
  await page.click('#modalOk'); await page.waitForSelector('.cg-stage'); await page.waitForTimeout(300);
}
function run(fn) {
  (async () => {
    require('node:fs').mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    try { await fn(browser); } catch (e) { expect(false, 'error: ' + String(e.message).split('\n')[0]); } finally { await browser.close(); }
  })();
}
module.exports = { URL, OUT, RUN, expect, phone, signup, modal, makeChallenge, playChallengeGame, run };
