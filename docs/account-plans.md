# Account plans and rollout

`202610020001_account_plans.sql` adds an operator-owned plan catalog, private subscription state and device registrations. Existing accounts have no subscription row and resolve to Free. The migration does not alter books, files, progress or local IndexedDB data. The previous book-count quota table is replaced by per-plan byte limits; existing cloud data remains accessible even when it exceeds the new limit. Upload reservations and the final insert trigger both check bytes under the existing profile row lock. The 32 MiB per-file, three active reservations and hourly upload protections remain technical limits.

Deploy in this order: apply all pending migrations with `npx supabase db push`, deploy `book-storage` with `npx supabase functions deploy book-storage --no-verify-jwt`, then distribute updated Windows/Android clients. Old clients do not register devices and will be unable to perform cloud operations after the migration; their local books remain intact. No R2 configuration, environment variables or secrets are added.

The app creates a random installation ID and a second random secret in local storage. The server stores only the SHA-256 hash of the secret. One registration is associated with each account and installation, and the verified Supabase session is bound to it. Free admits two active registrations. A third device can view and revoke old registrations in Account. A downgrade with more than two registered devices pauses cloud access on all of them until the user chooses which registrations to remove; it does not log out or delete local books. Plus and Pro have no device cap. A stolen Supabase session token remains a general account security issue; this registry does not replace normal session protection.

The plan catalog is server controlled: Free is 1 GiB and two devices; Plus is 25 GiB; Pro is 100 GiB. Translation and premium TTS are tiers without invented numeric allowances. Current translation limits and existing functionality stay in place until tier-specific usage policies are specified. Microsoft Store purchases are available only in the native Windows build and are validated against Microsoft's recurrence API before the service role updates `private.account_subscriptions`; the client has no write privilege. See `microsoft-store-billing.md` for configuration and release steps.

For staging verification only, an operator can use Supabase SQL Editor to assign a test account a paid plan, then revert it. Do not expose this command to a client or run it against a real customer's account:

```sql
insert into private.account_subscriptions(user_id,plan_code,status,billing_cycle)
values ('STAGING_TEST_USER_UUID','plus','active','monthly')
on conflict(user_id) do update set plan_code=excluded.plan_code,status=excluded.status,billing_cycle=excluded.billing_cycle,updated_at=now();
-- Change plus to pro for the Pro case. Revert to Free by setting status='expired'.
```

Subscription states `active` and `trialing` retain a plan until `expires_at` when set; `canceled` retains it only until a future `expires_at`; `past_due` retains it through `grace_until`. Other states resolve to Free. Downgrades never delete cloud files. Users over their new byte quota can still download and remove existing books, but cannot reserve more storage.
