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
// Returns a key that is public by design, so this is harmless either way.
// ─────────────────────────────────────────────────────────────────────────────
// Returns the VAPID public key to the client so it can subscribe to push
export default function handler(req, res) {
  const origin = process.env.APP_ORIGIN || '';
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(500).json({ error: 'VAPID not configured' });
  res.status(200).json({ publicKey: key });
}
