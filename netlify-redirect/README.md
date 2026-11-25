# Old Netlify address → Cloudflare

Intra Chat moved to **https://app.intrachat.workers.dev**. This folder is the whole Netlify site now: it forwards
`intra-chat-7ed6e7.netlify.app/*` to the same path on the new address, and `sw.js` replaces the old app's service
worker (clears its offline copy, removes itself, sends open tabs to the new address). No functions, so it uses almost
no Netlify credits and the old database is never written to again.

Deploy (replaces the old app and its functions):

```sh
npx netlify deploy --prod --site 3bda2ca7-5559-455a-a9d9-3b84d36ab47a --dir netlify-redirect
```
