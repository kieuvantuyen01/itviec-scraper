import os
from bs4_scraper import scrape_companies_bs4
from selenium_scraper import scrape_companies_selenium
from playwright_scraper import scrape_companies_playwright
from utils.csv_helper import save_to_csv
from utils.json_helper import save_to_json
from utils.selenium_helper import setup_selenium_driver
import threading

def get_user_input(prompt, timeout, default):
    def ask_input():
        nonlocal user_input
        user_input = input(prompt).strip().lower()

    user_input = default
    thread = threading.Thread(target=ask_input)
    thread.start()
    thread.join(timeout)
    return user_input

def main():
    # CI mode: đọc từ environment variables (không cần interactive input)
    ci_mode = os.environ.get('CI', '') == 'true'

    if ci_mode:
        method = os.environ.get('SCRAPE_METHOD', 'playwright').lower()
        export_format = os.environ.get('EXPORT_FORMAT', 'json').lower()
        print(f"🤖 CI mode: method={method}, export={export_format}")
    else:
        method = get_user_input("Choose scraping method (bs4/selenium): ", 20, "bs4")
        export_format = None  # sẽ hỏi sau khi scrape xong

    if method == 'playwright':
        companies = scrape_companies_playwright()
    elif method == 'bs4':
        companies = scrape_companies_bs4()
    elif method == 'selenium':
        if ci_mode:
            browser = os.environ.get('BROWSER', 'firefox')
        else:
            browser = get_user_input("Choose browser (firefox/safari/edge): ", 20, "safari")
        driver = setup_selenium_driver(browser)
        if driver:
            companies = scrape_companies_selenium(driver)
            driver.quit()
        else:
            print("Unsupported browser.")
            return
    else:
        print("Unsupported method.")
        return

    if companies:
        if export_format is None:
            export_format = get_user_input("Choose export format (csv/json): ", 20, "csv")

        if export_format == 'csv':
            save_to_csv(companies)
        elif export_format == 'json':
            save_to_json(companies)
        else:
            print("Unsupported export format.")
            return

        # Trong CI mode, export cả CSV và JSON
        if ci_mode:
            if export_format != 'csv':
                save_to_csv(companies)
            if export_format != 'json':
                save_to_json(companies)

        print(f'✅ Scraping completed. {len(companies)} companies saved.')
    else:
        print('❌ No companies scraped.')
        if ci_mode:
            exit(1)

if __name__ == '__main__':
    main()

