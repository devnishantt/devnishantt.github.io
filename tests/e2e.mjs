// Browser check for the portfolio: drives every lab, asserts the verdicts, saves screenshots.
// Usage: node tests/e2e.mjs [baseUrl] [screenshotDir]   (needs the `playwright` package and Chromium)
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3000/";
const SHOTS = process.argv[3] || "/tmp/shots";
mkdirSync(SHOTS, { recursive: true });

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()}`));

const verdict = (lab) => page.locator(`#${lab}-verdict .verdict-tag`).textContent({ timeout: 8000 });
const step = (name) => console.log(`  ok  ${name}`);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
assert.equal(await page.title(), "Nishant · try to break my backends");
await page.waitForSelector("#chain-list .chain-row");
await page.waitForSelector("#status-list li");
step("page loads, status and chain render");
await page.screenshot({ path: `${SHOTS}/01-hero.png` });

// Lab 01
// A single naive race breaks about 75% of the time; click until it does, as a visitor would.
let raced = "";
for (let i = 0; i < 25 && raced !== "BUG REPRODUCED"; i++) {
  await page.click("#race-run");
  raced = await verdict("race");
  assert.ok(["BUG REPRODUCED", "NOTE"].includes(raced), `unexpected naive verdict ${raced}`);
}
assert.equal(raced, "BUG REPRODUCED");
await page.locator("#lab-race").screenshot({ path: `${SHOTS}/02-race-broken.png` });
await page.check('input[name="race-mode"][value="conditional"]', { force: true });
await page.click("#race-many");
assert.equal(await verdict("race"), "MY CODE HELD");
assert.match(await page.textContent("#race-verdict"), /My code: 0 of 1000/);
await page.check('input[name="race-mode"][value="locked"]', { force: true });
await page.click("#race-run");
assert.equal(await verdict("race"), "MY CODE HELD");
step("race: naive breaks, conditional holds 1000/1000, locked holds");

// Lab 02
await page.uncheck("#retry-key", { force: true });
await page.click("#retry-run");
assert.equal(await verdict("retry"), "BUG REPRODUCED");
assert.match(await page.textContent("#retry-verdict"), /3 charges/);
await page.check("#retry-key", { force: true });
await page.click("#retry-run");
assert.equal(await verdict("retry"), "MY CODE HELD");
assert.match(await page.textContent("#retry-verdict"), /exactly one charge/);
await page.locator("#lab-retry").screenshot({ path: `${SHOTS}/03-retry-held.png` });
step("retry: no key triple-charges, key replays");

// Lab 03
assert.equal(await verdict("money"), "BUG REPRODUCED");
await page.fill("#money-total", "1.005");
await page.waitForFunction(() => document.querySelector("#money-verdict .verdict-tag")?.textContent === "MY CODE HELD");
await page.fill("#money-total", "100.00");
await page.waitForFunction(() => document.querySelector("#money-verdict .verdict-tag")?.textContent === "BUG REPRODUCED");
await page.locator("#lab-money").screenshot({ path: `${SHOTS}/04-money.png` });
step("money: float split loses a cent, extra precision is rejected");

// Lab 04
const amount = page.locator('#chain-list input[data-i="2"]');
await amount.fill("-3.00");
await amount.dispatchEvent("change");
assert.equal(await verdict("chain"), "MY CODE HELD");
assert.match(await page.textContent("#chain-verdict"), /record 2/);
await page.click("#chain-reset");
await page.uncheck("#chain-checkpoint", { force: true });
await page.click("#chain-drop");
assert.equal(await verdict("chain"), "BUG REPRODUCED");
await page.check("#chain-checkpoint", { force: true });
assert.equal(await verdict("chain"), "MY CODE HELD");
assert.match(await page.textContent("#chain-verdict"), /checkpoint says 6/);
await page.click("#chain-reset");
await page.click("#chain-forge");
await page.locator("#lab-chain").screenshot({ path: `${SHOTS}/05-chain.png` });
step("chain: edit caught, truncation passes without checkpoint and fails with it");

// Lab 05
const act = async (actor, action) => {
  await page.check(`input[name="actor"][value="${actor}"]`, { force: true });
  await page.click(`#approve-actions button[data-action="${action}"]`);
};
for (const [a, x] of [["alice", "investigate"], ["alice", "evidence"], ["alice", "contain"], ["alice", "approve"], ["alice", "resolve"]]) await act(a, x);
assert.equal(await verdict("approve"), "BUG REPRODUCED");
await page.check("#approve-enforce", { force: true });
for (const [a, x] of [["alice", "investigate"], ["alice", "evidence"], ["alice", "contain"], ["alice", "approve"]]) await act(a, x);
assert.equal(await verdict("approve"), "MY CODE HELD");
assert.match(await page.textContent("#approve-verdict"), /403/);
for (const [a, x] of [["bob", "approve"], ["carol", "approve"], ["mallory", "evidence"], ["mallory", "resolve"]]) await act(a, x);
assert.match(await page.textContent("#approve-verdict"), /412/);
await page.locator("#lab-approve").screenshot({ path: `${SHOTS}/06-approve.png` });
step("approvals: self-close succeeds unenforced, 403 and stale-evidence 412 when enforced");

// Scoreboard persisted across reload
assert.equal(await page.textContent("#score-broken"), "5");
await page.reload({ waitUntil: "networkidle" });
assert.equal(await page.textContent("#score-broken"), "5");
assert.equal(await page.textContent("#score-labs"), "5/5");
step("scoreboard: 5 broken, 5/5 labs, survives reload");

await page.locator("#status").screenshot({ path: `${SHOTS}/07-status.png` });
await page.screenshot({ path: `${SHOTS}/08-full.png`, fullPage: true });

// Resume: page renders, PDF is downloadable, fits one A4 page
const pdf = await page.request.get(new URL("resume/Nishant_Backend_Engineer_Resume.pdf", BASE).href);
assert.equal(pdf.status(), 200);
assert.match(pdf.headers()["content-type"] || "", /pdf/);
assert.ok((await pdf.body()).subarray(0, 5).toString() === "%PDF-", "resume is not a PDF");
assert.equal(await page.locator('#contact-resume-download').getAttribute("download"), "");
const resume = await browser.newPage({ viewport: { width: 1100, height: 1300 } });
resume.on("pageerror", (e) => errors.push(`resume pageerror: ${e.message}`));
await resume.goto(new URL("resume/", BASE).href, { waitUntil: "networkidle" });
assert.match(await resume.textContent("h1"), /Nishant/);
assert.ok((await resume.locator("a.proof").count()) >= 10, "resume should link claims to code");
await resume.emulateMedia({ media: "print" });
const fits = await resume.evaluate(() => { const s = document.querySelector(".sheet"); return s.scrollHeight <= s.clientHeight + 1; });
assert.ok(fits, "resume overflows one A4 page");
await resume.emulateMedia({ media: "screen" });
await resume.screenshot({ path: `${SHOTS}/11-resume.png`, fullPage: true });
await resume.close();
step("resume: page renders, PDF downloads, fits one A4 page");

// Mobile: no horizontal overflow
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
mobile.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
await mobile.goto(BASE, { waitUntil: "networkidle" });
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(overflow <= 1, `horizontal overflow on mobile: ${overflow}px`);
await mobile.screenshot({ path: `${SHOTS}/09-mobile.png` });
await mobile.click("#race-run");
await mobile.locator("#lab-race").screenshot({ path: `${SHOTS}/10-mobile-race.png` });
step("mobile: no horizontal overflow");

await browser.close();
assert.deepEqual(errors, [], `browser errors:\n${errors.join("\n")}`);
console.log(`\nall browser checks passed; screenshots in ${SHOTS}`);
