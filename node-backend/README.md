# Doordripp Node Backend (Scaffold)

Scaffolded JavaScript + Express backend using PostgreSQL (Prisma) and Razorpay hooks.

Quick start

1. Copy `.env.example` to `.env` and fill values (`DATABASE_URL`, JWT secret, Razorpay keys).
2. Install dependencies:

```powershell
cd node-backend
npm install
```

3. Start in development:

```powershell
npm run dev
```

API endpoints (initial):
- `POST /api/auth/register` — register user
- `POST /api/auth/login` — login user (returns JWT)
- `GET /api/products` — list products
- `POST /api/products` — create product (admin)
- `POST /api/orders` — create order (creates Razorpay order id payload)

Next steps: seed admin, add more validations, webhooks, file uploads, and admin dashboards.
