export function strictParse(value: string): number {
  return /^(-|\+)?(\d+|Infinity)$/.test(value) ? Number(value) : NaN;
}
