const { initDb } = require('../src/db');
const { createBotService } = require('../src/bot/botService');

function makeGatewayMock() {
  return {
    sendMessage: jest.fn(async () => ({ ok: true })),
    forwardToHuman: jest.fn(async () => ({ ok: true })),
  };
}

describe('Idempotency', () => {
  test('duplicate message_id is ignored (no double reply)', async () => {
    const config = {
      DB_PATH: ':memory:',
      CS_NUMBER: '628999000111',
      AUTO_TIMEOUT_MS: 24 * 60 * 60 * 1000,
      AUTO_TIMEOUT_HOURS: 24,
      RATE_LIMIT_MIN_MS: 0,
      GATEWAY_BASE_URL: 'http://example.test',
      GATEWAY_API_KEY: 'x',
      ADMIN_USER: 'u',
      ADMIN_PASS: 'p',
    };

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const db = initDb(config, logger);
    const gateway = makeGatewayMock();
    const bot = createBotService({ db, gateway, config, logger });

    const payload = {
      message_id: 'dup-1',
      from: '628111222333',
      text: 'menu',
      timestamp: Date.now(),
    };

    const r1 = await bot.handleInboundEvent(payload);
    const r2 = await bot.handleInboundEvent(payload);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.duplicate).toBe(true);

    expect(gateway.sendMessage).toHaveBeenCalledTimes(1);
  });
});
