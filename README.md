# Intra Chat

A quick group chat app. Run it in two ways with the same code:

| Mode | Where it runs | Who can reach it |
|------|---------------|------------------|
| **LAN** | `node server.js` on one office computer | Anyone on your network |
| **Netlify** | Netlify Functions + Netlify Blobs | Anyone with the link (groups can have their own password) |

## Features
- **Profiles**: profile photo (shown on messages, chat list, members, friends), *About* text, and a **status**
  (📅 In a meeting, 🍽️ At lunch, 🏖️ On leave… or your own) that clears itself after 1 h / 4 h / today / this week.
  Tap anyone's photo or name to see their profile card and message them or add them as a friend. Admins can set a **group photo**.
- **Beyond WhatsApp**:
  - ⏰ **Scheduled messages**: type a message, then press and hold ➤ (or right-click it) to send it later;
    see and cancel them from ⋮ → Scheduled messages. Delivered by a scheduled function every minute (`netlify/functions/scheduler.mjs`).
  - 🔔 **Remind me** about any message: you get a notification at that time that opens the message.
  - ✏️ **Edit your messages any time** (marked "edited" for everyone).
  - 📌 **Pinned messages** bar (up to 10 per chat; tap to jump, cycles through older pins).
  - 🔍 **Search** a chat's history by words or sender.
  - **@mentions** with suggestions while typing; the mentioned person is highlighted and notified **even if they muted the group**.
  - Formatting: `*bold*` `_italic_` `~strike~` `` `code` ``, plus clickable links.
- **WhatsApp-style interface**: Chats / Friends / Settings tabs (bottom bar on phones, left rail on tablet/desktop),
  chat list with unread counts and filters (All, Unread, Friends, Groups), bubbles with tails, blue read ticks,
  emoji picker, ⋮ menus. Light, dark or system theme, and chat wallpapers (doodles, colours, gradients, or **your own
  photo** with a dim slider) for all chats or per chat — kept on each device.
- **Logo**: `public/logo.svg` (original mark: chat bubble with voice bars and radio waves); app icons in `public/icons`
  are rendered from it.
- **Friends & private 1:1 chats**: find people by @username, send a friend request (they get a notification),
  accept/decline; friends can chat 1:1 with "online / last seen", notifications, voice notes, walkie-talkie and
  reactions. 1:1 chats are visible only to the two people.
- Mobile-first design: chat list → chat on phones, side-by-side on tablets, plus a group-info column on desktop. Light/dark mode.
- **Accounts**: sign up with a username, display name and password; sign in on any device. Your name comes from your
  account (nobody can post as you), and your groups, admin rights, mutes and notifications follow you to every device.
- **Group access**: 💬 **Open** (anyone with the link) · 🔒 **Private** (the group's own password, asked once per account)
  · 📍 **Location** (works within a range, optionally with a password too)
- **Group admin**: the creator is admin and can rename the group, add/change/remove the password, manage a location
  group's range and requests, and **Make admin** — hand the group over to another member.
- **Members list** in Group info for every group: who's in it, who's admin, who's online.
- Invite links (`…/#/g/<group>`): share from the chat header; new people enter their name and go straight in (or get asked for the password)
- Chat list with last-message previews, times, unread dots and an unread count in the tab title; previews of private groups are hidden from people who haven't joined
- Custom popups and toasts everywhere (no browser alert/confirm/prompt), jump-to-latest button with new-message count, per-group drafts, profile (change name / sign out)
- **Push notifications like WhatsApp**: members get notified of new messages even when the app is closed, the phone is
  locked, or they're outside a location group's range. Notifications stack per group ("Floor (3 messages)"), tapping one
  opens that chat, and nothing is shown for the chat you're already looking at. Mute a group for 8 hours, 1 week or always.
- **Installable app** (PWA): "Install" / "Add to Home Screen" gives an app icon, full-screen window and unread badge.
  On iPhone/iPad, notifications only work after adding to the Home Screen (iOS 16.4+).
- **Satellite range map** for location groups (Group info and the New group sheet): satellite or street view, the
  range drawn as a circle, a 📍 centre pin and a blue "You" dot. The admin can drag the pin to move the centre and sees
  the circle resize live while changing the range. Members see the group's centre; members' own positions are never shared.
  Map library: Leaflet 1.9.4 (bundled in `public/vendor/leaflet`, BSD-2 licence). Imagery © Esri / Maxar; streets © OpenStreetMap.
- **📻 Walkie-talkie**: open it from the chat header and **hold to talk** (or hold the Space bar on a computer).
  **Auto-play** (on by default, Settings → Walkie-talkie auto-play): once you've tapped anywhere in the app, people talking in
  the chat you have open play straight away — no “Listen” tap — and keep playing with the screen locked or another app in front.
  Everyone with the walkie-talkie open hears you live (about 1–2 s behind), one person talks at a time, and people
  who aren't listening see "X is talking — Listen". Each transmission is also saved in the chat as a 📻 voice message
  (can be switched off), so others get a notification and can play it later. Turns are limited to 1 minute.
  While it's on, the walkie-talkie plays through one continuous media stream with a lock-screen media notification,
  so on Android Chrome it keeps working with the screen locked or another app open (like music) — as long as the app
  isn't closed. iPhone Safari pauses web pages in the background, so there it works while on screen.
- **Fast voice replies**: notifications for voice/walkie messages have **🎙 Reply** (opens that group's walkie-talkie,
  ready to answer that message) and **▶ Play**; other messages get **↩ Reply**. Long-press the app icon for a
  **📻 Walkie-talkie** shortcut (opens your last group with the walkie-talkie on — drag it to your home screen). Voice
  messages from others have a **Hold to reply** button that records a quoted voice reply right there.
  (Notification buttons and app shortcuts work on Android and desktop; iPhone doesn't support them for web apps.)
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
- `netlify/functions/scheduler.mjs`: runs every minute to deliver scheduled messages and reminders (the LAN server does this itself)
- `server.js`: LAN server

## Location groups: how it works and limits
- Each member's browser shares its position with the server while the group is open (a quick approximate fix first,
  then GPS; if no fix arrives the app says so and offers Try again; being inside within the last 10 minutes counts
  while the phone is between fixes); the server checks the distance
  (allowing up to 150 m of GPS inaccuracy) every time they send. Exact coordinates are not shown to anyone; the admin only
  sees each member's distance and inside/outside status.
- Location can be faked by a determined user (browser dev tools / spoofing apps), so treat this as a convenience
  fence, not a security boundary.
- Approval to chat from outside lasts until the admin revokes it.

## Security notes
- Anyone with the site link can open `#general` and other open groups, and create groups. Use private groups (own password) for anything sensitive.
- Group passwords are stored only as salted scrypt hashes. Joining returns a per-group key kept in that browser; changing the password invalidates old keys. Repeated wrong guesses are slowed down and briefly blocked.
- Account passwords and group passwords are stored only as salted scrypt hashes; sessions are random tokens (only their hash is stored). Repeated wrong sign-in attempts lock that username for a few minutes.
- Groups created before accounts existed belonged to a device; the first account to sign in on that device becomes their admin.
