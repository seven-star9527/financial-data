# -*- coding: utf-8 -*-
import sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

conn = sqlite3.connect('boc_fx_rates.db')

count = conn.execute('SELECT COUNT(*) FROM boc_fx_rates').fetchone()[0]
currencies = [r[0] for r in conn.execute('SELECT DISTINCT currency FROM boc_fx_rates ORDER BY currency').fetchall()]
print(f'总记录数: {count}')
print(f'货币种类 ({len(currencies)}): {currencies}')
print()

print('=== 美元 月度折算价（中行折算价 / 100外币折合人民币）===')
rows = conn.execute('''
    SELECT year_month, rate_date, convert_rate, central_rate, buy_rate 
    FROM boc_fx_rates WHERE currency="美元" ORDER BY year_month
''').fetchall()
for r in rows:
    cv = f"{r[2]:.2f}" if r[2] else "N/A"
    cr = f"{r[3]:.2f}" if r[3] else "N/A"
    print(f"  {r[0]}  首日:{r[1]}  折算价:{cv}  央行中间价:{cr}")

print()
print('=== 欧元 月度折算价 ===')
rows2 = conn.execute('''
    SELECT year_month, rate_date, convert_rate 
    FROM boc_fx_rates WHERE currency="欧元" ORDER BY year_month
''').fetchall()
for r in rows2:
    cv = f"{r[2]:.2f}" if r[2] else "N/A"
    print(f"  {r[0]}  首日:{r[1]}  折算价:{cv}")

conn.close()
