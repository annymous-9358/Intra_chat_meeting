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
  await K.evaluate(() => { window.__up = []; const orig = upload; upload = (f, ...rest) => { __up.push({ type: f.type, size: f.size }); return orig(f, ...rest); }; });
  await K.evaluate(() => { window.__long = 0; try { new PerformanceObserver(l => { window.__long += l.getEntries().length; }).observe({ type: 'longtask' }); } catch {} });
  const box = await K.locator('.fun-pad canvas.prev').boundingBox();
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
  const live = (await K.evaluate(() => __up)).filter(u => u.type === 'image/webp');
  expect(live.length >= 1 && live.every(u => u.size < 150_000), `live wallpaper frames are small WebP (${live.map(u => Math.round(u.size / 1024) + ' KB').join(', ')})`);
  expect(await K.evaluate(() => window.__long) <= 3, `drawing stays smooth (${await K.evaluate(() => window.__long)} long tasks while drawing)`);
  expect(sends.filter(s => s.live && !s.final).length >= 1 && sends.every(s => /^\/api\/file\/[a-f0-9]{24}$/.test(s.url) && s.target === 'lock'), `wallpaper frames went out while drawing (${sends.length})`);
  const inkCount = () => K.evaluate(() => { const c = document.querySelector('.fun-pad canvas.ink'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 60) n++; return n; });
  const inked = await inkCount();
  await K.click('.fun-row .btn:has-text("Undo")'); await K.click('.fun-row .btn:has-text("Clear")');
  const empty = await inkCount();
  expect(inked > 20 && empty === 0, `undo and clear work (ink: ${inked} → ${empty})`);
  await B.waitForTimeout(1200);
  expect(await lit(B) < 5, 'Bob’s view clears too');
  await tool('Pen'); await line(0.3, 0.4, 0.7, 0.45);
  await K.click('.fun-pad .btn.primary');
  // Done freezes the pad straight away: a stroke drawn while it's sending doesn't happen (so nothing is lost)
  const before = await inkCount(); await line(0.1, 0.8, 0.9, 0.85).catch(() => {}); const after = await inkCount().catch(() => before);
  expect(after === before, 'after Done the pad is frozen — the final picture is exactly what was on screen');
  await K.waitForTimeout(1500);
  const final = sends.find(s => s.final);
  expect(!!final && final.kind === 'doodle' && !(await K.locator('.fun-pad').count()), 'Done sends the final doodle and closes the pad');
  await B.waitForSelector('.fun-watch-foot .btn', { timeout: 10000 });
  expect((await B.textContent('.fun-watch-title')).includes('Kunik drew on your lock screen'), 'Bob’s viewer says it’s finished');
  await B.click('.fun-watch-foot .btn'); await B.waitForTimeout(150); const early = await lit(B); await B.waitForTimeout(2500); const late = await lit(B);
  expect(late > early, `"Watch again" replays the drawing (${early} → ${late})`);
  // Camera: a snapped photo goes straight to Bob (no editor in between)
  const jpg = require('node:path').join(OUT, 'snap.jpg');
  require('node:fs').writeFileSync(jpg, Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'));
  sends.length = 0;
  await K.evaluate(() => openFun()); await K.waitForSelector('#funSheet .fun-btns .btn:has-text("Camera")');
  const [fc] = await Promise.all([K.waitForEvent('filechooser'), K.click('#funSheet .btn:has-text("Camera")')]);
  expect(await fc.element().evaluate(i => i.getAttribute('capture')) === 'environment', 'Camera opens the phone camera');
  await fc.setFiles(jpg); await K.waitForTimeout(2000);
  expect(sends.some(s => s.kind === 'photo' && s.final && /^\/api\/file\//.test(s.url)), 'the photo is sent to Bob’s screen right away');
  const photoUrl = sends.find(s => s.kind === 'photo')?.url;
  // Video: uploads as a video and goes out as one
  const mp4 = require('node:path').join(OUT, 'clip.mp4');
  require('node:fs').writeFileSync(mp4, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(3000)]));
  sends.length = 0; const ups = []; K.on('request', async r => { if (r.url().includes('/api/upload')) { const h = await r.allHeaders(); ups.push(h['x-upload-kind'] || ''); } });
  const [fr] = await Promise.all([K.waitForEvent('filechooser'), K.click('#funSheet .btn:has-text("Record")')]);
  expect(await fr.element().evaluate(i => i.getAttribute('capture') === 'environment' && i.accept === 'video/*'), 'Record opens the camera for a video');
  await fr.setFiles([]);
  const [fv] = await Promise.all([K.waitForEvent('filechooser'), K.click('#funSheet .btn:has-text("Gallery")')]);
  expect(await fv.element().evaluate(i => i.accept) === 'image/*,video/*', 'Gallery takes a photo or a video');
  await fv.setFiles(mp4); await K.waitForTimeout(5000);
  expect(ups.includes('video') && sends.some(s => s.kind === 'video' && s.final), 'a video from the gallery uploads as a video and is sent');
  // a fun note opens what was set (notes need a real phone to receive it, so preview the uploads directly)
  const vurl = sends.find(s => s.kind === 'video').url;
  await K.keyboard.press('Escape'); await K.evaluate(u => funPreview(u), vurl);
  expect(await K.waitForSelector('dialog.fun-video-view[open] video', { timeout: 5000 }).then(() => true, () => false), 'a video note previews the video');
  await K.keyboard.press('Escape'); await K.waitForTimeout(200);
  await K.evaluate(u => funPreview(u), photoUrl);
  expect(await K.waitForSelector('#viewer:not(.hidden) img[src*="/api/file/"]', { timeout: 5000 }).then(() => true, () => false), 'a photo note previews the photo');
  // an older Android app that doesn't answer the live-wallpaper question: Fun mode still opens and says to update
  const O = await phone(browser); await signup(O, 'Olde', 'olde'); await O.goto(URL + '/#/g/general'); await O.waitForSelector('#text'); await O.waitForTimeout(800);
  await O.evaluate(() => { window.Capacitor = { isNativePlatform: () => true, nativePromise: (plugin, m) => m === 'liveStatus' ? new Promise(() => {}) : Promise.resolve({}) }; });
  await O.evaluate(() => openFun());
  const opened = await O.waitForSelector('#funSheet[open]', { timeout: 6000 }).then(() => true, () => false);
  expect(opened && (await O.textContent('#funSheet .fun-livecard')).includes('Update Intra Chat'), 'with an older app, Fun mode still opens (and suggests updating for the live wallpaper)');
});

