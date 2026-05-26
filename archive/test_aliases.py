# -*- coding: utf-8 -*-
"""
测试 AkShare currency_boc_sina 对各种货币代码/名称的支持
AkShare 内部使用新浪财经接口，参数是货币代码(如TWD)，AkShare对其做了名称映射
"""
import os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import akshare as ak
import warnings
warnings.filterwarnings('ignore')

# 查看 AkShare 内部的货币映射
# 通过源码或直接测试找到支持的中文名
test_names = [
    # 不支持的货币，尝试不同的名称
    ('波兰兹罗提', ['波兰兹罗提', '波兰币', '兹罗提']),
    ('土耳其里拉', ['土耳其里拉', '土耳其', '里拉']),
    ('沙特里亚尔', ['沙特里亚尔', '沙特', '里亚尔']),
    ('墨西哥比索', ['墨西哥比索', '墨西哥', '比索']),
    ('印度卢比',   ['印度卢比', '卢比']),
    ('巴西雷亚尔', ['巴西雷亚尔', '巴西', '雷亚尔']),
    ('阿联酋迪拉姆',['阿联酋迪拉姆', '迪拉姆', '阿联酋']),
    ('林吉特',     ['林吉特', '马来西亚林吉特', '马来西亚']),
    ('卢布',       ['卢布', '俄罗斯卢布', '俄罗斯']),
    ('匈牙利福林', ['匈牙利福林', '福林', '匈牙利']),
    ('以色列谢克尔',['以色列谢克尔', '谢克尔', '以色列']),
    ('越南盾',     ['越南盾', '盾', '越南']),
    ('新台币',     ['新台币', '台币']),
    ('捷克克朗',   ['捷克克朗', '克朗', '捷克']),
]

for currency_cn, aliases in test_names:
    found = False
    for alias in aliases:
        try:
            df = ak.currency_boc_sina(symbol=alias, start_date='20250101', end_date='20250115')
            if df is not None and not df.empty:
                print(f"  [OK] '{currency_cn}' -> 使用名称:'{alias}'  行数:{len(df)}  列:{df.columns.tolist()}")
                found = True
                break
        except Exception as e:
            pass
    if not found:
        print(f"  [FAIL] '{currency_cn}' 所有别名均不支持")
