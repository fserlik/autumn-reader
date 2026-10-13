# Premium AI Speech

Premium AI Speech adds Amazon Polly Neural to the existing device TTS. Device voices remain the default, work offline, and are available on Free. Autumn+ receives 60 generation minutes per monthly entitlement cycle; Autumn Pro receives 180. Annual subscriptions are split into monthly cycles anchored to `current_period_start`.

## Architecture and security

- The reader sends one visible fragment at a time to `ai-speech`. Requests are capped at 3,000 normalized characters.
- The Edge Function verifies the Supabase JWT and active device session, then authorizes the private cloud book. Before calling Polly, it downloads that owned EPUB/PDF from R2 and verifies that the requested text is present in the source file.
- PDF validation uses a static, versioned `npm:unpdf@1.8.0/pdfjs` import so the dependency is included in Supabase's ESZip instead of being resolved lazily at request time. Its worker is inlined for Deno/Edge runtimes; validation disables font rendering, system fonts, WASM and remote worker/font fetches because it extracts text only. A local `Math.sumPrecise` compatibility shim covers Supabase Edge Runtime 1.77/Deno 2.1.4, while newer runtimes keep their native implementation. The browser reader keeps its existing `pdfjs-dist` integration.
- `reserve_ai_speech` serializes work by user/fragment and also takes a global budget lock. It reserves estimated seconds before Polly is called. A duplicate returns the existing audio or a pending response; it cannot create a second charge.
- Polly credentials, the Supabase service role and R2 credentials exist only in Edge Function secrets. The client receives a two-minute signed GET URL, never an object key or credential.
- Audio uses deterministic keys under `ai-speech/<user>/<book>/<request-hash>.mp3`. The hash includes the text, voice, language, speed and provider version. Previously generated audio is replayed without consuming quota again.
- The reader's voice-sample control synthesizes only a short excerpt from the current owned book. Its first generation uses a few quota seconds and subsequent plays reuse the deterministic cached object; it does not activate or pre-generate paid sample assets.
- Provider failures release the user's reserved seconds. If Polly succeeded but R2 failed, `provider_billed` keeps the estimated provider cost in the global budget while releasing user quota.
- `private.ai_speech_admin_alerts` records an alert once at 80% and 100% of the monthly budget. Connect this private table to the team's existing Supabase database alert/webhook process if notifications outside Supabase are desired; none are activated automatically.

Amazon Polly's synchronous response does not contain the final audio duration. Autumn Reader therefore uses the documented conservative fallback `ceil(characters / 12 / playback_rate)` seconds. The estimated duration, billable characters and estimated cost are retained with every generation. `actual_seconds` is available for a future trusted duration probe; client-reported durations are deliberately not accepted for quota accounting.

## AWS configuration

1. Choose a region that supports every enabled Neural voice. The initial catalog includes Spanish (`Lucia`, `Sergio`, `Mia`, `Andres`, `Lupe`, `Pedro`), English, French and Italian voices. The function always sends `Engine: neural`; it never falls back to generative voices.
2. Create an IAM user or role dedicated to this Edge Function. The minimum Polly policy is:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "polly:SynthesizeSpeech",
    "Resource": "*"
  }]
}
```

3. Do not grant `StartSpeechSynthesisTask`, S3 access, voice cloning, or other Polly permissions. R2 uses the existing bucket credentials and requires read/write access only to the configured private bucket.

## Backend secrets

Copy `supabase/.env.example` to the ignored `supabase/.env` for local development, or set the same names as Supabase project secrets:

```dotenv
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SESSION_TOKEN=
AWS_REGION=us-east-1
AI_SPEECH_MONTHLY_BUDGET_USD=10
AI_SPEECH_RETENTION_DAYS=90
POLLY_NEURAL_USD_PER_MILLION_CHARS=16
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ALLOWED_ORIGINS=http://127.0.0.1:1420,http://tauri.localhost,https://tauri.localhost,tauri://localhost
```

`AWS_SESSION_TOKEN` is optional. Keep the US$10 budget unless an operator intentionally raises it. Update `POLLY_NEURAL_USD_PER_MILLION_CHARS` when AWS pricing changes; it is an estimate and AWS billing remains authoritative.

## R2 retention

The database expiration is set from `AI_SPEECH_RETENTION_DAYS` for every generated object. Configure an R2 lifecycle rule for the private `ai-speech/` prefix with the same number of days so audio is deleted automatically. Do not make the bucket or prefix public. Changing retention or budget requires only backend configuration, not a client release.

## Migration and deployment

Review and apply, in order:

```text
supabase/migrations/202610100001_premium_ai_speech.sql
```

Then set secrets and deploy only the new function. The PDF parser correction itself does not require a migration:

```bash
supabase secrets set --env-file supabase/.env
supabase db push
supabase functions deploy ai-speech --no-verify-jwt
```

The `--no-verify-jwt` flag is intentional: the function verifies the access token with `auth.getUser()` and then checks the server-side device session before any paid work. Run these commands only against the intended project. This repository change does not execute them.

## Verification

Local checks:

```bash
npm run build
npm test
npm run check:backend
npm run test:backend
```

Production smoke tests still require configured AWS/R2 credentials: confirm Polly region/voice compatibility, R2 lifecycle execution, alert delivery from `private.ai_speech_admin_alerts`, signed URL playback on Windows and Android, and quota renewal at a real billing boundary.

## Diagnosing a safe `provider_unavailable`

Every request now emits structured `ai-speech diagnostic` events with a random request ID, stage and outcome. Error events can also contain a sanitized error type, service and upstream HTTP status. They never contain JWTs, AWS/R2 credentials, user or book identifiers, book text, object keys, or signed URLs.

Relevant stages are `authentication`, `device_authorization`, `quota_lookup`, `reservation`, `book_download`, `book_validation`, `polly_configuration`, `polly_synthesis`, `r2_audio_upload`, `finalization` and `r2_audio_presign`. For example, an invalid AWS signature is logged as `stage=polly_synthesis`, `errorType=InvalidSignatureException`, `service=polly`, `httpStatus=403`, while the client still receives only the safe `provider_configuration` code.

PDF errors also contain a sanitized `parserStage`: `module_load`, `module_initialization`, `document_load`, `encryption`, `text_extraction` or `fragment_validation`. Controlled client codes are `pdf_validation_unavailable` for an unavailable parser, `pdf_encrypted`, `pdf_damaged`, `pdf_no_extractable_text`, or the generic `book_text_unverified` when the requested fragment is absent. Raw exception messages, extracted text and signed R2 URLs are never logged.

For local diagnosis, serve the function with the ignored environment file and read the terminal output:

```bash
supabase functions serve ai-speech --env-file supabase/.env --no-verify-jwt
```

For production, open Supabase Dashboard → Edge Functions → `ai-speech` → Logs, reproduce the failure once, and filter for `ai-speech diagnostic`. Follow the common `requestId` to find the first event whose `outcome` is `error`. The stage identifies whether the failure is an RPC/migration problem, an inaccessible R2 object, a parser rejection, AWS configuration/signing, Polly itself, R2 upload, or final database bookkeeping.

Before deployment, confirm that the project secret list contains `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, all four `R2_*` values, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `ALLOWED_ORIGINS`. Temporary AWS credentials additionally require `AWS_SESSION_TOKEN`; the signed request includes it automatically. Do not paste secret values into logs or support tickets.
