import * as race from "./labs/race.js";
import * as retry from "./labs/idempotency.js";
import * as money from "./labs/money.js";
import * as chain from "./labs/chain.js";
import * as approvals from "./labs/approvals.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- lab registry

const LAB_INFO = [
  { id: "race", short: "Double withdraw", title: "Withdraw the same money twice", inv: "cash_dispensed <= opening_balance" },
  { id: "retry", short: "Triple charge", title: "Get charged three times", inv: "charges(intent) <= 1" },
  { id: "money", short: "Lost cent", title: "Make a cent disappear", inv: "sum(shares) == total" },
  { id: "chain", short: "Rewrite history", title: "Rewrite history unnoticed", inv: "verify(log) detects any change" },
  { id: "approve", short: "Solo close", title: "Close an incident alone", inv: "approvers - {author} >= 2" },
];
const LABS = LAB_INFO.map((l) => l.id);
const STATE_LABEL = { untested: "untested", tried: "probing", broken: "broken", held: "held" };

// ---------------------------------------------------------------- scoreboard

const SCORE_KEY = "nishant.labs.v1";

function loadScore() {
  try {
    const s = JSON.parse(localStorage.getItem(SCORE_KEY));
    if (s && Array.isArray(s.broke) && Array.isArray(s.tried) && Number.isInteger(s.held)) {
      s.last = s.last && typeof s.last === "object" ? s.last : {};
      return s;
    }
  } catch { /* storage unavailable or corrupt */ }
  return { broke: [], tried: [], held: 0, last: {} };
}
let score = loadScore();

function saveScore() {
  try { localStorage.setItem(SCORE_KEY, JSON.stringify(score)); } catch { /* private mode */ }
}

function bump(el) {
  if (reduced || !el) return;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
  setTimeout(() => el.classList.remove("bump"), 260);
}

/** Session state for one lab: the latest outcome, falling back to "broken" if it was ever broken. */
function labState(lab) {
  const last = score.last[lab];
  if (last) return last;
  if (score.broke.includes(lab)) return "broken";
  return score.tried.includes(lab) ? "tried" : "untested";
}

function renderMonitor() {
  $("#monitor-rows").innerHTML = LAB_INFO.map((l, i) => {
    const st = labState(l.id);
    return `<li class="monitor-row"><span class="n">${String(i + 1).padStart(2, "0")}</span>
      <a class="inv" href="#lab-${l.id}"><b>${esc(l.title)}</b><code>${esc(l.inv)}</code></a>
      <span class="badge ${st}">${STATE_LABEL[st]}</span></li>`;
  }).join("");
  $$(".rail-item").forEach((a) => { a.dataset.state = labState(a.dataset.lab); });
  LABS.forEach((lab) => {
    const el = $(`#lab-${lab} .lab-state`);
    const st = labState(lab);
    el.dataset.state = st;
    el.textContent = STATE_LABEL[st];
  });
}

function renderScore(changed) {
  $("#score-broken").textContent = score.broke.length;
  $("#score-held").textContent = score.held;
  $("#score-labs").textContent = `${score.tried.length}/${LABS.length}`;
  renderMonitor();
  if (changed) bump($(changed));
}

function record(lab, outcome) {
  if (!score.tried.includes(lab)) score.tried.push(lab);
  let changed = "#score-labs";
  if (outcome === "broke" && !score.broke.includes(lab)) { score.broke.push(lab); changed = "#score-broken"; }
  if (outcome === "held") { score.held += 1; changed = "#score-held"; }
  score.last[lab] = outcome === "broke" ? "broken" : outcome === "held" ? "held" : "tried";
  saveScore();
  renderScore(changed);
  const card = $(`#lab-${lab}`);
  card.classList.toggle("is-broken", outcome === "broke");
  card.classList.toggle("is-held", outcome === "held");
  if (outcome === "broke" && !reduced) {
    card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
  }
}

const runs = {};
/** Start a new run for a lab: clear the stale verdict and return a guard that is false once superseded. */
function startRun(lab) {
  runs[lab] = (runs[lab] || 0) + 1;
  const mine = runs[lab];
  $(`#${lab}-verdict`).innerHTML = "";
  return () => runs[lab] === mine;
}

function verdict(target, kind, title, why) {
  const tag = { bad: "BROKEN", good: "HELD", info: "NOTE" }[kind];
  $(target).innerHTML = `<div class="verdict-box ${kind}"><span class="verdict-tag">${tag}</span><p><b>${title}</b></p>${why ? `<p class="why">${why}</p>` : ""}</div>`;
}

function meta(lab, text, kind = "") {
  const el = $(`#${lab}-meta`);
  el.textContent = text;
  el.className = `output-meta${kind ? ` ${kind}` : ""}`;
}

function emptyState(glyph, text) {
  return `<div class="empty-state"><span class="empty-glyph" aria-hidden="true">${glyph}</span><p>${text}</p></div>`;
}

$("#score-reset").addEventListener("click", () => {
  score = { broke: [], tried: [], held: 0, last: {} };
  saveScore();
  renderScore();
  $$(".lab").forEach((l) => l.classList.remove("is-broken", "is-held"));
  toast("Score reset");
});

// ---------------------------------------------------------------- lab rail

$("#lab-rail").innerHTML = LAB_INFO.map((l, i) =>
  `<li><a class="rail-item" href="#lab-${l.id}" data-lab="${l.id}"><span class="n">${String(i + 1).padStart(2, "0")}</span>${esc(l.short)}</a></li>`).join("");

// ---------------------------------------------------------------- lab 01: race

const raceMode = () => $('input[name="race-mode"]:checked').value;
let raceSeed = Math.floor(Math.random() * 1e6);
const RACE_EMPTY = emptyState("T1 &#8644; T2", "Race once to see how the two transactions interleave, step by step.");

function showRaceSql() {
  const sql = esc(race.MODES[raceMode()].sql)
    .replace(/\b(SELECT|UPDATE|SET|WHERE|BEGIN|COMMIT|FOR UPDATE)\b/g, '<span class="k">$1</span>')
    .replace(/; /g, ";\n");
  $("#race-sql").innerHTML = sql;
}

function runRace() {
  const current = startRun("race");
  const mode = raceMode();
  // One run, one random interleaving. No retrying until it breaks: the failure rate shown is the real one.
  const r = race.simulate({ mode, seed: raceSeed++ });
  meta("race", `seed ${raceSeed - 1} · running`);

  const lanes = r.transactions.map((t) => {
    const items = r.events.map((e, i) => ({ e, i })).filter(({ e }) => e.tx === t.id);
    const lis = items.map(({ e, i }) =>
      `<li class="op-${e.op}" style="animation-delay:${reduced ? 0 : i * 110}ms"><span class="t">t${e.tick || i}</span><span>${esc(e.text)}</span></li>`).join("");
    return `<div class="race-lane"><h4>${t.name} withdraws ${t.amount} <span class="outcome ${t.outcome}">${t.outcome}</span></h4><ol>${lis}</ol></div>`;
  }).join("");
  $("#race-board").innerHTML = `
    <div class="race-lanes">${lanes}</div>
    <div class="race-meter">
      <div>account held<b>${r.initial}</b></div>
      <div class="${r.paidOut > r.initial ? "bad" : "good"}">cash dispensed<b>${r.paidOut}</b></div>
      <div class="${r.broken ? "bad" : "good"}">final balance<b>${r.final}</b></div>
    </div>`;

  const delay = reduced ? 0 : r.events.length * 110 + 150;
  setTimeout(() => {
    if (!current()) return;
    if (r.broken) {
      meta("race", `seed ${raceSeed - 1} · invariant violated`, "bad");
      verdict("#race-verdict", "bad", `The bank paid out ${r.paidOut} from an account that held ${r.initial}.`,
        `Both transactions read the balance before either wrote it, so both saw ${r.initial} and both approved. The second write overwrote the first. That is a lost update, and ${r.missing} just left the building.`);
      record("race", "broke");
    } else if (mode === "naive") {
      meta("race", `seed ${raceSeed - 1} · lucky schedule`);
      verdict("#race-verdict", "info", "This interleaving happened to be safe.", "The reads did not overlap this time. Race again, or race 1,000 times to see how often they do: the bug only needs it once.");
      record("race", "tried");
    } else {
      meta("race", `seed ${raceSeed - 1} · invariant held`, "good");
      verdict("#race-verdict", "good", `Exactly one withdrawal went through. ${r.initial} in, ${r.paidOut} out, ${r.final} left.`,
        mode === "locked"
          ? "The second transaction blocks on the row lock until the first commits, then reads the real balance and is rejected."
          : "The check and the write are one atomic statement. The second UPDATE matches zero rows, so there is nothing to race.");
      record("race", "held");
    }
  }, delay);
}

function raceMany() {
  startRun("race");
  const mode = raceMode();
  const n = 1000;
  const r = race.breakRate({ runs: n, firstSeed: raceSeed, mode });
  raceSeed += n;
  const pct = (r.rate * 100).toFixed(1);
  $("#race-board").innerHTML = `
    <div class="histogram" role="img" aria-label="${r.broken} of ${n} runs broke the invariant">
      <span class="h-bad" style="width:0%"></span><span class="h-good" style="width:100%"></span>
    </div>
    <div class="race-meter">
      <div>schedules tried<b>${n.toLocaleString()}</b></div>
      <div class="${r.broken ? "bad" : "good"}">money from nothing<b>${r.broken.toLocaleString()}</b></div>
      <div class="${r.broken ? "bad" : "good"}">failure rate<b>${pct}%</b></div>
    </div>`;
  const bad = $("#race-board .h-bad");
  const good = $("#race-board .h-good");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!bad.isConnected) return; // board was replaced (mode switched) before the animation started
    bad.style.width = `${pct}%`;
    good.style.width = `${100 - pct}%`;
  }));
  if (r.broken) {
    meta("race", `${n} schedules · ${pct}% broken`, "bad");
    verdict("#race-verdict", "bad", `${r.broken} of ${n} schedules paid out more than the account held.`,
      "Tests that run one request at a time will never see this. Production, with real concurrency, sees it on a busy day.");
    record("race", "broke");
  } else {
    meta("race", `${n} schedules · 0 broken`, "good");
    verdict("#race-verdict", "good", `0 of ${n} schedules broke conservation.`, "Every interleaving the scheduler could produce leaves money in equal to money out.");
    record("race", "held");
  }
}

$$('input[name="race-mode"]').forEach((i) => i.addEventListener("change", () => {
  startRun("race");
  showRaceSql();
  $("#race-board").innerHTML = RACE_EMPTY;
  meta("race", "idle");
}));
$("#race-run").addEventListener("click", runRace);
$("#race-many").addEventListener("click", raceMany);
showRaceSql();

// ---------------------------------------------------------------- lab 02: retries

function syncSlider() {
  const s = $("#retry-lost");
  $("#retry-lost-out").textContent = s.value;
  s.style.setProperty("--fill", `${(s.value / s.max) * 100}%`);
}
$("#retry-lost").addEventListener("input", syncSlider);
syncSlider();

$("#retry-run").addEventListener("click", () => {
  const current = startRun("retry");
  const idempotency = $("#retry-key").checked;
  const lostCount = Number($("#retry-lost").value);
  const r = retry.simulate({
    idempotency,
    lost: Array(lostCount).fill(true),
    changeAmountOnRetry: $("#retry-mutate").checked,
  });
  $("#retry-charges").innerHTML = "";
  meta("retry", `${r.attempts} attempt${r.attempts === 1 ? "" : "s"} · in flight`);
  $("#retry-seq").innerHTML = `<ol>${r.events.map((e, i) => {
    const cls = [`from-${e.from}`, e.from === "server" && e.text.startsWith("creates") ? "charged" : "", e.replayed ? "replayed" : ""].join(" ");
    const who = e.from === "network" ? "network" : e.from === "client" ? `client #${e.attempt}` : "server";
    return `<li class="${cls}" style="animation-delay:${reduced ? 0 : i * 140}ms"><span class="who">${who}</span><span class="msg">${esc(e.text)}</span></li>`;
  }).join("")}</ol>`;

  setTimeout(() => {
    if (!current()) return;
    const rows = r.charges.map((c, i) =>
      `<li class="${i > 0 ? "dup" : ""}"><span>${esc(c.id)}</span><span>${esc(c.amount)}</span></li>`).join("")
      || `<li><span class="muted">no charges</span><span>0</span></li>`;
    $("#retry-charges").innerHTML = `
      <div class="statement-head"><span>card statement</span><span>order total ${esc(r.intended)}</span></div>
      <ul>${rows}</ul>
      <div class="total ${r.broken ? "bad" : "good"}"><span>charged</span><b>${esc(r.totalCharged)}</b></div>`;
    if (r.broken) {
      meta("retry", `${r.charges.length} charges for 1 payment`, "bad");
      verdict("#retry-verdict", "bad", `One payment, ${r.charges.length} charges: the customer paid ${r.totalCharged} for a ${r.intended} order.`,
        "The server cannot tell a retry from a new payment, so every timeout becomes another charge. The client did nothing wrong: retrying is correct behaviour.");
      record("retry", "broke");
    } else if (lostCount === 0) {
      meta("retry", "delivered first time");
      verdict("#retry-verdict", "info", "Nothing was lost, so there was nothing to retry.", "Raise “responses lost” to make the client time out.");
      record("retry", "tried");
    } else {
      const replays = r.events.filter((e) => e.replayed).length;
      const rejected = r.events.some((e) => e.status === 422);
      meta("retry", `${r.attempts} attempts · 1 charge`, "good");
      verdict("#retry-verdict", "good", `${r.attempts} attempts, exactly one charge of ${r.totalCharged}.`,
        rejected
          ? "Reusing a key with a different body is refused with 422 instead of silently charging the new amount."
          : `The server stored the first response under the key and replayed it ${replays} time${replays === 1 ? "" : "s"}. No new charge.`);
      record("retry", "held");
    }
  }, reduced ? 0 : r.events.length * 140 + 120);
});

// ---------------------------------------------------------------- lab 03: money

function renderMoney() {
  const total = $("#money-total").value;
  const ways = Math.max(1, Math.min(12, Number($("#money-ways").value) || 1));
  const sumInputs = $("#money-sum").value.split(/[,\s]+/).filter(Boolean);
  $$("#money-presets .preset").forEach((p) => p.classList.toggle("active",
    p.dataset.total === total && Number(p.dataset.ways) === ways && p.dataset.sum === $("#money-sum").value));
  try {
    const c = money.compareSplit(total, ways);
    const s = sumInputs.length ? money.compareSum(sumInputs) : null;
    const floatBad = !c.float.exact || (s && !s.matches);
    $("#money-out").innerHTML = `
      <div class="money-col ${floatBad ? "bad" : ""}">
        <h4><span>number (IEEE 754 double)</span><span>${floatBad ? "wrong" : "lucky"}</span></h4>
        <div class="shares">${c.float.shares.map((x) => `<span>${esc(x.toFixed(2))}</span>`).join("")}</div>
        <div class="total"><span>shares add up to</span><b>${esc(c.float.sumText)}</b></div>
        ${s ? `<div class="sum-line">${esc(sumInputs.join(" + "))} = ${esc(s.floatText)}</div>` : ""}
      </div>
      <div class="money-col good">
        <h4><span>integer minor units (BigInt cents)</span><span>exact</span></h4>
        <div class="shares">${c.integer.shares.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
        <div class="total"><span>shares add up to</span><b>${esc(c.integer.sum)}</b></div>
        ${s ? `<div class="sum-line">${esc(sumInputs.join(" + "))} = ${esc(s.exact)}</div>` : ""}
      </div>`;
    if (floatBad) {
      meta("money", "float drifted", "bad");
      const lost = !c.float.exact ? `The float shares add up to ${c.float.sumText}, not ${c.total}.` : `${sumInputs.join(" + ")} is ${s.floatText} as a float.`;
      verdict("#money-verdict", "bad", esc(lost),
        "Binary floating point cannot represent most decimal fractions, and rounding each share independently drops or invents cents. Integers plus a largest-remainder split always sum to the total.");
      return "broke";
    }
    meta("money", "both agree");
    verdict("#money-verdict", "info", "Both columns agree for these numbers.", "Try 100.00 split 3 ways, 0.10 + 0.20, or 9.99 split 7 ways.");
    return "tried";
  } catch (err) {
    $("#money-out").innerHTML = "";
    meta("money", "rejected at input", "good");
    verdict("#money-verdict", "good", "Rejected at the boundary.", `${esc(err.message)}. Amounts with more precision than the currency has are refused instead of being rounded silently.`);
    return "held";
  }
}

let moneyTimer;
let moneyLast = null;
function moneyChanged(delay = 350) {
  clearTimeout(moneyTimer);
  moneyTimer = setTimeout(() => {
    const outcome = renderMoney();
    if (outcome !== moneyLast || outcome === "held") record("money", outcome);
    moneyLast = outcome;
  }, delay);
}
["#money-total", "#money-ways", "#money-sum"].forEach((sel) => $(sel).addEventListener("input", () => moneyChanged()));
$("#money-presets").addEventListener("click", (e) => {
  const p = e.target.closest(".preset");
  if (!p) return;
  $("#money-total").value = p.dataset.total;
  $("#money-ways").value = p.dataset.ways;
  $("#money-sum").value = p.dataset.sum;
  moneyChanged(0);
});
renderMoney();

// ---------------------------------------------------------------- lab 04: audit chain

let original = [];
let ledger = [];
let checkpoint = null;

async function resetChain() {
  original = await chain.build(chain.SAMPLE);
  ledger = original.map((r) => ({ ...r, data: { ...r.data } }));
  checkpoint = chain.checkpointOf(original);
  await renderChain(false);
}

function tampered() {
  if (ledger.length !== original.length) return true;
  return ledger.some((r, i) => chain.canonical(r.data) !== chain.canonical(original[i].data) || r.hash !== original[i].hash);
}

async function renderChain(score = true, flashSeq = null) {
  const useCp = $("#chain-checkpoint").checked;
  const v = await chain.verify(ledger, useCp ? checkpoint : null);
  const badSeqs = new Set(v.issues.map((i) => i.seq));
  const missing = checkpoint && useCp ? checkpoint.count - ledger.length : 0;
  $("#chain-list").innerHTML = ledger.map((r, i) => `
    <li class="chain-row ${badSeqs.has(r.seq) ? "bad" : "ok"}${flashSeq === i ? " flash" : ""}">
      <span class="seqno">${r.seq}</span>
      <span class="memo"><b>${esc(r.data.memo)}</b><small>${esc(r.data.at)}</small></span>
      <input aria-label="amount for entry ${r.seq}" data-i="${i}" value="${esc(money.formatMinor(BigInt(r.data.amount)))}" inputmode="decimal" spellcheck="false">
      <span class="hashes"><span>prev <b>${r.prev.slice(0, 10)}</b></span><span>hash <b>${r.hash.slice(0, 10)}</b></span></span>
    </li>`).join("") + (missing > 0
    ? `<li class="chain-row bad missing"><span class="seqno">${ledger.length}</span><span>missing: the checkpoint expected ${missing} more record${missing === 1 ? "" : "s"}</span></li>` : "");
  $("#chain-cp").innerHTML = useCp
    ? `checkpoint published at ${original.length} records: <b>${checkpoint.head.slice(0, 16)}…</b> stored where the database cannot write`
    : "no checkpoint: verification only checks that each record links to the one before it";
  meta("chain", v.ok ? `${ledger.length} records · verify OK` : `${v.issues.length} issue${v.issues.length === 1 ? "" : "s"} found`, v.ok ? "" : "good");

  if (!score) { $("#chain-verdict").innerHTML = ""; return; }
  if (!tampered()) {
    verdict("#chain-verdict", "info", "Untouched. Every link verifies.", "Change an amount, delete the last row, or re-hash everything.");
    return;
  }
  if (v.ok) {
    meta("chain", "tampered · verify OK", "bad");
    verdict("#chain-verdict", "bad", "You rewrote history and verification still says OK.",
      "Without an external checkpoint, a chain that was truncated or fully re-hashed is internally consistent. Turn the checkpoint back on and look again.");
    record("chain", "broke");
  } else {
    const first = v.issues[0];
    verdict("#chain-verdict", "good", `Caught at record ${first.seq}: ${esc(first.message)}.`,
      v.issues.length > 1 ? `${v.issues.length} problems found in total. Every edit, deletion and re-hash shows up.` : "Changing any byte changes the hash, and every later record depends on it.");
    record("chain", "held");
  }
}

$("#chain-list").addEventListener("change", async (e) => {
  const input = e.target.closest("input[data-i]");
  if (!input) return;
  const i = Number(input.dataset.i);
  try {
    ledger[i] = { ...ledger[i], data: { ...ledger[i].data, amount: Number(money.parseMinor(input.value)) } };
    await renderChain(true, i);
  } catch (err) {
    verdict("#chain-verdict", "info", "That is not an amount.", esc(err.message));
  }
});
$("#chain-drop").addEventListener("click", async () => {
  if (ledger.length > 1) ledger.pop();
  await renderChain();
});
$("#chain-forge").addEventListener("click", async () => {
  ledger = await chain.forge(ledger);
  await renderChain();
});
$("#chain-reset").addEventListener("click", resetChain);
$("#chain-checkpoint").addEventListener("change", () => renderChain(tampered()));

// ---------------------------------------------------------------- lab 05: approvals

let incident = null;
let evidenceCount = 0;

async function resetIncident() {
  incident = await approvals.createIncident();
  evidenceCount = 0;
  $("#approve-log").innerHTML = "";
  $("#approve-verdict").innerHTML = "";
  renderIncident();
}

function renderIncident() {
  const s = incident;
  const idx = approvals.FLOW.indexOf(s.status);
  const flow = approvals.FLOW.map((f, i) => `<span class="${i < idx ? "done" : i === idx ? "now" : ""}">${f}</span>`).join("");
  const valid = approvals.currentApprovers(s).length;
  const approvalsHtml = s.approvals.length
    ? s.approvals.map((a) => {
      const stale = a.manifest !== s.manifest;
      const self = a.actor === s.creator;
      return `<li class="${stale ? "stale" : ""} ${self ? "self" : ""}"><span>${esc(a.actor)}${self ? " (author)" : ""}</span><span class="muted">${a.manifest.slice(0, 8)}${stale ? " stale" : ""}</span></li>`;
    }).join("")
    : `<li><span class="muted">none yet</span></li>`;
  const ev = s.evidence.length ? s.evidence.map((e) => `${esc(e.ref)} <span class="muted">by ${esc(e.by)}</span>`).join("<br>") : `<span class="muted">none</span>`;
  $("#approve-state").innerHTML = `
    <div class="incident-card">
      <h4>${esc(s.id)} · ${esc(s.title)}</h4>
      <div class="flow">${flow}</div>
      <dl class="kv">
        <dt>author</dt><dd>${esc(s.creator)}</dd>
        <dt>revision</dt><dd>${s.revision}</dd>
        <dt>manifest</dt><dd>sha256:${s.manifest.slice(0, 16)}…</dd>
        <dt>evidence</dt><dd>${ev}</dd>
      </dl>
    </div>
    <div class="incident-card">
      <h4>approvals · ${valid} of 2 valid</h4>
      <ul class="approvals-list">${approvalsHtml}</ul>
    </div>`;
  meta("approve", `${s.id} · ${s.status} · rev ${s.revision}`, s.status === "resolved" ? "good" : "");
}

$("#approve-actions").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const type = btn.dataset.action;
  if (type === "reset") return resetIncident();
  const enforce = $("#approve-enforce").checked;
  const actor = $('input[name="actor"]:checked').value;
  const action = { type, actor };
  if (type === "evidence") action.ref = `evidence-${++evidenceCount}.log`;
  const res = await approvals.apply(incident, action, { enforce });
  const li = document.createElement("li");
  li.className = `s${String(res.status)[0]}`;
  li.innerHTML = `<span class="code">${res.status}</span><span>${esc(actor)}: ${esc(type)}</span><span>${esc(res.message)}</span>`;
  $("#approve-log").prepend(li);
  incident = res.state;
  renderIncident();

  if (type === "resolve" && res.ok) {
    const audit = approvals.auditResolution(incident);
    if (audit.legitimate) {
      verdict("#approve-verdict", "info", "Resolved legitimately.", `${esc(audit.reason)}. Now try to do it dishonestly: reset, self-approve, or add evidence after the sign-offs.`);
      record("approve", "tried");
    } else {
      meta("approve", `${incident.id} · closed illegitimately`, "bad");
      verdict("#approve-verdict", "bad", `INC-1042 is closed, and an audit says it should not be: ${esc(audit.reason)}.`,
        "When “resolved” is just a status field guarded in the UI, anyone who can send the request can close it. Turn on server-side enforcement and try again.");
      record("approve", "broke");
    }
  } else if (!res.ok && enforce && ["approve", "resolve"].includes(type) && [403, 412].includes(res.status)) {
    verdict("#approve-verdict", "good", `Refused with ${res.status}.`, `${esc(res.message)}. The rule lives on the server and is checked against the evidence hash, not a checkbox.`);
    record("approve", "held");
  }
});
$("#approve-enforce").addEventListener("change", resetIncident);

// ---------------------------------------------------------------- status page & work

const WORK = [
  { repo: "ledgerline", name: "Ledgerline", lab: "lab-money", tags: ["React", "Hono", "Cloudflare D1", "Zod"],
    what: "Reconciles bank statements against ledger records.",
    hard: "Integer minor-unit money, ambiguous matches left unresolved instead of guessed, reviewer-gated approvals and a hash-linked audit chain." },
  { repo: "aftermark", name: "Aftermark", lab: "lab-approve", tags: ["Fastify", "Bun", "Cloudflare D1", "OpenAPI"],
    what: "Evidence-driven incident response API.",
    hard: "Closure needs two non-creator approvals of the current SHA-256 evidence manifest; every write claims the next revision." },
  { repo: "bank-management-system", name: "bank-management-system", lab: "lab-race", tags: ["Express 5", "Prisma", "PostgreSQL", "Docker"],
    what: "Banking REST API.",
    hard: "Double-entry ledger, row-locked transfers in a fixed order so they cannot deadlock, and Idempotency-Key retries." },
  { repo: "Pactrail", name: "Pactrail", lab: null, tags: ["TypeScript", "Zod", "Ajv", "Vitest"],
    what: "API contract checks and OpenAPI breaking-change detection.",
    hard: "Anything it cannot prove backward-compatible is flagged for review and blocks CI. 639 tests, mostly schema boundary cases." },
  { repo: "tracebench", name: "Tracebench", lab: null, tags: ["Python", "DuckDB", "Pydantic", "pytest"],
    what: "Local-first dataset contracts and drift reports.",
    hard: "Reports “incomparable” instead of quietly saying “stable”; bounded ingestion and fingerprinted offline reports." },
  { repo: "Hospital-Management", name: "Hospital-Management", lab: null, tags: ["Express 5", "Prisma", "PostgreSQL", "Redis"],
    what: "Hospital management API.",
    hard: "Access and refresh token rotation, a Redis-backed token blacklist, rate limiting, uploads and email." },
];

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function renderWork(status) {
  const byRepo = Object.fromEntries((status?.repos || []).map((r) => [r.repo, r]));
  $("#work-grid").innerHTML = WORK.map((w) => {
    const s = byRepo[w.repo];
    const ok = s?.latest?.conclusion === "success";
    const chip = s?.latest ? `<span class="ci-chip ${ok ? "ok" : "bad"}">CI ${ok ? "passing" : esc(s.latest.conclusion)}</span>` : "";
    return `<a class="work-card" href="https://github.com/devnishantt/${esc(w.repo)}">
      <div class="work-top">${chip || `<span class="ci-chip">CI</span>`}${w.lab ? `<span class="lab-link">lab ${String(["lab-race", "lab-retry", "lab-money", "lab-chain", "lab-approve"].indexOf(w.lab) + 1).padStart(2, "0")}</span>` : ""}</div>
      <h3><span>${esc(w.name)}</span><svg class="i"><use href="#i-arrow"/></svg></h3>
      <p>${esc(w.what)}</p>
      <p class="hard">${esc(w.hard)}</p>
      <div class="tags">${w.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
    </a>`;
  }).join("");
}

function renderStatus(status) {
  const pill = $("#nav-status");
  if (!status) {
    pill.querySelector(".label").textContent = "status unavailable";
    $("#status-summary").innerHTML = `<p>Status data could not be loaded.</p>`;
    return;
  }
  const allGreen = status.green === status.total;
  pill.classList.add(allGreen ? "ok" : "bad");
  pill.querySelector(".label").textContent = `${status.green}/${status.total} pipelines green`;
  $("#status-summary").innerHTML = `
    <span class="big ${allGreen ? "ok" : "bad"}">${status.green}/${status.total}</span>
    <p>${allGreen ? "All featured pipelines are passing on <code>main</code>." : "Some pipelines are failing. This page says so instead of hiding it."}</p>`;
  $("#status-list").innerHTML = status.repos.map((r) => {
    const latest = r.latest;
    const cls = !latest ? "none" : latest.conclusion === "success" ? "ok" : "bad";
    const SLOTS = 30;
    const empty = Array.from({ length: Math.max(0, SLOTS - r.history.length) },
      (_, i) => `<span class="empty" style="animation-delay:${reduced ? 0 : i * 25}ms" title="no run recorded yet"></span>`).join("");
    const bars = empty + r.history.slice(-SLOTS).map((h, i) => {
      const c = h.conclusion === "success" ? "ok" : h.conclusion === "failure" ? "bad" : "other";
      return `<a class="${c}" href="${esc(h.url)}" style="animation-delay:${reduced ? 0 : i * 25}ms" title="${esc(h.workflow)} · ${esc(h.sha)} · ${esc(h.conclusion)} · ${h.seconds}s"></a>`;
    }).join("");
    const rate = r.pass_rate == null ? "n/a" : `${Math.round(r.pass_rate * 100)}%`;
    return `<li>
      <a class="status-name" href="${esc(r.url)}"><span class="dot ${cls}"></span>${esc(r.repo)}</a>
      <div class="bars" aria-label="${r.history.length} recent runs, ${rate} passing">${bars}</div>
      <div class="status-meta"><b>${rate}</b> of ${r.history.length} run${r.history.length === 1 ? "" : "s"} · ${latest ? `${latest.seconds}s · ${ago(latest.at)}` : "no runs"}</div>
    </li>`;
  }).join("");
  $("#status-updated").textContent = `data generated ${ago(status.generated_at)} (${status.generated_at})`;
}

async function loadStatus() {
  try {
    const res = await fetch("data/status.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    renderStatus(data);
    renderWork(data);
  } catch (err) {
    console.warn("status unavailable:", err.message);
    renderStatus(null);
    renderWork(null);
  }
}

// ---------------------------------------------------------------- page behaviour

let toastTimer;
function toast(text) {
  const el = $("#toast");
  el.innerHTML = `<svg class="i"><use href="#i-check"/></svg><span>${esc(text)}</span>`;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

$("#copy-email").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const email = btn.dataset.email;
  let ok = false;
  try { await navigator.clipboard.writeText(email); ok = true; } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: email });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
  }
  if (!ok) { toast(email); return; }
  btn.classList.add("copied");
  btn.querySelector("use").setAttribute("href", "#i-check");
  btn.querySelector("span").textContent = "Copied";
  toast("Email copied to clipboard");
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.querySelector("use").setAttribute("href", "#i-copy");
    btn.querySelector("span").textContent = "Copy";
  }, 2000);
});

// Sticky header background once the page scrolls.
const header = $("#site-header");
const onScroll = () => header.classList.toggle("scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Reveal on scroll.
const revealEls = $$(".reveal");
if ("IntersectionObserver" in window && !reduced) {
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
  }), { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("in"));
}

// Highlight the lab in view (rail) and the section in view (nav).
if ("IntersectionObserver" in window) {
  const labObs = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    const id = en.target.dataset.lab;
    $$(".rail-item").forEach((a) => a.classList.toggle("active", a.dataset.lab === id));
  }), { rootMargin: "-40% 0px -55% 0px" });
  $$(".lab").forEach((l) => labObs.observe(l));
  const navObs = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    $$(".nav-links a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${en.target.id}`));
  }), { rootMargin: "-45% 0px -50% 0px" });
  ["labs", "status", "work", "contact"].forEach((id) => navObs.observe($(`#${id}`)));
}

// Keyboard: 1-5 jump to a lab (ignored while typing).
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input, textarea, select, [contenteditable]")) return;
  const n = Number(e.key);
  if (n >= 1 && n <= LABS.length) {
    const el = $(`#lab-${LABS[n - 1]}`);
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }
});

// Soft spotlight following the pointer, and a glow on work cards.
if (!reduced && matchMedia("(pointer: fine)").matches) {
  const spot = $(".backdrop-spot");
  let raf = 0;
  addEventListener("pointermove", (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      spot.style.setProperty("--mx", `${e.clientX}px`);
      spot.style.setProperty("--my", `${e.clientY}px`);
    });
  }, { passive: true });
  $("#work-grid").addEventListener("pointermove", (e) => {
    const card = e.target.closest(".work-card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--cx", `${e.clientX - r.left}px`);
    card.style.setProperty("--cy", `${e.clientY - r.top}px`);
  });
}

// ---------------------------------------------------------------- boot

renderScore();
LABS.forEach((lab) => {
  const st = labState(lab);
  $(`#lab-${lab}`).classList.toggle("is-broken", st === "broken");
  $(`#lab-${lab}`).classList.toggle("is-held", st === "held");
});
renderWork(null);
loadStatus();
resetChain();
resetIncident();
