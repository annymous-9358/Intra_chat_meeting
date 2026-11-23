// Runs every minute: delivers scheduled messages and "remind me" notifications that are due,
// and syncs Google Health steps for connected accounts (each at most every 30 minutes).
import { getStore } from '@netlify/blobs';
import { runScheduler, blobsAdapter } from '../../lib/chat.mjs';

export default async () => {
  const store = blobsAdapter(getStore({ name: 'intra-chat', consistency: 'strong' }));
  const sent = await runScheduler(store, {
    vapidEnv: { publicKey: Netlify.env.get('VAPID_PUBLIC_KEY'), privateKey: Netlify.env.get('VAPID_PRIVATE_KEY'), subject: Netlify.env.get('VAPID_SUBJECT') },
    origin: Netlify.env.get('VAPID_SUBJECT') || '',
    health: { clientId: Netlify.env.get('GOOGLE_HEALTH_CLIENT_ID'), clientSecret: Netlify.env.get('GOOGLE_HEALTH_CLIENT_SECRET') },
  });
  return new Response(`delivered ${sent}`);
};

export const config = { schedule: '* * * * *' };
