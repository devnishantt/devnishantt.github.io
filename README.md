# devnishantt.github.io

[![Test and deploy](https://github.com/devnishantt/devnishantt.github.io/actions/workflows/pages.yml/badge.svg)](https://github.com/devnishantt/devnishantt.github.io/actions/workflows/pages.yml)

**Live: https://devnishantt.github.io**

A portfolio you attack instead of read. It hands you five invariants my backends enforce and the tools
to break them. Each lab contains two versions of the same code: a **common bug** (built in on purpose, so you can watch it break) and **my code** (what my projects actually do, which should never break). "Bug reproduced" in a lab means you found the planted bug, not that the project failed.

| Lab | You try to | The invariant | Comes from |
|---|---|---|---|
| 01 | Withdraw the same money twice | cash dispensed never exceeds what the account held | [bank-management-system](https://github.com/devnishantt/bank-management-system) |
| 02 | Get charged three times for one payment | one payment intent becomes at most one charge | [bank-management-system](https://github.com/devnishantt/bank-management-system) |
| 03 | Make a cent disappear | the parts of a split always add up to the whole | [ledgerline](https://github.com/devnishantt/ledgerline) |
| 04 | Rewrite history without getting caught | any change to the audit log is detectable | [ledgerline](https://github.com/devnishantt/ledgerline), [aftermark](https://github.com/devnishantt/aftermark) |
| 05 | Close an incident on your own | resolution needs two non-authors approving the current evidence | [aftermark](https://github.com/devnishantt/aftermark) |

Your progress (bugs found in the common-bug versions, attacks my code survived) is kept in `localStorage`. "Compare 1,000 races" in lab 01 runs the bug and both fixes on the same 1,000 random timings side by side.
There is also a status page with recent main-branch CI runs for each featured repository.

## How it works

- **No framework, no build step.** Hand-written HTML and CSS, plus ES modules served as-is.
- **The labs are pure functions** in [`site/js/labs/`](site/js/labs). The UI in [`site/js/main.js`](site/js/main.js) only renders what they return.
  - `race.js` simulates concurrent transactions with a seeded scheduler that interleaves their statements. Read-then-write breaks in about 75% of interleavings; `SELECT … FOR UPDATE` and a conditional `UPDATE` break in none.
  - `idempotency.js` is a payment endpoint with an `Idempotency-Key` store that replays the original response and refuses a reused key with a different body (`422`).
  - `money.js` parses amounts into `BigInt` minor units and splits by largest remainder, so the shares always sum to the total.
  - `chain.js` is a SHA-256 hash chain (Web Crypto). Verified against a published checkpoint, it also catches truncation and full re-hashing.
  - `approvals.js` is an incident state machine: evidence changes the manifest hash, which makes earlier approvals stale.
- **Status data** comes from [`scripts/fetch_status.py`](scripts/fetch_status.py), which runs on every deploy and once a day and writes `site/data/status.json` from the GitHub Actions API.

## Tests

```sh
npm ci
npm test                        # 24 unit tests for the lab logic (node --test)
npx playwright install chromium
npm run serve &                 # http://localhost:3000
npm run test:e2e                # drives every lab in Chromium, desktop and mobile
```

CI ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)) runs both suites, uploads screenshots, refreshes the status
data and deploys `site/` to GitHub Pages. Pull requests are tested but never deployed.

## Layout

```text
site/              what GitHub Pages serves
  index.html
  css/site.css
  js/main.js       UI wiring
  js/labs/*.js     lab logic, framework-free and unit-tested
  data/status.json CI history, regenerated on deploy
scripts/           status fetcher, local static server
tests/             unit tests and the browser test
```

## License

MIT
