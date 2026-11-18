import { getStore } from '@netlify/blobs';
import { handle, blobsAdapter } from '../../lib/chat.mjs';

export default async (req) => {
  const password = Netlify.env.get('CHAT_PASSWORD');
  if (!password) {
    return Response.json({ error: 'Server not configured: set the CHAT_PASSWORD environment variable in Netlify.' }, { status: 500 });
  }
  const store = blobsAdapter(getStore({ name: 'intra-chat', consistency: 'strong' }));
  return handle(req, store, { password, giphyKey: Netlify.env.get('GIPHY_API_KEY') });
};

export const config = { path: '/api/*' };
