const { z } = require('zod');
const { detectSensitive, maskSensitive, buildSensitiveWarning } = require('../utils/sensitive');
const { normalizeWaNumber } = require('../utils/normalize');
const { buildMainMenuText, buildShortMenuText, getMenuById } = require('./menus');

function normalizeTimestamp(input) {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  // If looks like seconds (10 digits-ish), convert to ms
  if (n < 1e12) return n * 1000;
  return n;
}

function sanitizeText(text) {
  return String(text ?? '').trim();
}

function isMenuCommand(lower) {
  return lower === 'menu' || lower === '0';
}

function parseMenuNumber(text) {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function createBotService({ db, gateway, config, logger }) {
  const inboundSchema = z.object({
    message_id: z.string().min(1),
    from: z.string().min(3),
    text: z.string().optional().default(''),
    timestamp: z.union([z.number(), z.string()]).optional().default(() => Date.now()),
  });

  // lightweight in-memory per-user anti-spam (optional)
  const lastProcessedAtByUser = new Map(); // wa_number -> ms

  async function handleInboundEvent(body) {
    const parsed = inboundSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues, body }, 'Invalid inbound payload');
      return { ok: false, error: 'invalid_payload' };
    }

    const messageId = String(parsed.data.message_id);
    const from = normalizeWaNumber(parsed.data.from);
    const textRaw = sanitizeText(parsed.data.text);
    const textLower = textRaw.toLowerCase();
    const timestampMs = normalizeTimestamp(parsed.data.timestamp);

    if (!from) return { ok: false, error: 'invalid_from' };

    // Idempotency (atomic-ish): insert-or-ignore processed_message_ids
    const inserted = db.markMessageProcessed(messageId);
    if (!inserted) {
      logger.info({ messageId }, 'Duplicate message ignored');
      return { ok: true, duplicate: true };
    }
// If message from CS_NUMBER and it's a command: allow closing sessions
    if (from === config.CS_NUMBER) {
      const cmd = parseCsCommand(textRaw);
      if (cmd) {
        const target = normalizeWaNumber(cmd.userNumber);
        if (!target) {
          await safeSendToCs(`Formatnya: #close <nomorUser> ya kak 😊`);
          return { ok: true, duplicate: false, handled: 'cs_command_invalid' };
        }
        db.upsertUser(target, { last_interaction_at: Date.now() });
        db.setUserMode(target, 'BOT');

        await safeSendToCs(`Sip kak, mode BOT untuk user ${target} sudah aktif lagi 😊`);
        // log inbound from CS too (for audit)
        const csUser = db.upsertUser(from, { last_interaction_at: Date.now() });
        db.insertMessage({
          user_id: csUser.id,
          direction: 'IN',
          message_id: messageId,
          from_number: from,
          to_number: null,
          text: textRaw,
          timestamp: timestampMs,
          status: null,
          error: null,
          meta_json: { kind: 'CS_COMMAND', cmd },
        });
        return { ok: true, duplicate: false, handled: 'cs_command' };
      }
      // Non-command from CS: just log and ignore
      const csUser = db.upsertUser(from, { last_interaction_at: Date.now() });
      db.insertMessage({
        user_id: csUser.id,
        direction: 'IN',
        message_id: messageId,
        from_number: from,
        to_number: null,
        text: textRaw,
        timestamp: timestampMs,
        status: null,
        error: null,
        meta_json: { kind: 'CS_NON_COMMAND' },
      });
      return { ok: true, duplicate: false, handled: 'cs_ignored' };
    }

    // Optional rate limiting
    if (config.RATE_LIMIT_MIN_MS > 0) {
      const last = lastProcessedAtByUser.get(from) || 0;
      const now = Date.now();
      if (now - last < config.RATE_LIMIT_MIN_MS) {
        // Still log inbound for audit, but don't spam reply/forward.
        const user = db.upsertUser(from, { last_interaction_at: now });
        db.insertMessage({
          user_id: user.id,
          direction: 'IN',
          message_id: messageId,
          from_number: from,
          to_number: null,
          text: textRaw,
          timestamp: timestampMs,
          status: null,
          error: null,
          meta_json: { kind: 'RATE_LIMITED' },
        });
        logger.warn({ from }, 'Rate limited (ignored for processing)');
        return { ok: true, duplicate: false, handled: 'rate_limited' };
      }
      lastProcessedAtByUser.set(from, now);
    }

    // Load existing user first (to check timeout using previous last_interaction)
    const existing = db.getUserByNumber(from);
    const now = Date.now();

    // Upsert + update last interaction
    let user = db.upsertUser(from, { last_interaction_at: now });

    // Log inbound message
    db.insertMessage({
      user_id: user.id,
      direction: 'IN',
      message_id: messageId,
      from_number: from,
      to_number: null,
      text: textRaw,
      timestamp: timestampMs,
      status: null,
      error: null,
      meta_json: null,
    });

    // Auto-timeout: if previous interaction is too old and user was HUMAN, revert to BOT
    if (existing && existing.mode === 'HUMAN') {
      const gap = now - Number(existing.last_interaction_at || 0);
      if (gap > config.AUTO_TIMEOUT_MS) {
        db.setUserMode(from, 'BOT');
        user = db.getUserByNumber(from);
      }
    }

    // Sensitive detection (security override)
    const sensitive = detectSensitive(textRaw);
    if (sensitive) {
      // Always warn the user (even if they are in HUMAN mode) - security first.
      await sendAndLogMessage(user, from, buildSensitiveWarning(), { kind: 'SENSITIVE_WARNING', sensitive });

      if (user.mode === 'HUMAN') {
        // Forward masked content to CS to reduce risk
        await forwardAndLog(user, config.CS_NUMBER, from, maskSensitive(textRaw), { kind: 'SENSITIVE_MASKED', sensitive });
        return { ok: true, duplicate: false, handled: 'human_forward_sensitive' };
      }

      // BOT mode: after warning, show menu again
      await sendAndLogMessage(user, from, buildMainMenuText(), { kind: 'MENU_AFTER_SENSITIVE' });
      db.setUserSelectedMenu(from, null);
      return { ok: true, duplicate: false, handled: 'bot_sensitive' };
    }

    // HUMAN mode: just forward to CS and stay silent
    if (user.mode === 'HUMAN') {
      await forwardAndLog(user, config.CS_NUMBER, from, textRaw, { kind: 'HUMAN_FORWARD' });
      return { ok: true, duplicate: false, handled: 'human_forward' };
    }

    // BOT mode: state machine
    const handled = await handleBotMessage(user, textRaw, textLower);
    return { ok: true, duplicate: false, handled };
  }

  async function handleBotMessage(user, textRaw, textLower) {
    const wa = user.wa_number;

    // Command: menu / 0
    if (isMenuCommand(textLower)) {
      db.setUserSelectedMenu(wa, null);
      await sendAndLogMessage(user, wa, buildMainMenuText(), { kind: 'MENU' });
      return 'menu';
    }

    // Flow: waiting for order number (selected_menu === 1)
    if (Number(user.selected_menu) === 1) {
      const orderNo = textRaw;
      // Placeholder response
      const reply = [
        `Sip kak, aku coba cek order *${escapeForBold(orderNo)}* ya...`,
        '',
        'Untuk sekarang fitur cek otomatisnya masih disiapin 🙏',
        'Kalau urgent, kakak bisa pilih *5* buat hubungi CS langsung ya 😊',
      ].join('\n');

      await sendAndLogMessage(user, wa, reply, { kind: 'ORDER_PLACEHOLDER', orderNo });
      db.setUserSelectedMenu(wa, null);
      return 'order_placeholder';
    }

    // Menu number
    const menuNo = parseMenuNumber(textRaw);
    if (menuNo !== null) {
      const menu = getMenuById(menuNo);
      if (!menu) {
        await sendAndLogMessage(user, wa, buildShortMenuText(), { kind: 'INVALID_MENU_NUMBER', menuNo });
        return 'invalid_menu';
      }

      const ctx = createHandlerContext(user);

      await menu.handler(ctx);

      // Refresh user after handler state changes
      user = db.getUserByNumber(wa);

      return `menu_${menuNo}`;
    }

    // Fallback
    const fallback = [
      'Aku belum nangkep kak 😅',
      buildShortMenuText(),
      '',
      'Ketik *0/menu* kalau mau lihat menu lengkap ya 😊',
    ].join('\n');

    await sendAndLogMessage(user, wa, fallback, { kind: 'FALLBACK' });
    return 'fallback';
  }

  function createHandlerContext(user) {
    const wa = user.wa_number;

    return {
      user,
      async reply(text) {
        await sendAndLogMessage(user, wa, text, { kind: 'BOT_REPLY' });
      },
      async forwardToHuman(text) {
        await forwardAndLog(user, config.CS_NUMBER, wa, text, { kind: 'BOT_FORWARD' });
      },
      setMode(mode) {
        db.setUserMode(wa, mode);
        this.user = db.getUserByNumber(wa);
      },
      setSelectedMenu(menuId) {
        db.setUserSelectedMenu(wa, menuId);
        this.user = db.getUserByNumber(wa);
      },
      clearSelectedMenu() {
        db.setUserSelectedMenu(wa, null);
        this.user = db.getUserByNumber(wa);
      },
    };
  }

  async function sendAndLogMessage(user, to, text, meta) {
    const res = await gateway.sendMessage(to, text);
    db.insertMessage({
      user_id: user.id,
      direction: 'OUT',
      message_id: null,
      from_number: null,
      to_number: to,
      text,
      timestamp: Date.now(),
      status: res.ok ? 'SENT' : 'FAILED',
      error: res.ok ? null : (res.error || 'send_failed'),
      meta_json: meta || null,
    });
  }

  async function forwardAndLog(user, csNumber, originalFromUser, text, meta) {
    const res = await gateway.forwardToHuman(csNumber, originalFromUser, text);
    db.insertMessage({
      user_id: user.id,
      direction: 'FWD',
      message_id: null,
      from_number: originalFromUser,
      to_number: csNumber,
      text,
      timestamp: Date.now(),
      status: res.ok ? 'SENT' : 'FAILED',
      error: res.ok ? null : (res.error || 'forward_failed'),
      meta_json: meta || null,
    });
  }

  function parseCsCommand(textRaw) {
    const t = String(textRaw).trim();
    // commands: #close <userNumber> OR #boton <userNumber>
    const m = t.match(/^#(close|boton)\s+(.+)$/i);
    if (!m) return null;
    return { cmd: m[1].toLowerCase(), userNumber: m[2].trim() };
  }

  async function safeSendToCs(text) {
    // try-catch ignored; avoid loop if gateway down
    try {
      await gateway.sendMessage(config.CS_NUMBER, text);
    } catch (e) {
      logger.warn({ e }, 'Failed to notify CS');
    }
  }

  function escapeForBold(str) {
    // keep it safe for whatsapp formatting
    return String(str).replace(/\*/g, '').slice(0, 64);
  }

  async function adminSetMode(waNumber, mode, { notifyUser = false } = {}) {
    const wa = normalizeWaNumber(waNumber);
    if (!wa) throw new Error('invalid_wa_number');

    db.upsertUser(wa, { last_interaction_at: Date.now() });

    db.setUserMode(wa, mode);

    const user = db.getUserByNumber(wa);

    if (notifyUser) {
      if (mode === 'BOT') {
        await sendAndLogMessage(user, wa, 'Oke kak, botnya aku aktif lagi ya 😊\nKetik 0/menu buat lihat menu.', { kind: 'ADMIN_NOTIFY_BOT' });
      } else {
        await sendAndLogMessage(user, wa, 'Siap kak, aku sambungkan ke CS ya. Setelah ini kakak bisa chat seperti biasa 😊', { kind: 'ADMIN_NOTIFY_HUMAN' });
        await forwardAndLog(user, config.CS_NUMBER, wa, '(SYSTEM) Admin takeover: user masuk mode HUMAN.', { kind: 'ADMIN_TAKEOVER_NOTIFY' });
      }
    }

    return user;
  }

  async function adminSendMessage(waNumber, text) {
    const wa = normalizeWaNumber(waNumber);
    const clean = sanitizeText(text);
    if (!wa) throw new Error('invalid_wa_number');
    if (!clean) throw new Error('empty_text');

    db.upsertUser(wa, { last_interaction_at: Date.now() });
    const user = db.getUserByNumber(wa);

    await sendAndLogMessage(user, wa, clean, { kind: 'ADMIN_MANUAL' });
    return { ok: true };
  }

  return {
    handleInboundEvent,
    adminSetMode,
    adminSendMessage,
  };
}

module.exports = { createBotService };
