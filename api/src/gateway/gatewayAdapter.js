const axios = require('axios');

/**
 * Adapter integrasi ke WhatsApp API Gateway internal kamu.
 *
 * IMPORTANT:
 * - Ini BUKAN WhatsApp Cloud API.
 * - Detail endpoint gateway belum kamu isi, jadi adapter ini defaultnya STUB (no-op).
 *
 * Kontrak yang dipakai bot service:
 * - sendMessage(to, text)
 * - forwardToHuman(csNumber, originalFromUser, text)
 *
 * Cara pakai:
 * 1) Jalankan dulu dengan env: GATEWAY_STUB=1 (default) supaya service bisa hidup tanpa gateway.
 * 2) Kalau endpoint gateway kamu sudah siap:
 *    - Set GATEWAY_STUB=0
 *    - Implement path/payload di bagian TODO di bawah.
 */
function createGatewayAdapter(config, logger) {
  if (config.GATEWAY_STUB) {
    logger.warn('Gateway adapter running in STUB mode (no real WhatsApp will be sent). Set GATEWAY_STUB=0 to enable real calls.');
    return {
      async sendMessage(to, text) {
        logger.info({ to, textPreview: preview(text) }, '[STUB] sendMessage');
        return { ok: true, stub: true };
      },
      async forwardToHuman(csNumber, originalFromUser, text) {
        logger.info({ csNumber, originalFromUser, textPreview: preview(text) }, '[STUB] forwardToHuman');
        return { ok: true, stub: true };
      },
    };
  }

  const client = axios.create({
    baseURL: config.GATEWAY_BASE_URL,
    timeout: 15_000,
    headers: {
      'Content-Type': 'application/json',
      // TODO: sesuaikan skema auth gateway kamu (Bearer / X-API-Key / dll)
      'Authorization': `Bearer ${config.GATEWAY_API_KEY}`,
    },
  });

  async function sendMessage(to, text) {
    // TODO: isi path + payload sesuai gateway kamu.
    // Contoh (silakan ubah):
    // await client.post('/messages/send', { to, text });
    try {
      await client.post('/messages/send', { to, text });
      logger.info({ to }, 'GATEWAY sendMessage ok');
      return { ok: true };
    } catch (err) {
      logger.error({ err: serializeAxiosError(err), to }, 'GATEWAY sendMessage failed');
      return { ok: false, error: err?.message || 'sendMessage failed' };
    }
  }

  async function forwardToHuman(csNumber, originalFromUser, text) {
    // TODO: isi path + payload sesuai gateway kamu.
    // Skenario umum: kirim pesan ke CS dengan prefix siapa user-nya.
    const forwardedText = `📩 *Forward dari user ${originalFromUser}*\n${text}`;
    try {
      await client.post('/messages/send', { to: csNumber, text: forwardedText });
      logger.info({ csNumber, originalFromUser }, 'GATEWAY forwardToHuman ok');
      return { ok: true };
    } catch (err) {
      logger.error({ err: serializeAxiosError(err), csNumber, originalFromUser }, 'GATEWAY forwardToHuman failed');
      return { ok: false, error: err?.message || 'forwardToHuman failed' };
    }
  }

  function serializeAxiosError(err) {
    return {
      message: err?.message,
      code: err?.code,
      status: err?.response?.status,
      data: err?.response?.data,
    };
  }

  function preview(text) {
    const s = String(text ?? '');
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  }

  return { sendMessage, forwardToHuman };
}

module.exports = { createGatewayAdapter };
