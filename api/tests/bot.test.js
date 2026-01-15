const { initDb } = require('../src/db');
const { createBotService } = require('../src/bot/botService');

function makeGatewayMock() {
  return {
    sendMessage: jest.fn(async () => ({ ok: true })),
    forwardToHuman: jest.fn(async () => ({ ok: true })),
  };
}

function makeConfig() {
  return {
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
}

describe('BOT/HUMAN switching', () => {
  test('menu 5 switches to HUMAN and notifies CS', async () => {
    const config = makeConfig();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const db = initDb(config, logger);
    const gateway = makeGatewayMock();
    const bot = createBotService({ db, gateway, config, logger });

    const from = '628111222333';
    const res = await bot.handleInboundEvent({
      message_id: 'm1',
      from,
      text: '5',
      timestamp: Date.now(),
    });

    expect(res.ok).toBe(true);

    const user = db.getUserByNumber(from);
    expect(user.mode).toBe('HUMAN');

    // Confirmation sent to user
    expect(gateway.sendMessage).toHaveBeenCalledTimes(1);
    expect(gateway.sendMessage.mock.calls[0][0]).toBe(from);

    // Forward system note to CS
    expect(gateway.forwardToHuman).toHaveBeenCalledTimes(1);
    expect(gateway.forwardToHuman.mock.calls[0][0]).toBe(config.CS_NUMBER);
    expect(gateway.forwardToHuman.mock.calls[0][1]).toBe(from);
  });

  test('when HUMAN, user messages are forwarded and bot stays silent', async () => {
    const config = makeConfig();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const db = initDb(config, logger);
    const gateway = makeGatewayMock();
    const bot = createBotService({ db, gateway, config, logger });

    const from = '628111222333';

    // Switch to HUMAN first
    await bot.handleInboundEvent({ message_id: 'm1', from, text: '5', timestamp: Date.now() });

    gateway.sendMessage.mockClear();
    gateway.forwardToHuman.mockClear();

    const res2 = await bot.handleInboundEvent({ message_id: 'm2', from, text: 'halo', timestamp: Date.now() });
    expect(res2.ok).toBe(true);

    expect(gateway.forwardToHuman).toHaveBeenCalledTimes(1);
    expect(gateway.sendMessage).toHaveBeenCalledTimes(0);
  });

  test('auto-timeout returns HUMAN -> BOT on next message', async () => {
    const config = makeConfig();
    config.AUTO_TIMEOUT_MS = 1 * 60 * 60 * 1000; // 1 hour
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const db = initDb(config, logger);
    const gateway = makeGatewayMock();
    const bot = createBotService({ db, gateway, config, logger });

    const from = '628111222333';

    db.upsertUser(from, { last_interaction_at: Date.now() - 10 * 60 * 60 * 1000 }); // old
    db.setUserMode(from, 'HUMAN'); // and human

    gateway.sendMessage.mockClear();
    gateway.forwardToHuman.mockClear();

    const res = await bot.handleInboundEvent({ message_id: 'm3', from, text: 'menu', timestamp: Date.now() });

    expect(res.ok).toBe(true);
    const user = db.getUserByNumber(from);
    expect(user.mode).toBe('BOT');

    // It should reply menu (BOT)
    expect(gateway.sendMessage).toHaveBeenCalledTimes(1);
    expect(gateway.forwardToHuman).toHaveBeenCalledTimes(0);
  });
});
