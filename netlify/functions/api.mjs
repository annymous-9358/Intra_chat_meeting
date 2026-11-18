import { getStore } from '@netlify/blobs';
import { handle, blobsAdapter } from '../../lib/chat.mjs';

export default async (req, context) => {
  const store = blobsAdapter(getStore({ name: 'intra-chat', consistency: 'strong' }));
  return handle(req, store, {
    giphyKey: Netlify.env.get('GIPHY_API_KEY'),
    vapid: { publicKey: Netlify.env.get('VAPID_PUBLIC_KEY'), privateKey: Netlify.env.get('VAPID_PRIVATE_KEY'), subject: Netlify.env.get('VAPID_SUBJECT') },
    waitUntil: context?.waitUntil?.bind(context),
  });
};

export const config = { path: '/api/*' };
