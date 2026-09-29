# RevenueTrigger

Canonical Git repository baseline: Production V84.

## Deployment targets

- `frontend/` -> Cloudflare Worker `signalhound-phoenix` -> `revenuetrigger.ai`
- `backend/` -> Cloudflare Worker `signalhound-api` -> `api.revenuetrigger.ai`

## Cloudflare build commands

Frontend production deploy:
`npx wrangler deploy --config frontend/wrangler.toml`

Backend production deploy:
`npx wrangler deploy --config backend/wrangler.toml`

D1 migrations are intentionally NOT run automatically by either deploy command. Review and apply database migrations separately before deploying code that depends on them.

## Safety

Do not commit API secrets, Stripe secret keys, Resend keys, or authentication secrets. Runtime secrets remain in Cloudflare.
## Deployment status

GitHub → Cloudflare automated deployment pipeline enabled.
