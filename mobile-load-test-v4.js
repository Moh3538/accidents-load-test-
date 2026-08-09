'use strict';

const { chromium } = require('playwright');
const fs = require('fs');

// ──────────────── الإعدادات ────────────────
const TARGET_URL = 'https://icarsu.com/chassis-test.html';   // ★ استخدم الصفحة الثابتة
const IMAGES = [
  './chassis1.jpg','./chassis2.jpg','./chassis3.jpg','./chassis4.jpg','./chassis5.jpg',
  './chassis6.jpg','./chassis7.jpg','./chassis8.jpg','./chassis9.jpg','./chassis10.jpg',
];
const BATCHES = [5, 10, 15, 20, 50, 100];
const COOLDOWN = { longBefore: [50,100], long: 30000, short: 10000 };
const allResults = [];

// ─── رفع الملف مباشرة (عنصر input موجود حتماً) ───
async function uploadImage(page, imageFile) {
  // ننتظر الحقل (موجود في الـ HTML الأساسي)
  await page.waitForSelector('#regImage', { state: 'attached', timeout: 10000 });
  await page.locator('#regImage').setInputFiles(imageFile);
}

// ─── انتظار ظهور الشاسيه أو خطأ ───
async function waitForChassisResult(page) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    // فحص النتيجة
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

    // تحميل الصفحة
    const pStart = Date.now();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    timings.pageLoad = Date.now() - pStart;

    // رفع الصورة
    const upStart = Date.now();
    await uploadImage(page, imageFile);
    timings.upload = Date.now() - upStart;

    // انتظار النتيجة
    const apiStart = Date.now();
    const chassis = await waitForChassisResult(page);
    timings.api = Date.now() - apiStart;

    timings.full = Date.now() - fullStart;

    console.log(`   ✅ [Batch ${batchSize}] User ${userId} | chassis: ${chassis.slice(0,10)}... | page: ${(timings.pageLoad/1000).toFixed(2)}s | api: ${(timings.api/1000).toFixed(2)}s | FULL: ${(timings.full/1000).toFixed(2)}s`);
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
  const results = await Promise.all(
    Array.from({ length: size }, (_, i) => runSingleUser(i + 1, size))
  );
  const ok = results.filter(r => r.success);
  const fail = results.filter(r => !r.success);
  const wallTime = (Date.now() - startTime) / 1000;

  if (ok.length === 0) {
    console.log(`❌ ALL ${size} FAILED`);
    return { size, success: 0, total: size, wallTime, errors: fail.slice(0,3).map(e=>e.error) };
  }

  const stats = arr => ({
    avg: arr.reduce((a,b)=>a+b,0)/arr.length,
    min: Math.min(...arr),
    max: Math.max(...arr),
    p95: percentile(arr, 95)
  });

  const timings = {
    pageLoad: stats(ok.map(r=>r.timings.pageLoad)),
    upload:   stats(ok.map(r=>r.timings.upload)),
    api:      stats(ok.map(r=>r.timings.api)),
    full:     stats(ok.map(r=>r.timings.full))
  };

  return {
    size,
    success: ok.length,
    total: size,
    successRate: (ok.length/size)*100,
    wallTime,
    timings,
    errors: fail.slice(0,5).map(e=>e.error)
  };
}

// دوال إحصائية...
function percentile(arr, p) {
  const sorted = [...arr].sort((a,b)=>a-b);
  const idx = Math.ceil(p/100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function assessHealth(rate, apiP95) {
  if (rate === 0) return '💀 FAILED';
  if (rate < 50)  return '💀 OVERLOADED';
  if (rate < 80)  return '🔴 CRITICAL';
  if (apiP95 > 20000) return '🟠 DEGRADED';
  if (apiP95 > 10000) return '🟡 GOOD';
  return '🟢 EXCELLENT';
}

async function main() {
  console.log('🚀 iCarsU OCR LOAD TEST (static page)');
  
  for (let i = 0; i < BATCHES.length; i++) {
    const size = BATCHES[i];
    const result = await runBatch(size);
    allResults.push(result);

    if (result.timings) {
      console.log(`\n📊 Batch ${size}: ${result.success}/${result.total} (${result.successRate.toFixed(1)}%)`);
      console.log(`   Page: avg ${(result.timings.pageLoad.avg/1000).toFixed(2)}s / p95 ${(result.timings.pageLoad.p95/1000).toFixed(2)}s`);
      console.log(`   API : avg ${(result.timings.api.avg/1000).toFixed(2)}s / p95 ${(result.timings.api.p95/1000).toFixed(2)}s`);
      console.log(`   FULL: avg ${(result.timings.full.avg/1000).toFixed(2)}s / p95 ${(result.timings.full.p95/1000).toFixed(2)}s`);
      console.log(`   Health: ${assessHealth(result.successRate, result.timings.api.p95)}`);
    } else {
      console.log(`❌ Batch ${size}: ALL FAILED`);
    }

    // تهدئة
    if (i < BATCHES.length - 1) {
      const next = BATCHES[i+1];
      const wait = (COOLDOWN.longBefore.includes(next) ? COOLDOWN.long : COOLDOWN.short);
      console.log(`⏸️  Cooling ${wait/1000}s...\n`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  // حفظ CSV...
}

main().catch(console.error);
