// Utils.num_str / comma_sepi from the original.

/** Integers with thousands separators; floats (Netcoin) with up to 5 decimals by magnitude. */
export function numStr(n: number, isFloat = false): string {
  if (isFloat) {
    // decimal_places = min(5 - floor(log10(num)), 5); "%.*f" (log of 0 is -inf -> 5 places)
    const places = n > 0 ? Math.min(5 - Math.floor(Math.log(n) / Math.log(10)), 5) : 5;
    return n.toFixed(Math.max(0, places));
  }
  const neg = n < 0;
  let i = Math.abs(Math.trunc(n));
  let out = '';
  while (i > 999) {
    out = ',' + String(i % 1000).padStart(3, '0') + out;
    i = Math.floor(i / 1000);
  }
  return (neg ? '-' : '') + String(i) + out;
}
