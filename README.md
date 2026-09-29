# RevenueTrigger — Golden Production Baseline

Source: last-known-good desktop deployment folder supplied September 2026.

## Deployment targets
- `frontend/` → Cloudflare Worker `signalhound-phoenix`
- `backend/` → Cloudflare Worker `signalhound-api`

## Production safety
- Cloudflare secrets are NOT stored in this repository.
- D1 migrations are versioned here but are NOT run automatically during deployment.
- `.wrangler/` deployment cache/history is intentionally excluded.

## Required backend Cloudflare secrets
- `ADMIN_TOKEN`
- `RESEND_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

The D1 binding and non-secret variables remain defined in `backend/wrangler.toml`.
Backend automated deployment enabled.
