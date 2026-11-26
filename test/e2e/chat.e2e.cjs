// Two people chatting live in #general: delivery both ways, and the typing indicator.
const { URL, RUN, expect, phone, signup, run } = require('./helpers.cjs');
run(async browser => {
  const join = async (name, user) => { const p = await phone(browser); await signup(p, name, user); await p.goto(URL + '/#/g/general'); await p.waitForSelector('#text'); await p.waitForTimeout(1500); return p; };
  const A = await join('Alice', 'alice'), B = await join('Bob', 'bob');
  // an open chat with nothing happening must wait, not re-ask nonstop (a room with no messages yet used to loop)
  { let polls = 0; const count = r => { if (r.url().includes('/api/poll')) polls++; }; A.on('request', count);
    await A.waitForTimeout(10000); A.off('request', count);
    expect(polls <= 4, `idle chat (no messages yet on a fresh server): ${polls} new polls in 10 s (one request waits ~25 s)`); }
  for (let i = 0; i < 4; i++) {
    const [S, R] = i % 2 ? [B, A] : [A, B], txt = `hello ${i} ${RUN}`;
    await S.fill('#text', txt); const t0 = Date.now(); await S.click('#sendBtn');
    await R.waitForSelector(`#messages >> text=${txt}`, { timeout: 15000 });
    expect(true, `message ${i + 1} delivered in ${Date.now() - t0} ms`);
    await S.waitForTimeout(2000 + i * 3000);          // let polls sit idle in between
  }
  await A.fill('#text', 'typing…'); await B.waitForTimeout(2500);
  expect(await B.evaluate(() => document.body.innerText.includes('typing')), 'Bob sees that Alice is typing');
});
