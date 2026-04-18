const { chromium } = require('playwright');
const fs = require('fs');

/**
 * ================================================================
 *  iCarsU.com  –  PLAYWRIGHT BROWSER LOAD TEST
 *  Flow: Page Load → Upload → API → Copy Chassis
 *  Runs on GitHub Actions (stable network, no VUH limits)
 *
 *  BATCHES: 5, 10, 15, 20, 50, 100 concurrent users
 * ================================================================
 */

// ─── Mobile devices pool ──────────────────────────────────────────────────
const MOBILE_DEVICES = [
  { 
    name: 'iPhone 14 Pro Max',
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  { 
    name: 'Samsung Galaxy S23',
    viewport: { width: 384, height: 854 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  { 
    name: 'Google Pixel 7',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
  },
  { 
    name: 'iPhone 13',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  { 
    name: 'Samsung Galaxy S21',
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
];

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) ' +
                  'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
                  'Version/15.0 Mobile/15E148 Safari/604.1';

// ─── Chassis images (must be in same folder) ──────────────────────────────
const IMAGES = [
  './chassis1.jpg',  './chassis2.jpg',  './chassis3.jpg',
  './chassis4.jpg',  './chassis5.jpg',  './chassis6.jpg',
  './chassis7.jpg',  './chassis8.jpg',  './chassis9.jpg',
  './chassis10.jpg',
];

const TARGET_URL = 'https://icarsu.com/accidents/';
const API_TIMEOUT = 120000; // 2 minutes

// ─── Test batches ────────────────────────────────────────────────────────
const BATCHES = [5, 10, 15, 20, 50, 100];

// Results storage
const allResults = [];

// ─── Helper: Wait for chassis text to change ─────────────────────────────
async function waitForChassisChange(page, before) {
  const deadline = Date.now() + API_TIMEOUT;
  
  while (Date.now() < deadline) {
    const current = await page.evaluate(() => {
      const el = document.getElementById('chassisText');
      return el?.innerText?.trim() ?? '';
    }).catch(() => '');
    
    if (current.length > 0 && current !== before) {
      return current;
    }
    
    await page.waitForTimeout(300);
  }
  
  throw new Error(`Chassis text did not change within ${API_TIMEOUT / 1000}s`);
}

// ─── Helper: Upload file with multiple selector attempts ─────────────────
async function uploadFile(page, imageFile, timeoutMs = 30000) {
  const selectors = [
    'input[type="file"]',
    'input[id="regImage"]',
    '#regImage',
    '[accept*="image"]',
    'input[type="file"][accept]',
  ];
  
  for (const selector of selectors) {
    try {
      const fileInput = page.locator(selector).first();
      await fileInput.waitFor({ state: 'attached', timeout: 5000 });
      await fileInput.setInputFiles(imageFile);
      return true;
    } catch (e) {
      // Try next selector
    }
  }
  
  // Last resort
  await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: timeoutMs });
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(imageFile);
}

// ─── Helper: Click Copy button ───────────────────────────────────────────
async function clickCopyButton(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      const allElements = document.querySelectorAll('a, button, [role="button"], span, div');
      
      for (const el of allElements) {
        const elText = el.innerText || el.textContent || '';
        
        if ((elText.includes('Copy') && elText.includes('Chassis')) || 
            elText.trim() === 'Copy' ||
            elText.includes('Copy Chassis')) {
          if (el.offsetParent !== null) {
            el.click();
            return true;
          }
        }
      }
      return false;
    }).catch(() => false);
    
    if (clicked) return;
    await page.waitForTimeout(300);
  }
  
  throw new Error(`Copy button not found within ${timeoutMs / 1000}s`);
}

// ─── Single user journey ─────────────────────────────────────────────────
async function runSingleUser(userId, batchSize) {
  let browser;
  
  const device = MOBILE_DEVICES[Math.floor(Math.random() * MOBILE_DEVICES.length)];
  const imageFile = IMAGES[(userId - 1) % IMAGES.length];
  
  const timings = {
    pageLoad: 0,
    upload: 0,
    api: 0,
    copy: 0,
    total: 0,
  };

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      ...device,
      userAgent: MOBILE_UA,
    });

    const page = await context.newPage();

    // ─── Step 0: Page Load (TIMED) ────────────────────────────────────
    const pageStart = Date.now();
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
    timings.pageLoad = Date.now() - pageStart;
    
    await page.waitForTimeout(2000); // Small wait for stability

    // Snapshot chassis text before upload
    const preChassis = await page.evaluate(() => {
      const el = document.getElementById('chassisText');
      return el?.innerText?.trim() ?? '';
    }).catch(() => '');

    // ═══════════════════════════════════════════════════════════════
    // ⏱️ JOURNEY TIMER STARTS HERE (Upload → Copy Click)
    // ═══════════════════════════════════════════════════════════════
    const journeyStart = Date.now();

    // ─── Step 1: Upload ──────────────────────────────────────────────
    const uploadStart = Date.now();
    await uploadFile(page, imageFile);
    timings.upload = Date.now() - uploadStart;

    // ─── Step 2: API Processing ─────────────────────────────────────
    const apiStart = Date.now();
    const chassisFound = await waitForChassisChange(page, preChassis);
    timings.api = Date.now() - apiStart;

    // ─── Step 3: Click Copy ─────────────────────────────────────────
    const copyStart = Date.now();
    await clickCopyButton(page, 10000);
    timings.copy = Date.now() - copyStart;

    timings.total = Date.now() - journeyStart;

    console.log(`   ✅ [${batchSize}] User ${userId} | chassis: ${chassisFound.substring(0, 10)}... | page: ${(timings.pageLoad/1000).toFixed(2)}s | total: ${(timings.total/1000).toFixed(2)}s (API: ${(timings.api/1000).toFixed(2)}s)`);

    await page.waitForTimeout(1000);
    await browser.close();

    return {
      success: true,
      userId,
      batchSize,
      timings,
    };

  } catch (err) {
    console.error(`   ❌ [${batchSize}] User ${userId} | ${err.message}`);
    
    try {
      if (browser) await browser.close();
    } catch (e) {}
    
    return {
      success: false,
      userId,
      batchSize,
      error: err.message,
    };
  }
}

// ─── Run a single batch ────────────────────────────────────────────────
async function runBatch(size) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🔥 BATCH: ${size} CONCURRENT USERS`);
  console.log(`${'='.repeat(70)}`);

  const startTime = Date.now();
  
  const promises = [];
  for (let i = 0; i < size; i++) {
    promises.push(runSingleUser(i + 1, size));
  }

  const results = await Promise.all(promises);
  const batchDuration = (Date.now() - startTime) / 1000;
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (successful.length === 0) {
    console.log(`\n   ❌ ALL ${size} USERS FAILED`);
    return {
      size,
      success: 0,
      total: size,
      successRate: 0,
      wallTime: batchDuration,
      timings: null,
      errors: failed.slice(0, 3).map(f => f.error),
    };
  }

  const pageLoadTimes = successful.map(r => r.timings.pageLoad);
  const apiTimes = successful.map(r => r.timings.api);
  const totalTimes = successful.map(r => r.timings.total);
  const uploadTimes = successful.map(r => r.timings.upload);
  const copyTimes = successful.map(r => r.timings.copy);

  const result = {
    size,
    success: successful.length,
    total: size,
    successRate: (successful.length / size) * 100,
    wallTime: batchDuration,
    timings: {
      pageLoad: {
        avg: avg(pageLoadTimes),
        min: Math.min(...pageLoadTimes),
        max: Math.max(...pageLoadTimes),
        p95: percentile(pageLoadTimes, 95),
      },
      upload: {
        avg: avg(uploadTimes),
        min: Math.min(...uploadTimes),
        max: Math.max(...uploadTimes),
        p95: percentile(uploadTimes, 95),
      },
      api: {
        avg: avg(apiTimes),
        min: Math.min(...apiTimes),
        max: Math.max(...apiTimes),
        p95: percentile(apiTimes, 95),
      },
      copy: {
        avg: avg(copyTimes),
        p95: percentile(copyTimes, 95),
      },
      total: {
        avg: avg(totalTimes),
        min: Math.min(...totalTimes),
        max: Math.max(...totalTimes),
        p95: percentile(totalTimes, 95),
      },
    },
    errors: failed.slice(0, 5).map(f => f.error),
  };

  return result;
}

// ─── Statistics helpers ────────────────────────────────────────────────
function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[index] || 0;
}

// ─── Health assessment ─────────────────────────────────────────────────
function assessHealth(successRate, apiP95) {
  if (successRate === 0) return '💀 FAILED';
  if (successRate < 50) return '💀 OVERLOADED';
  if (successRate < 80) return '🔴 CRITICAL';
  if (apiP95 > 20000) return '🟠 DEGRADED';
  if (apiP95 > 10000) return '🟡 GOOD';
  return '🟢 EXCELLENT';
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log('\n📱 ========================================');
  console.log('📱 iCarsU MOBILE LOAD TEST - PLAYWRIGHT');
  console.log('📱 GitHub Actions | Stable Network');
  console.log('📱 Flow: Page Load → Upload → API → Copy');
  console.log('📱 ========================================\n');

  for (const size of BATCHES) {
    const result = await runBatch(size);
    allResults.push(result);

    if (result.timings) {
      console.log(`\n   📊 Batch ${size} Results:`);
      console.log(`   ✅ Success: ${result.success}/${result.total} (${result.successRate.toFixed(1)}%)`);
      console.log(`   ⏱️  Wall Time: ${result.wallTime.toFixed(2)}s`);
      console.log(`   📄 Page Load: avg ${(result.timings.pageLoad.avg / 1000).toFixed(2)}s | p95 ${(result.timings.pageLoad.p95 / 1000).toFixed(2)}s`);
      console.log(`   🔬 API: avg ${(result.timings.api.avg / 1000).toFixed(2)}s | p95 ${(result.timings.api.p95 / 1000).toFixed(2)}s`);
      console.log(`   📋 Journey: avg ${(result.timings.total.avg / 1000).toFixed(2)}s | p95 ${(result.timings.total.p95 / 1000).toFixed(2)}s`);
      console.log(`   🏥 Health: ${assessHealth(result.successRate, result.timings.api.p95)}`);
    } else {
      console.log(`\n   ❌ Batch ${size}: ALL FAILED`);
      if (result.errors) {
        console.log(`   📋 Sample errors:`);
        result.errors.slice(0, 3).forEach(e => console.log(`      - ${e}`));
      }
    }

    if (BATCHES.indexOf(size) < BATCHES.length - 1) {
      console.log('\n   ⏸️  Cooling down for 5 seconds...\n');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // ─── Generate CSV Report ────────────────────────────────────────────
  let csv = 'Users,Success,SuccessRate,WallTime_s,PageLoad_avg_s,PageLoad_p95_s,API_avg_s,API_p95_s,Journey_avg_s,Journey_p95_s,Upload_avg_s,Copy_avg_s,Health\n';
  
  allResults.forEach(r => {
    if (r.timings) {
      csv += `${r.size},${r.success}/${r.total},${r.successRate.toFixed(1)}%,${r.wallTime.toFixed(2)},`;
      csv += `${(r.timings.pageLoad.avg / 1000).toFixed(2)},${(r.timings.pageLoad.p95 / 1000).toFixed(2)},`;
      csv += `${(r.timings.api.avg / 1000).toFixed(2)},${(r.timings.api.p95 / 1000).toFixed(2)},`;
      csv += `${(r.timings.total.avg / 1000).toFixed(2)},${(r.timings.total.p95 / 1000).toFixed(2)},`;
      csv += `${(r.timings.upload.avg / 1000).toFixed(2)},${(r.timings.copy.avg / 1000).toFixed(2)},`;
      csv += `${assessHealth(r.successRate, r.timings.api.p95)}\n`;
    } else {
      csv += `${r.size},0/${r.total},0%,${r.wallTime.toFixed(2)},0,0,0,0,0,0,0,0,FAILED\n`;
    }
  });

  fs.writeFileSync('load-test-results.csv', csv);
  fs.writeFileSync('load-test-results.json', JSON.stringify(allResults, null, 2));

  // ─── Final Summary ─────────────────────────────────────────────────
  console.log('\n' + '='.repeat(105));
  console.log('📊 FINAL REPORT (Page Load → Upload → API → Copy)');
  console.log('='.repeat(105));
  console.log('Users  │ Success │ Page (avg/p95) │ API (avg/p95) │ Journey (avg/p95) │ Health');
  console.log('───────┼─────────┼─────────────────┼────────────────┼────────────────────┼──────────────');
  
  allResults.forEach(r => {
    if (r.timings) {
      const users = r.size.toString().padEnd(6);
      const success = `${r.success}/${r.total}`.padEnd(7);
      const page = `${(r.timings.pageLoad.avg/1000).toFixed(1)}/${(r.timings.pageLoad.p95/1000).toFixed(1)}s`.padEnd(15);
      const api = `${(r.timings.api.avg/1000).toFixed(1)}/${(r.timings.api.p95/1000).toFixed(1)}s`.padEnd(14);
      const journey = `${(r.timings.total.avg/1000).toFixed(1)}/${(r.timings.total.p95/1000).toFixed(1)}s`.padEnd(18);
      const health = assessHealth(r.successRate, r.timings.api.p95);
      console.log(`${users} │ ${success} │ ${page} │ ${api} │ ${journey} │ ${health}`);
    } else {
      console.log(`${r.size.toString().padEnd(6)} │ 0/${r.total}  │ -               │ -              │ -                  │ FAILED`);
    }
  });

  console.log('='.repeat(105));
  console.log('\n📝 Results saved to: load-test-results.csv, load-test-results.json\n');
  
  // ─── Executive Summary ──────────────────────────────────────────────
  console.log('📋 EXECUTIVE SUMMARY:');
  console.log('─────────────────────────────────────────────────────────────────────');
  
  const safeLimit = allResults.filter(r => r.successRate >= 90).pop()?.size || 10;
  const overloadPoint = allResults.find(r => r.successRate < 50)?.size || 50;
  
  console.log(`   ✅ Safe concurrent mobile users: ${safeLimit}`);
  console.log(`   ⚠️  Performance degrades at: ${safeLimit + 5} users`);
  console.log(`   ❌ Server overloaded at: ${overloadPoint} users`);
  console.log('');
}

main().catch(console.error);
