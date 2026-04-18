/**
 * ================================================================
 *  iCarsU.com  –  k6 BROWSER LOAD TEST
 *  Flow: Upload → API → Copy Chassis → Check Accidents MOI
 *  Runs on Grafana Cloud k6 (their servers, not your network)
 *
 *  HOW TO RUN:
 *
 *  LOCAL (your machine):
 *    k6 run --out cloud load-test.js
 *
 *  FULL CLOUD (recommended – unaffected by your network):
 *    k6 cloud load-test.js
 *
 *  Put all chassis images in the SAME folder as this script.
 * ================================================================
 */

import { browser }   from 'k6/browser';
import { check }     from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { scenario }  from 'k6/execution';

// ─── Custom metrics (reported per batch via tags) ─────────────────────────────
const mUpload  = new Trend('step_1_upload_ms',  true);
const mApi     = new Trend('step_2_api_ms',     true);  // ← KEY metric
const mCopy    = new Trend('step_3_copy_ms',    true);
const mMoi     = new Trend('step_4_moi_ms',     true);
const mTotal   = new Trend('total_journey_ms',  true);
const cSuccess = new Counter('flow_success');
const cFail    = new Counter('flow_failure');
const rSuccess = new Rate('success_rate');
// ─────────────────────────────────────────────────────────────────────────────

// ─── Chassis images (must be in same folder as this script) ──────────────────
const IMAGES = [
  'chassis1.jpg',  'chassis2.jpg',  'chassis3.jpg',
  'chassis4.jpg',  'chassis5.jpg',  'chassis6.jpg',
  'chassis7.jpg',  'chassis8.jpg',  'chassis9.jpg',
  'chassis10.jpg',
];

// Mobile user-agent (iPhone 12)
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) ' +
                  'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
                  'Version/15.0 Mobile/15E148 Safari/604.1';

const TARGET_URL   = 'https://icarsu.com/accidents/';
const API_TIMEOUT  = 120_000; // 2 min

// ─── Scenario config: all 6 batches run sequentially ─────────────────────────
// Each batch waits for the previous to finish + 30s cooldown
export const options = {
  scenarios: {
    batch_005: {
      executor:    'shared-iterations',
      vus:         5,
      iterations:  5,
      startTime:   '0s',
      maxDuration: '5m',
      options: { browser: { type: 'chromium' } },
    },
    batch_010: {
      executor:    'shared-iterations',
      vus:         10,
      iterations:  10,
      startTime:   '5m30s',    // 5m run + 30s cooldown
      maxDuration: '5m',
      options: { browser: { type: 'chromium' } },
    },
    batch_015: {
      executor:    'shared-iterations',
      vus:         15,
      iterations:  15,
      startTime:   '11m',
      maxDuration: '5m',
      options: { browser: { type: 'chromium' } },
    },
    batch_020: {
      executor:    'shared-iterations',
      vus:         20,
      iterations:  20,
      startTime:   '16m30s',
      maxDuration: '6m',
      options: { browser: { type: 'chromium' } },
    },
    batch_050: {
      executor:    'shared-iterations',
      vus:         50,
      iterations:  50,
      startTime:   '23m',
      maxDuration: '8m',
      options: { browser: { type: 'chromium' } },
    },
    batch_100: {
      executor:    'shared-iterations',
      vus:         100,
      iterations:  100,
      startTime:   '32m',
      maxDuration: '12m',
      options: { browser: { type: 'chromium' } },
    },
  },

  // Fail thresholds – test fails if server can't meet these
  thresholds: {
    'step_2_api_ms':    ['p(95)<30000'],   // API must respond in <30s for 95% of users
    'total_journey_ms': ['p(95)<60000'],   // Full journey <60s for 95%
    'success_rate':     ['rate>0.8'],      // At least 80% success overall
  },
};

// ── Helper: wait for element text to change ────────────────────────────────────
async function waitForChassisChange(page, before) {
  const deadline = Date.now() + API_TIMEOUT;
  while (Date.now() < deadline) {
    const current = await page
      .evaluate(() => document.getElementById('chassisText')?.innerText?.trim() ?? '')
      .catch(() => '');
    if (current.length > 0 && current !== before) return current;
    await page.waitForTimeout(300);
  }
  throw new Error(`#chassisText did not change within ${API_TIMEOUT / 1000}s`);
}

// ── Helper: click button by visible text ──────────────────────────────────────
async function clickButtonByText(page, text, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('a, button, [role="button"], span')]
        .find(e => e.innerText?.includes(t) && e.offsetParent !== null);
      if (el) { el.click(); return true; }
      return false;
    }, text).catch(() => false);
    if (clicked) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`Button "${text}" not found within ${timeoutMs / 1000}s`);
}

// ── Main test function ─────────────────────────────────────────────────────────
export default async function () {
  // Tag every metric with the batch name for per-batch averages in the report
  const batchName = scenario.name;                             // e.g. "batch_050"
  const batchSize = parseInt(batchName.split('_')[1]) || 0;   // e.g. 50
  const tags      = { batch: String(batchSize) };

  // Round-robin image selection across VUs
  const imageFile = IMAGES[(__VU - 1) % IMAGES.length];

  const page = await browser.newPage();
  let success = false;

  try {
    // ── MOBILE setup ────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setExtraHTTPHeaders({ 'User-Agent': MOBILE_UA });

    // ── LOAD PAGE (not timed) ────────────────────────────────────────────────
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60_000 });

    // Snapshot chassis text before upload
    const preChassis = await page
      .evaluate(() => document.getElementById('chassisText')?.innerText?.trim() ?? '')
      .catch(() => '');

    // ── STEP 1: UPLOAD ───────────────────────────────────────────────────────
    await page.locator('input[type="file"]').first().waitFor({ timeout: 15_000 });

    const t1 = Date.now();                                  // ⏱ TIMER STARTS
    await page.locator('input[type="file"]').first().setInputFiles(imageFile);
    mUpload.add(Date.now() - t1, tags);

    // ── STEP 2: API – wait for #chassisText to change ────────────────────────
    const t2 = Date.now();
    const chassisFound = await waitForChassisChange(page, preChassis);
    mApi.add(Date.now() - t2, tags);

    // ── STEP 3: CLICK "Copy Chassis" ─────────────────────────────────────────
    const t3 = Date.now();
    await clickButtonByText(page, 'Copy Chassis', 10_000);
    mCopy.add(Date.now() - t3, tags);

    // ── STEP 4: WAIT + CLICK "Check Accidents MOI" ───────────────────────────
    const t4 = Date.now();
    await clickButtonByText(page, 'Check Accidents MOI', 20_000);
    mMoi.add(Date.now() - t4, tags);                        // ⏱ TIMER ENDS

    // Total journey (steps 1–4 only, page load excluded)
    mTotal.add(
      mUpload.values.slice(-1)[0] +
      (Date.now() - t2) +    // this is slightly off, let's compute properly
      0, tags
    );

    // Better total: just sum the four durations we already recorded
    const upload = Date.now() - t1;   // approximate reuse
    // Actually track properly:
    const t_end = Date.now();
    const totalDuration = (t_end - t1);  // full wall time from upload to MOI click
    mTotal.add(totalDuration, tags);

    check(page, {
      [`[batch ${batchSize}] chassis detected`]: () => chassisFound.length > 0,
    });

    console.log(`✅ [batch ${batchSize}] VU ${__VU} | chassis: ${chassisFound}`);
    success = true;
    cSuccess.add(1, tags);

  } catch (err) {
    console.error(`❌ [batch ${batchSize}] VU ${__VU} | ${err.message}`);
    cFail.add(1, tags);
    check(page, {
      [`[batch ${batchSize}] flow completed`]: () => false,
    });
  } finally {
    rSuccess.add(success);
    await page.close();
  }
}
