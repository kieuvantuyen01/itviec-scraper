from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.webdriver.safari.service import Service as SafariService
from selenium.webdriver.edge.service import Service as EdgeService
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.safari.options import Options as SafariOptions
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.common.exceptions import NoSuchElementException, TimeoutException, ElementNotInteractableException
import time
from .constants import base_url
from credentials import username, password

def get_company_details_selenium(driver, company_url):
    details = {}
    
    try:
        overview_tab = driver.find_element(By.XPATH, "//a[@data-controller='utm-tracking' and contains(@class, 'tab-link') and contains(text(), 'Overview')]")
        overview_tab.click()
        time.sleep(2)  # Wait for the Overview tab to load

        name_tag = driver.find_element(By.CLASS_NAME, 'company__name')
        location_tag = driver.find_element(By.CLASS_NAME, 'company__location')
        type_tag = driver.find_element(By.CLASS_NAME, 'company__type')
        description_tag = driver.find_element(By.CLASS_NAME, 'company__description')

        if name_tag:
            details['Name'] = name_tag.text.strip()
        if location_tag:
            details['City'] = location_tag.text.strip()
        if type_tag:
            details['Type'] = type_tag.text.strip()
        if description_tag:
            details['Description'] = description_tag.text.strip()

        general_info_tag = driver.find_element(By.CLASS_NAME, 'company__general-info')
        overview_tag = driver.find_element(By.CLASS_NAME, 'company__overview')

        if general_info_tag:
            details['General Information'] = general_info_tag.text.strip()
        if overview_tag:
            details['Company Overview'] = overview_tag.text.strip()

        key_skills_tag = driver.find_element(By.CLASS_NAME, 'company__key-skills')
        location_tag = driver.find_element(By.CLASS_NAME, 'company__location')
        love_working_here_tag = driver.find_element(By.CLASS_NAME, 'company__love-working-here')

        if key_skills_tag:
            details['Our Key Skills'] = key_skills_tag.text.strip()
        if location_tag:
            details['Location'] = location_tag.text.strip()
        if love_working_here_tag:
            details['Why You\'ll Love Working Here'] = love_working_here_tag.text.strip()

    except NoSuchElementException as e:
        print(f"Error extracting company details: {e}")
    
    return details

def setup_selenium_driver(browser):
    if browser == 'firefox':
        options = FirefoxOptions()
        service = FirefoxService()
        driver = webdriver.Firefox(service=service, options=options)
    elif browser == 'safari':
        options = SafariOptions()
        service = SafariService()
        driver = webdriver.Safari(service=service, options=options)
    elif browser == 'edge':
        options = EdgeOptions()
        service = EdgeService()
        driver = webdriver.Edge(service=service, options=options)
    else:
        driver = None

    return driver

def login(driver):
    driver.get(f'{base_url}/sign_in')
    
    username_field = driver.find_element(By.ID, 'user_email')
    password_field = driver.find_element(By.ID, 'user_password')
    
    username_field.send_keys(username)
    password_field.send_keys(password)
    
    password_field.send_keys(Keys.RETURN)
    
    # Wait for login to complete
    time.sleep(10)
    
    # Check for successful login
    if "https://itviec.com" in driver.current_url or len(driver.find_elements(By.CLASS_NAME, 'sign-in-user-avatar')) > 0:
        print("Login successful!")
    else:
        print("Login failed!")

def get_total_companies(driver):
    try:
        driver.get(f'{base_url}/companies/')
        total_companies_tag = driver.find_element(By.XPATH, "//div[contains(@class, 'icontainer-sm')]//h1[contains(@class, 'imy-6')]")
        total_companies_text = total_companies_tag.text
        total_companies = int(total_companies_text.split()[0])
        return total_companies
    except NoSuchElementException:
        print("Total number of companies not found.")
        return 0

def click_see_more(driver):
    try:
        driver.get(f"{base_url}/companies/review-company")
        # Scroll to the bottom of the page
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(2)  # Wait for scrolling to complete
        see_more_button = driver.find_element(By.XPATH, "//div[contains(@class, 'show-more text-center imt-3')]//span[contains(text(), 'See more')]")
        see_more_button.click()
        time.sleep(5)  # Wait for the additional companies to load
    except NoSuchElementException:
        print("See more button not found.")
    except ElementNotInteractableException:
        print("See more button not interactable.")
