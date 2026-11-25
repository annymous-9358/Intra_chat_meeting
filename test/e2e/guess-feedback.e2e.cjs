// Wrong-guess feedback in Emoji Guess (challenge + chat game), and an empty guess box on every new puzzle.
const { URL, expect, phone, signup, makeChallenge, playChallengeGame, run } = require('./helpers.cjs');
run(async browser => {
  const A = await phone(browser); await signup(A);
  await playChallengeGame(A, await makeChallenge(A, 'emoji', { ptsPer: 5 }));
  await A.fill('.cg-guess input', 'zzzz'); await A.keyboard.press('Enter'); await A.waitForTimeout(600);
  expect((await A.textContent('.cg-fb')).includes('try again') && (await A.inputValue('.cg-guess input')) === '' && await A.evaluate(() => document.querySelector('.cg-guess input').classList.contains('wrong')), 'challenge: wrong guess → message, box cleared, shake');
  await A.click('.cg-head .icon-btn[aria-label=Quit]'); await A.waitForTimeout(600);
  await A.goto(URL + '/#/g/general'); await A.waitForTimeout(1200);
  await A.evaluate(async () => { await gameApi('start', { kind: 'emoji' }); await gameApi('begin'); openGame(); });
  await A.waitForSelector('.g-input[data-gk="eg"]');
  await A.fill('.g-input[data-gk="eg"]', 'zzzz'); await A.keyboard.press('Enter'); await A.waitForTimeout(800);
  expect((await A.textContent('.g-fb')).includes('try again') && (await A.inputValue('.g-input[data-gk="eg"]')) === '', 'chat game: wrong guess → message and box cleared');
  await A.fill('.g-input[data-gk="eg"]', 'half typed'); await A.focus('.g-input[data-gk="eg"]');
  await A.evaluate(() => setGame({ ...game, round: game.round + 1, data: { ...game.data, emoji: '🐠🔍🌊', solved: [] } }));
  await A.waitForTimeout(300);
  expect((await A.inputValue('.g-input[data-gk="eg"]')) === '' && !(await A.locator('.g-fb').count()), 'chat game: next puzzle starts with an empty box and no old message');
});
