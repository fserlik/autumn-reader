export type DiagnosticStage =
  | "authentication"
  | "device_authorization"
  | "request_validation"
  | "quota_lookup"
  | "reservation"
  | "book_authorization"
  | "book_download"
  | "book_validation"
  | "generation_claim"
  | "polly_configuration"
  | "polly_synthesis"
  | "r2_audio_upload"
  | "r2_audio_presign"
  | "finalization"
  | "failure_cleanup";

export class ServiceError extends Error {
  constructor(
    readonly safeCode: string,
    readonly errorType: string,
    readonly service?: "supabase" | "polly" | "r2" | "book_parser",
    readonly httpStatus?: number,
    readonly parserStage?: string,
  ) {
    super(safeCode);
    this.name = "ServiceError";
  }
}

const safeLabel = (value: unknown): string => {
  const label = typeof value === "string" ? value : "unknown_error";
  return /^[a-z0-9_.:-]{1,80}$/i.test(label) ? label : "unknown_error";
};

export function diagnosticError(reason: unknown): Record<string, unknown> {
  if (reason instanceof ServiceError) return {
    errorType: safeLabel(reason.errorType),
    safeCode: safeLabel(reason.safeCode),
    ...(reason.service ? { service: reason.service } : {}),
    ...(Number.isInteger(reason.httpStatus) ? { httpStatus: reason.httpStatus } : {}),
    ...(reason.parserStage ? { parserStage: safeLabel(reason.parserStage) } : {}),
  };
  const safeCode = reason instanceof Error && /^[a-z0-9_]{1,80}$/i.test(reason.message)
    ? reason.message : "provider_unavailable";
  return {
    errorType: safeLabel(reason instanceof Error ? reason.name : typeof reason),
    safeCode,
  };
}

export function logDiagnostic(
  requestId: string,
  stage: DiagnosticStage,
  outcome: "ok" | "error",
  details: Record<string, unknown> = {},
): void {
  const entry = { component: "ai-speech", ...details, requestId, stage, outcome };
  if (outcome === "error") console.error("ai-speech diagnostic", entry);
  else console.info("ai-speech diagnostic", entry);
}

export function rpcFailure(
  rpc: string,
  error: { code?: string; message?: string; status?: number } | null | undefined,
  fallbackCode = "provider_unavailable",
  recognizedCodes: readonly string[] = [],
): ServiceError {
  const safeCode = recognizedCodes.find(code => error?.message?.includes(code)) ?? fallbackCode;
  const rpcCode = safeLabel(error?.code ?? "rpc_error");
  return new ServiceError(safeCode, `rpc_${safeLabel(rpc)}_${rpcCode}`, "supabase", error?.status);
}
