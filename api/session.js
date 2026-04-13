// api/session.js -- Multi-device check-in sync via Upstash Redis REST API
// No npm packages needed -- uses fetch directly with env vars Vercel injects

const TTL = 86400; // 24 hours

async function redis(method, ...args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(`${url}/${[method, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
}

async function redisPost(body) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // GET: poll current session state
    if (req.method === 'GET' && action === 'poll') {
      const sessionRes = await redis('GET', 'tmcbc:session');
      const session = sessionRes.result ? JSON.parse(sessionRes.result) : null;
      const rawRes = await redis('HGETALL', 'tmcbc:checkedIn');
      const checkedIn = {};
      const pairs = rawRes.result || [];
      for (let i = 0; i < pairs.length; i += 2) {
        try { checkedIn[pairs[i]] = JSON.parse(pairs[i + 1]); } catch(e) { checkedIn[pairs[i]] = pairs[i+1]; }
      }
      return res.json({ session, checkedIn });
    }

    // POST: start new session
    if (req.method === 'POST' && action === 'start') {
      const { session } = req.body;
      await redisPost(['SET', 'tmcbc:session', JSON.stringify(session), 'EX', TTL]);
      await redis('DEL', 'tmcbc:checkedIn');
      return res.json({ ok: true });
    }

    // POST: record a check-in
    if (req.method === 'POST' && action === 'checkin') {
      const { key, person } = req.body;
      await redisPost(['HSET', 'tmcbc:checkedIn', key, JSON.stringify(person)]);
      await redis('EXPIRE', 'tmcbc:checkedIn', TTL);
      return res.json({ ok: true });
    }

    // POST: remove a check-in
    if (req.method === 'POST' && action === 'remove') {
      const { key } = req.body;
      await redisPost(['HDEL', 'tmcbc:checkedIn', key]);
      return res.json({ ok: true });
    }

    // DELETE: end session
    if (req.method === 'DELETE' && action === 'end') {
      await redis('DEL', 'tmcbc:session');
      await redis('DEL', 'tmcbc:checkedIn');
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Session sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
