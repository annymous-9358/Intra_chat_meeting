# Intra Chat

A quick group chat app. Run it in two ways with the same code:

| Mode | Where it runs | Who can reach it |
|------|---------------|------------------|
| **LAN** | `node server.js` on one office computer | Anyone on your network |
| **Netlify** | Netlify Functions + Netlify Blobs | Anyone on the internet who knows the password |

## Features
- Group chat with multiple rooms (`#general` by default, create any room by name)
- Online users, typing indicator, desktop notifications
- Shared password protection (required on Netlify, optional on LAN)
- History kept (last 300 messages per room)
- Works on phones, light/dark mode

New messages are fetched every ~2.5 s (every 10 s when the tab is in the background).

## Deploy on Netlify
1. Push this repo to GitHub, then in Netlify choose **Add new site → Import an existing project** and pick the repo.
   Build settings come from `netlify.toml` automatically.
2. In **Site configuration → Environment variables**, add `CHAT_PASSWORD` with your chosen password, then redeploy.
3. Share the site URL and the password with your team.

Or with the CLI: `npx netlify-cli deploy --prod` (after `netlify login` / `netlify link`).

Netlify Blobs needs no setup; it is enabled automatically for the site.

**Usage cost:** each open chat tab calls a function about 24 times a minute while visible.
Keep an eye on your Netlify usage if many people keep it open all day.

## Run on your LAN
Requires Node.js 18+.
```bash
npm install                 # once
node server.js              # open; or:
CHAT_PASSWORD=secret node server.js
```
It prints addresses like `http://192.168.1.20:3000`; share that with colleagues.
Allow inbound TCP 3000 in the server's firewall
(Windows: `netsh advfirewall firewall add rule name="Intra Chat" dir=in action=allow protocol=TCP localport=3000`).
Data is stored in `data/store.json`.

## Layout
- `public/index.html`: the whole web UI
- `lib/chat.mjs`: chat API (shared by both modes)
- `netlify/functions/api.mjs`: Netlify Function that serves `/api/*`
- `server.js`: LAN server
