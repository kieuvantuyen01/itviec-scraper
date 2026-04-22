# ITviec Scraper

Scrape toàn bộ IT job listings từ [itviec.com/it-jobs](https://itviec.com/it-jobs) bằng Playwright + Cheerio, có stealth mode để bypass Cloudflare.

## Features

- Crawl full pagination (auto-detect total pages from DOM).
- Parse list page → summary (title, company, location, salary, skills, posted time, label).
- Parse detail page → reasons to join, job description, requirements, benefits, company info.
- Parallel detail scraping với concurrency configurable (`p-limit`).
- Cookie persistence để tái sử dụng session (bypass Cloudflare sau lần đầu).
- Stealth plugin (`puppeteer-extra-plugin-stealth`) qua `playwright-extra`.
- Dedupe jobs theo URL.

## Requirements

- Node.js 18+
- ~1–2 GB RAM (Chromium)

## Install

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
node scraper.js
```

Output ghi vào `itviec-jobs.json`. Cookies cache ở `itviec-cookies.json`.

## Config

Chỉnh trong [scraper.js](scraper.js) ở object `CONFIG`:

| Key | Default | Ý nghĩa |
|---|---|---|
| `baseUrl` | `https://itviec.com/it-jobs` | List endpoint |
| `maxPages` | `null` | `null` = tất cả, hoặc số page tối đa |
| `outputFile` | `itviec-jobs.json` | Nơi ghi kết quả |
| `cookiesFile` | `itviec-cookies.json` | Nơi lưu session |
| `headless` | `false` | `true` khi chạy production |
| `detailConcurrency` | `3` | Số detail page parse song song |

## Output schema

```jsonc
{
  "jobKey": "db9273ac-452e-4463-b6fd-3fcf97c1bb9b",
  "slug": "lead-data-engineer-vnggames-3901",
  "title": "Lead Data Engineer",
  "url": "https://itviec.com/it-jobs/lead-data-engineer-vnggames-3901",
  "company": "VNGGames",
  "companySlug": "vnggames",
  "salary": "Sign in to view salary",      // "$X - $Y" nếu có session login
  "workingMode": "At office",                // At office | Hybrid | Remote
  "location": "Ho Chi Minh",
  "tags": ["Data Engineer", "MongoDB", "..."],
  "postedTime": "Posted 30 minutes ago",
  "label": "HOT",                            // HOT | SUPER HOT | ""
  "skills": ["...", "..."],                  // merge from list + detail
  "reasons": "- ...\n- ...\n- ...",
  "jobDescription": "- ...\n- ...",
  "requirements": "- ...\n- ...",
  "benefits": "- ...\n- ...",
  "companyInfo": {
    "name": "VNGGames",
    "Company type": "IT Product",
    "Company industry": "Game",
    "Company size": "501-1000 employees",
    "Country": "Vietnam",
    "Working days": "Monday - Friday",
    "Overtime policy": "No OT"
  },
  "scrapedAt": "2026-04-22T14:37:35.050Z"
}
```

## Notes

- **Salary**: nếu không login, luôn là `"Sign in to view salary"`. Để lấy salary thật, login bằng browser thường, export cookies sang `itviec-cookies.json` (Playwright `storageState`).
- **Scale**: ~43 pages × 20 jobs/page ≈ 860 jobs. List ~2 phút, detail (concurrency 3) ~15–25 phút.
- **Cloudflare**: nếu bị challenge liên tục, giảm `detailConcurrency` xuống `1–2` và tăng delay trong `scrapeJobDetail`.
- **Selector drift**: ITviec có thể đổi DOM. Nếu `parseJobList` trả về 0 jobs, inspect lại `debug-page1.html` và cập nhật selectors trong [scraper.js](scraper.js).

## Tech stack

- [`playwright-extra`](https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra) — Playwright wrapper
- [`puppeteer-extra-plugin-stealth`](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth) — anti-bot evasion
- [`cheerio`](https://cheerio.js.org/) — HTML parsing
- [`p-limit`](https://github.com/sindresorhus/p-limit) — concurrency control

## License

ISC. Chỉ dùng cho mục đích học tập / phân tích dữ liệu cá nhân. Tuân thủ [ITviec ToS](https://itviec.com/terms) và `robots.txt`.
