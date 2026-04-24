/**
 * company-scraper.js
 * Crawl danh sách công ty IT từ itviec.com/companies
 * Output: itviec-companies.json  [{ name, address, country, profileUrl }]
 *
 * Dùng lệnh:
 *   node company-scraper.js
 *   node company-scraper.js --headful   (mở browser hiện)
 *   node company-scraper.js --max 5     (chỉ lấy 5 trang đầu để test)
 */

import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import fs from 'fs';

chromium.use(stealth());

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const headless = !args.includes('--headful');
const maxPagesArg = args.indexOf('--max');
const MAX_PAGES = maxPagesArg !== -1 ? parseInt(args[maxPagesArg + 1]) : null;

// ── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  baseUrl: 'https://itviec.com/companies',
  outputFile: 'itviec-companies.json',
  cookiesFile: 'itviec-cookies.json',
  stateFile: 'itviec-companies-state.json',
  headless,
  saveEvery: 3,   // save state sau mỗi N trang
};

const STATE_VERSION = 1;
const sleep = (min, max = min) =>
  new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

// ── Parse helpers ─────────────────────────────────────────────────────────────

/**
 * Parse một trang listing /companies?page=N
 * Trả về array { name, address, country, profileUrl }
 */
function parseCompanyList(html, pageNum) {
  const $ = cheerio.load(html);
  const companies = [];

  // itviec.com/companies: mỗi công ty là 1 card
  // Selector chính: div.employer-item hoặc div[class*="employer"]
  // Fallback: các thẻ có href đến /companies/<slug>
  const selectors = [
    '.employer-item',
    '.company-card',
    '[data-controller*="employer"]',
    'div[class*="employer-card"]',
    'div[class*="company-card"]',
  ];

  let found = false;
  for (const sel of selectors) {
    const els = $(sel);
    if (els.length > 0) {
      els.each((_, el) => {
        const company = extractCompanyCard($, $(el));
        if (company.name) companies.push(company);
      });
      found = true;
      break;
    }
  }

  // Fallback tổng quát: tìm theo link /companies/<slug>
  if (!found) {
    const seen = new Set();
    $('a[href*="/companies/"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const slug = href.match(/\/companies\/([^?#/]+)/)?.[1];
      if (!slug || seen.has(slug)) return;
      seen.add(slug);

      const $card = $(a).closest('[class]');
      const company = extractCompanyCard($, $card.length ? $card : $(a));
      company.profileUrl = href.startsWith('http') ? href : `https://itviec.com${href}`;
      if (company.name) companies.push(company);
    });
  }

  return companies;
}

function extractCompanyCard($, $el) {
  // Name: h2, h3 hoặc .company-name, .employer-name
  let name = $el.find('h2, h3, .company-name, .employer-name').first().text().trim();
  if (!name) {
    // Tên có thể là text của link /companies/<slug>
    name = $el.find('a[href*="/companies/"]').first().text().trim();
  }

  // Address: meta hoặc span với icon địa chỉ / text chứa city names
  let address = '';
  $el.find('*').each((_, el) => {
    const text = $(el).children().length === 0 ? $(el).text().trim() : '';
    if (!text || text.length > 120) return;
    if (/Ho Chi Minh|Hà Nội|Hà nội|Ha Noi|Hanoi|Da Nang|Đà Nẵng|Can Tho|Hai Phong|Bình Dương|Đồng Nai|Cần Thơ/i.test(text)) {
      if (!address) address = text;
    }
  });

  // Country: "Vietnam", "Japan", "USA" v.v.
  let country = '';
  $el.find('*').each((_, el) => {
    const text = $(el).children().length === 0 ? $(el).text().trim() : '';
    if (!text || text.length > 80) return;
    if (/^(Vietnam|Việt Nam|Japan|USA|United States|Singapore|Korea|Australia|Germany|France|United Kingdom|UK|Canada|Netherlands|India|China|Taiwan|Thailand|Malaysia|Philippines|Indonesia|Hong Kong)/i.test(text)) {
      if (!country) country = text;
    }
  });

  // Profile URL
  const href = $el.find('a[href*="/companies/"]').first().attr('href') || '';
  const profileUrl = href ? (href.startsWith('http') ? href : `https://itviec.com${href}`) : '';

  return { name, address, country, profileUrl };
}

/**
 * Detect total pages bằng cách đọc pagination links
 */
async function detectTotalPages(page) {
  const total = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="page="]');
    let max = 1;
    for (const link of links) {
      const m = link.href.match(/page=(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1]));
    }
    return max;
  });
  return total;
}

// ── Cloudflare bypass ────────────────────────────────────────────────────────
async function bypassCloudflare(page) {
  const title = await page.title();
  if (title.includes('Just a moment') || title.includes('Cloudflare')) {
    console.log('🛑 Cloudflare challenge, đợi 15s...');
    await sleep(15000);
    try {
      await page.waitForFunction(
        () => !document.title.includes('Just a moment'),
        { timeout: 30000 }
      );
    } catch {
      console.log('⚠️ Cloudflare chưa qua, tiếp tục...');
    }
  }
}

// ── State helpers ────────────────────────────────────────────────────────────
function loadState() {
  if (!fs.existsSync(CONFIG.stateFile)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8'));
    if (s.version !== STATE_VERSION) return null;
    return s;
  } catch { return null; }
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  const tmp = CONFIG.stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, CONFIG.stateFile);
}

function createInitialState() {
  return {
    version: STATE_VERSION,
    totalPages: 0,
    completedPages: [],
    companies: [],          // { name, address, country, profileUrl }
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.time('⏱️ Total time');

  let state = loadState();
  const resuming = !!state;
  if (resuming) {
    console.log(`📂 Resuming: ${state.completedPages.length}/${state.totalPages || '?'} pages, ${state.companies.length} companies`);
  } else {
    state = createInitialState();
    console.log('🆕 Bắt đầu scrape mới');
  }

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    extraHTTPHeaders: { 'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8' },
  };

  if (fs.existsSync(CONFIG.cookiesFile)) {
    contextOptions.storageState = CONFIG.cookiesFile;
    console.log('📂 Loaded cookies từ file');
  }

  const context = await browser.newContext(contextOptions);

  // Graceful exit
  let shuttingDown = false;
  const gracefulExit = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n⚠️ Nhận ${signal}, saving state...`);
    try { saveState(state); } catch {}
    try { await context.storageState({ path: CONFIG.cookiesFile }); } catch {}
    try { await browser.close(); } catch {}
    console.log('💾 State saved. Chạy lại để resume.');
    process.exit(130);
  };
  process.on('SIGINT', () => gracefulExit('SIGINT'));
  process.on('SIGTERM', () => gracefulExit('SIGTERM'));

  const page = await context.newPage();

  // ── Warmup ───────────────────────────────────────────────────────────────
  if (!resuming) {
    console.log('🏠 Visiting homepage...');
    await page.goto('https://itviec.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await bypassCloudflare(page);
    await sleep(2000, 3000);
  }

  // ── Detect total pages ────────────────────────────────────────────────────
  if (!state.totalPages) {
    console.log('📊 Detecting total pages on /companies...');
    await page.goto(`${CONFIG.baseUrl}?page=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await bypassCloudflare(page);
    await sleep(1500, 2500);

    let totalPages = await detectTotalPages(page);
    if (MAX_PAGES) totalPages = Math.min(totalPages, MAX_PAGES);
    state.totalPages = totalPages;
    saveState(state);
    console.log(`📊 Total company pages: ${totalPages}`);
  } else {
    console.log(`📊 Total company pages: ${state.totalPages}`);
  }

  // ── Scrape list pages ─────────────────────────────────────────────────────
  const completedSet = new Set(state.completedPages);
  const seenNames = new Set(state.companies.map(c => c.name.toLowerCase()));

  for (let p = 1; p <= state.totalPages; p++) {
    if (shuttingDown) break;
    if (completedSet.has(p)) continue;

    const url = `${CONFIG.baseUrl}?page=${p}`;
    console.log(`\n📄 Page ${p}/${state.totalPages} → ${url}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await bypassCloudflare(page);
      try { await page.waitForSelector('a[href*="/companies/"]', { timeout: 8000 }); } catch {}
      await sleep(800, 1800);

      const html = await page.content();
      const found = parseCompanyList(html, p);
      let newCount = 0;
      for (const c of found) {
        const key = c.name.toLowerCase();
        if (!key || seenNames.has(key)) continue;
        seenNames.add(key);
        state.companies.push(c);
        newCount++;
      }

      completedSet.add(p);
      state.completedPages.push(p);

      console.log(`  ✓ Found ${found.length} companies (${newCount} new, total: ${state.companies.length})`);

      if (p % CONFIG.saveEvery === 0) saveState(state);
    } catch (err) {
      console.error(`  ❌ Page ${p} failed: ${err.message}`);
    }

    await sleep(1200, 2500);
  }

  // ── Final output ──────────────────────────────────────────────────────────
  saveState(state);
  await context.storageState({ path: CONFIG.cookiesFile }).catch(() => {});
  await browser.close();

  // Thêm STT
  const output = state.companies.map((c, i) => ({ stt: i + 1, ...c }));
  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));
  console.log(`\n✅ Saved ${output.length} companies → ${CONFIG.outputFile}`);
  console.log(`ℹ️ Xóa ${CONFIG.stateFile} để scrape lại từ đầu.`);
  console.timeEnd('⏱️ Total time');
}

main().catch(err => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
