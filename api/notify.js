// QStash callback — sends the Web Push notification to the user's device.
// Protected by a shared secret set at schedule time.
import { kv } from '@vercel/kv';
import webpush from 'web-push';

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
  if (!token || token !== process.env.NOTIFY_SECRET) {
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
