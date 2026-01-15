# wa-bot-brain (Otak Bot CS WhatsApp)

Service backend ini menerima event pesan WhatsApp dari **API gateway internal** kamu (bukan WA Cloud API/BSP), menentukan balasan bot berbasis menu, atau melakukan **takeover ke CS manusia** (mode HUMAN) dengan cara mem-forward chat.

## Fitur utama

- Menu 1..N (contoh 1..5), mudah ditambah (map handler).
- State per user:
  - `mode`: `BOT` / `HUMAN`
  - `selected_menu`: `null` / angka (untuk flow sederhana)
  - `last_interaction_at`
- Saat `HUMAN`: semua pesan user diforward ke nomor CS, bot diam (kecuali warning keamanan).
- Auto-timeout: jika user mode HUMAN tidak aktif X jam, otomatis kembali ke BOT.
- Admin panel HTML sederhana:
  - list user/conversation
  - lihat 20 pesan terakhir
  - takeover/release BOT/HUMAN
  - kirim pesan manual
- Idempotency: message_id yang sama tidak diproses ulang.
- Logging inbound/outbound/forward disimpan di SQLite.

> **Catatan:** Integrasi gateway disediakan via adapter stub (`src/gateway/gatewayAdapter.js`). Kamu tinggal isi endpoint sesuai API gateway milikmu.

---

## Requirement

- Linux VPS (Hostinger ok)
- Node.js 18+ (disarankan Node 20 LTS)
- SQLite (file)

---

## Cara jalanin di VPS

### 1) Install Node.js
Contoh (Ubuntu/Debian) menggunakan NodeSource (sesuaikan versi):
- Install Node 20 LTS, lalu cek:
```bash
node -v
npm -v
```

### 2) Upload project
Upload folder ini ke VPS, misal ke:
```bash
/opt/wa-bot-brain
```

### 3) Install dependencies
```bash
cd /opt/wa-bot-brain
npm install
```

### 4) Setup ENV
```bash
cp .env.example .env
nano .env
```

Minimal yang wajib:
- `CS_NUMBER`
- `ADMIN_USER`, `ADMIN_PASS`
- `AUTO_TIMEOUT_HOURS`
- `GATEWAY_BASE_URL`, `GATEWAY_API_KEY`

### 5) Run
```bash
npm start
```

Cek health:
```bash
curl http://127.0.0.1:3000/health
```

Webhook inbound (dari gateway):
```bash
POST http://your-vps:3000/webhook/inbound
```

Admin panel:
```bash
http://your-vps:3000/admin/
```
Browser akan meminta Basic Auth (ADMIN_USER/ADMIN_PASS).

---

## Run dengan PM2 (opsional tapi recommended)

```bash
npm i -g pm2
pm2 start src/server.js --name wa-bot-brain
pm2 save
pm2 startup
```

---

## Run dengan systemd (opsional)

Buat file:
`/etc/systemd/system/wa-bot-brain.service`

```ini
[Unit]
Description=wa-bot-brain
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/wa-bot-brain
EnvironmentFile=/opt/wa-bot-brain/.env
ExecStart=/usr/bin/node /opt/wa-bot-brain/src/server.js
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

Lalu:
```bash
systemctl daemon-reload
systemctl enable wa-bot-brain
systemctl start wa-bot-brain
systemctl status wa-bot-brain
```

---

## Skema Database (SQLite)

Tabel utama:

### `users`
- `wa_number` (UNIQUE)
- `mode` (`BOT`/`HUMAN`)
- `selected_menu` (INTEGER nullable)
- `last_interaction_at` (epoch ms)
- `created_at`, `updated_at`

### `messages`
Menyimpan log chat:
- `direction`: `IN` | `OUT` | `FWD` | `SYS`
- `message_id`: id dari gateway (untuk IN)
- `from_number`, `to_number`
- `text`
- `timestamp` (epoch ms)
- `status` (`SENT`/`FAILED`/null)
- `error` (nullable)
- `meta_json` (nullable)

### `processed_message_ids`
Untuk idempotency:
- `message_id` (PK)
- `processed_at` (epoch ms)

---

## Endpoint

### Webhook inbound (dari gateway)
`POST /webhook/inbound`

Body minimal:
```json
{
  "message_id": "abc-123",
  "from": "6281234567890",
  "text": "1",
  "timestamp": 1736928000
}
```

Mapping:
- `message_id` -> string unik per pesan
- `from` -> nomor WA pengirim (user atau CS bila pakai command)
- `text` -> isi pesan
- `timestamp` -> unix timestamp (detik atau ms; service akan normalize)

Response:
```json
{ "ok": true, "duplicate": false }
```

### Admin panel (Basic Auth)
- `GET /admin/` -> HTML
- `GET /admin/api/users` -> list user
- `GET /admin/api/users/:wa/messages?limit=20` -> histori
- `POST /admin/api/users/:wa/mode` -> set mode
- `POST /admin/api/users/:wa/send` -> kirim pesan manual

---

## Command CS (opsional)
Jika nomor pengirim sama dengan `CS_NUMBER`:

- `#close <userNumber>` atau `#boton <userNumber>`
  - mengembalikan mode user tersebut ke `BOT`

Contoh:
```
#close 6281234567890
```

---

## Test

```bash
npm test
```

Test fokus:
- switching BOT/HUMAN
- idempotency (message_id)

---

## File penting untuk kamu edit (gateway adapter)

`src/gateway/gatewayAdapter.js`

Di file ini ada TODO untuk mengarahkan:
- `sendMessage(to, text)`
- `forwardToHuman(csNumber, originalFromUser, text)`

Isi endpoint sesuai API gateway internal kamu.
