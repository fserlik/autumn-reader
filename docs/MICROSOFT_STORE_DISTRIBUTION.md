# Microsoft Store distribution

Microsoft Store is used only to package, distribute, and update the Windows build of Autumn Reader. It is not a billing provider and does not determine Free, Autumn+, Autumn Pro, or any entitlement.

Keep the package identity, manifests, signing configuration, publication workflow, and `scripts/build-store-msix.ps1`. Do not add Store add-ons, `Windows.Services.Store`, Store receipts, license checks, purchase restoration, or Store subscription identifiers to the application.

Build the Store package with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-store-msix.ps1
```

Installing or updating this MSIX never grants premium access. A user receives the same account entitlement on Windows and Android after signing in with the same Supabase account.
