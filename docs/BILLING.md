# Autumn Reader billing

## Architecture

```text
Lemon Squeezy (commercial source)
  -> signed webhook
  -> private.subscriptions (Supabase operational source)
  -> get_user_entitlements()
  -> Windows, Android and future clients
```

Microsoft Store and Google Play are distribution channels only. A subscription belongs to the Supabase `auth.users.id`, never to a device or operating system. Clients cannot read private billing tables or write plan, provider, status, dates, or entitlements.

The plan catalog defines capabilities centrally:

| Plan | Cloud storage | Devices | Sync | Offline | Notes/highlights |
| --- | ---: | ---: | --- | --- | --- |
| Free | 1 GiB | 2 | Yes | Yes | Yes |
| Autumn+ | 25 GiB | Unlimited | Yes | Yes | Yes |
| Autumn Pro | 100 GiB | Unlimited | Yes | Yes | Yes |

Cloud upload reservations and final library writes are checked in PostgreSQL under the existing account lock. The check is based only on total bytes; there is no book-count quota. Existing over-quota books remain downloadable and removable.

## Lemon Squeezy catalog

Autumn Reader uses two recurring products and four variants:

| Product | Interval | Price | Variant ID |
| --- | --- | ---: | ---: |
| Autumn+ | Monthly | US$4.99 | 2216029 |
| Autumn+ | Annual | US$39.99 | 2216031 |
| Autumn Pro | Monthly | US$9.99 | 2216032 |
| Autumn Pro | Annual | US$79.99 | 2216034 |

Test Mode and Live Mode use separate Lemon Squeezy objects and credentials. Verify the live variant IDs before production.

## Environment and secrets

Set these only as Supabase Edge Function secrets:

```text
LEMONSQUEEZY_API_KEY
LEMONSQUEEZY_WEBHOOK_SECRET
LEMONSQUEEZY_STORE_ID
LEMONSQUEEZY_PLUS_MONTHLY_VARIANT_ID
LEMONSQUEEZY_PLUS_ANNUAL_VARIANT_ID
LEMONSQUEEZY_PRO_MONTHLY_VARIANT_ID
LEMONSQUEEZY_PRO_ANNUAL_VARIANT_ID
```

The existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGINS` are also required. Never expose the Lemon Squeezy API key, webhook secret, or Supabase service-role key through a `VITE_` variable.

## Checkout and identity

`billing-checkout` verifies the bearer token with Supabase Auth and ignores any user ID supplied by a client. It creates a Lemon Squeezy hosted checkout for the server-owned variant and writes the authenticated Supabase UUID, plan and billing period into checkout custom data.

The checkout URL is returned directly to Autumn Reader. A successful redirect or checkout page never grants premium access by itself. Only a verified Lemon Squeezy webhook may call the service-role-only `process_billing_event` RPC.

## Webhook

Configure the Lemon Squeezy webhook destination as:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/lemonsqueezy-webhook
```

The deployed webhook verifies Lemon Squeezy's signature against the unmodified request body, maps the purchased variant to the Autumn plan/billing period, and writes billing state through `process_billing_event`.

`private.billing_webhook_events` makes repeated delivery idempotent and the billing RPC prevents stale events from replacing newer subscription state.

`private.legacy_billing_records` retains old Microsoft Store subscription rows for audit. They are removed from the operational table and can never grant an entitlement.

## Customer portal

`billing-portal` verifies the Supabase session and retrieves the account's stored Lemon Squeezy subscription server-side. It then obtains the signed Lemon Squeezy customer portal URL and returns it to the app.

Portal URLs are generated when needed rather than stored permanently. In Test Mode, portal availability can depend on the Lemon Squeezy store being activated.

## Deploy

```powershell
npm install
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push

npx supabase secrets set LEMONSQUEEZY_API_KEY=YOUR_KEY
npx supabase secrets set LEMONSQUEEZY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
npx supabase secrets set LEMONSQUEEZY_STORE_ID=YOUR_STORE_ID
npx supabase secrets set LEMONSQUEEZY_PLUS_MONTHLY_VARIANT_ID=YOUR_VARIANT_ID
npx supabase secrets set LEMONSQUEEZY_PLUS_ANNUAL_VARIANT_ID=YOUR_VARIANT_ID
npx supabase secrets set LEMONSQUEEZY_PRO_MONTHLY_VARIANT_ID=YOUR_VARIANT_ID
npx supabase secrets set LEMONSQUEEZY_PRO_ANNUAL_VARIANT_ID=YOUR_VARIANT_ID

npx supabase functions deploy billing-checkout
npx supabase functions deploy billing-portal
npx supabase functions deploy lemonsqueezy-webhook --no-verify-jwt
npx supabase functions deploy book-storage --no-verify-jwt
```

## Verification before release

```powershell
npm test
npm run test:backend
npm run check:backend
npm run build
npx playwright test tests/plans.spec.ts
Push-Location src-tauri
cargo check
Pop-Location
```

## Test Mode

1. Configure the Lemon Squeezy Test Mode API key, store, four variant IDs and webhook secret.
2. Sign in to Autumn Reader and start each monthly/annual checkout.
3. Complete checkout using a Lemon Squeezy Test Mode payment method.
4. Confirm the verified event appears once in `private.billing_webhook_events`.
5. Confirm `select public.get_user_entitlements()` returns the expected account capabilities for the authenticated account.
6. Test creation, plan changes, renewal, payment failure, scheduled cancellation, cancellation and duplicate webhook delivery.
7. Sign into the same Supabase account on Windows and Android; both must show the same plan.
8. Confirm `Administrar suscripción` opens the Lemon Squeezy customer portal once the store supports portal access.

## Production checklist

Before production:

- Activate/approve the Lemon Squeezy store.
- Create or verify the Live Mode products/variants and use their live IDs.
- Create the Live Mode API key and webhook secret.
- Configure the production webhook destination.
- Replace Test Mode Lemon Squeezy secrets/IDs with Live Mode values.
- Deploy `billing-checkout`, `billing-portal` and `lemonsqueezy-webhook`.
- Run a low-risk real purchase, cancellation and refund test.
- Verify that normal Autumn Reader startup reads entitlement state from Supabase and does not depend on Lemon Squeezy being online.
