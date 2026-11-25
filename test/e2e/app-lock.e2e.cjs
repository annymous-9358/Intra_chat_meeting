// App lock (code + fingerprint) and opening hidden chats with fingerprint, using a virtual fingerprint reader.
const { OUT, expect, phone, signup, modal, run } = require('./helpers.cjs');
run(async browser => {
  const A = await phone(browser, { webauthn: true }); await signup(A); await A.waitForTimeout(800);
  expect((await A.evaluate(() => bioStatus())).available, 'fingerprint / face available');
  // hidden chats: PIN, then fingerprint
  await A.evaluate(() => api('privacy/pin', { room: 'general', pin: '2468' }).then(r => { privacyState = r; }));
  await A.evaluate(() => api('privacy/hide', { room: 'general', on: true }).then(r => { privacyState = r; }));
  const p1 = A.evaluate(() => toggleHiddenBio()); await modal(A, '2468'); await p1; await A.waitForTimeout(500);
  expect(await A.evaluate(() => hiddenBioOn()), 'hidden chats: fingerprint turned on (needs the PIN)');
  expect(await A.evaluate(() => { hiddenOpen = false; return unlockHidden(); }) && !(await A.locator('#modal[open]').count()), 'hidden chats open with fingerprint, no PIN asked');
  // app lock
  await A.evaluate(() => openAppLockSettings()); await A.waitForSelector('#appLockSheet .al-row');
  await A.click('#appLockSheet .al-row >> nth=0'); await modal(A, '1357'); await modal(A, '1357'); await modal(A);   // code, confirm, "use fingerprint too"
  await A.waitForTimeout(800);
  const l = await A.evaluate(() => appLock());
  expect(l.on && l.bio && l.after === 0, 'app lock on with fingerprint, locking immediately');
  await A.click('#appLockSheet .chip-btn:has-text("After 1 minute")'); await A.waitForTimeout(200);
  expect(await A.evaluate(() => appLock().after) === 60000, 'auto-lock set to after 1 minute');
  await A.reload(); await A.waitForSelector('#appLock', { timeout: 8000 }); await A.waitForTimeout(300);
  expect(await A.locator('#appLock').isVisible(), 'locked when the app opens');
  await A.screenshot({ path: OUT + '/app-lock.png' });
  await A.fill('#appLock input', '0000'); await A.click('#appLock .btn.primary'); await A.waitForTimeout(400);
  expect((await A.textContent('#appLock .al-msg')) === 'Wrong code', 'wrong code is refused');
  await A.fill('#appLock input', '1357'); await A.click('#appLock .btn.primary'); await A.waitForTimeout(500);
  expect(!(await A.locator('#appLock').count()), 'right code unlocks');
  await A.evaluate(() => showAppLock()); await A.waitForSelector('#appLock');
  await A.click('#appLock .al-bio'); await A.waitForTimeout(800);
  expect(!(await A.locator('#appLock').count()), 'fingerprint unlocks');
  await A.evaluate(() => openAppLockSettings()); await A.waitForSelector('#appLockSheet .al-row');
  await A.click('#appLockSheet .al-row >> nth=0'); await A.waitForTimeout(800);
  expect(await A.evaluate(() => !appLock().on), 'turning app lock off asks for the fingerprint');
});
