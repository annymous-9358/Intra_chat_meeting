# Intra Chat

A quick, zero-dependency chat app for your local / intranet network.
One computer runs the server; everyone else just opens a browser.

## Features
- Real-time messages (Server-Sent Events), no install needed on clients
- Multiple rooms (`#general` by default, create any room by name)
- Online users list, typing indicator, desktop notifications
- Message history saved to `data/messages.json` (last 500 per room)
- Works on phones too, light/dark mode
- No npm packages: only Node.js is required (works on offline networks)

## Run
Requires Node.js 18+.

```bash
node server.js          # or: npm start
PORT=8080 node server.js   # custom port
```

The server prints addresses like `http://192.168.1.20:3000`. Share that
address with colleagues on the same network.

**Firewall:** allow inbound TCP on the port (default 3000) on the server machine.
On Windows: `netsh advfirewall firewall add rule name="Intra Chat" dir=in action=allow protocol=TCP localport=3000`

## Note
There is no login or password. Anyone who can reach the server can join under any name.
Use it only on a trusted internal network.
