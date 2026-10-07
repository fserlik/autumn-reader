import {
  admin,
  authenticatedUser,
  cors,
  json,
  originAllowed,
  required,
} from "../_shared/billing.ts";

export async function handleRequest(request: Request): Promise<Response> {
  if (!originAllowed(request)) {
    return json(request, { code: "forbidden" }, 403);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(request) });
  }

  if (request.method !== "POST") {
    return json(request, { code: "forbidden" }, 405);
  }

  try {
    const userId = await authenticatedUser(request);

    if (!userId) {
      return json(request, { code: "session_expired" }, 401);
    }

    const { data, error } = await admin().rpc("billing_customer", {
      p_user: userId,
    });

    const customer = data as {
      provider?: unknown;
      customerId?: unknown;
      subscriptionId?: unknown;
    } | null;

    if (
      error ||
      customer?.provider !== "lemonsqueezy" ||
      typeof customer.subscriptionId !== "string"
    ) {
      return json(
        request,
        { code: "billing_portal_unavailable" },
        409,
      );
    }

    const response = await fetch(
      `https://api.lemonsqueezy.com/v1/subscriptions/${
        encodeURIComponent(customer.subscriptionId)
      }`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.api+json",
          Authorization: `Bearer ${required("LEMONSQUEEZY_API_KEY")}`,
        },
      },
    );

    const payload = await response.json().catch(() => null) as {
      data?: {
        attributes?: {
          urls?: {
            customer_portal?: unknown;
          };
        };
      };
      errors?: unknown;
    } | null;

    if (!response.ok) {
      console.error("Lemon Squeezy subscription retrieval failed", {
        status: response.status,
        errors: payload?.errors,
      });

      throw new Error("billing_provider_unavailable");
    }

    const portalUrl =
      payload?.data?.attributes?.urls?.customer_portal;

    if (typeof portalUrl !== "string") {
      return json(
        request,
        { code: "billing_portal_unavailable" },
        409,
      );
    }

    const parsedUrl = new URL(portalUrl);

    if (parsedUrl.protocol !== "https:") {
      throw new Error("billing_provider_unavailable");
    }

    return json(request, {
      portalUrl: parsedUrl.toString(),
    });
  } catch (error) {
    const code = error instanceof Error
      ? error.message
      : "billing_provider_unavailable";

    console.error("Billing portal failed", { code });

    return json(
      request,
      {
        code: code === "backend_not_configured"
          ? code
          : "billing_provider_unavailable",
      },
      503,
    );
  }
}
