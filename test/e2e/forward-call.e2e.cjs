// Forward and share messages; the call button and game voice button (calls themselves need LiveKit — see live checks).
const { URL, RUN, expect, phone, signup, run } = require('./helpers.cjs');
run(async browser => {
  const A = await phone(browser), B = await phone(browser);
  await signup(A, 'Kunik', 'kunik'); await signup(B, 'Bob', 'bob');
  await A.evaluate(r => api('group/create', { room: 'team-' + r, title: 'Team', type: 'open' }), RUN);
  await B.goto(URL + `/#/g/team-${RUN}`); await B.waitForSelector('#text'); await B.waitForTimeout(800);
  await A.goto(URL + '/#/g/general'); await A.waitForSelector('#text'); await A.waitForTimeout(1200);
  await A.fill('#text', 'forward me ' + RUN); await A.click('#sendBtn'); await A.waitForSelector(`#messages >> text=forward me ${RUN}`);
  const msg = A.locator('#messages .msg', { hasText: 'forward me ' + RUN }).last();
  await msg.dispatchEvent('contextmenu'); await A.waitForSelector('#msgMenu:not(.hidden)');
  const items = await A.locator('#mmActions button').allTextContents();
  expect(items.includes('Forward') && items.includes('Share'), 'the message menu has Forward and Share');
  await A.click('#mmActions button:has-text("Forward")'); await A.waitForSelector('#fwdSheet[open] .fwd-row');
  await A.fill('#fwdSheet .fwd-search', 'Tea');
  expect((await A.locator('#fwdSheet .fwd-row').allTextContents()).every(t => t.includes('Team')), 'search narrows the chat list');
  await A.click('#fwdSheet .fwd-row:has-text("Team") input'); await A.click('#fwdSheet .btn.primary'); await A.waitForTimeout(1200);
  await B.waitForSelector(`#messages >> text=forward me ${RUN}`, { timeout: 15000 });
  expect(await B.locator('#messages .msg', { hasText: 'forward me ' + RUN }).locator('.fwd-label').count() === 1, 'it arrives in Team marked "Forwarded"');
  // share: in a browser without a share sheet the text is copied
  await A.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await A.evaluate(() => { delete navigator.share; });
  await msg.dispatchEvent('contextmenu'); await A.click('#mmActions button:has-text("Share")'); await A.waitForTimeout(500);
  expect((await A.evaluate(() => navigator.clipboard.readText())).includes('forward me ' + RUN), 'Share copies the message when there’s no share sheet');
  // call button: voice / video choice; this test server has no LiveKit, so it says calls aren't set up
  expect(await A.locator('#callBtn').isVisible(), 'the chat header has a call button');
  await A.click('#callBtn'); await A.waitForSelector('#modal[open]');
  expect((await A.locator('#modalChoices button').allTextContents()).join() === 'Voice call,Video call', 'it offers a voice or a video call');
  await A.click('#modalChoices button:has-text("Video call")'); await A.waitForTimeout(800);
  expect(/Calls aren’t set up/.test(await A.evaluate(() => document.body.innerText)), 'without LiveKit it explains calls aren’t set up');
  // every game has a voice chat button
  await A.evaluate(async () => { await gameApi('start', { kind: 'wyr' }); openGame(); }); await A.waitForSelector('#gameSheet .game-voice');
  expect((await A.getAttribute('#gameSheet .game-voice', 'aria-label')) === 'Join voice chat', 'games have a "Join voice chat" button');
  await A.evaluate(() => gameApi('end').then(() => gameApi('end')).catch(() => {}));      // leave #general free for the other tests
});
