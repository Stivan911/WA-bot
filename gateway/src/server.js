require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

// Need raw body for signature verification.
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

app.use(morgan('combined'));

const {
  PORT = '9999',
  GATEWAY_API_KEY,
  BOT_BASE_URL = 'http://127.0.0.1:3101',
  WA_GRAPH_VERSION = 'v20.0',
  WA_PHONE_NUMBER_ID,
  WA_ACCESS_TOKEN,
  WA_VERIFY_TOKEN,
  WA_APP_SECRET,
} = process.env;

function requireApiKey(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const xApiKey = req.headers['x-api-key'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';

  const provided = token || xApiKey;
  if (!GATEWAY_API_KEY) {
    return res.status(500).json({ ok: false, error: 'GATEWAY_API_KEY not set' });
  }
  if (provided !== GATEWAY_API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

function verifyHubSignature(req) {
  // Optional verification using WA_APP_SECRET.
  if (!WA_APP_SECRET) return true;

  const signature = req.headers['x-hub-signature-256'];
  if (!signature || typeof signature !== 'string') return false;

  // signature format: sha256=<hash>
  const expected = 'sha256=' + crypto
    .createHmac('sha256', WA_APP_SECRET)
    .update(req.rawBody || Buffer.from(''))
    .digest('hex');

  // Use timing-safe compare
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Webhook verification
app.get('/wa/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
    return res.status(200).send(String(challenge || ''));
  }
  return res.sendStatus(403);
});

// Webhook events
app.post('/wa/webhook', async (req, res) => {
  if (!verifyHubSignature(req)) {
    return res.sendStatus(401);
  }

  // Always acknowledge quickly to stop retries.
  res.sendStatus(200);

  try {
    const body = req.body;

    // Typical structure: entry[].changes[].value.messages[]
    const entries = Array.isArray(body?.entry) ? body.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const ch of changes) {
        const value = ch?.value || {};
        const messages = Array.isArray(value?.messages) ? value.messages : [];

        for (const msg of messages) {
          const message_id = msg?.id;
          const from = msg?.from; // WA ID (phone number)
          const timestamp = msg?.timestamp ? Number(msg.timestamp) : Date.now();

          // Only handle text for now
          let text = '';
          if (msg?.type === 'text' && msg?.text?.body) {
            text = msg.text.body;
          } else {
            // Fallback: stringify minimal info
            text = `[${msg?.type || 'unknown'}]`;
          }

          if (!message_id || !from) continue;

          // Forward to bot
          await axios.post(`${BOT_BASE_URL}/webhook/inbound`, {
            message_id,
            from,
            text,
            timestamp,
          }, {
            timeout: 15_000,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }
  } catch (err) {
    // Don't crash on webhook errors
    // eslint-disable-next-line no-console
    console.error('Webhook processing error:', err?.message || err);
  }
});

// Internal send endpoint: bot -> gateway
app.post('/messages/send', requireApiKey, async (req, res) => {
  try {
    if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
      return res.status(500).json({ ok: false, error: 'WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN not set' });
    }

    const { to, text } = req.body || {};
    if (!to || !text) {
      return res.status(400).json({ ok: false, error: 'Body must include {to, text}' });
    }

    const url = `https://graph.facebook.com/${WA_GRAPH_VERSION}/${WA_PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to: String(to),
      type: 'text',
      text: { body: String(text) },
    };

    const resp = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${WA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });

    return res.json({ ok: true, meta: resp.data });
  } catch (err) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data;
    return res.status(status).json({ ok: false, error: err?.message || 'send failed', data });
  }
});

// Security: bind to localhost by default; expose via Nginx only.
const host = process.env.BIND_HOST || '127.0.0.1';
app.listen(Number(PORT), host, () => {
  // eslint-disable-next-line no-console
  console.log(`wa-gateway listening on http://${host}:${PORT}`);
});
