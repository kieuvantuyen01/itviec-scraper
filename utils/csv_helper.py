import csv

def save_to_csv(companies):
    if not companies:
        print("No companies found to save.")
        return

    # Khóa cố định dựa trên yêu cầu của người dùng
    final_keys = ['Name', 'URL', 'Rating', 'City', 'Location', 'Jobs', 'Reviews', 'Best About', 'Description']
    
    # Chuẩn hoá data: Chỉ lấy những key nằm trong final_keys, nếu không có thì để trống
    cleaned_companies = []
    for c in companies:
        cleaned_c = {k: c.get(k, '') for k in final_keys}
        cleaned_companies.append(cleaned_c)

    with open('companies_detailed.csv', 'w', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=final_keys)
        writer.writeheader()
        writer.writerows(cleaned_companies)
