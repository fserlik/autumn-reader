const required = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const apiKey = required("LEMONSQUEEZY_API_KEY");
const storeId = required("LEMONSQUEEZY_STORE_ID");
const mode = required("LEMONSQUEEZY_MODE");
if (!/^[0-9]+$/.test(storeId) || !["test", "live"].includes(mode)) throw new Error("Invalid store or mode configuration");

const offers = [
  { name: "monthly", env: "LEMONSQUEEZY_PREMIUM_MONTHLY_VARIANT_ID", confirmedId: "2236412", price: 599, subscription: true },
  { name: "lifetime", env: "LEMONSQUEEZY_PREMIUM_LIFETIME_VARIANT_ID", confirmedId: "2236414", price: 11999, subscription: false },
];

const request = async path => {
  const response = await fetch(`https://api.lemonsqueezy.com/v1${path}`, { headers: {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${apiKey}`,
  }});
  if (!response.ok) throw new Error(`Lemon Squeezy API rejected ${path} (${response.status})`);
  const payload = await response.json();
  if (!payload?.data?.attributes) throw new Error(`Malformed Lemon Squeezy response for ${path}`);
  return payload.data;
};

const verified = [];
for (const offer of offers) {
  const variantId = required(offer.env);
  if (variantId !== offer.confirmedId) throw new Error(`${offer.env} must be the confirmed variant ${offer.confirmedId}`);
  const variant = await request(`/variants/${variantId}`);
  const attrs = variant.attributes;
  const product = await request(`/products/${attrs.product_id}`);
  const expectedTestMode = mode === "test";
  const intervalValid = offer.subscription
  ? attrs.is_subscription === true &&
    attrs.interval === "month" &&
    attrs.interval_count === 1
  : attrs.is_subscription === false;
  if (String(product.attributes.store_id) !== storeId) throw new Error(`${offer.name} variant belongs to another store`);
  if (attrs.test_mode !== expectedTestMode || product.attributes.test_mode !== expectedTestMode) throw new Error(`${offer.name} variant belongs to the wrong Lemon Squeezy environment`);
  if (attrs.price !== offer.price || !intervalValid) {
  throw new Error(`${offer.name} variant mismatch: ${JSON.stringify({
    expected: {
      priceUsdCents: offer.price,
      is_subscription: offer.subscription,
      interval: offer.subscription ? "month" : null,
      interval_count: offer.subscription ? 1 : null
    },
    actual: {
      priceUsdCents: attrs.price,
      is_subscription: attrs.is_subscription,
      interval: attrs.interval,
      interval_count: attrs.interval_count
    }
  })}`);
}
  if (!["published", "pending"].includes(attrs.status)) throw new Error(`${offer.name} variant is not available`);
  verified.push({ offer: offer.name, variantId, priceUsdCents: attrs.price, testMode: attrs.test_mode, storeId });
}

console.log(JSON.stringify({ ok: true, mode, offers: verified }, null, 2));
