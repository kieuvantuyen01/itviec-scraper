import json

def save_to_json(companies):
    if not companies:
        print("No companies found to save.")
        return

    with open('itviec-companies.json', 'w', encoding='utf-8') as file:
        json.dump(companies, file, ensure_ascii=False, indent=4)
