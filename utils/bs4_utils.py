import requests
from bs4 import BeautifulSoup

def get_company_details_bs4(company_url):
    response = requests.get(company_url)
    soup = BeautifulSoup(response.content, 'html.parser')
    
    details = {}
    
    # Extracting basic company details
    name_tag = soup.find('h1', class_='company__name')
    location_tag = soup.find('span', class_='company__location')
    type_tag = soup.find('div', class_='company__type')
    description_tag = soup.find('div', class_='company__description')
    
    if name_tag:
        details['Name'] = name_tag.text.strip()
    if location_tag:
        details['City'] = location_tag.text.strip()
    if type_tag:
        details['Type'] = type_tag.text.strip()
    if description_tag:
        details['Description'] = description_tag.text.strip()
    
    # Extracting General Information and Company Overview
    general_info_tag = soup.find('div', class_='company__general-info')
    overview_tag = soup.find('div', class_='company__overview')
    
    if general_info_tag:
        details['General Information'] = general_info_tag.text.strip()
    if overview_tag:
        details['Company Overview'] = overview_tag.text.strip()
    
    # Extracting additional sections
    key_skills_tag = soup.find('div', class_='company__key-skills')
    location_tag = soup.find('div', class_='company__location')
    love_working_here_tag = soup.find('div', class_='company__love-working-here')
    
    if key_skills_tag:
        details['Our Key Skills'] = key_skills_tag.text.strip()
    if location_tag:
        details['Location'] = location_tag.text.strip()
    if love_working_here_tag:
        details['Why You\'ll Love Working Here'] = love_working_here_tag.text.strip()
    
    return details
