import base64
import time
import os
from playwright.sync_api import sync_playwright
from yes_captcha_solver import YesCaptchaSolver
from dotenv import load_dotenv

load_dotenv()

def test_boc_captcha_with_playwright():
    print("开始使用 Playwright 测试中行验证码识别 (新搜索页面)...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()
        
        try:
            # 1. 访问中行新搜索页面
            target_url = "https://srh.bankofchina.com/search/whpj/search_cn.jsp"
            print(f"正在访问: {target_url}")
            page.goto(target_url, wait_until="networkidle", timeout=60000)
            
            # 2. 定位验证码图片 (通常是一个 img 标签，其 src 是 data:image/png;base64,...)
            # 或者查看 id
            print("正在定位验证码...")
            # 尝试定位包含 base64 的图片
            captcha_img = page.locator('img[src^="data:image"]')
            
            if captcha_img.count() > 0:
                print("找到验证码图片，正在提取数据...")
                src = captcha_img.first.get_attribute("src")
                
                # 提取 base64 部分
                if "," in src:
                    img_base64 = src.split(",")[1]
                else:
                    img_base64 = src
                
                # 保存图片供查看 (调试用)
                with open("boc_captcha_extracted.png", "wb") as f:
                    f.write(base64.b64decode(img_base64))
                print(f"验证码图片已保存: boc_captcha_extracted.png")
                
                # 3. 调用 YesCaptcha 识别
                solver = YesCaptchaSolver()
                print("正在调用 YesCaptcha 识别...")
                result = solver.solve_image_to_text(img_base64, task_type="ImageToTextTaskOcrBase")
                
                if result:
                    print(f"识别成功! 结果: {result}")
                else:
                    print("识别失败")
            else:
                print("未能定位到验证码图片")
                page.screenshot(path="debug_page_new.png")
                print("已保存页面截图: debug_page_new.png")
                
        except Exception as e:
            print(f"发生错误: {e}")
            page.screenshot(path="error_page_new.png")
        finally:
            browser.close()

if __name__ == "__main__":
    test_boc_captcha_with_playwright()
