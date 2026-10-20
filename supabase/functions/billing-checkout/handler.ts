import {
  authenticatedUser,
  cors,
  json,
  originAllowed,
  required,
  type BillingPeriod,
  type PaidPlan,
} from "../_shared/billing.ts";

function variantId(_plan: PaidPlan, billingPeriod: BillingPeriod): string {
  const periodKey = billingPeriod === "monthly" ? "MONTHLY" : "LIFETIME";
  const value = required(`LEMONSQUEEZY_PREMIUM_${periodKey}_VARIANT_ID`);

  if (!/^\d+$/.test(value)) throw new Error("backend_not_configured");
  return value;
}

type LemonResource = { data?: { attributes?: Record<string, unknown> } };

async function lemonResource(path: string, apiKey: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.lemonsqueezy.com/v1${path}`, {
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const payload = await response.json().catch(() => null) as LemonResource | null;
  if (!response.ok || !payload?.data?.attributes) {
  console.error("Lemon resource verification failed", {
    path,
    status: response.status,
    hasAttributes: Boolean(payload?.data?.attributes),
  });
  throw new Error("backend_not_configured");
}
  return payload.data.attributes;
}

async function verifyConfiguredOffer(
  billingPeriod: BillingPeriod,
  selectedVariantId: string,
  storeId: string,
  apiKey: string,
): Promise<void> {
  const mode = required("LEMONSQUEEZY_MODE");

  if (mode !== "test" && mode !== "live") {
    throw new Error("backend_not_configured");
  }

  const variant = await lemonResource(`/variants/${selectedVariantId}`, apiKey);

  const productId = variant.product_id;

  if (!Number.isInteger(productId)) {
    throw new Error("backend_not_configured");
  }

  const product = await lemonResource(`/products/${String(productId)}`, apiKey);

  const expectedTestMode = mode === "test";
  const expectedPrice = billingPeriod === "monthly" ? 599 : 11999;

  const cadenceMatches = billingPeriod === "monthly"
    ? variant.is_subscription === true &&
      variant.interval === "month" &&
      variant.interval_count === 1
    : variant.is_subscription === false;

  // DIAGNÓSTICO: identificar qué configuración falla
  console.log("Billing variant verification", {
    billingPeriod,
    selectedVariantId,
    configuredStoreId: storeId,
    actualStoreId: product.store_id,
    configuredMode: mode,
    productTestMode: product.test_mode,
    variantTestMode: variant.test_mode,
    expectedPrice,
    actualPrice: variant.price,
    cadenceMatches,
    status: variant.status,
  });

  if (
    String(product.store_id) !== storeId ||
    product.test_mode !== expectedTestMode ||
    variant.test_mode !== expectedTestMode ||
    variant.price !== expectedPrice ||
    !cadenceMatches ||
    !["published", "pending"].includes(String(variant.status))
  ) {
    throw new Error("backend_not_configured");
  }
}

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

    const body = await request.json().catch(() => null) as {
      plan?: unknown;
      billingPeriod?: unknown;
    } | null;

    if (
      !body ||
      body.plan !== "premium" ||
      (body.billingPeriod !== "monthly" &&
        body.billingPeriod !== "lifetime")
    ) {
      return json(request, { code: "invalid_plan" }, 400);
    }

    const plan = body.plan as PaidPlan;
    const billingPeriod = body.billingPeriod as BillingPeriod;

    const storeId = required("LEMONSQUEEZY_STORE_ID");
    const selectedVariantId = variantId(plan, billingPeriod);
    const apiKey = required("LEMONSQUEEZY_API_KEY");

    if (!/^\d+$/.test(storeId)) {
      throw new Error("backend_not_configured");
    }

    await verifyConfiguredOffer(billingPeriod, selectedVariantId, storeId, apiKey);

    const response = await fetch(
      "https://api.lemonsqueezy.com/v1/checkouts",
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.api+json",
          "Content-Type": "application/vnd.api+json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: "checkouts",
            attributes: {
              product_options: {
                enabled_variants: [Number(selectedVariantId)],
              },
              checkout_data: {
                custom: {
                  autumn_user_id: userId,
                  autumn_plan: plan,
                  autumn_billing_period: billingPeriod,
                },
              },
            },
            relationships: {
              store: {
                data: {
                  type: "stores",
                  id: storeId,
                },
              },
              variant: {
                data: {
                  type: "variants",
                  id: selectedVariantId,
                },
              },
            },
          },
        }),
      },
    );

    const payload = await response.json().catch(() => null) as {
      data?: {
        id?: unknown;
        attributes?: {
          url?: unknown;
        };
      };
      errors?: unknown;
    } | null;

    if (!response.ok) {
      console.error("Lemon Squeezy checkout creation failed", {
        status: response.status,
        errors: payload?.errors,
      });
      throw new Error("billing_provider_unavailable");
    }

    const checkoutId = payload?.data?.id;
    const checkoutUrl = payload?.data?.attributes?.url;

    if (
      typeof checkoutId !== "string" ||
      typeof checkoutUrl !== "string"
    ) {
      throw new Error("billing_provider_unavailable");
    }

    const parsedUrl = new URL(checkoutUrl);

    if (parsedUrl.protocol !== "https:") {
      throw new Error("billing_provider_unavailable");
    }

    return json(request, {
      transactionId: checkoutId,
      checkoutUrl: parsedUrl.toString(),
    });
  } catch (error) {
    const code = error instanceof Error
      ? error.message
      : "billing_provider_unavailable";

    console.error("Billing checkout failed", { code });

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
