import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import fs from 'fs';
import pLimit from 'p-limit';

chromium.use(stealth());

const CONFIG = {
  baseUrl: 'https://itviec.com/it-jobs',
  maxPages: null,        // null = scrape tất cả
  outputFile: 'itviec-jobs.json',
  cookiesFile: 'itviec-cookies.json',
  headless: false,       // false khi dev, true khi stable
  detailConcurrency: 3,  // số detail page parse song song
};

const sleep = (min, max = min) => new Promise(r => 
  setTimeout(r, min + Math.random() * (max - min))
);

// ============ PARSE HTML FUNCTIONS ============

/**
 * Parse list page → array of job summary
 * Selector có thể đổi theo thời gian, cần update khi cần
 */
function parseJobList(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  $('.job-card').each((_, el) => {
    const $el = $(el);

    const slug = $el.attr('data-search--job-selection-job-slug-value');
    const jobKey = $el.attr('data-job-key');
    if (!slug) return;

    // Title nằm ở <h3>, không phải <a> bên trong
    const $h3 = $el.find('h3[data-search--job-selection-target="jobTitle"]').first();
    const title = $h3.text().trim();
    const url = `https://itviec.com/it-jobs/${slug}`;

    // Company: anchor đến /companies/<slug>
    const $companyA = $el.find('a[href*="/companies/"]').last();
    const company = $companyA.text().trim();
    const companySlug = ($companyA.attr('href') || '').match(/\/companies\/([^?]+)/)?.[1] || '';

    // Salary: .salary div; nếu chưa sign-in hiện "Sign in to view salary"
    let salary = $el.find('.salary').first().text().replace(/\s+/g, ' ').trim();
    if (!salary) {
      const signInText = $el.find('.sign-in-view-salary').first().text().trim();
      salary = signInText || '';
    }

    // Working mode ("At office" / "Hybrid" / "Remote") + location
    // Cả 2 nằm trong block text-rich-grey sau salary
    const infoTexts = $el.find('.text-rich-grey').map((_, n) => $(n).text().trim()).get()
      .filter(t => t && t.length < 80);
    // Bỏ tên company ra khỏi list
    const infoFiltered = infoTexts.filter(t => t !== company);
    const workingMode = infoFiltered.find(t => /office|remote|hybrid/i.test(t)) || '';
    const location = infoFiltered.find(t =>
      /Ho Chi Minh|Ha Noi|Hanoi|Da Nang|Can Tho|Hai Phong|Others/i.test(t)
    ) || '';

    // Tags/skills: .itag - bỏ tag "+N" overflow
    const tags = $el.find('a.itag').map((_, t) => $(t).text().trim()).get()
      .filter(t => t && !/^\+\d+$/.test(t));

    // Posted time: span.small-text.text-dark-grey (ở đầu card)
    const postedTime = $el.find('.small-text.text-dark-grey').first().text()
      .replace(/\s+/g, ' ').trim();

    // Label (HOT / NEW) nếu có
    const label = $el.find('.ilabel').first().text().trim();

    jobs.push({
      jobKey,
      slug,
      title,
      url,
      company,
      companySlug,
      salary: salary || 'Sign in to view salary',
      workingMode,
      location,
      tags,
      postedTime,
      label,
    });
  });

  return jobs;
}

/**
 * Parse detail page → job info đầy đủ
 */
function parseJobDetail(html, baseData) {
  const $ = cheerio.load(html);

  // Scope: main column (excludes "More jobs for you" sidebar)
  const $mainCol = $('.col-xl-8.im-0').first();
  const $scope = $mainCol.length ? $mainCol : $.root();

  const title = $('h1').first().text().trim() || baseData.title;

  // Salary block nằm trong .job-header-info (khi chưa login sẽ là "Sign in to view salary")
  const salary = $('.job-header-info .salary').first().text().replace(/\s+/g, ' ').trim()
    || baseData.salary || '';

  // Extract sections từ h2 → nội dung tới h2 kế tiếp
  const sectionMap = {};
  $scope.find('h2').each((_, h) => {
    const heading = $(h).text().trim();
    if (!heading) return;
    if (/^(More jobs|Make Your|Feedback)/i.test(heading)) return;

    let sib = $(h).next();
    const chunks = [];
    while (sib.length && sib[0].tagName !== 'h2') {
      const lis = sib.find('li');
      if (lis.length) {
        chunks.push(lis.map((_, li) => '- ' + $(li).text().trim().replace(/\s+/g, ' ')).get().join('\n'));
      } else {
        const t = sib.text().trim().replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
        if (t) chunks.push(t);
      }
      sib = sib.next();
    }
    sectionMap[heading] = chunks.join('\n\n').trim();
  });

  // Company info: label/value đều là <div class="col"> cạnh nhau
  const companyInfo = { name: baseData.company };
  const labels = ['Company type', 'Company industry', 'Company size', 'Country', 'Working days', 'Overtime policy'];
  $('div.col').each((_, col) => {
    const text = $(col).text().trim().replace(/\s+/g, ' ');
    if (labels.includes(text)) {
      const val = $(col).next('.col').text().trim().replace(/\s+/g, ' ');
      if (val) companyInfo[text] = val;
    }
  });

  // Skills chỉ lấy trong main column (tránh pollute từ "More jobs for you")
  const mainSkills = $scope.find('a.itag').map((_, t) => $(t).text().trim()).get();
  const skills = [...new Set([...(baseData.tags || []), ...mainSkills])]
    .filter(s => s && !/^\+\d+$/.test(s));

  return {
    ...baseData,
    title,
    salary,
    skills,
    reasons: sectionMap['Top 3 reasons to join us'] || '',
    jobDescription: sectionMap['Job description'] || '',
    requirements: sectionMap['Your skills and experience'] || '',
    benefits: sectionMap["Why you'll love working here"] || '',
    companyInfo,
    scrapedAt: new Date().toISOString(),
  };
}

// ============ SCRAPE FLOW ============

async function setupBrowser() {
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    extraHTTPHeaders: {
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    },
  };

  // Reuse cookies nếu có
  if (fs.existsSync(CONFIG.cookiesFile)) {
    contextOptions.storageState = CONFIG.cookiesFile;
    console.log('📂 Loaded cookies từ file');
  }

  const context = await browser.newContext(contextOptions);
  return { browser, context };
}

async function bypassCloudflare(page) {
  const title = await page.title();
  if (title.includes('Just a moment') || title.includes('Cloudflare')) {
    console.log('🛑 Cloudflare challenge, đợi 15s...');
    await sleep(15000);
    // Đợi thêm cho tới khi title đổi
    try {
      await page.waitForFunction(
        () => !document.title.includes('Just a moment'),
        { timeout: 30000 }
      );
    } catch {
      console.log('⚠️ Cloudflare challenge chưa qua, nhưng tiếp tục...');
    }
  }
}

async function detectTotalPages(page) {
  // ITviec thường có pagination ở cuối trang với link đến page cuối
  const total = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="page="]');
    let max = 1;
    for (const link of links) {
      const match = link.href.match(/page=(\d+)/);
      if (match) max = Math.max(max, parseInt(match[1]));
    }
    return max;
  });
  return total;
}

async function scrapeListPage(page, pageNum) {
  const url = `${CONFIG.baseUrl}?page=${pageNum}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await bypassCloudflare(page);
  
  try {
    await page.waitForSelector('h3, [class*="job"]', { timeout: 10000 });
  } catch {}

  const html = await page.content();
  
  // DEBUG: lưu page 1 ra file để inspect
//   if (pageNum === 1) {
//     fs.writeFileSync('debug-page1.html', html);
//     console.log('  💾 Saved debug-page1.html');
//   }
  
  return parseJobList(html);
}

async function scrapeJobDetail(context, job) {
  const page = await context.newPage();
  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await bypassCloudflare(page);
    const html = await page.content();
    return parseJobDetail(html, job);
  } finally {
    await page.close();
  }
}

async function main() {
  console.time('⏱️ Total time');
  const { browser, context } = await setupBrowser();
  const page = await context.newPage();

  // ============ STEP 1: Visit homepage để warm up cookies ============
  console.log('🏠 Visiting homepage...');
  await page.goto('https://itviec.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await bypassCloudflare(page);
  await sleep(2000, 4000);

  // ============ STEP 2: Get total page count ============
  console.log('📊 Detecting total pages...');
  await page.goto(`${CONFIG.baseUrl}?page=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await bypassCloudflare(page);
  
  let totalPages = await detectTotalPages(page);
  if (CONFIG.maxPages) totalPages = Math.min(totalPages, CONFIG.maxPages);
  console.log(`📊 Total pages: ${totalPages}`);

  // ============ STEP 3: Scrape list pages ============
  const allJobs = [];
  const seenUrls = new Set();

  for (let p = 1; p <= totalPages; p++) {
    console.log(`\n📄 Page ${p}/${totalPages}`);
    try {
      const jobs = await scrapeListPage(page, p);
      
      // Dedupe
      const newJobs = jobs.filter(j => !seenUrls.has(j.url));
      newJobs.forEach(j => seenUrls.add(j.url));
      allJobs.push(...newJobs);
      
      console.log(`  ✓ Got ${jobs.length} jobs (${newJobs.length} new, total: ${allJobs.length})`);
    } catch (err) {
      console.error(`  ❌ Page ${p} failed: ${err.message}`);
    }

    // Save cookies mỗi 5 pages
    if (p % 5 === 0) {
      await context.storageState({ path: CONFIG.cookiesFile });
    }

    await sleep(1500, 3500); // Delay giữa các page
  }

  await page.close();
  console.log(`\n📊 Total jobs collected: ${allJobs.length}`);

  // ============ STEP 4: Scrape detail pages (parallel) ============
  console.log(`\n🔍 Scraping ${allJobs.length} job details...`);
  const limit = pLimit(CONFIG.detailConcurrency);
  const detailed = [];
  let done = 0;

  const tasks = allJobs.map(job => limit(async () => {
    try {
      await sleep(500, 1500);
      const detail = await scrapeJobDetail(context, job);
      detailed.push(detail);
      done++;
      if (done % 10 === 0) {
        console.log(`  Progress: ${done}/${allJobs.length}`);
      }
    } catch (err) {
      console.error(`  ❌ ${job.title.slice(0, 40)}: ${err.message}`);
      detailed.push(job); // giữ lại data cơ bản nếu detail fail
    }
  }));

  await Promise.all(tasks);

  // ============ STEP 5: Save + cleanup ============
  await context.storageState({ path: CONFIG.cookiesFile });
  await browser.close();

  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(detailed, null, 2));
  console.log(`\n✅ Saved ${detailed.length} jobs to ${CONFIG.outputFile}`);
  console.timeEnd('⏱️ Total time');
}

main().catch(console.error);