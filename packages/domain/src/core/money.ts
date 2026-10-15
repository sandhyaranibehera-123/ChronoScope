/**
 * Money representation — system-guarantees.md rule 15:
 * "Amounts use currency + amount_minor BIGINT."
 *
 * Prevents floating point errors in monetary calculations.
 */

export interface Money {
  readonly currency: string;
  readonly amountMinor: bigint;
}

export function createMoney(currency: string, amountMinor: bigint | number | string): Money {
  const normCurrency = currency.toUpperCase().trim();
  if (!normCurrency || normCurrency.length !== 3) {
    throw new Error(`Invalid currency code: '${currency}'. Must be 3-letter ISO code.`);
  }

  const parsed = typeof amountMinor === 'bigint' ? amountMinor : BigInt(amountMinor);
  if (parsed < 0n) {
    throw new Error(`Monetary amount cannot be negative: ${parsed}`);
  }

  return { currency: normCurrency, amountMinor: parsed };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch in addition: '${a.currency}' vs '${b.currency}'`);
  }
  return { currency: a.currency, amountMinor: a.amountMinor + b.amountMinor };
}

export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch in subtraction: '${a.currency}' vs '${b.currency}'`);
  }
  if (a.amountMinor < b.amountMinor) {
    throw new Error(
      `Insufficient funds for subtraction: have ${a.amountMinor.toString()} minor units, need ${b.amountMinor.toString()}`,
    );
  }
  return { currency: a.currency, amountMinor: a.amountMinor - b.amountMinor };
}

export function compareMoney(a: Money, b: Money): number {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch in comparison: '${a.currency}' vs '${b.currency}'`);
  }
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

export function formatMoney(money: Money, decimalPlaces: number = 2): string {
  const factor = 10n ** BigInt(decimalPlaces);
  const whole = money.amountMinor / factor;
  const remainder = money.amountMinor % factor;
  const remStr = remainder.toString().padStart(decimalPlaces, '0');
  return `${money.currency} ${whole.toString()}.${remStr}`;
}
