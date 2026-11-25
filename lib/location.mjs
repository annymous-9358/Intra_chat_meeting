// Location groups: a group can have a geofence; members inside the radius can chat, others wait for the admin.
import { isAdminOf } from './groups.mjs';

// ---------- Location groups ----------
// A group (room) can have a geofence: the admin sets a centre and a radius. Members inside the radius can chat;
// members outside stay in the group read-only until the admin approves their request.
export const MIN_RADIUS = 50, MAX_RADIUS = 50_000;
export const ACCURACY_SLACK = 150;    // GPS accuracy (m) we forgive when deciding "inside"
export function cleanLoc(l) {
  if (!l || typeof l !== 'object') return null;
  const lat = Number(l.lat), lng = Number(l.lng), acc = Number(l.acc);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, acc: Number.isFinite(acc) ? Math.min(Math.max(acc, 0), 100_000) : 0 };
}
export function distanceM(a, b) {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Work out (and persist when it changes) a member's standing in a location group
export async function memberState(store, group, room, user, dev, loc, now) {
  const isAdmin = isAdminOf(group, user, dev);
  const key = user && `gm/${room}/${user.uid}`;
  let old = (key && await store.get(key)) || null;
  if (!old && key && dev) {                // carry over a pre-accounts record kept per device
    old = await store.get(`gm/${room}/${dev}`);
    if (old) await store.del(`gm/${room}/${dev}`);
  }
  let inside = null, dist = null;
  if (loc) {
    dist = Math.round(distanceM(group.center, loc));
    inside = dist <= group.radius + Math.min(loc.acc || 0, ACCURACY_SLACK);
  }
  const rec = { uid: user?.uid, name: user?.name, inside: inside ?? old?.inside ?? null, dist: dist ?? old?.dist ?? null, acc: loc ? Math.round(loc.acc) : old?.acc ?? null,
    approved: !!old?.approved, req: old?.req || null, reqAt: old?.reqAt || 0, note: old?.note || '', at: loc ? now : old?.at || 0, seenAt: old?.seenAt || 0 };
  let changed = false;
  if (key && (!old || old.uid !== rec.uid || old.inside !== rec.inside || old.name !== rec.name || now - (old.seenAt || 0) > 60_000 || (loc && Math.abs((old.dist ?? 0) - rec.dist) > 100))) {
    rec.seenAt = now;
    changed = !old || old.inside !== rec.inside;
    await store.set(key, rec);
  }
  const fresh = loc != null;
  // A fresh fix inside the range, or (when the phone can't get a fix right now) inside within the last 10 minutes
  const recentInside = rec.inside === true && now - (rec.at || 0) < 10 * 60_000;
  const canChat = isAdmin || rec.approved || (fresh ? rec.inside === true : recentInside);
  return { isAdmin, changed, rec, canChat, fresh };
}
