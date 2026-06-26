# ATslip Auth Service

Node.js service สำหรับ Telegram MTProto authentication (Phone OTP & QR Login)

## Setup

```bash
cd auth-service
npm install
cp .env.example .env
# แก้ไข .env ใส่ค่า TELEGRAM_API_ID และ TELEGRAM_API_HASH จาก https://my.telegram.org
npm start
```

## Environment Variables

| Variable | คำอธิบาย |
|---|---|
| `TELEGRAM_API_ID` | API ID จาก my.telegram.org → API Development Tools |
| `TELEGRAM_API_HASH` | API Hash จาก my.telegram.org |
| `PORT` | Port ที่ service จะ listen (default: 4000) |
| `ALLOWED_ORIGIN` | URL ของ frontend ที่อนุญาต CORS |

## API Endpoints

| Method | Path | คำอธิบาย |
|---|---|---|
| POST | `/api/tg-auth/send-code` | ส่ง OTP ไปยังเบอร์โทร |
| POST | `/api/tg-auth/verify-code` | ตรวจสอบ OTP |
| POST | `/api/tg-auth/verify-2fa` | ตรวจสอบรหัสผ่าน 2FA |
| POST | `/api/tg-auth/qr-start` | สร้าง QR Login session |
| GET  | `/api/tg-auth/qr-status/:id` | ตรวจสอบสถานะ QR |
| POST | `/api/tg-auth/logout` | ยกเลิก Telegram session |
| GET  | `/api/tg-auth/health` | Health check |

## Deploy

Service นี้รัน Node.js ดังนั้นต้อง deploy บน server ที่รัน Node.js ได้ เช่น:
- VPS (Ubuntu, CentOS, ฯลฯ)
- Railway, Render, Fly.io
- Docker container

### ตัวอย่างด้วย PM2

```bash
npm install -g pm2
pm2 start server.js --name "atslip-auth"
pm2 save
pm2 startup
```

## Frontend Configuration

หลัง deploy แล้ว อัปเดต `frontend/js/config.js`:

```js
const AUTH_CONFIG = {
  AUTH_SERVICE_URL: 'https://auth.atslip.biz',  // ← URL ที่ deploy auth-service
  BACKEND_URL: '',
};
```
