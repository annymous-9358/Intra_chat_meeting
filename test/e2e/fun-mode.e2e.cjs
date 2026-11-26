// Fun mode: Bob (Android app — simulated here) lets the chat change his lock screen; Kunik doodles live and sends it.
const { URL, OUT, expect, phone, signup, run } = require('./helpers.cjs');
run(async browser => {
  const K = await phone(browser), B = await phone(browser);
  await signup(K, 'Kunik', 'kunik'); await signup(B, 'Bob', 'bob');
  const open = async p => { await p.goto(URL + '/#/g/general'); await p.waitForSelector('#text'); await p.waitForTimeout(1200); };
  await open(K); await open(B);
  // Bob's phone: stand in for the Android app's Fun plugin and record what the app asks it to do
  await B.evaluate(() => { window.__native = []; window.Capacitor = { isNativePlatform: () => true, nativePromise: async (plugin, m, a) => { __native.push([plugin, m, a]); return {}; } }; });
  await B.evaluate(() => openFun()); await B.waitForSelector('#funSheet .al-row');
  expect((await B.textContent('#funSheet')).includes('Lock screen') && await B.locator('#funSheet .al-switch.on').count() === 0, 'Bob sees fun mode off by default');
  await B.click('#funSheet .al-row >> nth=0'); await B.waitForTimeout(800);
  const calls = await B.evaluate(() => __native);
  expect(calls.some(([p, m, a]) => p === 'Fun' && m === 'setAllowed' && a.lock === true && a.home === false && a.baseUrl.startsWith('http')), 'turning on "Lock screen" tells the phone (lock only)');
  await K.waitForSelector('#messages >> text=Bob turned on fun mode', { timeout: 15000 });
  expect(true, 'the chat shows "Bob turned on fun mode"');
  // Kunik doodles
  const sends = []; K.on('request', r => { if (r.url().includes('/api/fun/send')) sends.push(JSON.parse(r.postData())); });
  await K.evaluate(() => openFun()); await K.waitForSelector('#funSheet .fun-people');
  expect((await K.textContent('#funSheet .fun-people')).includes('Bob · lock'), 'Kunik sees he can draw on Bob’s lock screen');
  await K.click('#funSheet .btn:has-text("Doodle live")'); await K.waitForSelector('.fun-pad canvas');
  const box = await K.locator('.fun-pad canvas').boundingBox();
  const line = async (x1, y1, x2, y2) => { await K.mouse.move(box.x + box.width * x1, box.y + box.height * y1); await K.mouse.down(); for (let i = 1; i <= 12; i++) await K.mouse.move(box.x + box.width * (x1 + (x2 - x1) * i / 12), box.y + box.height * (y1 + (y2 - y1) * i / 12)); await K.mouse.up(); };
  const tool = async name => K.click(`.fun-toolrow .fun-tool:has-text("${name}")`).catch(() => K.click(`.fun-toolrow .fun-tool[aria-label="${name}"]`));
  await line(0.2, 0.3, 0.8, 0.3); await K.waitForTimeout(700);
  // Bob has the chat open: the live viewer opens by itself and shows the stroke
  await B.waitForSelector('.fun-watch', { timeout: 10000 });
  expect((await B.textContent('.fun-watch-title')).includes('Kunik is drawing on your lock screen'), 'Bob’s app opens the live viewer: "Kunik is drawing on your lock screen"');
  const lit = p => p.evaluate(() => { const c = document.querySelector('.fun-watch-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 61) if (d[i] + d[i + 1] + d[i + 2] > 240) n++; return n; });
  await B.waitForTimeout(900); const lit1 = await lit(B);
  expect(lit1 > 10, 'the stroke appears on Bob’s screen');
  // brushes, size, shapes
  await K.locator('.fun-row input[type=range]').fill('40');
  await tool('Neon'); await K.click('.fun-sw >> nth=7'); await line(0.2, 0.45, 0.8, 0.5);
  await tool('Rainbow'); await line(0.2, 0.6, 0.8, 0.62);
  await tool('Spray'); await line(0.3, 0.7, 0.6, 0.72);
  await tool('heart'); await K.click('.fun-sw >> nth=9'); await line(0.25, 0.12, 0.45, 0.22);
  await tool('star'); await K.click('.fun-sw >> nth=4'); await line(0.55, 0.12, 0.75, 0.22);
  await K.waitForTimeout(1900);
  await B.waitForTimeout(1200); const lit2 = await lit(B);
  expect(lit2 > lit1 * 2, `Bob sees the new brushes and shapes arrive live (${lit1} → ${lit2} lit samples)`);
  await K.screenshot({ path: OUT + '/fun-pad.png' }); await B.screenshot({ path: OUT + '/fun-watch.png' });
  expect(sends.filter(s => s.live && !s.final).length >= 1 && sends.every(s => /^\/api\/file\/[a-f0-9]{24}$/.test(s.url) && s.target === 'lock'), `wallpaper frames went out while drawing (${sends.length})`);
  await K.click('.fun-row .btn:has-text("Undo")'); await K.click('.fun-row .btn:has-text("Clear")');
  const empty = await K.evaluate(() => { const c = document.querySelector('.fun-pad canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 60) n++; return n; });
  expect(empty === 0, 'undo and clear work');
  await B.waitForTimeout(1200);
  expect(await lit(B) < 5, 'Bob’s view clears too');
  await tool('Pen'); await line(0.3, 0.4, 0.7, 0.45);
  await K.click('.fun-pad .btn.primary'); await K.waitForTimeout(1500);
  const final = sends.find(s => s.final);
  expect(!!final && final.kind === 'doodle' && !(await K.locator('.fun-pad').count()), 'Done sends the final doodle and closes the pad');
  await B.waitForSelector('.fun-watch-foot .btn', { timeout: 10000 });
  expect((await B.textContent('.fun-watch-title')).includes('Kunik drew on your lock screen'), 'Bob’s viewer says it’s finished');
  await B.click('.fun-watch-foot .btn'); await B.waitForTimeout(150); const early = await lit(B); await B.waitForTimeout(2500); const late = await lit(B);
  expect(late > early, `"Watch again" replays the drawing (${early} → ${late})`);
});
