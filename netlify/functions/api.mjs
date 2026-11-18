import { getStore } from '@netlify/blobs';
import { handle, blobsAdapter } from '../../lib/chat.mjs';

export default async (req) => {
  const store = blobsAdapter(getStore({ name: 'intra-chat', consistency: 'strong' }));
  return handle(req, store, { giphyKey: Netlify.env.get('GIPHY_API_KEY') });
};

export const config = { path: '/api/*' };
