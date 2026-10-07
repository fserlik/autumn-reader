import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
Deno.env.set("LEMONSQUEEZY_WEBHOOK_SECRET", "webhook-test-secret");
Deno.env.set("ALLOWED_ORIGINS", "");

const { handleRequest } = await import("./handler.ts");

async function signature(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("webhook-test-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(result))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    meta: {
      event_name: "subscription_created",
      custom_data: {
        autumn_user_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      },
    },
    data: {
      type: "subscriptions",
      id: "7654321",
      attributes: {
        store_id: 491763,
        customer_id: 1234567,
        variant_id: 2216029,
        status: "active",
        cancelled: false,
        created_at: "2026-10-06T18:00:00.000Z",
        updated_at: "2026-10-06T18:00:01.000Z",
        renews_at: "2026-11-06T18:00:00.000Z",
        ...overrides,
      },
    },
  };
}

Deno.test("rejects an invalid Lemon Squeezy signature", async () => {
  const body = JSON.stringify(payload());
  const response = await handleRequest(new Request("https://example.test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": "invalid",
    },
    body,
  }));

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { code: "invalid_signature" });
});

Deno.test("maps a verified subscription to the authenticated Autumn account", async () => {
  const previous = globalThis.fetch;
  let rpcBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname.endsWith("/rpc/process_billing_event")) {
      rpcBody = await request.json();
      return Response.json(true);
    }

    return Response.json({});
  };

  try {
    const body = JSON.stringify(payload());
    const response = await handleRequest(new Request("https://example.test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": await signature(body),
      },
      body,
    }));

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { received: true, duplicate: false });

    assertEquals(rpcBody?.p_provider, "lemonsqueezy");
    assertEquals(rpcBody?.p_user, "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
    assertEquals(rpcBody?.p_provider_customer_id, "1234567");
    assertEquals(rpcBody?.p_provider_subscription_id, "7654321");
    assertEquals(rpcBody?.p_plan, "plus");
    assertEquals(rpcBody?.p_billing_period, "monthly");
    assertEquals(rpcBody?.p_status, "active");
    assertEquals(rpcBody?.p_cancel_at_period_end, false);
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("maps every configured Lemon Squeezy variant", async () => {
  const previous = globalThis.fetch;
  const observed: Array<[unknown, unknown]> = [];

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname.endsWith("/rpc/process_billing_event")) {
      const args = await request.json() as Record<string, unknown>;
      observed.push([args.p_plan, args.p_billing_period]);
      return Response.json(true);
    }

    return Response.json({});
  };

  try {
    for (const variantId of [2216029, 2216031, 2216032, 2216034]) {
      const body = JSON.stringify(payload({ variant_id: variantId }));
      const response = await handleRequest(new Request("https://example.test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": await signature(body),
        },
        body,
      }));
      assertEquals(response.status, 200);
    }

    assertEquals(observed, [
      ["plus", "monthly"],
      ["plus", "annual"],
      ["pro", "monthly"],
      ["pro", "annual"],
    ]);
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("rejects an unknown variant without writing billing state", async () => {
  const previous = globalThis.fetch;
  let rpcCalled = false;

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname.endsWith("/rpc/process_billing_event")) {
      rpcCalled = true;
    }
    return Response.json(true);
  };

  try {
    const body = JSON.stringify(payload({ variant_id: 9999999 }));
    const response = await handleRequest(new Request("https://example.test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": await signature(body),
      },
      body,
    }));

    assertEquals(response.status, 422);
    assertEquals(await response.json(), { code: "unknown_variant" });
    assertEquals(rpcCalled, false);
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("reports duplicate webhook delivery when the billing RPC returns false", async () => {
  const previous = globalThis.fetch;

  globalThis.fetch = async () => Response.json(false);

  try {
    const body = JSON.stringify(payload());
    const response = await handleRequest(new Request("https://example.test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": await signature(body),
      },
      body,
    }));

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { received: true, duplicate: true });
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("ignores unsupported events after signature verification", async () => {
  const event = payload();
  event.meta.event_name = "order_created";
  const body = JSON.stringify(event);

  const response = await handleRequest(new Request("https://example.test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": await signature(body),
    },
    body,
  }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true, ignored: true });
});
