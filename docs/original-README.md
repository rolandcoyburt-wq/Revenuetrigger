# SignalHound V2 — Phoenix

This package upgrades the working V1 deployment into a customer product while preserving the existing City of Phoenix permit feed and D1 lead data.

## What V2 adds

- Passwordless email sign-in with 15-minute one-time links.
- 30-day authenticated sessions.
- Personalized industry preferences.
- Saved opportunities.
- Plan entitlements for Scout, Hunter and Territory.
- Stripe Checkout subscriptions.
- Stripe Customer Portal billing management.
- Stripe webhook synchronization into D1.
- Hunter/Territory CSV export.
- Automated email alerts through Resend.
- Scout weekly digest, Hunter daily digest, Territory near-real-time alerts.
- V1 beta subscribers automatically migrated into free V2 accounts.

## Important: this is an upgrade, not a new database

Your V1 deployment already has a working D1 database. Keep that same database.

Before deploying V2, copy the existing `database_id` from your current working `wrangler.toml` into the V2 `cloudflare/wrangler.toml` file where it says:

```toml
database_id = "KEEP_YOUR_EXISTING_D1_DATABASE_ID"
```

Do not create a second SignalHound database unless you intentionally want a clean install.

## Upgrade order

### 1. Back up the working V1 files

Make a copy of your current `signalhound` folder before replacing anything.

### 2. Run the V2 D1 migration

Open PowerShell in the new `signalhound\cloudflare` folder and run:

```powershell
npx wrangler d1 execute signalhound --remote --file=./migration-v2.sql
```

This adds the new V2 tables without deleting the V1 `leads` or `subscribers` tables.

### 3. Test V2 authentication before configuring paid services

For a short local/deployment test only, change this in `wrangler.toml`:

```toml
DEV_AUTH_BYPASS = "true"
```

Then deploy:

```powershell
npx wrangler deploy
```

Upload the new `index.html` to your existing `signalhound-phoenix` front end.

When you request a sign-in link, the API will return a development sign-in link directly to the UI if email is not configured. This is only for testing.

As soon as the login flow works, set:

```toml
DEV_AUTH_BYPASS = "false"
```

and deploy again.

Never leave development bypass enabled on a public production deployment.

## Configure Resend email

SignalHound uses Resend for magic sign-in links and paid-plan alerts. Resend supports Cloudflare Workers through its email API.

1. Create a Resend account.
2. Verify a sending domain.
3. Create an API key.
4. Set `EMAIL_FROM` in `wrangler.toml`, for example:

```toml
EMAIL_FROM = "SignalHound <alerts@signalhound.com>"
```

5. Store the API key as a Worker secret:

```powershell
npx wrangler secret put RESEND_API_KEY
```

Do not put the Resend API key in `wrangler.toml` or `index.html`.

## Configure Stripe subscriptions

Create three recurring monthly Stripe Prices:

- Scout — $49/month
- Hunter — $149/month
- Territory — $499/month

Copy each Stripe **Price ID** (it begins with `price_`) into `wrangler.toml`:

```toml
STRIPE_PRICE_SCOUT = "price_..."
STRIPE_PRICE_HUNTER = "price_..."
STRIPE_PRICE_TERRITORY = "price_..."
```

Then store your Stripe secret key:

```powershell
npx wrangler secret put STRIPE_SECRET_KEY
```

### Stripe webhook

In Stripe, create a webhook endpoint pointing to:

```text
https://signalhound-api.rolandcoyburt.workers.dev/api/stripe/webhook
```

Subscribe it to these events:

```text
checkout.session.completed
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
```

Copy the webhook signing secret (`whsec_...`) and store it:

```powershell
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

The Worker verifies Stripe's webhook signature before changing a customer's plan.

## Existing admin token

Keep the existing `ADMIN_TOKEN` secret. V2 preserves the protected manual refresh route:

```text
POST /api/refresh
Authorization: Bearer YOUR_ADMIN_TOKEN
```

## Deploy V2 Worker

After the migration and configuration:

```powershell
npx wrangler deploy
```

Then test:

```text
https://signalhound-api.rolandcoyburt.workers.dev/api/health
```

Expected service name:

```json
{"ok":true,"service":"SignalHound V2"}
```

The health response also reports whether Stripe and email secrets are present.

## Deploy V2 front end

Replace the existing front-end `index.html` with the V2 `index.html`, then create a new deployment for your current `signalhound-phoenix` project.

The V2 front end is already pointed at:

```text
https://signalhound-api.rolandcoyburt.workers.dev/api
```

so you do not need to edit the API URL unless the Worker hostname changes.

## V2 plan behavior

### Beta / free account
- 1 industry
- 7-day matching feed
- saved opportunities
- no automated email alerts
- no CSV export

### Scout — $49/month
- 1 industry
- 7-day history
- weekly email digest
- saved opportunities

### Hunter — $149/month
- up to 3 industries
- 30-day history
- daily email digest
- saved opportunities
- CSV export

### Territory — $499/month
- all currently live industries
- up to 90-day accumulated history
- near-real-time alerts from the hourly refresh
- saved opportunities
- CSV export

Note: the Phoenix source is currently the only live municipal source. The UI deliberately does not claim Scottsdale, Tempe, Mesa or Chandler are live yet.

## Cron behavior

The existing hourly cron remains:

```toml
[triggers]
crons = ["17 * * * *"]
```

Each run:

1. Refreshes Phoenix permit data.
2. Sends any qualifying Territory alert that has not already been sent.
3. At approximately 8:17 AM Phoenix time, sends Hunter daily digests.
4. On Monday at approximately 8:17 AM Phoenix time, sends Scout weekly digests.

Phoenix remains on UTC-7 year-round, so 15:17 UTC corresponds to approximately 8:17 AM in Phoenix.

## Security choices in V2

- Authentication tokens stored in D1 are SHA-256 hashes, not raw links/sessions.
- Magic links expire after 15 minutes and can be used only once.
- Magic tokens are carried in the URL fragment (`#magic=...`), keeping them out of normal server request logs.
- Sessions expire after 30 days.
- Stripe webhooks require signature verification.
- Stripe and Resend secret keys are Worker secrets, never browser code.
- Manual refresh remains protected by `ADMIN_TOKEN`.
- CORS stays restricted to the deployed SignalHound front end.

## API routes added in V2

Public:

```text
GET  /api/health
GET  /api/leads
POST /api/subscribe
POST /api/auth/request
POST /api/auth/verify
POST /api/stripe/webhook
```

Authenticated:

```text
GET  /api/me
POST /api/logout
GET  /api/dashboard
POST /api/preferences
GET  /api/saved
POST /api/saved
GET  /api/export.csv
POST /api/billing/checkout
POST /api/billing/portal
```

Admin:

```text
POST /api/refresh
```

## Files

- `index.html` — V2 customer-facing web app.
- `cloudflare/worker.js` — V2 API/backend.
- `cloudflare/migration-v2.sql` — upgrade the existing V1 D1 database.
- `cloudflare/schema-v2-full.sql` — full schema for a clean install only.
- `cloudflare/wrangler.toml` — V2 Worker config template.
- `cloudflare/schema-v1-reference.sql` — copy of the original V1 schema for reference.
