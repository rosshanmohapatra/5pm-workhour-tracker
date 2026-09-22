// ─────────────────────────────────────────────────────────────────────────────
// NOT CURRENTLY WIRED UP. Nothing in the app calls this endpoint.
//
// Notifications today are client-side: setTimeout + showNotification, which
// only fire while the browser is open. This file is the server half of Web
// Push, the one mechanism that can notify you with the app fully closed.
//
// Still missing before push would work:
//   1. a "push" event listener in sw.js (nothing receives a delivered push)
//   2. a scheduler to call /api/notify at the right time (cron or QStash)
//   3. client code to register a subscription via /api/subscribe
//   4. NOTIFY_SECRET set in the Vercel environment
//
// This half is complete and correctly secured: it verifies the Supabase JWT
// server-side and keys by the verified user id, never one from the body.
// ─────────────────────────────────────────────────────────────────────────────
// Saves a Web Push subscription object to Vercel KV, keyed by the verified user ID.
// The caller must supply a valid Supabase JWT in the Authorization header.
import { kv } from '@vercel/kv';

// Verify the Bearer token against Supabase's /auth/v1/user endpoint.
// Returns the user object on success, or null on failure.
async function getVerifiedUser(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
  });

  if (!res.ok) return null;
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Verify the caller is an authenticated Supabase user
  const user = await getVerifiedUser(req);
  if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });

  const { subscription } = req.body || {};
  if (!subscription?.endpoint) {
    return res.status(400).json({ error: 'Missing subscription' });
  }

  // Key by the verified server-side user ID — never trust userId from the body
  await kv.set(
    `sub:${user.id}`,
    JSON.stringify(subscription),
    { ex: 60 * 60 * 24 * 365 } // 1 year TTL, refreshed on every grant
  );

  res.status(200).json({ ok: true });
}
