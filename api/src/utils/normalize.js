function normalizeWaNumber(input) {
  if (!input) return '';
  return String(input).replace(/[^\d]/g, '');
}

module.exports = { normalizeWaNumber };
