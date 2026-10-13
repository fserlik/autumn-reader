import {
  admin,
  authenticatedUser,
  cors,
  json,
  originAllowed,
  required,
} from "../_shared/billing.ts";

type BillingIdentity = {
  provider?: unknown;
  customerId?: unknown;
  subscriptionId?: unknown;
};

type PortalResource = {
  kind: "customer" | "subscription";
  path: string;
};

type ProviderPayload = {
  data?: {
    attributes?: {
      urls?: {
        customer_portal?: unknown;
      };
    };
  };
};

function diagnostic(
  requestId: string,
  stage: string,
  outcome: "ok" | "error",
  details: { errorType?: string; providerStatus?: number } = {},
): void {
  const entry = {
    component: "billing-portal",
    requestId,
    stage,
    outcome,
    ...details,
  };

  if (outcome === "error") console.error("billing-portal diagnostic", entry);
  else console.info("billing-portal diagnostic", entry);
}

function portalResources(customer: BillingIdentity): PortalResource[] {
  const resources: PortalResource[] = [];

  if (
    typeof customer.customerId === "string" && customer.customerId.length > 0
  ) {
    resources.push({
      kind: "customer",
      path: `customers/${encodeURIComponent(customer.customerId)}`,
    });
  }

  if (
    typeof customer.subscriptionId === "string" &&
    customer.subscriptionId.length > 0
  ) {
    resources.push({
      kind: "subscription",
      path: `subscriptions/${encodeURIComponent(customer.subscriptionId)}`,
    });
  }

  return resources;
}

async function fetchPortalUrl(
  resource: PortalResource,
  apiKey: string,
  requestId: string,
): Promise<string | null> {
  let response: Response;

  try {
    response = await fetch(`https://api.lemonsqueezy.com/v1/${resource.path}`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch {
    diagnostic(requestId, "provider_request", "error", {
      errorType: `${resource.kind}_network_error`,
    });
    return null;
  }

  const payload = await response.json().catch(() => null) as
    | ProviderPayload
    | null;

  if (!response.ok) {
    diagnostic(requestId, "provider_request", "error", {
      errorType: `${resource.kind}_http_error`,
      providerStatus: response.status,
    });
    return null;
  }

  const portalUrl = payload?.data?.attributes?.urls?.customer_portal;

  if (typeof portalUrl !== "string") {
    diagnostic(requestId, "provider_response", "error", {
      errorType: `${resource.kind}_portal_url_missing`,
      providerStatus: response.status,
    });
    return null;
  }

  try {
    const parsedUrl = new URL(portalUrl);

    if (parsedUrl.protocol !== "https:") throw new Error("invalid_protocol");

    diagnostic(requestId, "provider_request", "ok", {
      providerStatus: response.status,
    });
    return parsedUrl.toString();
  } catch {
    diagnostic(requestId, "provider_response", "error", {
      errorType: `${resource.kind}_portal_url_invalid`,
      providerStatus: response.status,
    });
    return null;
  }
}

export async function handleRequest(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();

  if (!originAllowed(request)) {
    diagnostic(requestId, "origin", "error", { errorType: "origin_rejected" });
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
      diagnostic(requestId, "authentication", "error", {
        errorType: "session_expired",
      });
      return json(request, { code: "session_expired" }, 401);
    }

    diagnostic(requestId, "authentication", "ok");

    const { data, error } = await admin().rpc("billing_customer", {
      p_user: userId,
    });
    const customer = data as BillingIdentity | null;

    if (error) {
      diagnostic(requestId, "billing_identity", "error", {
        errorType: "billing_identity_query_failed",
      });
      return json(request, { code: "billing_portal_unavailable" }, 409);
    }

    if (customer?.provider !== "lemonsqueezy") {
      diagnostic(requestId, "billing_identity", "error", {
        errorType: "unsupported_billing_provider",
      });
      return json(request, { code: "billing_portal_unavailable" }, 409);
    }

    const resources = portalResources(customer);

    if (resources.length === 0) {
      diagnostic(requestId, "billing_identity", "error", {
        errorType: "provider_identity_missing",
      });
      return json(request, { code: "billing_portal_unavailable" }, 409);
    }

    diagnostic(requestId, "billing_identity", "ok");

    const apiKey = required("LEMONSQUEEZY_API_KEY");

    for (const resource of resources) {
      const portalUrl = await fetchPortalUrl(resource, apiKey, requestId);

      if (portalUrl) {
        diagnostic(requestId, "complete", "ok");
        return json(request, { portalUrl });
      }
    }

    diagnostic(requestId, "complete", "error", {
      errorType: "provider_portal_unavailable",
    });
    return json(request, { code: "billing_provider_unavailable" }, 503);
  } catch (error) {
    const errorType = error instanceof Error &&
        error.message === "backend_not_configured"
      ? "backend_not_configured"
      : "unexpected_error";

    diagnostic(requestId, "complete", "error", { errorType });

    return json(
      request,
      {
        code: errorType === "backend_not_configured"
          ? errorType
          : "billing_provider_unavailable",
      },
      503,
    );
  }
}
