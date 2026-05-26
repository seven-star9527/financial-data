import os
import time
import sqlite3
import base64
import json
import argparse
from datetime import datetime, timedelta
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
from yes_captcha_solver import YesCaptchaSolver

# 加载配置
load_dotenv()

DB_FILE = "boc_fx_rates.db"
EXPORT_JSON = "boc_fx_rates_export.json"

# 目标货币白名单
TARGET_CURRENCIES = [
    '美元', '加拿大元', '英镑', '欧元', '澳大利亚元', '日元', '瑞典克朗',
    '波兰兹罗提', '土耳其里拉', '沙特里亚尔', '墨西哥比索', '印度卢比',
    '港币', '巴西雷亚尔', '阿联酋迪拉姆', '新加坡元', '泰国铢', '丹麦克朗',
    '菲律宾比索', '新西兰元', '瑞士法郎', '林吉特', '卢布', '匈牙利福林',
    '以色列谢克尔', '越南盾', '新台币', '捷克克朗'
]

BOC_NAME_MAP = {
    '韩元': '韩国元'
}

class BOCCrawler:
    def __init__(self):
        self.solver = YesCaptchaSolver()
        self.url = "https://srh.bankofchina.com/search/whpj/search_cn.jsp"

    def init_db(self):
        conn = sqlite3.connect(DB_FILE)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS boc_fx_rates (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                currency      TEXT    NOT NULL,
                rate_date     TEXT    NOT NULL,
                year_month    TEXT    NOT NULL,
                buy_rate      REAL,
                cash_buy      REAL,
                sell_rate     REAL,
                central_rate  REAL,
                convert_rate  REAL    NOT NULL,
                fetched_at    TEXT    NOT NULL,
                UNIQUE(currency, year_month)
            )
        """)
        conn.commit()
        conn.close()

    def export_to_json(self):
        """将数据库中的汇率导出为 JSON 文件供 Node.js 使用"""
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cur = conn.execute("SELECT currency, year_month, convert_rate FROM boc_fx_rates")
        rows = cur.fetchall()
        conn.close()
        
        export_data = {}
        for row in rows:
            currency = row['currency']
            ym = row['year_month']
            rate = row['convert_rate']
            
            if currency not in export_data:
                export_data[currency] = {}
            export_data[currency][ym] = rate
            
        with open(EXPORT_JSON, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)
        print(f"数据已导出至: {EXPORT_JSON}")

    def fetch_currency_for_day(self, page, currency, target_date):
        """查询某一天的数据"""
        boc_label = BOC_NAME_MAP.get(currency, currency)
        page.select_option("select#pjname", label=boc_label)
        
        page.fill("input#searchDate", target_date)
        if page.locator("input#nothing").count() > 0:
            page.fill("input#nothing", target_date)
        
        max_retries = 3
        for i in range(max_retries):
            captcha_img = page.locator('img#captcha_img')
            if captcha_img.count() == 0:
                captcha_img = page.locator('img[src^="data:image"]')
            
            if captcha_img.count() == 0:
                print("未找到验证码图片")
                return "error"
            
            src = captcha_img.first.get_attribute("src")
            if "base64," in src:
                img_base64 = src.split("base64,")[1]
            else:
                img_base64 = base64.b64encode(captcha_img.screenshot()).decode("utf-8")
            
            captcha_text = self.solver.solve_image_to_text(img_base64)
            if not captcha_text:
                captcha_img.click()
                time.sleep(1)
                continue
            
            page.fill('input[name="captcha"]', captcha_text)
            page.click('input[type="button"][value="查询"]')
            time.sleep(2)
            
            if page.locator("div.BOC_main table tr").count() > 1:
                return "success"
            else:
                captcha_img.click()
                time.sleep(1)
        
        return "nodata"

    def fetch_currency_rate(self, page, currency, year_month):
        """
        为一个月份抓取该月第一条有效记录的最后更新值
        """
        print(f"\n[任务] 查询: {currency} 月份: {year_month}")
        
        try:
            max_page_retries = 3
            options = None
            for p_retry in range(max_page_retries):
                try:
                    page.goto(self.url, wait_until="networkidle", timeout=30000)
                    options = page.eval_on_selector_all('select#pjname option', 'elements => elements.map(e => e.innerText.trim())')
                    if options: break
                except:
                    time.sleep(2)
            
            if not options:
                print(f"[{currency}] 无法加载下拉框选项")
                return None

            boc_label = BOC_NAME_MAP.get(currency, currency)
            if boc_label not in options:
                print(f"[{currency}] 下拉框中未找到")
                return None 

            # 尝试 1 号到 7 号，直到找到数据
            for day in range(1, 8):
                target_date = f"{year_month}-{day:02d}"
                print(f"尝试日期: {target_date}...")
                
                status = self.fetch_currency_for_day(page, currency, target_date)
                if status == "success":
                    rows = page.locator("div.BOC_main table tr").all()
                    if len(rows) > 1:
                        cols = rows[1].locator("td").all_inner_texts()
                        if len(cols) >= 7:
                            def safe_float(val):
                                try: return float(val.strip())
                                except: return None

                            rate_data = {
                                "currency": currency,
                                "rate_date": cols[6][:10].strip(),
                                "publish_time": cols[6].strip(), # 完整的发布时间
                                "year_month": year_month,
                                "buy_rate": safe_float(cols[1]),
                                "cash_buy": safe_float(cols[2]),
                                "sell_rate": safe_float(cols[3]),
                                "central_rate": None,
                                "convert_rate": safe_float(cols[5]),
                                "fetched_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                            }
                            if rate_data['convert_rate'] is not None:
                                print(f"[{currency}] {target_date} 找到有效数据: {rate_data['convert_rate']} (发布时间: {rate_data['publish_time']})")
                                return rate_data
                elif status == "error":
                    print(f"[{currency}] 验证码错误或其他异常，跳过 {target_date}")
            
            print(f"[{currency}] {year_month} 前7天均无数据")
            return None

        except Exception as e:
            print(f"抓取 {currency} 失败: {e}")
            return None

    def save_to_db(self, record):
        if not record: return
        conn = sqlite3.connect(DB_FILE)
        try:
            conn.execute("""
                INSERT INTO boc_fx_rates 
                (currency, rate_date, year_month, buy_rate, cash_buy, sell_rate, central_rate, convert_rate, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(currency, year_month) DO UPDATE SET
                    rate_date=excluded.rate_date,
                    buy_rate=excluded.buy_rate,
                    cash_buy=excluded.cash_buy,
                    sell_rate=excluded.sell_rate,
                    convert_rate=excluded.convert_rate,
                    fetched_at=excluded.fetched_at
            """, (
                record["currency"], record["rate_date"], record["year_month"],
                record["buy_rate"], record["cash_buy"], record["sell_rate"],
                record["central_rate"], record["convert_rate"], record["fetched_at"]
            ))
            conn.commit()
            print(f"OK: {record['currency']} {record['year_month']} 数据库已更新")
        except Exception as e:
            print(f"数据库保存失败: {e}")
        finally:
            conn.close()

    def run(self, target_months):
        self.init_db()
        
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = context.new_page()
            
            page.goto(self.url, wait_until="networkidle")
            
            for month in target_months:
                print(f"\n========== 开始采集月份: {month} ==========")
                success_count = 0
                for currency in TARGET_CURRENCIES:
                    record = self.fetch_currency_rate(page, currency, month)
                    if record:
                        self.save_to_db(record)
                        success_count += 1
                    time.sleep(1)
                print(f"月份 {month} 采集完成。成功: {success_count}/{len(TARGET_CURRENCIES)}")
                
            browser.close()
        
        self.export_to_json()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='中行汇率爬虫')
    parser.add_argument('--target-month', type=str, help='目标月份，例如 2026-04')
    parser.add_argument('--backfill', action='store_true', help='回溯 2025-07 至 2026-05')
    parser.add_argument('--start', type=str, help='起始月份 YYYY-MM')
    parser.add_argument('--end', type=str, help='结束月份 YYYY-MM')
    args = parser.parse_args()

    crawler = BOCCrawler()
    
    months = []
    if args.backfill:
        # 2025年7-12月
        months += [f"2025-{m:02d}" for m in range(7, 13)]
        # 2026年1-5月
        months += [f"2026-{m:02d}" for m in range(1, 6)]
    elif args.start and args.end:
        # 生成范围内的所有月份
        s_yr, s_mo = map(int, args.start.split('-'))
        e_yr, e_mo = map(int, args.end.split('-'))
        curr_yr, curr_mo = s_yr, s_mo
        while (curr_yr < e_yr) or (curr_yr == e_yr and curr_mo <= e_mo):
            months.append(f"{curr_yr}-{curr_mo:02d}")
            curr_mo += 1
            if curr_mo > 12:
                curr_mo = 1
                curr_yr += 1
    elif args.target_month:
        months = [args.target_month]
    else:
        # 默认当月
        months = [datetime.now().strftime("%Y-%m")]
        
    crawler.run(months)
