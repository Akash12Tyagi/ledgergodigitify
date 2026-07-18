// Section 2.8 — the ONLY money utilities in the codebase (Law 2: money is
// integer paise everywhere in storage/math/transport; Law 10: no
// duplicated logic — every other file that needs to parse or render money
// imports from here, never re-implements it).

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyParseError";
  }
}

function assertSafeInteger(n: number, label: string): void {
  if (!Number.isSafeInteger(n)) {
    throw new MoneyParseError(`${label} must be a safe integer, got ${n}`);
  }
}

/**
 * Parses a rupee-denominated user input into integer paise.
 * Accepts: "12000", "12,000", "₹12,000", "12000.50", or a plain number.
 * Rejects: negatives, more than 2 decimal places, non-numeric input.
 */
export function toPaise(rupeeInput: string | number): number {
  const raw = typeof rupeeInput === "number" ? String(rupeeInput) : rupeeInput;
  const cleaned = raw.trim().replace(/^₹\s*/, "").replace(/,/g, "");

  if (cleaned === "") {
    throw new MoneyParseError("Amount is required");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new MoneyParseError(
      `"${raw}" is not a valid amount (no negatives, no more than 2 decimal places)`
    );
  }

  const [rupeesPart, decimalPart = ""] = cleaned.split(".");
  const rupees = Number(rupeesPart);
  const paiseFraction = Number(decimalPart.padEnd(2, "0"));

  const paise = rupees * 100 + paiseFraction;
  assertSafeInteger(paise, "Parsed amount");
  return paise;
}

/**
 * Renders integer paise as an en-IN grouped rupee string.
 * 1200050 -> "₹12,000.50"; 123456789 -> "₹12,34,567.89";
 * whole rupees render without decimals: 1200000 -> "₹12,000".
 */
export function formatINR(paise: number, opts?: { showSign?: boolean }): string {
  assertSafeInteger(paise, "paise");

  const negative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupees = Math.floor(absPaise / 100);
  const remainder = absPaise % 100;

  const rupeesFormatted = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(rupees);
  const decimalSuffix = remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`;
  const sign = negative ? "-" : opts?.showSign ? "+" : "";

  return `${sign}₹${rupeesFormatted}${decimalSuffix}`;
}

/**
 * Section 7.13 — CSV exports need a plain numeric rupee string (no ₹
 * symbol, no thousands grouping) so spreadsheet tools treat the column as
 * a number, not text. Never used for on-screen display — that's always
 * formatINR.
 */
export function paiseToRupeesPlain(paise: number): string {
  assertSafeInteger(paise, "paise");
  const negative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupees = Math.floor(absPaise / 100);
  const remainder = absPaise % 100;
  const sign = negative ? "-" : "";
  return remainder === 0 ? `${sign}${rupees}` : `${sign}${rupees}.${String(remainder).padStart(2, "0")}`;
}

export function addPaise(a: number, b: number): number {
  assertSafeInteger(a, "a");
  assertSafeInteger(b, "b");
  const result = a + b;
  assertSafeInteger(result, "result");
  return result;
}

export function subtractPaise(a: number, b: number): number {
  assertSafeInteger(a, "a");
  assertSafeInteger(b, "b");
  const result = a - b;
  assertSafeInteger(result, "result");
  return result;
}
