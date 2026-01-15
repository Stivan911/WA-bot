/**
 * Lightweight sensitive info detection.
 * Goal: prevent bot asking/handling OTP, password, kartu.
 * - Not perfect, but tries to reduce false positives using patterns + (optional) Luhn.
 */

function luhnCheck(numStr) {
  // expects digits only
  let sum = 0;
  let shouldDouble = false;
  for (let i = numStr.length - 1; i >= 0; i--) {
    let digit = numStr.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return false;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function extractDigitRuns(text) {
  // returns digit sequences length>=4 (including separated by space/dash)
  const compact = String(text).replace(/[^\d]/g, ' ');
  const runs = compact.split(/\s+/).filter(Boolean);
  return runs;
}

function looksLikeOtp(text) {
  const t = String(text).toLowerCase();
  const hasKeyword = /(otp|kode|code|verifikasi|verification|login|masuk)/.test(t);
  const digitRuns = extractDigitRuns(text);
  const has6 = digitRuns.some(r => r.length === 6);
  const has4to8 = digitRuns.some(r => r.length >= 4 && r.length <= 8);
  // Typical OTP is 4-8 digits, often 6 digits.
  return (hasKeyword && has4to8) || has6;
}

function looksLikeCardNumber(text) {
  // detect 13-19 digits, luhn pass to reduce false positive
  const t = String(text);
  const candidates = [];

  // candidates: sequences that might have separators
  const raw = t.match(/(?:\d[ -]?){13,23}\d/g);
  if (raw) {
    for (const part of raw) {
      const digits = part.replace(/[^\d]/g, '');
      if (digits.length >= 13 && digits.length <= 19) candidates.push(digits);
    }
  }

  return candidates.some(c => luhnCheck(c));
}

function looksLikePasswordOrPin(text) {
  const t = String(text).toLowerCase();
  // If user says "password: xxxx" or "pin: 1234"
  if (/(password|pass|pin|pwd)\s*[:=]/.test(t)) return true;
  return false;
}

function detectSensitive(text) {
  if (!text) return null;

  if (looksLikeCardNumber(text)) {
    return { type: 'CARD', reason: 'Looks like a card number' };
  }
  if (looksLikeOtp(text)) {
    return { type: 'OTP', reason: 'Looks like an OTP' };
  }
  if (looksLikePasswordOrPin(text)) {
    return { type: 'PASSWORD', reason: 'Looks like password/PIN' };
  }

  return null;
}

function maskSensitive(text) {
  const s = String(text);

  // Mask digit runs >= 4, keep last 2 digits
  return s.replace(/\d{4,}/g, (m) => {
    if (m.length <= 4) return '****';
    const last2 = m.slice(-2);
    return '*'.repeat(m.length - 2) + last2;
  });
}

function buildSensitiveWarning() {
  return `Kak, demi keamanan jangan kirim OTP / password / nomor kartu ya 🙏\nKalau tadi terlanjur terkirim, sebaiknya diabaikan & jangan dipakai lagi.`;
}

module.exports = {
  detectSensitive,
  maskSensitive,
  buildSensitiveWarning,
};
