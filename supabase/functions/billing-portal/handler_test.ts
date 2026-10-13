import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
Deno.env.set("LEMONSQUEEZY_API_KEY", "ls_test_api_key");
Deno.env.set("ALLOWED_ORIGINS", "http://127.0.0.1:1420");

const { handleRequest } = await import("./handler.ts");

const portalRequest = () =>
  new Request("https://example.test", {
    method: "POST",
    headers: {
      Authorization: "Bearer valid",
      Origin: "http://127.0.0.1:1420",
    },
  });

Deno.test("portal uses the authenticated user's stored Lemon Squeezy customer", async () => {
  const previous = globalThis.fetch;
  const paths: string[] = [];

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    paths.push(path);

    if (path === "/auth/v1/user") {
      return Response.json({
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        aud: "authenticated",
        role: "authenticated",
      });
    }

    if (path.endsWith("/rpc/billing_customer")) {
      return Response.json({
        provider: "lemonsqueezy",
        customerId: "1234567",
        subscriptionId: "7654321",
      });
    }

    return Response.json({
      data: {
        type: "customers",
        id: "1234567",
        attributes: {
          urls: {
            customer_portal:
              "https://app.lemonsqueezy.com/my-orders/test-portal",
          },
        },
      },
    });
  };

  try {
    const response = await handleRequest(portalRequest());

    assertEquals(response.status, 200);
    assertEquals(
      (await response.json()).portalUrl,
      "https://app.lemonsqueezy.com/my-orders/test-portal",
    );
    assertEquals(paths.at(-1), "/v1/customers/1234567");
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("portal falls back to the subscription when the customer lookup fails", async () => {
  const previous = globalThis.fetch;
  const providerPaths: string[] = [];

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;

    if (path === "/auth/v1/user") {
      return Response.json({
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        aud: "authenticated",
        role: "authenticated",
      });
    }

    if (path.endsWith("/rpc/billing_customer")) {
      return Response.json({
        provider: "lemonsqueezy",
        customerId: "stale-customer",
        subscriptionId: "7654321",
      });
    }

    providerPaths.push(path);

    if (path.startsWith("/v1/customers/")) {
      return Response.json({ errors: [{ title: "Not found" }] }, {
        status: 404,
      });
    }

    return Response.json({
      data: {
        type: "subscriptions",
        id: "7654321",
        attributes: {
          urls: {
            customer_portal: "https://app.lemonsqueezy.com/my-orders/fallback",
          },
        },
      },
    });
  };

  try {
    const response = await handleRequest(portalRequest());

    assertEquals(response.status, 200);
    assertEquals(
      (await response.json()).portalUrl,
      "https://app.lemonsqueezy.com/my-orders/fallback",
    );
    assertEquals(providerPaths, [
      "/v1/customers/stale-customer",
      "/v1/subscriptions/7654321",
    ]);
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("portal returns a controlled error when no provider identity exists", async () => {
  const previous = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;

    if (path === "/auth/v1/user") {
      return Response.json({
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        aud: "authenticated",
        role: "authenticated",
      });
    }

    return Response.json({
      provider: "lemonsqueezy",
      customerId: null,
      subscriptionId: null,
    });
  };

  try {
    const response = await handleRequest(portalRequest());

    assertEquals(response.status, 409);
    assertEquals(await response.json(), { code: "billing_portal_unavailable" });
  } finally {
    globalThis.fetch = previous;
  }
});

Deno.test("portal keeps provider failures generic", async () => {
  const previous = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;

    if (path === "/auth/v1/user") {
      return Response.json({
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        aud: "authenticated",
        role: "authenticated",
      });
    }

    if (path.endsWith("/rpc/billing_customer")) {
      return Response.json({
        provider: "lemonsqueezy",
        customerId: "1234567",
        subscriptionId: null,
      });
    }

    return Response.json({ errors: [{ detail: "secret provider detail" }] }, {
      status: 401,
    });
  };

  try {
    const response = await handleRequest(portalRequest());

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      code: "billing_provider_unavailable",
    });
  } finally {
    globalThis.fetch = previous;
  }
});
