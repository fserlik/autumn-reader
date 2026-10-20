import { assertEquals, assert } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
Deno.env.set("LEMONSQUEEZY_API_KEY", "ls_test_api_key");
Deno.env.set("LEMONSQUEEZY_STORE_ID", "491763");
Deno.env.set("LEMONSQUEEZY_MODE", "test");
Deno.env.set("LEMONSQUEEZY_PREMIUM_MONTHLY_VARIANT_ID", "991001");
Deno.env.set("LEMONSQUEEZY_PREMIUM_LIFETIME_VARIANT_ID", "991002");
Deno.env.set("ALLOWED_ORIGINS", "http://127.0.0.1:1420");

const { handleRequest } = await import("./handler.ts");
const userId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function lemonCatalog(path: string): Response | undefined {
  const variant = path.match(/^\/v1\/variants\/(\d+)$/)?.[1];
  if (variant) {
    const monthly = variant === "991001";
    return Response.json({ data: { type: "variants", id: variant, attributes: {
      product_id: monthly ? 88001 : 88002, test_mode: true,
      price: monthly ? 599 : 11999, status: "published",
      is_subscription: monthly, interval: monthly ? "month" : null,
      interval_count: monthly ? 1 : null,
    } } });
  }
  if (/^\/v1\/products\/8800[12]$/.test(path)) return Response.json({
    data: { type: "products", id: path.split("/").at(-1), attributes: { store_id: 491763, test_mode: true } },
  });
  return undefined;
}

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

    const catalog = lemonCatalog(url.pathname);
    if (catalog) return catalog;

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
        plan: "premium",
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
    assertEquals(relationships.variant.data.id, "991001");
    assertEquals(custom.autumn_user_id, userId);
    assertEquals(custom.autumn_plan, "premium");
    assertEquals(custom.autumn_billing_period, "monthly");
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
      body: JSON.stringify({ plan: "premium", billingPeriod: "lifetime" }),
    }));

    assertEquals(response.status, 401);
    assert(!lemonSqueezyCalled);
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("checkout maps both Premium purchase options to server-owned Lemon Squeezy variants", async () => {
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

    const catalog = lemonCatalog(url.pathname);
    if (catalog) return catalog;

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
      ["premium", "monthly"],
      ["premium", "lifetime"],
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

    assertEquals(observed, ["991001", "991002"]);
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("checkout fails closed when the provider catalog does not match the configured offer", async () => {
  const previous = globalThis.fetch;
  let checkoutCreated = false;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === "/auth/v1/user") return Response.json({ id:userId,email:"reader@example.org",aud:"authenticated",role:"authenticated" });
    if (path === "/v1/variants/991001") return Response.json({ data:{ type:"variants",id:"991001",attributes:{
      product_id:88001,test_mode:true,price:999,status:"published",is_subscription:true,interval:"month",interval_count:1,
    } } });
    if (path === "/v1/products/88001") return Response.json({ data:{type:"products",id:"88001",attributes:{store_id:491763,test_mode:true}} });
    checkoutCreated = true;
    return Response.json({});
  };
  try {
    const response = await handleRequest(new Request("https://example.test",{method:"POST",headers:{Authorization:"Bearer valid","Content-Type":"application/json",Origin:"http://127.0.0.1:1420"},body:JSON.stringify({plan:"premium",billingPeriod:"monthly"})}));
    assertEquals(response.status,503);
    assertEquals(await response.json(),{code:"backend_not_configured"});
    assertEquals(checkoutCreated,false);
  } finally { globalThis.fetch=previous; }
});
