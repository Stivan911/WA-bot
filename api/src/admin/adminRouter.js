const path = require('path');
const express = require('express');
const { basicAuth } = require('../middleware/basicAuth');
const { normalizeWaNumber } = require('../utils/normalize');

function createAdminRouter({ db, botService, config, logger }) {
  const router = express.Router();

  router.use(basicAuth({ username: config.ADMIN_USER, password: config.ADMIN_PASS }));

  // Static admin panel (vanilla HTML/JS)
  const publicDir = path.join(__dirname, 'public');
  router.use('/', express.static(publicDir, { maxAge: 0 }));

  // API: list users
  router.get('/api/users', (req, res) => {
    const limit = clampInt(req.query.limit, 1, 500, 200);
    const offset = clampInt(req.query.offset, 0, 1_000_000, 0);
    const data = db.listUsers({ limit, offset });
    res.json({ ok: true, ...data });
  });

  // API: messages for user
  router.get('/api/users/:wa/messages', (req, res) => {
    const wa = normalizeWaNumber(req.params.wa);
    const limit = clampInt(req.query.limit, 1, 200, 20);
    const offset = clampInt(req.query.offset, 0, 1_000_000, 0);
    if (!wa) return res.status(400).json({ ok: false, error: 'invalid_wa' });

    const user = db.getUserByNumber(wa);
    if (!user) return res.json({ ok: true, user: null, messages: [] });

    const messages = db.getMessagesByUser(wa, { limit, offset });
    res.json({ ok: true, user, messages });
  });

  // API: set mode BOT/HUMAN
  router.post('/api/users/:wa/mode', express.json(), async (req, res) => {
    try {
      const wa = normalizeWaNumber(req.params.wa);
      const mode = String(req.body?.mode || '').toUpperCase();
      const notifyUser = !!req.body?.notifyUser;

      if (!wa) return res.status(400).json({ ok: false, error: 'invalid_wa' });
      if (!['BOT', 'HUMAN'].includes(mode)) return res.status(400).json({ ok: false, error: 'invalid_mode' });

      const user = await botService.adminSetMode(wa, mode, { notifyUser });

      res.json({ ok: true, user });
    } catch (err) {
      logger.error({ err }, 'adminSetMode failed');
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  // API: send manual message
  router.post('/api/users/:wa/send', express.json(), async (req, res) => {
    try {
      const wa = normalizeWaNumber(req.params.wa);
      const text = String(req.body?.text || '').trim();

      if (!wa) return res.status(400).json({ ok: false, error: 'invalid_wa' });
      if (!text) return res.status(400).json({ ok: false, error: 'empty_text' });

      await botService.adminSendMessage(wa, text);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'adminSendMessage failed');
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  // Quick helper: show config / (optional)
  router.get('/api/meta', (req, res) => {
    res.json({
      ok: true,
      autoTimeoutHours: config.AUTO_TIMEOUT_HOURS,
      csNumber: config.CS_NUMBER,
    });
  });

  return router;
}

function clampInt(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

module.exports = { createAdminRouter };
