import { createClient } from "npm:@supabase/supabase-js";

export const required = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error("backend_not_configured");
  return value;
};

const allowedOrigins = (): Set<string> =>
  new Set(
    (Deno.env.get("ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin":
      origin && allowedOrigins().has(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return !origin || allowedOrigins().has(origin);
}

export function json(
  request: Request,
  body: unknown,
  status = 200,
): Response {
  return Response.json(body, { status, headers: cors(request) });
}

export function admin() {
  return createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export async function authenticatedUser(
  request: Request,
): Promise<string | null> {
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer (.+)$/)?.[1];

  if (!token) return null;

  const { data, error } = await admin().auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

export type PaidPlan = "plus" | "pro";
export type BillingPeriod = "monthly" | "annual";
