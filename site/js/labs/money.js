// Lab 03: money as binary floating point versus integer minor units.

const DECIMAL = /^\s*(-)?(\d+)(?:\.(\d*))?\s*$/;

/** "19.99" -> 1999n. Rejects input with more decimals than the currency has. */
export function parseMinor(text, scale = 2) {
  const m = DECIMAL.exec(String(text));
  if (!m) throw new RangeError(`not an amount: ${JSON.stringify(text)}`);
  const frac = m[3] ?? "";
  if (frac.length > scale) throw new RangeError(`${text.trim()} has more than ${scale} decimal places`);
  const minor = BigInt(m[2]) * 10n ** BigInt(scale) + BigInt((frac + "0".repeat(scale)).slice(0, scale) || "0");
  return m[1] ? -minor : minor;
}

export function formatMinor(minor, scale = 2) {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const base = 10n ** BigInt(scale);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(scale, "0");
  return `${neg ? "-" : ""}${whole}${scale ? `.${frac}` : ""}`;
}

/** Split `total` into parts by integer `weights`, distributing the remainder by largest remainder. Sums exactly. */
export function allocate(total, weights) {
  if (total < 0n) throw new RangeError("total must be non-negative");
  if (!weights.length || weights.some((w) => !Number.isInteger(w) || w < 0)) throw new RangeError("weights must be non-negative integers");
  const sum = BigInt(weights.reduce((a, b) => a + b, 0));
  if (sum === 0n) throw new RangeError("weights must not all be zero");
  const parts = weights.map((w) => (total * BigInt(w)) / sum);
  const rems = weights.map((w, i) => ({ i, r: (total * BigInt(w)) % sum }));
  let left = total - parts.reduce((a, b) => a + b, 0n);
  rems.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (let k = 0; left > 0n; k++, left--) parts[rems[k % rems.length].i] += 1n;
  return parts;
}

/** The common float approach: divide, round each share to 2 dp. */
export function floatSplit(total, ways) {
  const share = Math.round((total / ways) * 100) / 100;
  return Array.from({ length: ways }, () => share);
}

export function floatSum(values) {
  return values.reduce((a, b) => a + b, 0);
}

/** Compare both representations for a split. */
export function compareSplit(totalText, ways) {
  const totalMinor = parseMinor(totalText);
  const totalFloat = Number(totalText);
  const floats = floatSplit(totalFloat, ways);
  const floatTotal = floatSum(floats);
  const ints = allocate(totalMinor, Array(ways).fill(1));
  const intTotal = ints.reduce((a, b) => a + b, 0n);
  return {
    total: formatMinor(totalMinor),
    float: { shares: floats, sum: floatTotal, sumText: String(floatTotal), exact: floatTotal === totalFloat },
    integer: { shares: ints.map((m) => formatMinor(m)), sum: formatMinor(intTotal), exact: intTotal === totalMinor },
  };
}

/** Compare summing a list of amounts both ways. */
export function compareSum(texts) {
  const floats = texts.map(Number);
  const floatTotal = floatSum(floats);
  const minor = texts.map((t) => parseMinor(t)).reduce((a, b) => a + b, 0n);
  const exact = formatMinor(minor);
  return { floatText: String(floatTotal), exact, matches: String(floatTotal) === String(Number(exact)) && Number(exact) === floatTotal };
}
