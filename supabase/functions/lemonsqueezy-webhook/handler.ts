import { admin, json, required } from "../_shared/billing.ts";

type JsonObject = Record<string, unknown>;

type LemonWebhook = {
  meta?: {
    event_name?: unknown;
    custom_data?: JsonObject;
  };
  data?: {
    type?: unknown;
    id?: unknown;
    attributes?: JsonObject;
  };
};

const catalog = new Map<number, {
  plan: "plus" | "pro";
  period: "monthly" | "annual";
}>([
  [2216029, { plan: "plus", period: "monthly" }],
  [2216031, { plan: "plus", period: "annual" }],
  [2216032, { plan: "pro", period: "monthly" }],
  [2216034, { plan: "pro", period: "annual" }],
]);

const handledEvents = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
  "subscription_payment_failed",
  "subscription_payment_success",
  "subscription_payment_recovered",
  "subscription_payment_refunded",
  "subscription_plan_changed",
]);

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }

  return null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;

  return new Date(time).toISOString();
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function validSignature(
  body: string,
  receivedSignature: string,
): Promise<boolean> {
  if (!body || !receivedSignature) return false;

  const expected = await hmacHex(
    required("LEMONSQUEEZY_WEBHOOK_SECRET"),
    body,
  );

  return constantTimeEqual(
    expected.toLowerCase(),
    receivedSignature.trim().toLowerCase(),
  );
}

function normalizeStatus(
  eventName: string,
  attributes: JsonObject,
): "active" | "trialing" | "past_due" | "canceled" | "expired" {
  if (eventName === "subscription_expired") return "expired";
  if (eventName === "subscription_payment_failed") return "past_due";

  const raw = asString(attributes.status)?.toLowerCase();

  switch (raw) {
    case "active":
      return "active";

    case "on_trial":
    case "trialing":
      return "trialing";

    case "past_due":
    case "unpaid":
      return "past_due";

    case "cancelled":
    case "canceled":
      return "canceled";

    case "expired":
      return "expired";

    /*
     * Our entitlement schema does not have a paused state.
     * Treat paused subscriptions as expired until Lemon Squeezy
     * reports them as active again.
     */
    case "paused":
      return "expired";

    default:
      if (
        eventName === "subscription_created" ||
        eventName === "subscription_resumed" ||
        eventName === "subscription_unpaused" ||
        eventName === "subscription_payment_success" ||
        eventName === "subscription_payment_recovered"
      ) {
        return "active";
      }

      throw new Error("unknown_status");
  }
}

function eventTimestamp(
  attributes: JsonObject,
  request: Request,
): string {
  return (
    iso(attributes.updated_at) ??
    iso(attributes.created_at) ??
    iso(request.headers.get("X-Event-Time")) ??
    new Date().toISOString()
  );
}

function currentPeriodStart(attributes: JsonObject): string | null {
  /*
   * Lemon Squeezy doesn't expose a Paddle-style
   * current_period_start field in the subscription payload.
   * created_at is a safe initial value for our existing schema.
   */
  return iso(attributes.created_at);
}

function currentPeriodEnd(attributes: JsonObject): string | null {
  /*
   * renews_at is the end of the current billing cycle.
   * For cancelled/expired subscriptions, ends_at is authoritative.
   */
  return (
    iso(attributes.ends_at) ??
    iso(attributes.renews_at)
  );
}

function isCancelled(attributes: JsonObject): boolean {
  return attributes.cancelled === true ||
    asString(attributes.status)?.toLowerCase() === "cancelled" ||
    asString(attributes.status)?.toLowerCase() === "canceled";
}

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json(request, { code: "forbidden" }, 405);
  }

  const signature = request.headers.get("X-Signature") ?? "";
  const rawBody = await request.text();

  try {
    if (!(await validSignature(rawBody, signature))) {
      console.warn("Lemon Squeezy webhook signature rejected");
      return json(request, { code: "invalid_signature" }, 401);
    }
  } catch (error) {
    console.error("Lemon Squeezy signature verification failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });

    return json(request, { code: "invalid_signature" }, 401);
  }

  let event: LemonWebhook;

  try {
    event = JSON.parse(rawBody) as LemonWebhook;
  } catch {
    return json(request, { code: "invalid_payload" }, 400);
  }

  const eventName = asString(event.meta?.event_name);

  if (!eventName) {
    return json(request, { code: "invalid_event" }, 400);
  }

  if (!handledEvents.has(eventName)) {
    return json(request, {
      received: true,
      ignored: true,
    });
  }

  const data = event.data;

  if (!data || data.type !== "subscriptions") {
    /*
     * Payment events may have a different resource type.
     * They can safely be ignored because subscription_updated
     * is our source of truth for entitlement state.
     */
    return json(request, {
      received: true,
      ignored: true,
    });
  }

  const subscriptionId = asString(data.id);
  const attributes = data.attributes ?? {};

  if (!subscriptionId) {
    return json(request, { code: "invalid_event" }, 422);
  }

  const variantId = asNumber(attributes.variant_id);
  const match = variantId === null ? undefined : catalog.get(variantId);

  if (!match) {
    console.error("Unknown Lemon Squeezy variant", {
      eventName,
      variantId,
      subscriptionId,
    });

    return json(request, { code: "unknown_variant" }, 422);
  }

  const customerId = asString(attributes.customer_id);

  if (!customerId) {
    return json(request, { code: "invalid_customer" }, 422);
  }

  const customData =
    event.meta?.custom_data &&
      typeof event.meta.custom_data === "object"
      ? event.meta.custom_data
      : {};

  const userId =
    asString(customData.autumn_user_id) ??
    asString(customData.user_id);

  const status = normalizeStatus(eventName, attributes);

  /*
   * Generate a deterministic event ID.
   *
   * Lemon Squeezy's webhook payload does not provide the same
   * event-id field Paddle used, so event type + subscription +
   * provider update timestamp gives our existing RPC a stable
   * deduplication key.
   */
  const occurredAt = eventTimestamp(attributes, request);

  const eventId = [
    eventName,
    subscriptionId,
    occurredAt,
  ].join(":");

  const args = {
    p_provider: "lemonsqueezy",
    p_event_id: eventId,
    p_event_type: eventName,
    p_occurred_at: occurredAt,

    p_user: userId,

    p_provider_customer_id: customerId,
    p_provider_subscription_id: subscriptionId,

    p_plan: match.plan,
    p_billing_period: match.period,

    p_status: status,

    p_current_period_start: currentPeriodStart(attributes),
    p_current_period_end: currentPeriodEnd(attributes),

    p_cancel_at_period_end: isCancelled(attributes),
  };

  try {
    const { data: processed, error } = await admin().rpc(
      "process_billing_event",
      args,
    );

    if (error) {
      console.error("Lemon Squeezy webhook database update failed", {
        eventName,
        subscriptionId,
        error: error.message,
      });

      throw new Error("database_unavailable");
    }

    return json(request, {
      received: true,
      duplicate: processed === false,
    });
  } catch (error) {
    console.error("Lemon Squeezy webhook rejected", {
      eventName,
      subscriptionId,
      reason: error instanceof Error ? error.message : "unknown",
    });

    return json(
      request,
      { code: "webhook_processing_failed" },
      422,
    );
  }
}