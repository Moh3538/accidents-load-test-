'use strict';

const { chromium } = require('playwright');
const fs = require('fs');

// ──────────────── الإعدادات ────────────────
const TARGET_URL = 'https://icarsu.com/chassis-test.html';
const IMAGES = [
  './chassis1.jpg','./chassis2.jpg','./chassis3.jpg','./chassis4.jpg','./chassis5.jpg',
  './chassis6.jpg','./chassis7.jpg','./chassis8.jpg','./chassis9.jpg','./chassis10.jpg',
];
const BATCHES = [5, 10, 15, 20, 50, 100];
const LONG_COOLDOWN_BEFORE = [50, 100];
const COOLDOWN_LONG  = 30000;
const COOLDOWN_SHORT = 10000;
const allResults = [];

// ─── رفع الصورة مباشرة (عنصر input موجود حتماً) ───
async function uploadImage(page, imageFile) {
  await page.waitForSelector('#regImage', { state: 'attached', timeout: 10000 });
  await page.locator('#regImage').setInputFiles(imageFile);
}

// ─── انتظار ظهور الشاسيه أو خطأ ───
async function waitForChassisResult(page) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const result = await page.evaluate(() => {
      const chassis = document.getElementById('chassisText')?.innerText?.trim() || '';
      const status = document.getElementById('status')?.innerText || '';
      return { chassis, status };
    }).catch(() => ({ chassis: '', status: '' }));

    if (result.chassis.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(result.chassis)) {
      return result.chassis;
    }
    if (result.status.includes('failed') || result.status.includes('No chassis')) {
      throw new Error('OCR failed: ' + result.status);
    }
    await page.waitForTimeout(300);
  }
  throw new Error('OCR timeout');
}

async function runSingleUser(userId, batchSize) {
  let browser;
  const imageFile = IMAGES[(userId - 1) % IMAGES.length];
  const timings = { pageLoad: 0, upload: 0, api: 0, full: 0 };

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const fullStart = Date.now();

    const pStart = Date.now();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    timings.pageLoad = Date.now() - pStart;

    const upStart = Date.now();
    await uploadImage(page, imageFile);
    timings.upload = Date.now() - upStart;

    const apiStart = Date.now();
    const chassis = await waitForChassisResult(page);
    timings.api = Date.now() - apiStart;

    timings.full = Date.now() - fullStart;

    console.log(
      `   ✅ [Batch ${batchSize}] User ${userId}` +
      ` | chassis: ${chassis.substring(0, 10)}...` +
      ` | page: ${(timings.pageLoad / 1000).toFixed(2)}s` +
      ` | api: ${(timings.api / 1000).toFixed(2)}s` +
      ` | FULL: ${(timings.full / 1000).toFixed(2)}s`
    );

    await browser.close();
    return { success: true, userId, batchSize, timings };
  } catch (err) {
    console.error(`   ❌ [Batch ${batchSize}] User ${userId} | ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    return { success: false, userId, batchSize, error: err.message };
  }
}

async function runBatch(size) {
  console.log(`\n${'='.repeat(60)}\n🔥 BATCH: ${size} USERS\n${'='.repeat(60)}`);

  // ✅ تعريف startTime هنا
  const startTime = Date.now();

  const results = await Promise.all(
    Array.from({ length: size }, (_, i) => runSingleUser(i + 1, size))
  );

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

  const pageLoads = successful.map(r => r.timings.pageLoad);
  const uploads   = successful.map(r => r.timings.upload);
  const apis      = successful.map(r => r.timings.api);
  const fulls     = successful.map(r => r.timings.full);

  return {
    size,
    success: successful.length,
    total: size,
    successRate: (successful.length / size) * 100,
    wallTime: batchDuration,
    timings: {
      pageLoad: {
        avg: avg(pageLoads),
        min: Math.min(...pageLoads),
        max: Math.max(...pageLoads),
        p95: percentile(pageLoads, 95),
      },
      upload: {
        avg: avg(uploads),
        min: Math.min(...uploads),
        max: Math.max(...uploads),
        p95: percentile(uploads, 95),
      },
      api: {
        avg: avg(apis),
        min: Math.min(...apis),
        max: Math.max(...apis),
        p95: percentile(apis, 95),
      },
      full: {
        avg: avg(fulls),
        min: Math.min(...fulls),
        max: Math.max(...fulls),
        p95: percentile(fulls, 95),
      },
    },
    errors: failed.slice(0, 5).map(f => f.error),
  };
}

// ─── إحصائيات ──────────────────────────────────────────────
function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

function assessHealth(successRate, apiP95) {
  if (successRate === 0)  return '💀 FAILED';
  if (successRate < 50)   return '💀 OVERLOADED';
  if (successRate < 80)   return '🔴 CRITICAL';
  if (apiP95 > 20000)     return '🟠 DEGRADED';
  if (apiP95 > 10000)     return '🟡 GOOD';
  return '🟢 EXCELLENT';
}

// ─── الرئيسية ──────────────────────────────────────────────
async function main() {
  console.log('🚀 iCarsU OCR LOAD TEST (static page)\n');

  for (let i = 0; i < BATCHES.length; i++) {
    const size = BATCHES[i];
    const result = await runBatch(size);
    allResults.push(result);

    if (result.timings) {
      console.log(`\n📊 Batch ${size}: ${result.success}/${result.total} (${result.successRate.toFixed(1)}%)`);
      console.log(`   Page: avg ${(result.timings.pageLoad.avg / 1000).toFixed(2)}s / p95 ${(result.timings.pageLoad.p95 / 1000).toFixed(2)}s`);
      console.log(`   API : avg ${(result.timings.api.avg / 1000).toFixed(2)}s / p95 ${(result.timings.api.p95 / 1000).toFixed(2)}s`);
      console.log(`   FULL: avg ${(result.timings.full.avg / 1000).toFixed(2)}s / p95 ${(result.timings.full.p95 / 1000).toFixed(2)}s`);
      console.log(`   Health: ${assessHealth(result.successRate, result.timings.api.p95)}`);
    } else {
      console.log(`\n❌ Batch ${size}: ALL FAILED`);
    }

    if (i < BATCHES.length - 1) {
      const nextBatch = BATCHES[i + 1];
      const isLong = LONG_COOLDOWN_BEFORE.includes(nextBatch);
      const wait = isLong ? COOLDOWN_LONG : COOLDOWN_SHORT;
      console.log(`⏸️  Cooling down for ${wait / 1000}s before Batch ${nextBatch}...\n`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  // حفظ CSV
  let csv = 'Users,Success,SuccessRate,WallTime_s,PageLoad_avg_s,PageLoad_p95_s,API_avg_s,API_p95_s,FULL_avg_s,FULL_p95_s,Upload_avg_s,Health\n';
  allResults.forEach(r => {
    if (r.timings) {
      csv += `${r.size},${r.success}/${r.total},${r.successRate.toFixed(1)}%,${r.wallTime.toFixed(2)},` +
        `${(r.timings.pageLoad.avg/1000).toFixed(2)},${(r.timings.pageLoad.p95/1000).toFixed(2)},` +
        `${(r.timings.api.avg/1000).toFixed(2)},${(r.timings.api.p95/1000).toFixed(2)},` +
        `${(r.timings.full.avg/1000).toFixed(2)},${(r.timings.full.p95/1000).toFixed(2)},` +
        `${(r.timings.upload.avg/1000).toFixed(2)},${assessHealth(r.successRate, r.timings.api.p95)}\n`;
    } else {
      csv += `${r.size},0/${r.total},0%,${r.wallTime.toFixed(2)},0,0,0,0,0,0,0,FAILED\n`;
    }
  });
  fs.writeFileSync('load-test-results.csv', csv);
  fs.writeFileSync('load-test-results.json', JSON.stringify(allResults, null, 2));

  console.log('\n✅ Test complete. Results saved.');
}

main().catch(console.error); 
