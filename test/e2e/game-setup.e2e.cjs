// Starting a chat game: rounds, time per turn, sounds, and Episode Recall's show + episode count.
const { URL, OUT, expect, phone, signup, run } = require('./helpers.cjs');
run(async browser => {
  const A = await phone(browser); await signup(A);
  await A.goto(URL + '/#/g/general'); await A.waitForTimeout(1200);
  await A.evaluate(() => openGamePicker()); await A.waitForSelector('#gamePicker .game-card');
  await A.click('#gamePicker .game-card:has-text("Emoji Guess")'); await A.waitForSelector('.gs-row');
  const setup = await A.textContent('#gamePicker .sheet-inner');
  expect(setup.includes('Rounds') && setup.includes('Time per puzzle') && setup.includes('Sounds'), 'emoji setup: rounds, time and sounds');
  for (let k = 0; k < 3; k++) await A.click('.gs-row:has-text("Rounds") .gs-step >> nth=1');
  await A.click('.gs-chips .chip-btn:has-text("20 s")');
  await A.click('#gamePicker .btn:has-text("Start game")'); await A.waitForSelector('#gameSheet[open]'); await A.waitForTimeout(400);
  expect((await A.textContent('#gameSheet .sheet-inner')).includes('8 rounds · time per puzzle: 20 s'), 'lobby shows the chosen settings');
  await A.click('#gameSheet .btn:has-text("Start game")'); await A.waitForTimeout(700);
  expect((await A.textContent('.g-round')).includes('1 / 8') && (await A.textContent('.g-timer')).includes('20'), 'game runs with 8 rounds and a 20 s timer');
  await A.evaluate(() => gameApi('end')); await A.waitForTimeout(300); await A.evaluate(() => gameApi('end').catch(() => {}));
  // Episode Recall: show name + episode count
  await A.evaluate(() => openGamePicker()); await A.click('#gamePicker .game-card:has-text("Episode Recall")'); await A.waitForSelector('#gamePicker input[type=number]');
  expect((await A.inputValue('#gamePicker input[type=number]')) === '4000', 'episode count defaults to 4000 for TMKOC');
  await A.fill('#gamePicker .field input:not([type])', 'Panchayat');
  expect((await A.inputValue('#gamePicker input[type=number]')) === '', 'typing another show clears the count');
  await A.click('#gamePicker .btn:has-text("Start game")'); await A.waitForTimeout(500);
  expect(await A.locator('#gamePicker[open]').count() === 1, "can't start without the episode count");
  await A.fill('#gamePicker input[type=number]', '40'); await A.screenshot({ path: OUT + '/episode-setup.png' });
  await A.click('#gamePicker .btn:has-text("Start game")');
  const started = await A.waitForFunction(() => game?.kind === 'episode' && game.phase === 'lobby', null, { timeout: 8000 }).then(() => true, () => false);
  expect(started, 'Episode Recall started');
  await A.evaluate(() => gameApi('end')); await A.waitForTimeout(300); await A.evaluate(() => gameApi('end').catch(() => {}));
  // RPS: first-to setting; Back returns to the list
  await A.evaluate(() => openGamePicker()); await A.click('#gamePicker .game-card:has-text("Rock Paper")'); await A.waitForSelector('.gs-row');
  expect((await A.textContent('#gamePicker .sheet-inner')).includes('First to win'), 'rps setup: first to N wins');
  await A.click('.gs-back'); await A.waitForSelector('#gamePicker .game-card');
  expect(true, 'back to the games list');
});
