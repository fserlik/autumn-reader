import { t, type TranslationKey } from "../i18n";
export type CloudErrorCode =
  | "offline"
  | "session_expired"
  | "upload_failed"
  | "too_large"
  | "invalid_format"
  | "corrupt_epub"
  | "corrupt_pdf"
  | "unrecognized_format"
  | "storage_unavailable"
  | "cloud_unavailable"
  | "conflict"
  | "quota_exceeded"
  | "book_limit"
  | "storage_limit"
  | "pending_upload_limit"
  | "upload_rate_limited"
  | "forbidden"
  | "not_configured"
  | "cancelled";
export class CloudError extends Error {
  constructor(
    readonly code: CloudErrorCode,
    message?: string,
  ) {
    super(message ?? t(messages[code]));
    this.name = "CloudError";
  }
}
const messages: Record<CloudErrorCode, TranslationKey> = {
  offline: "errorOffline", session_expired: "errorSession", upload_failed: "errorUpload",
  too_large: "errorTooLarge", invalid_format: "errorInvalidFormat", corrupt_epub: "errorCorruptEpub",
  corrupt_pdf: "errorCorruptPdf", unrecognized_format: "errorUnrecognizedFormat", storage_unavailable: "errorStorage",
  cloud_unavailable: "errorCloud", conflict: "errorConflict", quota_exceeded: "errorQuota",
  book_limit: "errorBookLimit", storage_limit: "errorStorageLimit",
  pending_upload_limit: "errorPendingUploadLimit", upload_rate_limited: "errorUploadRateLimit",
  forbidden: "errorForbidden", not_configured: "errorNotConfigured", cancelled: "errorCancelled",
};
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : t("errorUnknown");
}
export function requireOnline(): void {
  if (!navigator.onLine) throw new CloudError("offline");
}
