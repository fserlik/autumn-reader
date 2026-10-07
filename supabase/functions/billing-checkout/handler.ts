import {
  authenticatedUser,
  cors,
  json,
  originAllowed,
  required,
  type BillingPeriod,
  type PaidPlan,
} from "../_shared/billing.ts";

function variantId(plan: PaidPlan, billingPeriod: BillingPeriod): string {
  const planKey = plan === "plus" ? "PLUS" : "PRO";
  const periodKey = billingPeriod === "monthly" ? "MONTHLY" : "ANNUAL";
  const value = required(`LEMONSQUEEZY_${planKey}_${periodKey}_VARIANT_ID`);

  if (!/^\d+$/.test(value)) throw new Error("backend_not_configured");
  return value;
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
      (body.plan !== "plus" && body.plan !== "pro") ||
      (body.billingPeriod !== "monthly" &&
        body.billingPeriod !== "annual")
    ) {
      return json(request, { code: "invalid_plan" }, 400);
    }

    const plan = body.plan as PaidPlan;
    const billingPeriod = body.billingPeriod as BillingPeriod;

    const storeId = required("LEMONSQUEEZY_STORE_ID");
    const selectedVariantId = variantId(plan, billingPeriod);

    if (!/^\d+$/.test(storeId)) {
      throw new Error("backend_not_configured");
    }

    const response = await fetch(
      "https://api.lemonsqueezy.com/v1/checkouts",
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.api+json",
          "Content-Type": "application/vnd.api+json",
          Authorization: `Bearer ${required("LEMONSQUEEZY_API_KEY")}`,
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
