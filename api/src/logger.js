const pino = require('pino');

function createLogger() {
  const isProd = process.env.NODE_ENV === 'production';
  return pino({
    level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.ADMIN_PASS',
        '*.GATEWAY_API_KEY',
      ],
      remove: true,
    },
  });
}

module.exports = { createLogger };
