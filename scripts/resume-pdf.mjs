// Regenerates site/resume/Nishant_Backend_Engineer_Resume.pdf from site/resume/index.html.
// Usage: npm run serve (in another shell), then: node scripts/resume-pdf.mjs [baseUrl]
// Fails if the resume no longer fits on one A4 page.
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:3000/";
const OUT = new URL("../site/resume/Nishant_Backend_Engineer_Resume.pdf", import.meta.url).pathname;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(new URL("resume/", BASE).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: "print" });
const { scroll, client } = await page.evaluate(() => {
  const s = document.querySelector(".sheet");
  return { scroll: s.scrollHeight, client: s.clientHeight };
});
if (scroll > client + 1) {
  await browser.close();
  console.error(`resume overflows one A4 page by ${scroll - client}px; shorten it`);
  process.exit(1);
}
await page.pdf({ path: OUT, format: "A4", printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(`wrote ${OUT}`);
