import json
from playwright.sync_api import sync_playwright

url = "https://srh.bankofchina.com/search/whpj/search_cn.jsp"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    
    print("Navigating to BOC...")
    page.goto(url, wait_until="networkidle")
    
    options = page.eval_on_selector_all('select#pjname option', 
        'elements => elements.map(e => ({ value: e.value, text: e.innerText.trim() }))')
    
    with open("pdf-analyze/scratch/boc_options.json", "w", encoding="utf-8") as f:
        json.dump(options, f, ensure_ascii=False, indent=2)
        
    print("Successfully exported to pdf-analyze/scratch/boc_options.json")
    browser.close()
