import { getStore } from '@netlify/blobs';
import { handle, blobsAdapter } from '../../lib/chat.mjs';

export default async (req, context) => {
  const store = blobsAdapter(getStore({ name: 'intra-chat', consistency: 'strong' }));
  return handle(req, store, {
    giphyKey: Netlify.env.get('GIPHY_API_KEY'),
    vapid: { publicKey: Netlify.env.get('VAPID_PUBLIC_KEY'), privateKey: Netlify.env.get('VAPID_PRIVATE_KEY'), subject: Netlify.env.get('VAPID_SUBJECT') },
    waitUntil: context?.waitUntil?.bind(context),
    health: { clientId: Netlify.env.get('GOOGLE_HEALTH_CLIENT_ID'), clientSecret: Netlify.env.get('GOOGLE_HEALTH_CLIENT_SECRET') },
    youtubeKey: Netlify.env.get('YOUTUBE_API_KEY'),
    livekit: { url: Netlify.env.get('LIVEKIT_URL'), apiKey: Netlify.env.get('LIVEKIT_API_KEY'), apiSecret: Netlify.env.get('LIVEKIT_API_SECRET') },
  });
};

export const config = { path: '/api/*' };
