export function strictParse(value: string): number {
  return /^(-|\+)?(\d+|Infinity)$/.test(value) ? Number(value) : NaN;
}

export function itemAfter<T>(x: T, xs: T[]): T {
  const idx = xs.indexOf(x);
  return xs[(idx + 1) % xs.length];
}

export function rotateToLast<T>(xs: T[], x: T): T[] {
  const idx = xs.indexOf(x);
  return idx === -1 ? xs : xs.slice(idx + 1).concat(xs.slice(0, idx + 1));
}
