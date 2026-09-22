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
// Kept deliberately: this is the harder half to rebuild. Safe as-is, it
// rejects every request while NOTIFY_SECRET is unset.
// ─────────────────────────────────────────────────────────────────────────────
// Scheduler callback: sends the Web Push notification to the user's device.
// Protected by a shared secret supplied by the caller.
import { timingSafeEqual } from 'crypto';
import { kv } from '@vercel/kv';
import webpush from 'web-push';

// Constant-time comparison, so a wrong secret cannot be narrowed by timing the
// response. Lengths are checked first because timingSafeEqual throws on buffers
// of different sizes. Returns false when either side is missing, which is what
// keeps this endpoint closed while NOTIFY_SECRET is unset.
function secretMatches(token, expected) {
  if (!token || !expected) return false;
  const a = Buffer.from(String(token));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,       // e.g. mailto:you@yourapp.com
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

const MESSAGES = {
  kickstart: {
    title: 'Almost there 👀',
    body:  '5 minutes left in your shift. Time to start wrapping up.',
    tag:   'kickstart',
  },
  target: {
    title: 'Time to go! 🎉',
    body:  "You've hit your daily target. Head out — you've earned it.",
    tag:   'target',
  },
  overtime: {
    title: 'You should leave now ⏰',
    body:  "It's been 5 minutes past your target. Close the laptop and go.",
    tag:   'overtime',
    requireInteraction: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, type } = req.body || {};

  // Authenticate via Authorization header — secret never travels in the logged request body
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!secretMatches(token, process.env.NOTIFY_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!userId || !MESSAGES[type]) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // Look up the push subscription from KV
  const subRaw = await kv.get(`sub:${userId}`);
  if (!subRaw) {
    return res.status(404).json({ error: 'No subscription found — user may have unsubscribed' });
  }

  const subscription = typeof subRaw === 'string' ? JSON.parse(subRaw) : subRaw;

  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(MESSAGES[type])
    );
    res.status(200).json({ ok: true, type });
  } catch (err) {
    // 410 Gone = subscription expired / user revoked permission
    if (err.statusCode === 410 || err.statusCode === 404) {
      await kv.del(`sub:${userId}`);
    }
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}
