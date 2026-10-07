import { assertEquals, assert } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
Deno.env.set("LEMONSQUEEZY_API_KEY", "ls_test_api_key");
Deno.env.set("LEMONSQUEEZY_STORE_ID", "491763");
Deno.env.set("LEMONSQUEEZY_PLUS_MONTHLY_VARIANT_ID", "2216029");
Deno.env.set("LEMONSQUEEZY_PLUS_ANNUAL_VARIANT_ID", "2216031");
Deno.env.set("LEMONSQUEEZY_PRO_MONTHLY_VARIANT_ID", "2216032");
Deno.env.set("LEMONSQUEEZY_PRO_ANNUAL_VARIANT_ID", "2216034");
Deno.env.set("ALLOWED_ORIGINS", "http://127.0.0.1:1420");

const { handleRequest } = await import("./handler.ts");
const userId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

Deno.test("checkout binds Lemon Squeezy custom data to the authenticated Supabase user", async () => {
  const previous = globalThis.fetch;
  let checkoutBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: userId,
        email: "reader@example.org",
        aud: "authenticated",
        role: "authenticated",
      });
    }

    checkoutBody = await request.json();
    return Response.json({
      jsonapi: { version: "1.0" },
      links: { self: "https://api.lemonsqueezy.com/v1/checkouts/1" },
      data: {
        type: "checkouts",
        id: "1",
        attributes: {
          url: "https://autumn-reader.lemonsqueezy.com/buy/test-checkout",
        },
      },
    }, { status: 201 });
  };

  try {
    const response = await handleRequest(new Request("https://example.test", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid",
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:1420",
      },
      body: JSON.stringify({
        plan: "plus",
        billingPeriod: "monthly",
        userId: "attacker-controlled",
      }),
    }));

    assertEquals(response.status, 200);

    const responseBody = await response.json() as { checkoutUrl: string };
    assertEquals(
      responseBody.checkoutUrl,
      "https://autumn-reader.lemonsqueezy.com/buy/test-checkout",
    );

    const data = checkoutBody.data as Record<string, unknown>;
    const relationships = data.relationships as Record<string, { data: { type: string; id: string } }>;
    const attributes = data.attributes as Record<string, unknown>;
    const checkoutData = (attributes.checkout_data ?? {}) as Record<string, unknown>;
    const custom = (checkoutData.custom ?? {}) as Record<string, unknown>;

    assertEquals(relationships.store.data.id, "491763");
    assertEquals(relationships.variant.data.id, "2216029");
    assertEquals(custom.autumn_user_id, userId);
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("checkout rejects an unauthenticated request before contacting Lemon Squeezy", async () => {
  const previous = globalThis.fetch;
  let lemonSqueezyCalled = false;

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);

    if (new URL(request.url).pathname === "/auth/v1/user") {
      return Response.json({ message: "invalid" }, { status: 401 });
    }

    lemonSqueezyCalled = true;
    return Response.json({});
  };

  try {
    const response = await handleRequest(new Request("https://example.test", {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plan: "pro", billingPeriod: "annual" }),
    }));

    assertEquals(response.status, 401);
    assert(!lemonSqueezyCalled);
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("checkout maps every paid plan and billing period to its server-owned Lemon Squeezy variant", async () => {
  const previous = globalThis.fetch;
  const observed: string[] = [];

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: userId,
        email: "reader@example.org",
        aud: "authenticated",
        role: "authenticated",
      });
    }

    const body = await request.json() as {
      data: {
        relationships: {
          variant: { data: { id: string } };
        };
      };
    };
    observed.push(body.data.relationships.variant.data.id);

    return Response.json({
      data: {
        type: "checkouts",
        id: "1",
        attributes: {
          url: "https://autumn-reader.lemonsqueezy.com/buy/test-checkout",
        },
      },
    }, { status: 201 });
  };

  try {
    for (const [plan, billingPeriod] of [
      ["plus", "monthly"],
      ["plus", "annual"],
      ["pro", "monthly"],
      ["pro", "annual"],
    ] as const) {
      const response = await handleRequest(new Request("https://example.test", {
        method: "POST",
        headers: {
          Authorization: "Bearer valid",
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:1420",
        },
        body: JSON.stringify({ plan, billingPeriod }),
      }));

      assertEquals(response.status, 200);
    }

    assertEquals(observed, ["2216029", "2216031", "2216032", "2216034"]);
  } finally {
    globalThis.fetch = previous;
  }
});
