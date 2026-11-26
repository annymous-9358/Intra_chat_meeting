# Intra Chat

A quick group chat app. Run it three ways with the same code. **Live: https://app.intrachat.workers.dev** (Cloudflare).

| Mode | Where it runs | Who can reach it |
|------|---------------|------------------|
| **Cloudflare** (main) | Workers + D1 + R2, free tiers | Anyone with the link (groups can have their own password) |
| **LAN** | `node server.js` on one office computer | Anyone on your network |
| **Netlify** (old) | Netlify Functions + Netlify Blobs | Anyone with the link |

## Features
- **Fun mode** (chat menu → Fun mode, 1:1 chats and groups): friends can set your phone’s **lock screen** or **home
  screen** — a photo, or a **doodle that appears live** while they draw: brushes (pen, marker, neon, rainbow, spray,
  eraser) with a size slider, shapes (line, arrow, rectangle, circle, heart, star), colour or photo background. With the chat
  open you watch the strokes animate in as they're drawn, and the chat note replays the doodle. Strictly opt-in, per chat and per screen, off by default; turn it off or put your lock screen back anytime.
  Changing wallpapers needs the Android app (it gets a silent push and sets the picture); anyone can draw and send.
- **App lock** (Settings → App lock): Intra Chat asks for your **fingerprint / face** (or the phone's PIN/pattern on
  Android) or a 4–8 digit **app code** when you open it — immediately, after 1 minute or after 30 minutes away. Checked on the
  device, like WhatsApp; "Forgot code" signs you out. **Hidden chats** can also open with fingerprint / face: each device
  registers a passkey (browser) or an Android Keystore key, and unlocking signs a one-time challenge the server checks.
- **Chat games** (Games in a chat's menu): Imposter, Mafia, Episode Recall, Emoji Guess, Would You Rather, Tic-tac-toe and
  Rock Paper Scissors. Whoever starts a game picks the **number of rounds** (or wins needed in RPS) and the **time for each
  turn** (clue time, time per puzzle, day discussion…); everyone sees the settings in the lobby.
  **Sounds**: a wrong answer or lost round plays the wrong sound, a right answer or point plays the right sound. The starter
  (or challenge creator) picks them: built-in sounds made in the app (Fahh meme style, buzzer, sad trombone, bruh / Crorepati
  jackpot, ding ding, arcade coin, ta-da) or their own uploaded clip. Anyone can mute game sounds with the speaker button.
- **Challenges** (Challenges tab): anyone can create a step challenge with a **banner**, description, **publish / start /
  end dates** and who can join (everyone or one group). Steps activity: a **target per day or per week**, **points for every
  N steps** (e.g. 5 points per 1,000), a **daily step cap** (steps above it don't count), bonus points for hitting the target,
  and a **tie-breaker** (more steps / more target days / joined first). **Daily tasks** — step tasks that complete
  automatically or tick-off tasks — each add points. The challenge page shows My Ranking (steps, rank, points), today's
  target progress, the tasks, how points work, and the **leaderboard** with ▲/▼ rank changes and *Updated at* time.
  **Levels** (Starter → Bronze → Silver → Gold → Platinum → Diamond, as a share of the best possible score) with progress to
  the next level, **streaks**, a **points history** (each day's counted steps, cap, step points, target bonus and tasks, with the
  time each was credited), and a **summary card** for anyone on the leaderboard (rank, points, streak, best day, average).
  **Games** (optional, set by the creator): fun games — **Emoji Guess** (140 movies, shows, songs, food and places in clear
  categories such as Bollywood movie, Indian TV show, Indian web series, English TV series, Hindi song; every answer has three
  different emoji clues that rotate, and puzzles you haven't seen come first — same in the chat game) and **Word Scramble** (as
  many as you can against the clock), **Rock Paper Scissors** and **Tic-tac-toe** vs the computer (single-player versions of the chat games), **Bubble Pop**,
  **Step Dash** (runner), **Tower Stack** — or brain games — **Quick Math**, **Reaction Time**, **Memory Path**. The creator sets
  plays per day, points per score and whether the best play or all plays count. Guesses and RPS rounds are checked on the server
  as you play, tic-tac-toe games are replayed there, brain games are scored there, and arcade scores are checked against the real
  playing time; starting a game uses a play. Results update the leaderboard straight away (Overall / Game switch) and show in the
  points history. The ⓘ buttons explain points and step syncing without crowding the page.
  **Reminders** (bell on each challenge): "starts tomorrow", "2 days left", "you moved up to #N" (top 10) and "you're N steps from
  today's target" (evenings) — each at most once, never more than 2 a day per person, only 8 AM–9 PM local time.
  Leaderboards recalculate every 15 minutes (scheduler) or on Refresh; steps sync every 15 minutes from Google Health and
  the Android app (Health Connect).
- **Hidden chats** (chat ⋮ → Hide chat; list ⋮ → Hidden chats): move chats into a PIN-protected folder (4–8 digits,
  synced across your devices). They vanish from the list, counts and search; their notifications say only "New message";
  the folder re-locks when you leave the app for a minute. Wrong PINs are rate-limited.
- **Privacy mode** (eye button in the chat header, or Settings → Privacy): blurs messages, photos, GIFs, voice waveforms
  and chat previews so people nearby can't read over your shoulder — tap a message to read it for 5 seconds. When you
  switch away, the screen is covered so the recent-apps preview doesn't show your chats.
- **Step challenge** (group ⋮ → Step challenge, or Settings → My steps): a daily goal ring, 7-day chart, streaks and
  8 badges. **Walk mode** counts steps with the phone's motion sensor while the app is open (screen kept on); or add
  today's total from your phone's Health / Google Fit app (web apps can't read those directly). Group admins start a
  **challenge** (daily goal, length, optional **team journey** in km with milestones): live **leaderboard** (today /
  week / challenge), crowns and streak flames, **cheer** a teammate (push notification, once a day), a challenge
  banner in the chat, and a short note in the chat (no notification spam) when someone hits the goal — with confetti.
  In a **1:1 friends chat** it's a **Step duel**: either friend can start or end it, with a head-to-head You vs Them card.
- **Stories**: share a photo (with caption) or a text story (colours + fonts) from the strip at the top of Chats.
  Friends see a ring until they've watched it; tap to step, hold to pause, swipe down to close. Extras: share with
  **all friends or close friends only**, choose **6 / 24 / 48 hours**, add a **poll**, quick **emoji reactions**,
  **replies** arrive as a 1:1 message quoting the story, see **who viewed** (with their reaction and vote), mute someone's
  stories, delete your own. Expired stories and their photos are cleaned up automatically.
- **App styles** (Settings → ✨ App style): 💬 **Classic**, 🫧 **Glass** (frosted Apple-style glass, iOS blue), 🍎 **iOS**
  (iMessage look: blue bubbles, centred chat header, large titles, inset grouped settings), 🎨 **Material** (Android Material You),
  🧱 **Brutal** (neo-brutalism), 🌃 **Neon** (glowing pink & cyan, always dark), 🧸 **Clay** (soft pastel 3D) and ◻️ **Minimal** (black & white).
  Each works in light, dark or system mode, and comes with a matching default wallpaper.
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
- **Owner & admins**: whoever creates a group is its **owner** — always an admin, and nobody can remove them. The owner and admins can
  make more members **admins** (same settings powers). Only the owner can remove an admin; an admin can step down.
  Only the owner can **delete the group** (type its name to confirm) — it's removed for everyone, including messages and files.
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

## Google Health step sync (optional)
Steps can sync automatically from the **Google Health API** (phone steps via Health Connect, Fitbit, Pixel Watch).
1. Google Cloud console → create a project → **APIs & Services → Library** → enable **Google Health API**.
2. **Google Auth Platform**: configure the consent screen (External), add your team under **Audience → Test users**,
   and under **Data Access** add the scope `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`.
3. **Clients → Create client → Web application**, authorized redirect URI: `https://<your-site>/api/health/callback`.
4. In Netlify → Site configuration → Environment variables add `GOOGLE_HEALTH_CLIENT_ID` and `GOOGLE_HEALTH_CLIENT_SECRET`
   (mark the secret as secret), then redeploy. Each person needs the **Google Health** app signed in with the same Google account.
While the Google app is in *Testing*, only test users can connect and each connection lasts 7 days (then tap Reconnect).
For everyone / no weekly reconnect, publish the app and complete Google's verification for the restricted Health scope.
The server syncs connected accounts every 30 minutes (scheduled function) and on "Sync now"; it never lowers a day's count.

## Deploy on Cloudflare (main)
`wrangler.toml` describes it: one Worker (`worker/index.mjs`) serves the web app (public/ is packed in at build time by
`worker/build-assets.mjs`) and the `/api` server; data lives in D1 (`lib/stores/d1.mjs`: a `kv` table of JSON records),
uploaded photos, voice notes and sounds in the R2 bucket `intra-chat-files` (the D1 `files` table is only a fallback); a
Cron Trigger runs the background job every minute. The Worker is pinned next to the database (D1 primary: Hong Kong).

```sh
npm install
export CLOUDFLARE_ACCOUNT_ID=…  CLOUDFLARE_API_TOKEN=…     # token: Workers Scripts + D1 edit
npx wrangler deploy                                          # build + upload
npx wrangler secret put VAPID_PUBLIC_KEY                     # and VAPID_PRIVATE_KEY, VAPID_SUBJECT, GIPHY_API_KEY,
                                                             # YOUTUBE_API_KEY, GOOGLE_HEALTH_CLIENT_ID/SECRET, LIVEKIT_*
npx wrangler dev                                             # run it locally with a local D1
```
Free-plan fit: polls wait up to 25 s and check D1 twice a second; a poll reads only the new messages. Google Health needs
`https://app.intrachat.workers.dev/api/health/callback` as an authorised redirect URI.

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
Requires Node.js 20+.
```bash
npm install                 # once
node server.js
```
It prints addresses like `http://192.168.1.20:3000`; share that with colleagues.
Allow inbound TCP 3000 in the server's firewall
(Windows: `netsh advfirewall firewall add rule name="Intra Chat" dir=in action=allow protocol=TCP localport=3000`).
Data is stored in `data/store.json` and uploads in `data/files/` (set `DATA_DIR` to use another folder).

**Voice messages and location groups need HTTPS** (browsers only allow the microphone and location on secure pages).
On Netlify this just works. On a LAN install over plain `http://192.168…` those two features are unavailable
unless you put the server behind HTTPS (e.g. a reverse proxy with a certificate).

## Stack and layout
Plain JavaScript end to end, no framework and no client build step: the web app is static files, and the server is
one request handler (`handle(req, store, opts)` in `lib/chat.mjs`, standard `Request` → `Response`) that runs unchanged on
Cloudflare Workers, Netlify Functions and Node. Storage is a small key/value interface with one adapter per host.

```
public/                 the web app (PWA): index.html, app.js, app.css, sw.js (offline cache), icons, vendor libs
lib/                    the server, one module per feature
  chat.mjs              router for /api/* + chat core (send, long-poll, rooms, uploads, reactions)
  core.mjs              shared limits and helpers (JSON responses, input cleaning, media sniffing)
  accounts.mjs          users, passwords (scrypt), sessions
  groups.mjs            group access, owner/admins, membership, group settings
  location.mjs          location groups (geofence)
  messages.mjs          posting messages (mentions, replies, push), 1:1 chat helpers
  friends.mjs  stories.mjs  privacy.mjs (hidden chats, fingerprint)  walkie.mjs
  steps.mjs  health.mjs (Google Health)  challenges.mjs  games.mjs  emoji-puzzles.mjs
  push.mjs              web push + Firebase (Android) notifications
  scheduler.mjs         the every-minute background job
  stores/d1.mjs         Cloudflare D1 (+ R2 for files)
  stores/blobs.mjs      Netlify Blobs
  stores/file.mjs       JSON file on disk (LAN server)
worker/                 Cloudflare Worker entry (index.mjs) + build step that packs public/ into it
netlify/functions/      Netlify entry points (api.mjs, scheduler.mjs)
server.js               LAN server (Node http)
mobile/                 Android app (Capacitor) that opens the live site, plus native plugins
                        (step sync, walkie-talkie in the background, fingerprint / face)
netlify-redirect/       the old Netlify address, forwarding to Cloudflare
test/unit/              server tests (Node's test runner, in-memory store)
test/e2e/               browser tests (Playwright, phone-sized Chrome)
```

## Development
```sh
npm install
npm start                    # LAN server on http://localhost:3000
npm run dev                  # the Cloudflare Worker locally (local D1 + R2)
npm test                     # server tests (~360 checks, a few seconds)
npm run test:e2e             # browser tests against a fresh LAN server
E2E_URL=http://localhost:8787 npm run test:e2e    # …or against any running copy (e.g. npm run dev)
npm run deploy               # deploy to Cloudflare
```
The browser tests need Playwright's Chromium once: `npx playwright install chromium`. GitHub Actions runs the server
tests, a Worker build check and the browser tests on every push (`.github/workflows/test.yml`); the Android APK is built by
`.github/workflows/android.yml` when `mobile/` changes. After changing files in `public/`, bump `CACHE` in `public/sw.js`
so installed apps pick up the new version.

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
