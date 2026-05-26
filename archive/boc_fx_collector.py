# -*- coding: utf-8 -*-
import os, sys
# 强制 stdout/stderr 使用 UTF-8（解决 Windows GBK 终端乱码）
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
"""
中国银行外汇牌价 - 月度折算价采集器
数据来源：新浪财经（中行牌价数据）via AkShare
接口    ：ak.currency_boc_sina(symbol, start_date, end_date)
数据库  ：SQLite (boc_fx_rates.db)

采集策略：
  - 对每个货币、每个月，查询当月1日~5日区间的数据，
    取第一条记录（中行折算价），作为"当月首日有效汇率"。
  - 若当月1日~5日均无数据（节假日），则取该月第一条可用记录。

使用方法：
  python boc_fx_collector.py [--start 2020-01] [--end 2025-12] [--currencies 美元 欧元 ...]
"""

import akshare as ak
import sqlite3
import argparse
import sys
import time
import logging
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
import pandas as pd

# ─── 日志配置 ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("boc_fx_collector.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

# ─── 支持的货币列表（中行外汇牌价） ─────────────────────────────────────────────
SUPPORTED_CURRENCIES = [
    "美元",       # USD
    "欧元",       # EUR
    "港币",       # HKD
    "英镑",       # GBP
    "日元",       # JPY
    "澳大利亚元", # AUD
    "加拿大元",   # CAD
    "新加坡元",   # SGD
    "瑞士法郎",   # CHF
    "丹麦克朗",   # DKK
    "挪威克朗",   # NOK
    "瑞典克朗",   # SEK
    "新西兰元",   # NZD
    "韩国元",     # KRW
    "泰国铢",     # THB
    "菲律宾比索", # PHP
    "林吉特",     # MYR
    "卢布",       # RUB
    "南非兰特",   # ZAR
    "韩元",       # KRW (alternate name)
]

DB_FILE = "boc_fx_rates.db"

# ─── 数据库初始化 ──────────────────────────────────────────────────────────────
def init_db(conn: sqlite3.Connection):
    """创建数据库表（若不存在）"""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS boc_fx_rates (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            currency      TEXT    NOT NULL,          -- 货币名称（中文）
            rate_date     TEXT    NOT NULL,          -- 汇率日期 YYYY-MM-DD
            year_month    TEXT    NOT NULL,          -- 年月 YYYY-MM
            buy_rate      REAL,                      -- 中行汇买价
            cash_buy      REAL,                      -- 中行钞买价
            sell_rate     REAL,                      -- 中行钞卖价/汇卖价
            central_rate  REAL,                      -- 央行中间价
            convert_rate  REAL    NOT NULL,          -- 中行折算价 ★
            fetched_at    TEXT    NOT NULL,          -- 入库时间
            UNIQUE(currency, year_month)             -- 每货币每月仅保留一条
        )
    """)
    conn.commit()
    logger.info("数据库初始化完成：%s", DB_FILE)


# ─── 查询某货币某月第一条有效记录 ─────────────────────────────────────────────
def fetch_month_rate(currency: str, year: int, month: int) -> dict | None:
    """
    查询指定货币指定月份的首日折算价。
    先查当月1~5日，取第一条；若无则取当月内第一条。
    返回 dict 或 None（若整月无数据）。
    """
    month_start = datetime(year, month, 1)
    # 月末（下月1日减1天）
    month_end = (month_start + relativedelta(months=1)) - timedelta(days=1)

    start_str = month_start.strftime("%Y%m%d")
    end_str   = month_end.strftime("%Y%m%d")

    try:
        df = ak.currency_boc_sina(
            symbol=currency,
            start_date=start_str,
            end_date=end_str,
        )
    except Exception as e:
        logger.warning("[%s %04d-%02d] 查询失败: %s", currency, year, month, e)
        return None

    if df is None or df.empty:
        logger.warning("[%s %04d-%02d] 无数据", currency, year, month)
        return None

    # 确保 '日期' 列存在
    if "日期" not in df.columns:
        logger.warning("[%s %04d-%02d] 列名异常: %s", currency, year, month, df.columns.tolist())
        return None

    # 取第一条记录（最早日期）
    df = df.sort_values("日期").reset_index(drop=True)
    row = df.iloc[0]

    convert_rate = row.get("中行折算价", None)
    if pd.isna(convert_rate) or convert_rate is None:
        # 折算价为 NaN，尝试用央行中间价替代
        convert_rate = row.get("央行中间价", None)
        if pd.isna(convert_rate):
            logger.warning("[%s %04d-%02d] 折算价为空，跳过", currency, year, month)
            return None

    def safe_float(val):
        try:
            f = float(val)
            return None if pd.isna(f) else f
        except (TypeError, ValueError):
            return None

    return {
        "currency":     currency,
        "rate_date":    str(row["日期"]),
        "year_month":   f"{year:04d}-{month:02d}",
        "buy_rate":     safe_float(row.get("中行汇买价")),
        "cash_buy":     safe_float(row.get("中行钞买价")),
        "sell_rate":    safe_float(row.get("中行钞卖价/汇卖价")),
        "central_rate": safe_float(row.get("央行中间价")),
        "convert_rate": float(convert_rate),
        "fetched_at":   datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


# ─── 写入数据库（UPSERT） ──────────────────────────────────────────────────────
def upsert_rate(conn: sqlite3.Connection, record: dict) -> str:
    """
    插入或更新一条汇率记录。
    返回操作结果：'inserted' / 'updated' / 'skipped'
    """
    cur = conn.execute(
        "SELECT id, convert_rate FROM boc_fx_rates WHERE currency=? AND year_month=?",
        (record["currency"], record["year_month"])
    )
    existing = cur.fetchone()

    if existing is None:
        conn.execute("""
            INSERT INTO boc_fx_rates
                (currency, rate_date, year_month, buy_rate, cash_buy, sell_rate,
                 central_rate, convert_rate, fetched_at)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (
            record["currency"], record["rate_date"], record["year_month"],
            record["buy_rate"], record["cash_buy"], record["sell_rate"],
            record["central_rate"], record["convert_rate"], record["fetched_at"],
        ))
        conn.commit()
        return "inserted"
    else:
        # 已有记录，更新（覆盖）
        conn.execute("""
            UPDATE boc_fx_rates SET
                rate_date=?, buy_rate=?, cash_buy=?, sell_rate=?,
                central_rate=?, convert_rate=?, fetched_at=?
            WHERE id=?
        """, (
            record["rate_date"], record["buy_rate"], record["cash_buy"],
            record["sell_rate"], record["central_rate"], record["convert_rate"],
            record["fetched_at"], existing[0],
        ))
        conn.commit()
        return "updated"


# ─── 生成月份序列 ──────────────────────────────────────────────────────────────
def month_range(start_ym: str, end_ym: str):
    """
    生成从 start_ym 到 end_ym 的 (year, month) 元组序列。
    格式: '2020-01'
    """
    sy, sm = int(start_ym[:4]), int(start_ym[5:7])
    ey, em = int(end_ym[:4]),   int(end_ym[5:7])
    cur = datetime(sy, sm, 1)
    end = datetime(ey, em, 1)
    while cur <= end:
        yield cur.year, cur.month
        cur += relativedelta(months=1)


# ─── 主入口 ───────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="中国银行外汇牌价月度折算价采集器（AkShare + SQLite）"
    )
    parser.add_argument(
        "--start", default="2020-01",
        help="开始年月，格式 YYYY-MM，默认 2020-01"
    )
    parser.add_argument(
        "--end", default=datetime.now().strftime("%Y-%m"),
        help="结束年月，格式 YYYY-MM，默认当月"
    )
    parser.add_argument(
        "--currencies", nargs="+", default=None,
        help="指定货币列表（中文），不传则使用内置列表"
    )
    parser.add_argument(
        "--delay", type=float, default=0.8,
        help="每次请求间隔秒数，默认 0.8s（避免频控）"
    )
    args = parser.parse_args()

    currencies = args.currencies if args.currencies else SUPPORTED_CURRENCIES
    months     = list(month_range(args.start, args.end))

    logger.info("=" * 60)
    logger.info("采集范围: %s ~ %s", args.start, args.end)
    logger.info("货币数量: %d 种", len(currencies))
    logger.info("月份数量: %d 个月", len(months))
    logger.info("预计请求: %d 次", len(currencies) * len(months))
    logger.info("=" * 60)

    conn = sqlite3.connect(DB_FILE)
    init_db(conn)

    total = inserted = updated = skipped = errors = 0

    for currency in currencies:
        logger.info("━━━ 开始采集货币: [%s] ━━━", currency)
        for year, month in months:
            total += 1
            record = fetch_month_rate(currency, year, month)

            if record is None:
                errors += 1
                logger.debug("[%s %04d-%02d] 无数据或错误", currency, year, month)
            else:
                action = upsert_rate(conn, record)
                if action == "inserted":
                    inserted += 1
                    logger.info(
                        "[%s %04d-%02d] [NEW]  日期:%s  折算价:%.4f",
                        currency, year, month, record["rate_date"], record["convert_rate"]
                    )
                elif action == "updated":
                    updated += 1
                    logger.info(
                        "[%s %04d-%02d] [UPD]  日期:%s  折算价:%.4f",
                        currency, year, month, record["rate_date"], record["convert_rate"]
                    )

            time.sleep(args.delay)

    conn.close()

    logger.info("=" * 60)
    logger.info("采集完成！")
    logger.info("  总任务: %d | 新增: %d | 更新: %d | 跳过/无数据: %d",
                total, inserted, updated, errors)
    logger.info("  数据库: %s", DB_FILE)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
