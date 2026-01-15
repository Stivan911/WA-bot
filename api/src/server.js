const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { initDb } = require('./db');
const { createGatewayAdapter } = require('./gateway/gatewayAdapter');
const { createBotService } = require('./bot/botService');
const { createAdminRouter } = require('./admin/adminRouter');

function createApp() {
  // Load env
  require('dotenv').config();
  const config = loadConfig();
  const logger = createLogger();

  const db = initDb(config, logger);
  const gateway = createGatewayAdapter(config, logger);
  const botService = createBotService({ db, gateway, config, logger });

  const app = express();

  app.disable('x-powered-by');

  app.use(helmet());

  app.use(pinoHttp({
    logger,
    customLogLevel(req, res, err) {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }));

  // Health
  app.get('/health', (req, res) => res.json({ ok: true }));

  // Webhook inbound
  app.post('/webhook/inbound', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      const result = await botService.handleInboundEvent(req.body);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err) {
      req.log.error({ err }, 'Unhandled error in inbound');
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  // Admin panel
  app.use('/admin', createAdminRouter({ db, botService, config, logger }));

  // 404
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'not_found' });
  });

  // Background sweep for auto-timeout every 15 minutes
  setInterval(() => {
    try {
      db.sweepAutoTimeout({ timeoutMs: config.AUTO_TIMEOUT_MS });
    } catch (err) {
      logger.error({ err }, 'Auto-timeout sweep failed');
    }
  }, 15 * 60 * 1000).unref();

  return { app, config, logger };
}

if (require.main === module) {
  const { app, config } = createApp();
  app.listen(config.PORT, () => {
    console.log(`wa-bot-brain listening on :${config.PORT}`);
  });
}

module.exports = { createApp };
