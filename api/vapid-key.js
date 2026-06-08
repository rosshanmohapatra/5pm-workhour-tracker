// Returns the VAPID public key to the client so it can subscribe to push
export default function handler(req, res) {
  const origin = process.env.APP_ORIGIN || '';
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(500).json({ error: 'VAPID not configured' });
  res.status(200).json({ publicKey: key });
}
