// api/session.js -- Vercel KV session sync endpoint
// Handles real-time check-in sync across multiple devices
// Uses Vercel KV (Redis) for shared persistent state

import { kv } from '@vercel/kv';

const SESSION_TTL = 60 * 60 * 24; // 24 hours

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // ── GET: poll for current session state ──────────────────────────────────
    if (req.method === 'GET' && action === 'poll') {
      const session   = await kv.get('tmcbc:session');
      const checkedIn = await kv.hgetall('tmcbc:checkedIn') || {};
      return res.json({ session, checkedIn });
    }

    // ── POST: start a new session ─────────────────────────────────────────────
    if (req.method === 'POST' && action === 'start') {
      const { session } = req.body;
      await kv.set('tmcbc:session', session, { ex: SESSION_TTL });
      await kv.del('tmcbc:checkedIn');
      return res.json({ ok: true });
    }

    // ── POST: record a single check-in ────────────────────────────────────────
    if (req.method === 'POST' && action === 'checkin') {
      const { key, person } = req.body;
      await kv.hset('tmcbc:checkedIn', { [key]: JSON.stringify(person) });
      await kv.expire('tmcbc:checkedIn', SESSION_TTL);
      return res.json({ ok: true });
    }

    // ── DELETE: end session and clear KV ─────────────────────────────────────
    if (req.method === 'DELETE' && action === 'end') {
      await kv.del('tmcbc:session');
      await kv.del('tmcbc:checkedIn');
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Session sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
