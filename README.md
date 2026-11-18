# Intra Chat

A quick group chat app. Run it in two ways with the same code:

| Mode | Where it runs | Who can reach it |
|------|---------------|------------------|
| **LAN** | `node server.js` on one office computer | Anyone on your network |
| **Netlify** | Netlify Functions + Netlify Blobs | Anyone on the internet who knows the password |

## Features
- Mobile-first design: chat list → chat on phones, side-by-side on tablets, plus a group-info column on desktop. Light/dark mode.
- Group chats (`#general` plus any group you create), online list, typing indicator, desktop notifications
- **Voice messages**: hold the mic to record, slide left to cancel, release to send (max 2 min). Waveform, seek, 1×/1.5×/2× speed.
- **Location groups**: the creator (admin) sets a range around their location (50 m – 50 km).
  Members inside the range can chat. Members outside stay in the group read-only and can **ask to chat**;
  the admin approves or denies from the group info panel (and can revoke later). The admin can change the range or move the centre.
- WhatsApp-style replies: swipe a message on a phone, or hover and click ↩ (or double-click) on desktop
- Seen status: 🕓 sending · ✓ sent · ✓✓ delivered · blue ✓✓ seen, "Seen by …" under your latest message
- GIFs: GIPHY search (needs `GIPHY_API_KEY`) or upload your own GIF / image (max 4 MB)
- Shared password protection (required on Netlify, optional on LAN)
- History kept (last 300 messages per room; old uploads are deleted with them)

Messages arrive almost instantly via long-polling: each browser keeps one request open, and the server
answers it the moment someone sends a message or starts typing (~0.5–1 s on Netlify, <0.2 s on a LAN).
Your own messages appear immediately.

## Deploy on Netlify
1. Push this repo to GitHub, then in Netlify choose **Add new site → Import an existing project** and pick the repo.
   Build settings come from `netlify.toml` automatically.
2. In **Site configuration → Environment variables**, add `CHAT_PASSWORD` with your chosen password, then redeploy.
3. Share the site URL and the password with your team.

Or with the CLI: `npx netlify-cli deploy --prod` (after `netlify login` / `netlify link`).

Netlify Blobs needs no setup; it is enabled automatically for the site.

**GIF search (optional):** create a free API key at https://developers.giphy.com/dashboard/ (choose "API"),
add it as the `GIPHY_API_KEY` environment variable in Netlify, then redeploy. Without it, uploading your own GIFs
still works. On a LAN install, start the server with `GIPHY_API_KEY=... node server.js`.

Uploaded files can be opened by anyone who has their (random, unguessable) link, so they don't need the password.

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
Data is stored in `data/store.json` and uploads in `data/files/`.

**Voice messages and location groups need HTTPS** (browsers only allow the microphone and location on secure pages).
On Netlify this just works. On a LAN install over plain `http://192.168…` those two features are unavailable
unless you put the server behind HTTPS (e.g. a reverse proxy with a certificate).

## Layout
- `public/index.html`, `public/app.css`, `public/app.js`: the web app
- `lib/chat.mjs`: chat API (shared by both modes)
- `netlify/functions/api.mjs`: Netlify Function that serves `/api/*`
- `server.js`: LAN server

## Location groups: how it works and limits
- The admin is the device that created the group (a random id stored in that browser). Clearing site data or switching
  browsers loses admin rights.
- Each member's browser shares its position with the server while the group is open; the server checks the distance
  (allowing up to 150 m of GPS inaccuracy) every time they send. Exact coordinates are not shown to anyone; the admin only
  sees each member's distance and inside/outside status.
- Location can be faked by a determined user (browser dev tools / spoofing apps), so treat this as a convenience
  fence, not a security boundary.
- Approval to chat from outside lasts until the admin revokes it.
