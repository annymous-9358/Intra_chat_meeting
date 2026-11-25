// Game sounds: every built-in sound renders real audio; the starter's choice (incl. an uploaded clip) is used;
// mute works; a challenge game uses the creator's sounds.
const { URL, OUT, expect, phone, signup, makeChallenge, playChallengeGame, run } = require('./helpers.cjs');
const fs = require('node:fs'), path = require('node:path');
run(async browser => {
  const A = await phone(browser); await signup(A);
  const rendered = await A.evaluate(async () => {
    const out = {};
    for (const name of Object.keys(SFX_SYNTH)) {
      const c = new OfflineAudioContext(1, 44100 * 3, 44100), g = c.createGain(); g.connect(c.destination); SFX_SYNTH[name](c, g, 0.02);
      const buf = (await c.startRendering()).getChannelData(0); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v)); out[name] = peak;
    }
    return out;
  });
  expect(Object.values(rendered).every(p => p > 0.05 && p <= 1.2), 'all built-in sounds produce audio: ' + Object.keys(rendered).join(', '));
  // a tiny WAV to upload
  const wav = path.join(OUT, 'clip.wav'), n = 4000, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i * 0.3)), 44 + i * 2); fs.writeFileSync(wav, b);
  await A.goto(URL + '/#/g/general'); await A.waitForTimeout(1000);
  await A.evaluate(() => { window.__sfx = []; const orig = playSfx; playSfx = (k, c, f) => { __sfx.push(k + ':' + (c || 'default')); return orig(k, c, f); }; });
  await A.evaluate(() => openGamePicker()); await A.click('#gamePicker .game-card:has-text("Emoji Guess")'); await A.waitForSelector('.sfx-pick select');
  await A.selectOption('.sfx-row >> nth=0 >> select', 'trombone');
  const [fc] = await Promise.all([A.waitForEvent('filechooser'), A.selectOption('.sfx-row >> nth=1 >> select', '__up')]);
  await fc.setFiles(wav); await A.waitForTimeout(1500);
  const vals = await A.evaluate(() => [...document.querySelectorAll('.sfx-pick select')].map(s => s.value));
  expect(vals[0] === 'trombone' && /^\/api\/file\/[a-f0-9]{24}$/.test(vals[1]), 'picked a built-in sound and uploaded a clip');
  await A.click('#gamePicker .btn:has-text("Start game")'); await A.waitForSelector('#gameSheet[open]');
  expect(JSON.stringify(await A.evaluate(() => game.cfg.sounds)) === JSON.stringify({ wrong: vals[0], right: vals[1] }) && await A.locator('#gameSheet .sfx-mute').count() === 1, 'the game keeps the chosen sounds; mute button shown');
  await A.click('#gameSheet .btn:has-text("Start game")'); await A.waitForSelector('.g-input[data-gk="eg"]');
  await A.evaluate(() => { __sfx = []; });
  await A.fill('.g-input[data-gk="eg"]', 'zzzz'); await A.keyboard.press('Enter'); await A.waitForTimeout(700);
  expect(await A.evaluate(() => __sfx.includes('wrong:trombone')), 'a wrong guess plays the chosen wrong sound');
  await A.click('#gameSheet .sfx-mute');
  expect(await A.evaluate(() => sfxMuted()), 'mute button mutes game sounds'); await A.click('#gameSheet .sfx-mute');
  await A.evaluate(() => gameApi('end').then(() => gameApi('end')).catch(() => {})); await A.keyboard.press('Escape');
  // challenge game uses the creator's sounds
  await playChallengeGame(A, await makeChallenge(A, 'rps', { ptsPer: 2, sounds: { wrong: 'buzzer', right: 'tada' } }));
  await A.evaluate(() => { __sfx = []; });
  for (let k = 0; k < 10; k++) { await A.click('.cg-rps-btn >> nth=' + (k % 3)); await A.waitForTimeout(1300); }
  await A.waitForSelector('.cg-result', { timeout: 15000 }); await A.waitForTimeout(300);
  const played = await A.evaluate(() => __sfx);
  expect(played.length > 0 && played.every(x => x === 'wrong:buzzer' || x === 'right:tada'), "challenge rounds use the creator's sounds");
});
