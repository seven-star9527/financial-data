# -*- coding: utf-8 -*-
import os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import akshare as ak
import warnings
warnings.filterwarnings('ignore')

currencies = [
    '美元', '加拿大元', '英镑', '欧元', '澳大利亚元', '日元', '瑞典克朗',
    '波兰兹罗提', '土耳其里拉', '沙特里亚尔', '墨西哥比索', '印度卢比',
    '港币', '巴西雷亚尔', '阿联酋迪拉姆', '新加坡元', '泰国铢', '丹麦克朗',
    '菲律宾比索', '新西兰元', '瑞士法郎', '林吉特', '卢布', '匈牙利福林',
    '以色列谢克尔', '越南盾', '新台币', '捷克克朗'
]

print(f"共 {len(currencies)} 种货币，逐一测试...\n")
supported = []
unsupported = []

for curr in currencies:
    try:
        df = ak.currency_boc_sina(symbol=curr, start_date='20250101', end_date='20250115')
        if df is not None and not df.empty and '中行折算价' in df.columns:
            val = df['中行折算价'].dropna().iloc[0] if not df['中行折算价'].dropna().empty else None
            print(f"  [OK] {curr:<12} 行数:{len(df)}  折算价示例:{val}")
            supported.append(curr)
        else:
            print(f"  [??] {curr:<12} 返回空或无折算价列  cols:{df.columns.tolist() if df is not None else 'None'}")
            unsupported.append(curr)
    except Exception as e:
        print(f"  [ERR] {curr:<12} 错误: {e}")
        unsupported.append(curr)

print(f"\n支持({len(supported)}): {supported}")
print(f"\n不支持({len(unsupported)}): {unsupported}")
