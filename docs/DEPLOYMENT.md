# Production Deployment Guide — RazorGrowth AI / Vettri Vaanigam

This guide explains how to deploy RazorGrowth AI into a live, scalable production environment.

---

## 1. Architecture Overview

```
[ Clients / Agents / Browsers ]
               │
               ▼
   [ Cloudflare / Reverse Proxy ]
         │               │
         │ (SPA static)  │ (/api/v1/*)
         ▼               ▼
  [ Web (Nginx) ]  [ API (Fastify Node.js) ]
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
[ Supabase / Postgres ] [ Google Gemini ] [ Razorpay Test Mode ]
```

---

## 2. Prerequisites & Environment Variables

Copy `.env.example` into your production environment or Secret Manager:

```ini
# Core
NODE_ENV=production
PORT=4000
WEB_ORIGIN=https://app.yourdomain.com
LOG_LEVEL=info

# Database (Supabase / RDS with PgBouncer)
DATABASE_URL=postgresql://postgres.<your-project-ref>:PASSWORD@<your-db-host>:6543/postgres?pgbouncer=true&connection_limit=15&pool_timeout=30&sslmode=require
DIRECT_URL=postgresql://postgres.<your-project-ref>:PASSWORD@<your-db-host>:5432/postgres?sslmode=require

# Google Gemini (AI Provider)
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.5-flash
AI_PROVIDER_TIMEOUT_MS=15000

# Razorpay TEST MODE.
#
# This project is scoped to Test Mode and its safety argument depends on
# that. `rzp_live_` is deliberately not shown here even as an example:
# a copied placeholder is how a live key ends up in a demo deployment.
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_API_BASE_URL=https://api.razorpay.com/v1
RAZORPAY_TIMEOUT_MS=10000

# Cryptographic token signing.
#
# Generate a DISTINCT random value for each, per environment:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#
# Never paste a real secret into this file. These two sign agent
# delegation tokens and data fingerprints respectively, so a leaked value
# lets someone forge them against any deployment still using it.
ACP_DELEGATION_TOKEN_SECRET=<64-hex-chars, generate your own>
DATA_FINGERPRINT_SECRET=<64-hex-chars, generate your own, different from the above>
SESSION_VALIDITY_HOURS=12

# Frontend
VITE_API_BASE_URL=https://api.yourdomain.com/api/v1
```

---

## 3. Deployment Methods

### Option A: Docker Compose (Single Host / VPS / VM)

Run the full production stack with one command:

```bash
# 1. Build and start containers in background
docker compose -f docker-compose.prod.yml up -d --build

# 2. Run database migrations inside API container
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy --schema prisma/schema.prisma

# 3. (Optional) Seed demo merchant & initial catalog
docker compose -f docker-compose.prod.yml exec api node --import tsx prisma/seed.ts
```

---

### Option B: Cloud Split Deployment (Recommended for Scale)

#### 1. Backend API (Google Cloud Run / AWS ECS / Railway / Render)
* **Build Context**: Monorepo root
* **Dockerfile**: `apps/api/Dockerfile`
* **Exposed Port**: `4000`
* **Health Check**: `GET /api/v1/health`
* **Release Phase Command**: `pnpm --filter @razorgrowth/api db:deploy`

#### 2. Frontend SPA (Cloudflare Pages / Vercel / AWS S3 + CloudFront)
* **Root Directory**: `apps/web`
* **Build Command**: `pnpm --filter @razorgrowth/web run build`
* **Output Directory**: `dist`
* **Environment Variable**: `VITE_API_BASE_URL=https://api.yourdomain.com/api/v1`

---

## 4. Post-Deployment Verification

Verify all endpoints are healthy:

1. **API Health Check**:
   ```bash
   curl -i https://api.yourdomain.com/api/v1/health
   # Expected response: HTTP 200 {"status":"ok","service":"razorgrowth-api"}
   ```
2. **Machine-Readable Agent Catalog**:
   ```bash
   curl -i https://api.yourdomain.com/api/v1/agent-commerce/catalog
   # Expected response: HTTP 200 with schema.org JSON-LD catalog
   ```
3. **Razorpay Webhook Verification**:
   Configure webhook URL in Razorpay Dashboard (`https://api.yourdomain.com/api/v1/payments/webhooks/razorpay`) and test ping.

---

## 5. Maintenance & Monitoring

* **Logs**: Structured JSON logs are emitted on stdout by Pino.
* **Retention Sweeps**: Automatic 24-hour retention cleanup sweeps run in the background for expired sessions and idempotency records.
