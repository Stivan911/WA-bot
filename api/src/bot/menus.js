function buildMainMenuText() {
  return [
    'Halo kak! Aku bot CS 😊',
    '',
    'Pilih menu ya:',
    '1️⃣ Cek status pesanan',
    '2️⃣ Jam operasional & alamat',
    '3️⃣ Cara komplain',
    '4️⃣ Promo / info produk',
    '5️⃣ Hubungi CS langsung',
    '',
    'Ketik angka 1-5, atau ketik *0* / *menu* buat lihat menu lagi.',
  ].join('\n');
}

function buildShortMenuText() {
  return [
    'Kak, pilih angka menu ya 😊',
    '1-5 (ketik *0/menu* buat lihat daftar lengkap)',
  ].join('\n');
}

const MENUS = [
  {
    id: 1,
    title: 'Cek status pesanan',
    async handler(ctx) {
      // Flow 2 step: ask order number, then respond placeholder.
      await ctx.reply(
        'Siap kak. Kirim *nomor order* kamu ya (contoh: ORD12345 / 12345).'
      );
      ctx.setSelectedMenu(1);
    },
  },
  {
    id: 2,
    title: 'Jam operasional & alamat',
    async handler(ctx) {
      const text = [
        'Jam operasional kami:',
        '🕘 Senin–Jumat: 09.00–18.00',
        '🕘 Sabtu: 09.00–15.00',
        '❌ Minggu/libur nasional: tutup',
        '',
        'Alamat:',
        '📍 Jl. Contoh No. 123, Jakarta (placeholder)',
        '',
        'Kalau mau tanya rute, sebutin area kak ya 😊',
      ].join('\n');
      await ctx.reply(text);
      ctx.clearSelectedMenu();
    },
  },
  {
    id: 3,
    title: 'Cara komplain',
    async handler(ctx) {
      const text = [
        'Maaf ya kak kalau ada kendala 🙏',
        'Biar cepat, kakak bisa kirim format ini:',
        '- Nama:',
        '- Nomor order:',
        '- Keluhan singkat:',
        '- Foto/video (kalau ada):',
        '',
        'Catatan: jangan kirim OTP/password/nomor kartu ya kak 🙏',
      ].join('\n');
      await ctx.reply(text);
      ctx.clearSelectedMenu();
    },
  },
  {
    id: 4,
    title: 'Promo / info produk',
    async handler(ctx) {
      const text = [
        'Untuk promo terbaru, fitur ini masih nyusul ya kak 😄',
        'Nanti bisa kita sambungkan ke katalog / API internal.',
        '',
        'Kalau kakak cari produk tertentu, sebutin kebutuhannya aja 😊',
      ].join('\n');
      await ctx.reply(text);
      ctx.clearSelectedMenu();
    },
  },
  {
    id: 5,
    title: 'Hubungi CS langsung',
    async handler(ctx) {
      // Switch to HUMAN
      ctx.setMode('HUMAN');
      ctx.clearSelectedMenu();
      await ctx.reply('Siap kak, aku sambungkan ke CS ya. Setelah ini kakak bisa chat seperti biasa 😊');
      // Notify CS (optional but useful)
      await ctx.forwardToHuman(`(SYSTEM) User ${ctx.user.wa_number} minta disambungkan ke CS.`);
    },
  },
];

function getMenuById(id) {
  return MENUS.find(m => m.id === id) || null;
}

module.exports = {
  MENUS,
  getMenuById,
  buildMainMenuText,
  buildShortMenuText,
};
