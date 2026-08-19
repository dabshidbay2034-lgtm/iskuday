/**
 * Paying for a booking, and what a guest is offered.
 *
 * ── WHY MOBILE MONEY AND NOT CARDS ──────────────────────────────────────────
 * Card penetration in Somalia is negligible and Stripe does not operate here.
 * What people actually have is a mobile wallet tied to their SIM: EVC Plus on
 * Hormuud, Zaad on Telesom, Sahal on Golis, eDahab on Somtel. A checkout that
 * asks for a 16-digit card number is a checkout nobody completes. So the
 * primary flow is "type the number you pay from, approve the push on your
 * handset", and cards are the afterthought rather than the default.
 *
 * ── WHY THE SECRET IS NOT IN THIS FILE ──────────────────────────────────────
 * Sifalo authenticates with an API User and API Key from the merchant
 * dashboard. Anything in `src/` is compiled into the browser bundle and is
 * therefore public, so this module NEVER calls the provider. It computes what
 * is owed, describes the options, and hands off to the `sifalo-payment` edge
 * function, which holds the credentials server-side. Treat any change that
 * introduces a fetch to a provider from this file as a credential leak.
 *
 * ── WHY THE AMOUNT IS COMPUTED IN TWO PLACES ────────────────────────────────
 * `amountDueNow` below is for DISPLAY. The edge function recomputes the same
 * figure from the booking row before charging anything, because a number that
 * arrived from a browser is a suggestion, not a fact. The duplication is
 * deliberate and the two must agree; the test suite pins the rounding rule that
 * makes them agree.
 */

/** How a guest settles a booking. Mirrors bookings.payment_option. */
export type PaymentOption = "pay_now" | "deposit" | "at_hotel";

export const PAYMENT_OPTIONS: PaymentOption[] = ["pay_now", "deposit", "at_hotel"];

export const PAYMENT_OPTION_META: Record<
  PaymentOption,
  { label: string; hint: string; /** Does this route involve the provider at all? */ online: boolean }
> = {
  pay_now: {
    label: "Pay now in full",
    hint: "Room is confirmed the moment the payment clears.",
    online: true,
  },
  deposit: {
    label: "Pay a deposit",
    hint: "Hold the room now, settle the rest at the hotel.",
    online: true,
  },
  at_hotel: {
    label: "Pay at the hotel",
    hint: "Nothing to pay now. The hotel confirms and you settle on arrival.",
    online: false,
  },
};

/**
 * The wallets a guest can pay from.
 *
 * `key` is what the provider expects in its `gateway` field and is FROZEN once
 * any payment has used it — renaming one orphans every historical row.
 *
 * The order is not alphabetical and not arbitrary: EVC Plus first because
 * Hormuud is the largest network in Mogadishu by a wide margin, and a guest
 * scanning this list should find theirs without reading it.
 */
export type GatewayKey = "evcplus" | "zaad" | "edahab" | "sahal" | "premier" | "card";

export const GATEWAYS: {
  key: GatewayKey;
  label: string;
  /** The operator, shown small — several wallets are known by network locally. */
  network: string;
  /** Placeholder showing the shape of a number on this network. */
  accountHint: string;
  /** Cards take a pan, not an msisdn, and skip the account field entirely. */
  usesPhone: boolean;
}[] = [
  { key: "evcplus", label: "EVC Plus",       network: "Hormuud", accountHint: "61xxxxxxx", usesPhone: true },
  { key: "zaad",    label: "Zaad",           network: "Telesom", accountHint: "63xxxxxxx", usesPhone: true },
  { key: "edahab",  label: "eDahab",         network: "Somtel",  accountHint: "65xxxxxxx", usesPhone: true },
  { key: "sahal",   label: "Sahal",          network: "Golis",   accountHint: "90xxxxxxx", usesPhone: true },
  { key: "premier", label: "Premier Wallet", network: "Premier Bank", accountHint: "61xxxxxxx", usesPhone: true },
  { key: "card",    label: "Card",           network: "Visa / Mastercard", accountHint: "", usesPhone: false },
];

export function gatewayMeta(key: string) {
  return GATEWAYS.find((g) => g.key === key);
}

/**
 * What the guest pays right now, in whole cents of the quoted currency.
 *
 * Rounded UP to two decimals for a deposit. Rounding down would leave a
 * fraction of a cent uncollected on every booking, and a hotel reconciling
 * against the provider's statement would find every line a cent short — which
 * reads as a bug in the platform long before anyone suspects rounding.
 */
export function amountDueNow(
  total: number,
  option: PaymentOption,
  depositPercent: number,
): number {
  if (option === "at_hotel") return 0;
  if (option === "pay_now") return round2(total);
  const pct = clampPercent(depositPercent);
  return round2Up((total * pct) / 100);
}

/** The part settled on arrival. Never negative, even on a misconfigured hotel. */
export function amountDueLater(
  total: number,
  option: PaymentOption,
  depositPercent: number,
): number {
  return Math.max(0, round2(total - amountDueNow(total, option, depositPercent)));
}

/**
 * The options a hotel actually offers, in a stable order.
 *
 * A hotel whose column is empty or unrecognised falls back to `at_hotel` rather
 * than to nothing: a booking form with no way to proceed is worse than one that
 * takes the booking and asks for money at the desk, which is how every hotel
 * here operated before this feature existed.
 */
export function offeredOptions(raw: string[] | null | undefined): PaymentOption[] {
  const allowed = (raw ?? []).filter((o): o is PaymentOption =>
    (PAYMENT_OPTIONS as string[]).includes(o),
  );
  const ordered = PAYMENT_OPTIONS.filter((o) => allowed.includes(o));
  return ordered.length > 0 ? ordered : ["at_hotel"];
}

/** 1–100. A hotel storing 0 or 150 gets the product default rather than a free stay. */
export function clampPercent(percent: number | null | undefined): number {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 1 || n > 100) return 25;
  return Math.round(n);
}

/**
 * Digits only.
 *
 * People type "+252 61 555 0142", "061-5550142" and "0615550142" for the same
 * wallet. The provider wants one of them; stripping to digits is the only part
 * we can do safely without guessing at a country prefix that would silently
 * charge the wrong account.
 */
export function normaliseAccount(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

/**
 * Is this plausibly a Somali mobile-money number?
 *
 * Deliberately loose. The provider is the authority on what its gateways
 * accept, and a validator that is stricter than the provider rejects paying
 * customers — which is a far more expensive mistake than passing a bad number
 * through and surfacing the provider's own error. This catches typing accidents
 * (three digits, a pasted email) and nothing more.
 */
export function looksLikeAccount(input: string): boolean {
  const digits = normaliseAccount(input);
  return digits.length >= 7 && digits.length <= 15;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round2Up(n: number): number {
  return Math.ceil(n * 100) / 100;
}
