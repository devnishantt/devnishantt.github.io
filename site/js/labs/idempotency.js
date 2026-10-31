// Lab 02: a client retries a payment because the response got lost on the way back.

export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function createServer({ idempotency = true } = {}) {
  const charges = [];
  const keys = new Map();
  let seq = 0;

  function charge(body) {
    seq += 1;
    const record = { id: `ch_${String(seq).padStart(3, "0")}`, amount: body.amount };
    charges.push(record);
    return { status: 201, body: { charge: record.id, amount: record.amount } };
  }

  return {
    charges,
    keys,
    /** POST /payments */
    handle({ key = null, body }) {
      if (!idempotency || !key) return { ...charge(body), replayed: false };
      const fingerprint = canonical(body);
      const stored = keys.get(key);
      if (stored) {
        if (stored.fingerprint !== fingerprint) {
          return { status: 422, body: { error: "Idempotency-Key was already used with a different request body" }, replayed: false };
        }
        return { ...stored.response, replayed: true };
      }
      const response = charge(body);
      keys.set(key, { fingerprint, response });
      return { ...response, replayed: false };
    },
  };
}

/**
 * The client sends one payment intent. Each attempt's response is lost if `lost[i]` is true,
 * which makes the client time out and retry (up to `lost.length + 1` attempts).
 */
export function simulate({ idempotency = true, amount = 500, lost = [true, true], changeAmountOnRetry = false, key = "k_7f3a9c" } = {}) {
  const server = createServer({ idempotency });
  const events = [];
  const maxAttempts = lost.length + 1;
  let received = null;

  for (let attempt = 1; attempt <= maxAttempts && !received; attempt++) {
    const body = { amount: changeAmountOnRetry && attempt > 1 ? amount + 1 : amount, to: "acct_42" };
    events.push({ from: "client", to: "server", attempt,
      text: `POST /payments ${idempotency ? `Idempotency-Key: ${key}` : "(no key)"} amount=${body.amount}` });
    const res = server.handle({ key: idempotency ? key : null, body });
    const what = res.status === 201
      ? (res.replayed ? `replays stored response for ${res.body.charge}, no new charge` : `creates ${res.body.charge} and charges ${res.body.amount}`)
      : `rejects: ${res.body.error}`;
    events.push({ from: "server", to: "server", attempt, status: res.status, text: what, replayed: res.replayed });
    if (lost[attempt - 1]) {
      events.push({ from: "network", to: "client", attempt, lost: true, text: `${res.status} response lost, client times out` });
    } else {
      events.push({ from: "server", to: "client", attempt, status: res.status, text: `${res.status} ${res.status === 201 ? "Created" : "Unprocessable"}` });
      received = res;
    }
  }

  const totalCharged = server.charges.reduce((s, c) => s + c.amount, 0);
  return {
    events,
    attempts: events.filter((e) => e.from === "client").length,
    charges: server.charges.map((c) => ({ ...c })),
    totalCharged,
    intended: amount,
    gotResponse: Boolean(received),
    broken: server.charges.length > 1,
  };
}
