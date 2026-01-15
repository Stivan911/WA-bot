# wa-gateway (WhatsApp Cloud API)

Gateway kecil untuk:

1) menerima webhook dari WhatsApp Cloud API (Meta), lalu meneruskan ke bot pada `POST /webhook/inbound`.
2) menerima request internal dari bot (`POST /messages/send`) untuk mengirim pesan via Cloud API.

## Endpoint

- `GET /health`
- `GET /wa/webhook` (verifikasi webhook Meta)
- `POST /wa/webhook` (event inbound dari Meta)
- `POST /messages/send` (internal; dipanggil bot)

## Instal & run

```bash
cd /var/www/wa-gateway
npm install
cp .env.example .env
nano .env
npm start
```

## Nginx (contoh)

Jika bot ada di port `3101` dan gateway di port `9999`, kamu bisa pakai 1 subdomain:

- `/wa/webhook` → gateway
- sisanya (`/`, `/admin`, `/webhook/inbound`) → bot

```nginx
server {
  server_name wapi.domainkamu.com;

  # webhook dari Meta
  location = /wa/webhook {
    proxy_pass http://127.0.0.1:9999/wa/webhook;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # bot
  location / {
    proxy_pass http://127.0.0.1:3101;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Konfigurasi Meta (ringkas)

- Callback URL: `https://wapi.domainkamu.com/wa/webhook`
- Verify token: isi sama dengan `WA_VERIFY_TOKEN` di `.env`
- Subscribe field: minimal `messages`

## Catatan

- `POST /messages/send` sebaiknya **tidak dibuka publik**. Kalau gateway dan bot 1 VPS, paling aman biarkan gateway listen di `127.0.0.1` (lihat `src/server.js`).
