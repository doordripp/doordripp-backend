# Doordripp Backend – Deep Analysis Report

## Overview
- Stack: Node.js + Express, MongoDB (Mongoose), JWT auth with httpOnly cookies, Passport Google OAuth, Razorpay, OTP email/SMS flows, ImageKit routes.
- Deployment target: Render (`doordripp-backend.onrender.com`) with React frontend on `doordripp.com`/`www.doordripp.com` using credentials-included requests.

## Architecture & Routing
- Entry: `src/index.js` mounts auth/products/orders/cart/admin/imagekit plus health check. Static SPA fallback if built assets present.
- Mongo connection uses `MONGO_URI`/`DATABASE_URL`; skips if missing.
- Avatar uploads saved to local FS (`/uploads`); Render filesystem is ephemeral → avatars risk loss.

## Auth, Sessions, Cookies
- JWT issued and stored as httpOnly cookie (`sameSite: none`, `secure: true`, domain `.doordripp.com`); credentials supported via CORS.
- Multiple controllers: `authController.js`, `mongoAuthController.js`, `auth.controller.js`; ensure consistent flows.
- Google OAuth: callback defaults to `${BACKEND_URL}/api/auth/google/callback`; marks email verified.
- OTP flows for email/phone; console fallbacks when mail/SMS creds absent (dev-friendly, avoid in prod).

## CORS & Cross-Origin Behavior
- CORS whitelist: `https://doordripp.com`, `https://www.doordripp.com`, and localhost dev ports 3000/3001/5173; credentials enabled; methods GET/POST/PUT/DELETE/OPTIONS/PATCH; headers Content-Type, Authorization; maxAge 24h.
- Preflight handled globally via `app.options('*', cors(corsOptions))` before routes.

## Security
- ⚠️ `JWT_SECRET` falls back to `'secret'` if env missing—must be set in prod.
- Cookie settings are hardened for cross-domain; ensure HTTPS-only deployment.
- OTP fallback logs codes when mail/SMS creds missing—disable in prod.
- No global rate limiting detected on login/OTP—susceptible to brute-force/abuse.
- Passport Google strategy uses email from profile; no additional domain restrictions.

## Data & Storage
- MongoDB primary store; schema includes roles, verification flags, OTPs.
- Local avatar storage not durable on Render; migrate to external storage (S3/ImageKit) or ensure persistence.

## Reliability
- Mongo connect lacks retry/backoff; cold starts or brief outages will fail start. Add minimal retry strategy.
- No circuit breaking / graceful shutdown hooks noted.

## Performance
- Standard middleware stack (cors/json/cookieParser/morgan). No response compression; add `compression` if bandwidth matters.
- OTP/email/SMS synchronous in request path; consider queueing if volume grows.

## Observability
- Logging: morgan `dev` plus console; no structured logging, no APM/metrics.
- Health endpoint `/api/health` present.

## Configuration & Env
- `.env.example` exists; ensure production sets: `MONGO_URI`, `JWT_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_CALLBACK_URL`, `MAIL_*` or SMS credentials, `FRONTEND_URL`, `BACKEND_URL`, Razorpay keys.
- Seed/admin utilities: `scripts/create-admin.js`, `scripts/make-user-admin.js`.

## Testing & QA
- No automated tests detected. Manual scripts for email/brevo present. Add basic auth/product route tests to prevent regressions.

## Highest-Priority Actions
1) **Set secrets**: Provide strong `JWT_SECRET` in prod; verify `MONGO_URI` and OAuth/mail/SMS envs.
2) **Rate limiting**: Add `express-rate-limit` to `/api/auth/login`, `/api/auth/send-otp`, `/api/auth/verify-email-otp`.
3) **Durable uploads**: Move avatars/uploads to external storage (S3/ImageKit) to avoid loss on Render.
4) **DB resilience**: Add retry/backoff on Mongo connect and graceful shutdown.
5) **Logging/monitoring**: Add structured JSON logs and error tracking (e.g., Sentry) plus basic metrics.
6) **Tests**: Add smoke tests for CORS, login, OTP, and products endpoints.
