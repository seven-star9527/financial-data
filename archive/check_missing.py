import sqlite3
import json

TARGET_CURRENCIES = ['美元', '加拿大元', '英镑', '欧元', '澳大利亚元', '日元', '瑞典克朗', '波兰兹罗提', '土耳其里拉', '沙特里亚尔', '墨西哥比索', '印度卢比', '港币', '巴西雷亚尔', '阿联酋迪拉姆', '新加坡元', '泰国铢', '丹麦克朗', '菲律宾比索', '新西兰元', '瑞士法郎', '林吉特', '卢布', '匈牙利福林', '以色列谢克尔', '越南盾', '新台币', '捷克克朗']

conn = sqlite3.connect('boc_fx_rates.db')
cur = conn.execute("SELECT DISTINCT currency FROM boc_fx_rates WHERE year_month='2026-05'")
fetched = [row[0] for row in cur.fetchall()]
conn.close()

missing = [c for c in TARGET_CURRENCIES if c not in fetched]

with open('missing.json', 'w', encoding='utf-8') as f:
    json.dump(missing, f, ensure_ascii=False)
