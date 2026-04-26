// Stripe Checkout / Payment Link helper.
//
// Add-on, not a dependency: when STRIPE_SECRET_KEY is unset every function
// returns { stub: true } with a synthetic URL the rep can paste into the
// invoice's paymentUrl field manually. Real mode uses Stripe's Payment
// Links API directly via fetch (no @stripe/stripe-node dep) so the install
// cost stays at zero unless the integration is actually wired.

const PAYMENT_LINKS_URL = 'https://api.stripe.com/v1/payment_links';
const PRICES_URL = 'https://api.stripe.com/v1/prices';

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

interface CreateLinkInput {
  amountCents: number;
  currency?: string; // ISO 4217, default 'usd'
  description: string;
  invoiceId: string; // our id — round-tripped via metadata for the webhook
}

export interface PaymentLinkResult {
  url: string;
  stub: boolean;
  // Stripe's own ids surfaced for audit + future inspection.
  paymentLinkId?: string;
  priceId?: string;
}

async function stripeForm<T>(url: string, body: URLSearchParams): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY!;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Stripe ${url} ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

/** Creates a one-line price + a hosted Payment Link tagged with our invoice
 *  id. The link is single-use semantically (one invoice = one link). */
export async function createPaymentLinkForInvoice(
  input: CreateLinkInput,
): Promise<PaymentLinkResult> {
  if (!isStripeConfigured()) {
    return {
      url: `https://example.com/stub-stripe-link/${input.invoiceId}`,
      stub: true,
    };
  }
  const currency = (input.currency ?? 'usd').toLowerCase();

  // Stripe wants a Price (or product_data inline). Inline product_data is
  // simplest — no separate Product object to manage.
  const priceBody = new URLSearchParams();
  priceBody.set('unit_amount', String(input.amountCents));
  priceBody.set('currency', currency);
  priceBody.set('product_data[name]', input.description);
  const price = await stripeForm<{ id: string }>(PRICES_URL, priceBody);

  const linkBody = new URLSearchParams();
  linkBody.set('line_items[0][price]', price.id);
  linkBody.set('line_items[0][quantity]', '1');
  linkBody.set('metadata[invoiceId]', input.invoiceId);
  // Limit to a single payment so the link can't be reused.
  linkBody.set('restrictions[completed_sessions][limit]', '1');
  const link = await stripeForm<{ id: string; url: string }>(PAYMENT_LINKS_URL, linkBody);

  return { url: link.url, stub: false, paymentLinkId: link.id, priceId: price.id };
}
