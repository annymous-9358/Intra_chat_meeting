# Intra Chat

A quick group chat app. Run it in two ways with the same code:

| Mode | Where it runs | Who can reach it |
|------|---------------|------------------|
| **LAN** | `node server.js` on one office computer | Anyone on your network |
| **Netlify** | Netlify Functions + Netlify Blobs | Anyone with the link (groups can have their own password) |

## Features
- Mobile-first design: chat list → chat on phones, side-by-side on tablets, plus a group-info column on desktop. Light/dark mode.
- **No app-wide password** — first visit only asks for your name. Each group decides its own access:
  - 💬 **Open**: anyone with the link · 🔒 **Private**: needs the group's own password · 📍 **Location**: works within a range (optionally with a password too)
  - The group creator is its admin and can rename it, add/change/remove the password, and (for location groups) manage the range and requests.
  - Changing a password signs everyone else out of that group until they enter the new one.
- Invite links (`…/#/g/<group>`): share from the chat header; new people enter their name and go straight in (or get asked for the password)
- Chat list with last-message previews, times, unread dots and an unread count in the tab title; previews of private groups are hidden from people who haven't joined
- Custom popups and toasts everywhere (no browser alert/confirm/prompt), jump-to-latest button with new-message count, per-group drafts, profile (change name / sign out)
- **Push notifications like WhatsApp**: members get notified of new messages even when the app is closed, the phone is
  locked, or they're outside a location group's range. Notifications stack per group ("Floor (3 messages)"), tapping one
  opens that chat, and nothing is shown for the chat you're already looking at. Mute a group for 8 hours, 1 week or always.
- **Installable app** (PWA): "Install" / "Add to Home Screen" gives an app icon, full-screen window and unread badge.
  On iPhone/iPad, notifications only work after adding to the Home Screen (iOS 16.4+).
- **Message actions**: press and hold (phone) or right-click / 😊 (desktop) a message for emoji reactions
  (👍 ❤️ 😂 😮 😢 🙏, one per person), Reply, Copy text, Message info (seen/delivered) and Delete for everyone
  (your own messages; group admins can delete any message in their group)
- Group chats, online list, typing indicator
- **Voice messages**: hold the mic to record, slide left to cancel, release to send (max 2 min). Waveform, seek, 1×/1.5×/2× speed.
- **Location groups**: the creator (admin) sets a range around their location (50 m – 50 km).
  Members inside the range can chat. Members outside stay in the group read-only and can **ask to chat**;
  the admin approves or denies from the group info panel (and can revoke later). The admin can change the range or move the centre.
- WhatsApp-style replies: swipe a message on a phone, or hover and click ↩ (or double-click) on desktop
- Seen status: 🕓 sending · ✓ sent · ✓✓ delivered · blue ✓✓ seen, "Seen by …" under your latest message
- GIFs: GIPHY search (needs `GIPHY_API_KEY`) or upload your own GIF / image (max 4 MB)
- History kept (last 300 messages per room; old uploads are deleted with them)

Messages arrive almost instantly via long-polling: each browser keeps one request open, and the server
answers it the moment someone sends a message or starts typing (~0.5–1 s on Netlify, <0.2 s on a LAN).
Your own messages appear immediately.

## Deploy on Netlify
1. Push this repo to GitHub, then in Netlify choose **Add new site → Import an existing project** and pick the repo.
   Build settings come from `netlify.toml` automatically.
2. (Optional) add `GIPHY_API_KEY` for GIF search (see below) and redeploy.
3. Share the site URL. People create open, private or location groups themselves.

Or with the CLI: `npx netlify-cli deploy --prod` (after `netlify login` / `netlify link`).

Netlify Blobs needs no setup; it is enabled automatically for the site.

**Push notifications** need a VAPID key pair in the environment variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
`VAPID_SUBJECT` (your site URL). Generate one with `npx web-push generate-vapid-keys`. If they're missing, the server
creates a pair on first use and stores it in Netlify Blobs.

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
node server.js
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

## Security notes
- Anyone with the site link can open `#general` and other open groups, and create groups. Use private groups (own password) for anything sensitive.
- Group passwords are stored only as salted scrypt hashes. Joining returns a per-group key kept in that browser; changing the password invalidates old keys. Repeated wrong guesses are slowed down and briefly blocked.
- Admin rights belong to the browser that created the group (a random device id). Clearing site data loses them.
