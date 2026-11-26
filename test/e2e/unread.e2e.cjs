// WhatsApp-style unread messages: "N unread messages" divider when opening a chat, the chat opens at the first unread
// message, the down-arrow counts new messages while scrolled up and jumps to them, and replying clears the divider.
const { URL, OUT, RUN, expect, phone, signup, run } = require('./helpers.cjs');
run(async browser => {
  const A = await phone(browser), B = await phone(browser);
  await signup(A, 'Alice', 'alice'); await signup(B, 'Bob', 'bob');
  const send = async (p, txt) => { await p.fill('#text', txt); await p.click('#sendBtn'); await p.waitForSelector(`#messages >> text=${txt}`); };
  const open = async p => { await p.goto(URL + '/#/g/general'); await p.waitForSelector('#text'); await p.waitForTimeout(1500); };
  await open(A); await open(B);
  await send(A, 'hello ' + RUN); await B.waitForSelector('#messages >> text=hello ' + RUN); await B.waitForTimeout(1500);   // Bob has read it
  await B.goto(URL + '/#/'); await B.waitForTimeout(1000);                       // Bob leaves the chat
  for (let i = 1; i <= 30; i++) await send(A, `news ${i} ${RUN}`);
  await open(B);
  const div = B.locator('.unread-divider');
  expect(await div.count() === 1 && /30 unread messages/i.test(await div.textContent()), 'opening the chat: "30 unread messages" divider');
  const where = await B.evaluate(() => { const b = $('messages'), d = document.querySelector('.unread-divider').getBoundingClientRect(), r = b.getBoundingClientRect(); return { top: d.top - r.top, h: r.height, atBottom: b.scrollHeight - b.scrollTop - b.clientHeight < 40 }; });
  expect(where.top >= 0 && where.top < where.h / 2 && !where.atBottom, `the chat opens at the first unread message (divider ${Math.round(where.top)} px from the top), not at the bottom`);
  expect(await B.evaluate(() => document.querySelector('.unread-divider').nextElementSibling?.textContent.includes('news 1 ')), 'the divider sits right above the first unread message');
  await B.screenshot({ path: OUT + '/unread-open.png' });
  // scrolled up: new messages → arrow with a count; tapping it goes to the first new one, again → bottom
  await B.evaluate(() => { const b = $('messages'); b.scrollTop = 0; b.dispatchEvent(new Event('scroll')); });
  for (let i = 1; i <= 3; i++) await send(A, `more ${i} ${RUN}`);
  await B.waitForSelector(`#messages >> text=more 3 ${RUN}`); await B.waitForTimeout(300);
  expect(await B.locator('#toBottom').isVisible() && (await B.textContent('#toBottomCount')) === '3', 'scrolled up: the down-arrow shows 3 new messages');
  await B.click('#toBottom'); await B.waitForTimeout(900);
  const afterJump = await B.evaluate(() => { const b = $('messages'), d = document.querySelector('.unread-divider').getBoundingClientRect(), r = b.getBoundingClientRect(); return d.top - r.top; });
  expect(afterJump >= -5 && afterJump < 120, 'tapping the arrow goes to the new messages');
  await B.click('#toBottom').catch(() => {}); await B.waitForTimeout(900);
  expect(await B.evaluate(() => { const b = $('messages'); return b.scrollHeight - b.scrollTop - b.clientHeight < 60; }), 'tapping again goes to the very bottom');
  // replying clears the divider
  await send(B, 'thanks ' + RUN);
  expect(await B.locator('.unread-divider').count() === 0, 'replying clears the divider');
  // app in the background: messages that arrive are marked
  await B.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await send(A, 'while away 1 ' + RUN); await send(A, 'while away 2 ' + RUN);
  await B.waitForSelector(`#messages >> text=while away 2 ${RUN}`); await B.waitForTimeout(300);
  expect(/2 unread messages/i.test(await B.locator('.unread-divider').textContent().catch(() => '')), 'messages that arrive while the app is in the background are marked "2 unread messages"');
  await B.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await B.screenshot({ path: OUT + '/unread-away.png' });
});
