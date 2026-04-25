import requests
import cloudscraper
import time
import random
import re
import os
from bs4 import BeautifulSoup
from utils.constants import base_url
from utils.requests_helper import login, get_headers


def extract_companies_from_html(html_content):
    """Trích xuất thông tin company từ đoạn HTML chứa các company cards."""
    companies = []
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Cấu trúc: <a class="featured-company" href="/companies/xxx/review">
    cards = soup.find_all('a', class_='featured-company')
    
    for card in cards:
        company = {}
        
        # URL
        href = card.get('href', '')
        if href:
            company['URL'] = f'{base_url}{href}'
            slug = href.replace('/companies/', '').replace('/review', '')
            company['Slug'] = slug
        
        # Name: <h4 class='company__name'>
        name_tag = card.find('h4', class_='company__name')
        if name_tag:
            company['Name'] = name_tag.text.strip()
        
        # Rating: <span class='company__star-rate'>
        rating_tag = card.find('span', class_='company__star-rate')
        if rating_tag:
            company['Rating'] = rating_tag.text.strip()
        
        # City: <span class='company__footer-city'>
        city_tag = card.find('span', class_='company__footer-city')
        if city_tag:
            company['City'] = city_tag.text.strip()
        
        # Footer spans contain jobs count and reviews count
        footer = card.find('footer', class_='company__footer')
        if footer:
            spans = footer.find_all('span')
            for span in spans:
                text = span.get_text(strip=True)
                if 'job' in text.lower():
                    nums = re.findall(r'\d+', text)
                    if nums:
                        company['Jobs'] = int(nums[0])
                if 'review' in text.lower():
                    nums = re.findall(r'\d+', text)
                    if nums:
                        company['Reviews'] = int(nums[0])
        
        # Best about
        rated = card.find('div', class_='company__rated')
        if rated:
            rated_text = rated.get_text(separator=' ', strip=True)
            rated_text = re.sub(r'^Best\s+about\s*', '', rated_text, flags=re.IGNORECASE).strip()
            if rated_text:
                company['Best About'] = rated_text
        
        # Company description
        info_div = card.find('div', class_='company__info')
        if info_div:
            header = info_div.find('header')
            footer_tag = info_div.find('footer')
            if header and footer_tag:
                desc_parts = []
                for sibling in header.next_siblings:
                    if sibling == footer_tag:
                        break
                    text = sibling.string if sibling.string else ''
                    text = text.strip()
                    if text:
                        desc_parts.append(text)
                if desc_parts:
                    company['Description'] = ' '.join(desc_parts)
        
        if company.get('Name'):
            companies.append(company)
    
    return companies


def fetch_all_companies_via_api(session, headers):
    """Fetch TẤT CẢ companies thông qua ITviec API (như khi click See More)."""
    all_companies = []
    
    # Lần đầu lấy 6 công ty từ trang chủ HTML
    print("📡 Lấy 6 công ty đầu tiên từ trang listing...")
    response = session.get(f'{base_url}/companies/review-company', headers=headers)
    
    if response.status_code == 200:
        first_batch = extract_companies_from_html(response.text)
        all_companies.extend(first_batch)
        print(f"   => Lấy được {len(first_batch)} công ty.")
    
    # Lấy tiếp qua API
    offset = 6
    count = 18
    page = 1
    
    while True:
        print(f"📡 API Pagination #{page} (offset={offset}, count={count})...")
        api_url = f'{base_url}/api/v1/employers/most-popular'
        
        params = {
            'city': '',
            'rating_type': '',
            'count': count,
            'locale': 'en',
            'offset': offset,
            'show_cta': 'false'
        }
        
        # Header cần thiết cho AJAX request
        ajax_headers = headers.copy()
        ajax_headers['Accept'] = 'application/json, text/javascript, */*; q=0.01'
        ajax_headers['X-Requested-With'] = 'XMLHttpRequest'
        ajax_headers['Referer'] = f'{base_url}/companies/review-company'
        
        res = session.get(api_url, headers=ajax_headers, params=params)
        
        if res.status_code != 200:
            print(f"   ⚠ Lỗi API: HTTP {res.status_code}")
            break
            
        try:
            data = res.json()
            html_snippet = data.get('html', '')
            returned_count = data.get('count', 0)
            
            if not html_snippet:
                print("   => Hết dữ liệu (không có html).")
                break
                
            batch_companies = extract_companies_from_html(html_snippet)
            all_companies.extend(batch_companies)
            print(f"   => Nhận thêm {len(batch_companies)} công ty. (Tổng: {len(all_companies)})")
            
            if returned_count < count:
                print("   => Đã hết danh sách (result < count).")
                break
                
            offset += returned_count
            page += 1
            time.sleep(random.uniform(1.5, 3.0))
            
        except Exception as e:
            print(f"   ⚠ Lỗi Parse JSON: {e}")
            break

    # Lọc trùng lặp
    unique_companies = []
    seen_slugs = set()
    for c in all_companies:
        slug = c.get('Slug')
        if slug not in seen_slugs:
            seen_slugs.add(slug)
            unique_companies.append(c)

    return unique_companies


def fetch_companies_by_alphabet(session, headers):
    """Lấy danh sách các công ty thông qua trang danh bạ jobs-company-index."""
    all_slugs = set()
    print("\n📡 Bắt đầu quét danh bạ công ty (Alphabet Index)...")
    
    indexes = [
        '', # Trang đầu (A-C)
        '/d-f',
        '/g-i',
        '/j-l',
        '/m-o',
        '/p-r',
        '/s-u',
        '/v-x',
        '/y-z',
        '/others'
    ]
    
    for idx in indexes:
        url = f'{base_url}/jobs-company-index{idx}'
        try:
            res = session.get(url, headers=headers)
            if res.status_code == 200:
                soup = BeautifulSoup(res.text, 'html.parser')
                for a in soup.find_all('a'):
                    href = a.get('href', '')
                    if href.startswith('/companies/'):
                        slug = href.replace('/companies/', '').split('?')[0].replace('/review', '').strip('/')
                        if slug and slug != 'review-company':
                            all_slugs.add(slug)
        except Exception:
            pass
        time.sleep(random.uniform(0.2, 0.5))
        
    print(f"   => Quét được {len(all_slugs)} slugs công ty độc nhất từ danh bạ.")
    return list(all_slugs)


def scrape_company_detail(session, headers, company_url):
    """Scrape thêm chi tiết từ trang company riêng (overview)."""
    details = {}
    try:
        response = session.get(company_url, headers=headers)
        if response.status_code != 200:
            return details
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Trích xuất Tên công ty (rất quan trọng cho các công ty lấy từ danh bạ A-Z)
        name_tag = soup.find('h1')
        if name_tag:
            details['Name'] = name_tag.text.strip()
            
        # Trích xuất địa chỉ cơ bản
        address_tags = soup.select('.location, .country, .city, .address')
        if address_tags:
            details['Location'] = address_tags[0].get_text(separator=' ', strip=True)
            
        # Tìm overview tab
        overview_link = None
        for a in soup.find_all('a'):
            href = a.get('href', '')
            text = a.get_text(strip=True).lower()
            if 'overview' in text and '/companies/' in href:
                overview_link = href
                break
        
        if overview_link:
            if not overview_link.startswith('http'):
                overview_link = f'{base_url}{overview_link}'
            response = session.get(overview_link, headers=headers)
            soup = BeautifulSoup(response.content, 'html.parser')
        
        # Lấy các chi tiết khác (Overview, General info, Key skills, v.v...)
        # ITviec hiện dùng Tailwind/Utility class, nên ta sẽ quét qua các thẻ h2
        for h2 in soup.find_all('h2'):
            title = h2.get_text(strip=True).lower()
            parent = h2.parent
            if not parent:
                continue
                
            text = parent.get_text(separator='\n', strip=True)
            # Bỏ tiêu đề h2 ra khỏi nội dung
            text = re.sub(f'^{re.escape(h2.get_text(strip=True))}\n', '', text, flags=re.IGNORECASE).strip()
            
            if not text or len(text) < 5:
                continue
                
            if 'company overview' in title:
                details['Company Overview'] = text
            elif 'general information' in title:
                details['General Information'] = text
            elif 'key skills' in title:
                details['Key Skills'] = text
            elif 'love working' in title:
                details["Why You'll Love Working Here"] = text
            elif 'location' in title and 'Location' not in details:
                details['Location'] = text
            elif 'description' in title and 'Description' not in details:
                details['Description'] = text
        
    except Exception as e:
        print(f'      Detail error: {e}')
    
    return details


def scrape_companies_bs4():
    session = cloudscraper.create_scraper()
    login(session)
    headers = get_headers()
    
    debug_dir = 'debug'
    os.makedirs(debug_dir, exist_ok=True)
    
    # ==========================================
    # Step 1: Lấy TẤT CẢ danh sách qua API JS
    # ==========================================
    print('=' * 50)
    print('📋 Step 1: Extracting all companies via API...')
    print('=' * 50)
    
    companies = fetch_all_companies_via_api(session, headers)
    
    # Bước 1.5: Vét cạn thêm bằng A-Z
    extra_slugs = fetch_companies_by_alphabet(session, headers)
    
    # Lọc ra những slug chưa có trong danh sách 'companies'
    existing_slugs = {c.get('Slug') for c in companies if c.get('Slug')}
    new_slugs = [slug for slug in extra_slugs if slug not in existing_slugs]
    
    # Tạo object cơ bản cho các công ty mới tìm được
    for slug in new_slugs:
        companies.append({
            'Slug': slug,
            'URL': f'{base_url}/companies/{slug}'
        })
    
    if not companies:
        print('❌ Không tìm thấy công ty nào.')
        return []
        
    print(f'\n✅ Đã lấy thành công tổng cộng {len(companies)} companies (phổ biến + vét cạn A-Z).')
    
    # ==========================================
    # Step 2: Lấy thêm chi tiết từ từng company page
    # ==========================================
    print('\n' + '=' * 50)
    print('📋 Step 2: Enriching with company page details...')
    print('=' * 50)
    
    for i, company in enumerate(companies, 1):
        slug = company.get('Slug', '')
        if not slug:
            continue
        
        detail_url = f'{base_url}/companies/{slug}'
        print(f'  [{i}/{len(companies)}] {company.get("Name", "?")}...')
        
        # Chỉ fetch chi tiết nếu bạn cần. (Comment out nếu tốc độ quan trọng hơn)
        # Để crawl nhanh, có thể bỏ qua bước này.
        extra = scrape_company_detail(session, headers, detail_url)
        if extra:
            company.update(extra)
            print(f'      ✅ +{len(extra)} fields')
        else:
            print(f'      ℹ  No extra details')
        
        # Delay để không bị block
        time.sleep(random.uniform(0.5, 1.5))
    
    for c in companies:
        c.pop('Slug', None)
        
    # Loại bỏ các công ty rác (chẳng hạn như 'review-company')
    companies = [c for c in companies if 'review-company' not in c.get('URL', '')]

    # Chuẩn hoá toàn bộ nội dung của TẤT CẢ công ty trước khi xuất file
    for c in companies:
        for k, v in c.items():
            if isinstance(v, str):
                # Xoá các khoảng trắng thừa và ký tự xuống dòng
                clean_val = re.sub(r'\s+', ' ', v).strip()
                # Giới hạn độ dài text để file CSV không bị phình to hoặc rác
                if len(clean_val) > 1000:
                    clean_val = clean_val[:1000] + '...'
                c[k] = clean_val
    
    print(f'\n✅ Total: {len(companies)} companies scraped')
    return companies
