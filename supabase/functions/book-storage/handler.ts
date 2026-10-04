import { createClient } from "npm:@supabase/supabase-js";
import { AwsClient } from "npm:aws4fetch";
import {
  MAX_CLOUD_BOOK_BYTES,
  validHash,
  validateBookFile,
  type FileFormat,
} from "../../../shared/book-file.ts";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
type BackendDatabase = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
    Functions: {
      reserve_book_upload: {
        Args: {
          p_user: string;
          p_hash: string;
          p_format: string;
          p_size: number;
          p_title: string;
          p_author: string;
        };
        Returns: Json;
      };
      get_upload_intent: {
        Args: { p_user: string; p_id: string };
        Returns: Json;
      };
      complete_book_upload: {
        Args: { p_user: string; p_id: string };
        Returns: Json;
      };
      authorize_book_download: {
        Args: { p_user: string; p_book: string };
        Returns: Json;
      };
      remove_cloud_book: {
        Args: { p_user: string; p_book: string };
        Returns: Json;
      };
      authorize_account_device: {
        Args: { p_user: string; p_session: string };
        Returns: boolean;
      };
    };
  };
};
interface Intent {
  id: string;
  user_id: string;
  file_hash: string;
  format: FileFormat;
  file_size: number;
  staging_key: string;
  completed_at: string | null;
  book_id: string | null;
}
interface FileRecord {
  file_hash: string;
  file_size: number;
  format: FileFormat;
  r2_key: string;
}
const required = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error("backend_not_configured");
  return value;
};
const origins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const admin = () =>
  createClient<BackendDatabase>(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
const signer = () =>
  new AwsClient({
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });
const objectUrl = (key: string): string =>
  `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${encodeURIComponent(required("R2_BUCKET"))}/${key.split("/").map(encodeURIComponent).join("/")}`;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const checked = <T>(value: Json): T => value as T;
const quotaCodes = ["storage_limit", "pending_upload_limit", "upload_rate_limited", "quota_exceeded"] as const;
function databaseErrorCode(message: string): string {
  return quotaCodes.find((code) => message.includes(code)) ?? "cloud_unavailable";
}
function logQuotaDecision(code: string, details: string | null | undefined): void {
  if (!quotaCodes.some((value) => value === code)) return;
  let snapshot: Record<string, unknown> = {};
  try { snapshot = JSON.parse(details ?? "") as Record<string, unknown>; } catch { /* Earlier migrations have no detail. */ }
  const counts = Object.fromEntries(
    ["used_books", "active_pending_uploads", "expired_reservations", "used_bytes", "reserved_bytes", "recent_unique_uploads", "requested_bytes", "max_bytes", "max_pending_uploads"]
      .filter((key) => typeof snapshot[key] === "number")
      .map((key) => [key, snapshot[key]]),
  );
  // No user ID, hash, filename, object key, token, or selected text in logs.
  console.info("book-storage quota decision", { code, ...counts });
}
let validationActive = false; // Bound memory in an Edge isolate while validating a 32 MiB file.
async function presign(
  key: string,
  method: "GET" | "PUT",
  headers: Record<string, string> = {},
): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", method === "GET" ? "120" : "300");
  return (
    await signer().sign(url, {
      method,
      headers,
      aws: { signQuery: true, allHeaders: true },
    })
  ).url;
}
async function r2(
  key: string,
  method: string,
  headers: Record<string, string> = {},
  body?: Uint8Array<ArrayBuffer>,
): Promise<Response> {
  const response = await signer().fetch(objectUrl(key), {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok && response.status !== 412)
    throw new Error("storage_unavailable");
  return response;
}
async function boundedBytes(
  response: Response,
  expected: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    Number(response.headers.get("content-length")) !== expected ||
    expected > MAX_CLOUD_BOOK_BYTES ||
    !response.body
  )
    throw new Error("invalid_format");
  const bytes = new Uint8Array(expected);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > expected) throw new Error("too_large");
      bytes.set(value, offset);
      offset += value.length;
    }
  } finally {
    await reader.cancel();
  }
  if (offset !== expected) throw new Error("invalid_format");
  return bytes;
}
export async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = {
    "Access-Control-Allow-Origin": origin && origins.has(origin) ? origin : "",
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Cache-Control": "no-store",
  };
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: cors });
  if (origin && !origins.has(origin)) return reply({ code: "forbidden" }, 403);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return reply({ code: "forbidden" }, 405);
  try {
    const token = request.headers
      .get("Authorization")
      ?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return reply({ code: "session_expired" }, 401);
    const db = admin();
    const { data: identity, error: authError } = await db.auth.getUser(token);
    if (authError || !identity.user)
      return reply({ code: "session_expired" }, 401);
    // getUser verified the JWT; its session claim is now safe to compare with
    // the server-side active device registry. No device ID comes from the client.
    let sessionId: string | undefined;
    try {
      const payload = token.split(".")[1];
      const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { session_id?: unknown };
      if (typeof decoded.session_id === "string" && uuid(decoded.session_id)) sessionId = decoded.session_id;
    } catch { /* An invalid JWT cannot identify an approved device. */ }
    if (!sessionId) return reply({ code: "device_limit" }, 403);
    const { data: allowedDevice, error: deviceError } = await db.rpc("authorize_account_device", {
      p_user: identity.user.id,
      p_session: sessionId,
    });
    if (deviceError) throw new Error("cloud_unavailable");
    if (!allowedDevice) return reply({ code: "device_limit" }, 403);
    // Bound actual JSON bytes, including chunked bodies.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("invalid_format");
    let json = "";
    let jsonBytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      jsonBytes += chunk.value.length;
      if (jsonBytes > 8192) {
        await reader.cancel();
        throw new Error("too_large");
      }
      json += decoder.decode(chunk.value, { stream: true });
    }
    json += decoder.decode();
    const body = JSON.parse(json) as Record<string, unknown>;
    const user = identity.user.id;
    if (body.action === "prepare") {
      if (typeof body.size === "number" && body.size > MAX_CLOUD_BOOK_BYTES)
        throw new Error("too_large");
      if (
        typeof body.hash !== "string" ||
        !validHash(body.hash) ||
        (body.format !== "pdf" && body.format !== "epub") ||
        !Number.isSafeInteger(body.size) ||
        Number(body.size) <= 0 ||
        Number(body.size) > MAX_CLOUD_BOOK_BYTES ||
        typeof body.title !== "string" ||
        !body.title.trim() ||
        body.title.length > 500 ||
        (body.author !== undefined &&
          (typeof body.author !== "string" || body.author.length > 300))
      )
        throw new Error("invalid_format");
      const { data, error } = await db.rpc("reserve_book_upload", {
        p_user: user,
        p_hash: body.hash,
        p_format: body.format,
        p_size: Number(body.size),
        p_title: body.title,
        p_author: String(body.author ?? ""),
      });
      if (error) {
        const code = databaseErrorCode(error.message);
        logQuotaDecision(code, error.details);
        throw new Error(code);
      }
      const result = checked<Intent & { owned?: boolean }>(data!);
      if (result.owned) return reply({ bookId: result.book_id });
      const headers = {
        "Content-Type":
          body.format === "pdf" ? "application/pdf" : "application/epub+zip",
        "If-None-Match": "*",
      };
      // Content-Length is signed and fixed to the reserved size. Browsers set it from Blob automatically.
      const url = await presign(result.staging_key, "PUT", {
        ...headers,
        "Content-Length": String(body.size),
      });
      return reply({ intentId: result.id, url, headers });
    }
    if (body.action === "complete") {
      if (validationActive) throw new Error("storage_unavailable");
      validationActive = true;
      try {
        if (!uuid(body.intentId)) throw new Error("forbidden");
        const { data, error } = await db.rpc("get_upload_intent", {
          p_user: user,
          p_id: body.intentId,
        });
        if (error || !data) throw new Error("forbidden");
        const intent = checked<Intent>(data);
        if (intent.completed_at) return reply({ bookId: intent.book_id });
        const object = await r2(intent.staging_key, "GET");
        const bytes = await boundedBytes(object, intent.file_size);
        const hash = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (hash !== intent.file_hash || !validateBookFile(bytes, intent.format)) {
          await r2(intent.staging_key, "DELETE");
          throw new Error(hash !== intent.file_hash ? "invalid_format" : intent.format === "epub" ? "corrupt_epub" : "corrupt_pdf");
        }
        const canonical = `books/${hash}.${intent.format}`;
        // Only validated bytes can reach canonical objects. Conditional PUT also handles concurrent uploads.
        await r2(
          canonical,
          "PUT",
          {
            "If-None-Match": "*",
            "Content-Type":
              intent.format === "pdf"
                ? "application/pdf"
                : "application/epub+zip",
          },
          bytes,
        );
        const { data: done, error: finishError } = await db.rpc(
          "complete_book_upload",
          { p_user: user, p_id: intent.id },
        );
        if (finishError) {
          const code = databaseErrorCode(finishError.message);
          logQuotaDecision(code, finishError.details);
          throw new Error(code);
        }
        await r2(intent.staging_key, "DELETE").catch(() => {});
        return reply({ bookId: checked<{ book_id: string }>(done!).book_id });
      } finally {
        validationActive = false;
      }
    }
    if (body.action === "download") {
      if (!uuid(body.bookId)) throw new Error("forbidden");
      const { data, error } = await db.rpc("authorize_book_download", {
        p_user: user,
        p_book: body.bookId,
      });
      if (error || !data) throw new Error("forbidden");
      const file = checked<FileRecord>(data);
      return reply({
        url: await presign(file.r2_key, "GET"),
        hash: file.file_hash,
        size: file.file_size,
        format: file.format,
      });
    }
    if (body.action === "remove") {
      if (!uuid(body.bookId)) throw new Error("forbidden");
      const { data, error } = await db.rpc("remove_cloud_book", {
        p_user: user,
        p_book: body.bookId,
      });
      if (error || !data)
        throw new Error(error?.message.includes("forbidden") ? "forbidden" : "cloud_unavailable");
      const result = checked<{
        removed: boolean;
        remaining_references: number;
        cancelled_staging_keys: string[];
        usage: Json;
      }>(data);
      for (const key of result.cancelled_staging_keys ?? []) {
        if (key.startsWith(`staging/${user}/`)) await r2(key, "DELETE").catch(() => {});
      }
      // Canonical objects may be shared by other accounts. No inline R2 DELETE.
      return reply({ removed: result.removed, usage: result.usage });
    }
    throw new Error("forbidden");
  } catch (error: unknown) {
    const code = error instanceof Error ? error.message : "cloud_unavailable";
    const allowed = [
      "forbidden",
      "invalid_format",
      "corrupt_epub",
      "corrupt_pdf",
      "too_large",
      "storage_unavailable",
      "cloud_unavailable",
      "quota_exceeded",
      "storage_limit",
      "pending_upload_limit",
      "upload_rate_limited",
      "device_limit",
    ];
    const safe = allowed.includes(code) ? code : "cloud_unavailable";
    return reply(
      { code: safe },
      safe === "forbidden" || safe === "device_limit"
        ? 403
        : quotaCodes.some((value) => value === safe)
          ? 429
          : safe === "invalid_format" || safe === "corrupt_epub" || safe === "corrupt_pdf" || safe === "too_large"
            ? 400
            : 503,
    );
  }
}
