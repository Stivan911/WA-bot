const path = require('path');
const { z } = require('zod');

function normalizeWaNumber(input) {
  if (!input) return '';
  // Keep digits only. (No +, spaces, dashes)
  return String(input).replace(/[^\d]/g, '');
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

function loadConfig() {
  require('dotenv').config();

  const schema = z.object({
    PORT: z.string().optional(),
    CS_NUMBER: z.string().min(6),
    ADMIN_USER: z.string().min(1),
    ADMIN_PASS: z.string().min(1),
    AUTO_TIMEOUT_HOURS: z.string().optional(),
    DB_PATH: z.string().optional(),
    GATEWAY_BASE_URL: z.string().optional().default('http://127.0.0.1:9999'),
    GATEWAY_API_KEY: z.string().optional().default('change-me'),
    GATEWAY_STUB: z.string().optional(),
    RATE_LIMIT_MIN_MS: z.string().optional(),
  });

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid ENV: ${issues}`);
  }

  const PORT = toInt(parsed.data.PORT, 3000);
  const AUTO_TIMEOUT_HOURS = toInt(parsed.data.AUTO_TIMEOUT_HOURS, 24);

  const CS_NUMBER = normalizeWaNumber(parsed.data.CS_NUMBER);

  const DB_PATH = parsed.data.DB_PATH
    ? parsed.data.DB_PATH
    : path.join(process.cwd(), 'data', 'bot.db');

  const RATE_LIMIT_MIN_MS = toInt(parsed.data.RATE_LIMIT_MIN_MS, 0); // 0 = disabled
  const GATEWAY_STUB = toBool(parsed.data.GATEWAY_STUB, true);

  return {
    PORT,
    CS_NUMBER,
    ADMIN_USER: parsed.data.ADMIN_USER,
    ADMIN_PASS: parsed.data.ADMIN_PASS,
    AUTO_TIMEOUT_HOURS,
    AUTO_TIMEOUT_MS: AUTO_TIMEOUT_HOURS * 60 * 60 * 1000,
    DB_PATH,
    GATEWAY_BASE_URL: parsed.data.GATEWAY_BASE_URL,
    GATEWAY_API_KEY: parsed.data.GATEWAY_API_KEY,
    GATEWAY_STUB,
    RATE_LIMIT_MIN_MS,
  };
}

module.exports = {
  loadConfig,
  normalizeWaNumber,
};
