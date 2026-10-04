# Microsoft Store billing (Windows only)

Autumn Reader exposes Microsoft Store subscription purchases only inside the native Tauri app on Windows. Android, browser builds, and other desktop platforms keep their existing plan comparison without Store purchase controls.

## Product mapping

The Windows client discovers subscription add-ons of type `Durable`, then matches their Partner Center product IDs:

| Partner Center product ID | Autumn plan | Billing cycle |
| --- | --- | --- |
| `autumn_plus_monthly` | Plus | Monthly |
| `autumn_plus_yearly` | Plus | Annual |
| `autumn_pro_monthly` | Pro | Monthly |
| `autumn_pro_yearly` | Pro | Annual |

Partner Center assigns a separate 12-character **Store ID** to each add-on. Put those server-side IDs in the corresponding `MICROSOFT_STORE_*_ID` secrets. The backend accepts only those four IDs; the plan claimed by the client is ignored.

## Partner Center and Entra setup

1. Open each add-on overview in Partner Center and copy its 12-character Store ID.
2. Submit and publish the four subscription add-ons. Products in `No enviado` state are not available to the Store APIs used by the production app.
3. Create a Microsoft Entra Web/API application for the billing service.
4. In Partner Center, open the app's **Services > Product collections and purchases** page and associate that Entra client ID. Microsoft notes that this association may take time to propagate.
5. Create a client secret for that Entra application. Keep it only in Supabase secrets.
6. Install the packaged app from its Microsoft Store listing at least once on the test PC. This establishes the package identity required by `StoreContext`.

The MSIX must use the exact Identity Name and Publisher shown under Partner Center's product identity. Build it with `scripts/build-store-msix.ps1`; do not run the app elevated because Microsoft Store purchase UI is unavailable to elevated processes.

## Supabase configuration

Apply migration `202610030001_microsoft_store_subscriptions.sql`, deploy `microsoft-store-subscriptions`, and configure:

```text
MICROSOFT_STORE_TENANT_ID
MICROSOFT_STORE_CLIENT_ID
MICROSOFT_STORE_CLIENT_SECRET
MICROSOFT_STORE_PLUS_MONTHLY_ID
MICROSOFT_STORE_PLUS_YEARLY_ID
MICROSOFT_STORE_PRO_MONTHLY_ID
MICROSOFT_STORE_PRO_YEARLY_ID
```

The function also requires the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGINS` environment values.

## Purchase and validation flow

1. The Windows app loads localized prices from `Windows.Services.Store`.
2. Microsoft Store shows and completes the purchase UI using the Autumn Reader window as its owner.
3. Supabase issues a short-lived Entra service ticket scoped to Store purchase-key creation.
4. Windows creates a Microsoft Store ID key for the signed-in Autumn Reader user.
5. The backend sends that key to Microsoft's recurrence API and validates product ID, recurrence state, expiration, and grace period.
6. A service-role-only RPC updates `private.account_subscriptions`. A local client response alone never grants Plus or Pro.

The **Restore purchases** action runs the same server validation and can recover access after reinstalling or signing in on another approved Windows device.

## Verification

```powershell
npm run build
npm run check:backend
npm run test:backend
cd src-tauri
cargo check
```

Real checkout cannot be tested with a portable or development executable. Use the Store-associated MSIX and a Microsoft account included in the add-on's testing audience.
