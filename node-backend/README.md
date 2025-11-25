# Doordripp — Node Backend

This repository contains the Node.js + Express backend for the Doordripp storefront. It uses Mongoose (MongoDB) for data persistence and supports cookie-based JWT authentication, avatar uploads, OTP verification (phone and email), and Google OAuth.

**Quick Start**

1. Copy `.env.example` (or update `node-backend/.env`) with your environment values.
2. Install dependencies:

```powershell
cd node-backend
npm install
```

3. (Optional) Install the native image processor used for avatar resizing:

```powershell
cd node-backend
npm install sharp
```

4. Start backend in development:

```powershell
npm run dev
```

5. Start the frontend (from repo root `node-frontend`):

```powershell
cd ../node-frontend
npm install
npm run dev
```

**Important environment variables** (`node-backend/.env`)
- `MONGO_URI` — MongoDB connection string
- `PORT` — backend port (default 4000)
- `JWT_SECRET` — JWT signing secret
- `BACKEND_URL` — e.g. `http://localhost:4000`
- `FRONTEND_URL` — e.g. `http://localhost:5173`
- Google OAuth:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_CALLBACK_URL` — should be `http://localhost:4000/api/auth/google/callback` for server-side OAuth
- Twilio (optional): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`
- SMTP (optional, for email OTP): `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM`

**Auth & Account features**
- Cookie-based JWT sessions: successful register/login sets an `httpOnly` cookie named `token`.
- Endpoints (not exhaustive):
  - `POST /api/auth/register` — register new user (requires `termsAccepted`; if `phone` provided, requires phone verification token)
  - `POST /api/auth/login` — login with email or phone + password
  - `GET /api/auth/me` — current authenticated user (reads cookie or Authorization header)
  - `POST /api/auth/avatar` — upload profile image (accepts base64 data URL)
  - `POST /api/auth/send-otp` — send OTP to phone and/or email (Twilio + SMTP optional, otherwise logged)
  - `POST /api/auth/verify-otp` — verify OTP; returns short-lived `verificationToken` to prove ownership

**Signup fields & validation**
- Required: `name` (min 3 chars), `email` (valid), `phone` (10-digit India), `password` (min 6 chars, must include uppercase and number), `confirmPassword`, `termsAccepted` (checkbox)
- Optional: gender, date-of-birth, address, profile image
- Phone OTP verification is supported and can be enforced during registration (backend expects `verificationToken` when `phone` is provided).

**Avatar uploads**
- Avatars are uploaded as base64 data URLs by the frontend and processed by the backend using `sharp` (resized to 512×512 and converted to JPEG). Saved files are served from `/uploads/avatars/<userId>.jpg`.
- If you prefer to avoid native deps (`sharp`), the frontend can be switched to client-side resizing instead.

**OTP behavior**
- `send-otp` will accept `{ phone?, email? }` and attempt delivery to both identifiers.
- If Twilio is configured, SMS is sent; if SMTP configured, email is sent. When not configured, OTP is printed to backend logs for development.
- OTPs are hashed and expire after 5 minutes.
- Successful verification returns a short lived `verificationToken` (10 minutes) that should be included in registration payload to prove ownership.

**Google OAuth**
- Passport is configured to handle Google OAuth on the backend. Set `GOOGLE_CALLBACK_URL` to your backend callback (recommended):
  - `http://localhost:4000/api/auth/google/callback` (local dev)

**Notes & recommendations**
- Restart the backend after changing `.env`.
- Add rate limiting on `send-otp` in production to avoid abuse.
- Use a dedicated cloud storage (S3 / Cloudinary) for production avatars instead of local disk.

If you want, I can update this README with deployment steps (Docker, Azure/AWS), add a `.env.example`, or generate a quick Postman collection for the main endpoints.
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
