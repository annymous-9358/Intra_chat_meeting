// Single-player challenge games: Emoji Guess, Word Scramble, Rock Paper Scissors, Tic-tac-toe.
const { OUT, expect, phone, signup, makeChallenge, playChallengeGame, run } = require('./helpers.cjs');
run(async browser => {
  const A = await phone(browser); await signup(A);
  await A.click('.nav-btn[data-tab=challenges]'); await A.click('#newChallengeBtn'); await A.waitForSelector('#challengeSheet[open]');
  const groups = await A.evaluate(() => [...document.querySelectorAll('#challengeSheet optgroup')].map(g => g.label + ': ' + [...g.children].map(o => o.textContent).join(', ')).join(' | '));
  expect(/Fun games:.*Emoji Guess.*Word Scramble.*Rock Paper Scissors.*Tic-tac-toe/.test(groups) && /Brain games: Quick Math/.test(groups), 'the form lists fun and brain games');
  await A.keyboard.press('Escape'); await A.waitForTimeout(300);
  const quit = async () => { await A.click('.cg-head .icon-btn[aria-label=Quit]'); await A.waitForTimeout(600); };
  // Emoji Guess
  await playChallengeGame(A, await makeChallenge(A, 'emoji'));
  await A.fill('.cg-guess input', 'definitely wrong'); await A.keyboard.press('Enter'); await A.waitForTimeout(600);
  expect((await A.textContent('.cg-fb')).includes('try again') && (await A.textContent('.cg-emoji')).length > 0, 'emoji: a wrong guess says try again');
  await A.click('.cg-btns button:has-text("Skip")'); await A.waitForTimeout(600);
  expect((await A.textContent('.cg-fb')).startsWith('It was:'), 'emoji: skip shows the answer');
  await quit();
  // Word Scramble
  await playChallengeGame(A, await makeChallenge(A, 'scramble'));
  expect((await A.textContent('.cg-letters')).length >= 4, 'scramble: shows the letters');
  await A.screenshot({ path: OUT + '/scramble.png' }); await quit();
  // Rock Paper Scissors: 10 rounds
  await playChallengeGame(A, await makeChallenge(A, 'rps'));
  for (let k = 0; k < 10; k++) { await A.click('.cg-rps-btn >> nth=' + (k % 3)); await A.waitForTimeout(1300); }
  await A.waitForSelector('.cg-result', { timeout: 15000 });
  expect(/of 10/.test(await A.textContent('.cg-result')), 'rps: 10 rounds scored by the server');
  await A.click('.cg-btns button:has-text("Done")'); await A.waitForTimeout(600);
  // Tic-tac-toe: win game 1 with a fork, then fill squares
  await playChallengeGame(A, await makeChallenge(A, 'ttt'));
  for (const c of [0, 8, 6, 3]) { await A.click('.cg-ttt-cell >> nth=' + c); await A.waitForTimeout(450); }
  expect((await A.textContent('.cg-msg')).includes('You win'), 'ttt: winning move recognised');
  for (let k = 0; k < 80 && !(await A.locator('.cg-result').count()); k++) {
    const i = await A.evaluate(() => [...document.querySelectorAll('.cg-ttt-cell')].findIndex(c => !c.textContent));
    if (i >= 0) await A.click('.cg-ttt-cell >> nth=' + i).catch(() => {}); await A.waitForTimeout(450);
  }
  await A.waitForSelector('.cg-result', { timeout: 15000 });
  expect(/1 won/.test(await A.textContent('.cg-result')) || /[1-9] won/.test(await A.textContent('.cg-result')), 'ttt: the server replayed the games and counted the win');
});
