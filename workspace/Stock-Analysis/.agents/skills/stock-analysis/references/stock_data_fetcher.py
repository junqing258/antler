#!/usr/bin/env python3
"""
Stock Data Fetcher + Technical Indicator Calculator + Holiday Calendar
Outputs structured JSON for Antler analysis.
No AI/LLM calls -- pure data + math.

Data source priority (graceful degradation):
  A-share:  Tushare Pro (if TUSHARE_TOKEN set) > efinance > akshare > yfinance
  HK:       efinance > akshare > yfinance
  US:       yfinance (primary)
  CN index: akshare > efinance > yfinance (e.g., sh000001 上证指数)
  US index: yfinance (^IXIC, ^GSPC, ^DJI ...)

Holiday calendar (optional, for CN market):
  Primary: chinese_calendar (if installed) - covers official holidays + weekend shifts
  Fallback: Simple weekday check (Mon-Fri)

News search priority (via --news flag):
  Tavily (if TAVILY_API_KEY set) > SerpAPI (if SERPAPI_KEY set) > skip (use web_search in Antler)

Usage:
  # Stock analysis
  python3 stock_data_fetcher.py --stocks "600519,TSLA,HK00700,sh000001,创业板指" [--days 120] [--news]

  # Holiday calendar check
  python3 stock_data_fetcher.py --holiday                    # Check today
  python3 stock_data_fetcher.py --holiday --date 2025-01-01  # Check specific date

Environment variables (optional, for enhanced data):
  TUSHARE_TOKEN    - Tushare Pro token (free signup at tushare.pro)
  TAVILY_API_KEY   - Tavily API key (1000 free calls/month)
  SERPAPI_KEY      - SerpAPI key (100 free calls/month)

Optional libraries:
  chinese_calendar - For accurate CN market holiday detection
                     Install: pip install chinese_calendar
"""

import os
import sys

try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    _project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
    _project_env = os.path.join(_project_root, ".env")
    load_dotenv(_project_env)  # prefer project-root .env
    load_dotenv(_env_path, override=False)  # fallback: skill-dir .env
except ImportError:
    pass

import json
import argparse
import re
import threading
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

warnings.filterwarnings("ignore")

# Data source availability detection
_AVAILABLE_SOURCES = {}

# Cache for full-market realtime snapshots (avoid re-fetching for each stock).
# Sentinel _FAILED means a prior attempt failed; do not retry within this run.
_SPOT_CACHE = {}
_SPOT_CACHE_LOCK = threading.Lock()
_FAILED = object()

# Cache for holiday calendar check
_HOLIDAY_CACHE = {}
_HOLIDAY_CACHE_LOCK = threading.Lock()

def _check_source(name):
    """Lazy-check if a data source library is importable."""
    if name not in _AVAILABLE_SOURCES:
        try:
            __import__(name)
            _AVAILABLE_SOURCES[name] = True
        except ImportError:
            _AVAILABLE_SOURCES[name] = False
    return _AVAILABLE_SOURCES[name]


def _get_spot_snapshot(key: str, fetch_fn):
    """Cache a full-market realtime snapshot for the duration of a single run.

    fetch_fn is called at most once per key; subsequent calls return the cached
    DataFrame (or None if the prior fetch failed).
    """
    with _SPOT_CACHE_LOCK:
        if key in _SPOT_CACHE:
            cached = _SPOT_CACHE[key]
            return None if cached is _FAILED else cached
    try:
        df = fetch_fn()
        with _SPOT_CACHE_LOCK:
            _SPOT_CACHE[key] = df
        return df
    except Exception as e:
        _log(f"Spot snapshot '{key}' failed: {e}")
        with _SPOT_CACHE_LOCK:
            _SPOT_CACHE[key] = _FAILED
        return None

def _log(msg):
    """Log to stderr so it doesn't pollute JSON stdout."""
    print(f"[INFO] {msg}", file=sys.stderr)


# ============================================================
# SECTION 0.5: Holiday Calendar Utilities
# ============================================================

def _check_chinese_calendar():
    """Check if chinese_calendar library is available."""
    return _check_source("chinese_calendar")


def is_trading_day(check_date=None):
    """
    Check if a date is a trading day (workday and not a holiday).

    Args:
        check_date: date object or None (defaults to today)

    Returns:
        bool: True if trading day, False otherwise
    """
    if check_date is None:
        check_date = datetime.now().date()

    # Try chinese_calendar first (most reliable for CN market)
    if _check_chinese_calendar():
        try:
            import chinese_calendar
            return chinese_calendar.is_workday(check_date)
        except Exception as e:
            _log(f"chinese_calendar check failed: {e}")

    # Fallback: simple weekday check (Mon-Fri)
    # This doesn't account for holidays or weekend shifts
    return check_date.weekday() < 5


def get_last_trading_day(check_date=None, max_lookback=7):
    """
    Get the most recent trading day before the given date.

    Args:
        check_date: date object or None (defaults to today)
        max_lookback: maximum days to look back

    Returns:
        date: the last trading day
    """
    if check_date is None:
        check_date = datetime.now().date()

    for i in range(max_lookback):
        candidate = check_date - timedelta(days=i)
        if is_trading_day(candidate):
            return candidate

    # Fallback: if all else fails, return the date itself
    _log(f"Could not find trading day within {max_lookback} days, "
         f"using {check_date}")
    return check_date


def get_next_trading_day(check_date=None, max_lookahead=7):
    """
    Get the next trading day after the given date.

    Args:
        check_date: date object or None (defaults to today)
        max_lookahead: maximum days to look ahead

    Returns:
        date: the next trading day
    """
    if check_date is None:
        check_date = datetime.now().date()

    for i in range(1, max_lookahead + 1):
        candidate = check_date + timedelta(days=i)
        if is_trading_day(candidate):
            return candidate

    # Fallback: if all else fails, return the date itself
    _log(f"Could not find next trading day within {max_lookahead} days, "
         f"using {check_date + timedelta(days=1)}")
    return check_date + timedelta(days=1)


def get_trading_day_status(check_date=None):
    """
    Get detailed status about a date's trading status.

    Args:
        check_date: date object or None (defaults to today)

    Returns:
        dict: {
            "date": str,
            "is_trading_day": bool,
            "weekday": int (0=Mon, 6=Sun),
            "weekday_name": str,
            "last_trading_day": str,
            "next_trading_day": str,
        }
    """
    if check_date is None:
        check_date = datetime.now().date()

    weekday_names = ["Monday", "Tuesday", "Wednesday", "Thursday",
                     "Friday", "Saturday", "Sunday"]

    return {
        "date": check_date.isoformat(),
        "is_trading_day": is_trading_day(check_date),
        "weekday": check_date.weekday(),
        "weekday_name": weekday_names[check_date.weekday()],
        "last_trading_day": get_last_trading_day(
            check_date - timedelta(days=1)).isoformat(),
        "next_trading_day": get_next_trading_day(
            check_date + timedelta(days=1)).isoformat(),
    }


# ============================================================
# SECTION 1: Stock Code Parser
# ============================================================

# Registry of supported indices. Key is the canonical akshare-style symbol
# (lowercase prefix + 6-digit code). `yf` is the Yahoo Finance ticker used
# only as a last-resort fallback; empty string means yfinance has no
# reliable ticker for that index and the fallback chain stops at akshare.
INDEX_REGISTRY = {
    # Shanghai
    "sh000001": {"name": "上证指数",  "yf": "000001.SS"},
    "sh000016": {"name": "上证50",    "yf": "000016.SS"},
    "sh000300": {"name": "沪深300",   "yf": "000300.SS"},
    "sh000688": {"name": "科创50",    "yf": ""},
    "sh000852": {"name": "中证1000",  "yf": ""},
    "sh000905": {"name": "中证500",   "yf": "000905.SS"},
    "sh000906": {"name": "中证800",   "yf": ""},
    # Shenzhen
    "sz399001": {"name": "深证成指",  "yf": "399001.SZ"},
    "sz399005": {"name": "中小100",   "yf": ""},
    "sz399006": {"name": "创业板指",  "yf": "399006.SZ"},
    "sz399300": {"name": "沪深300",   "yf": ""},
    "sz399330": {"name": "深证100",   "yf": ""},
    # Beijing
    "bj899050": {"name": "北证50",    "yf": ""},
}

# US indices use yfinance directly via ^XXX tickers.
US_INDEX_REGISTRY = {
    "^IXIC": "纳斯达克综合指数",
    "^GSPC": "标普500",
    "^DJI":  "道琼斯指数",
    "^RUT":  "罗素2000",
    "^VIX":  "VIX恐慌指数",
    "^SSEC": "上证指数",  # yfinance alias
}

# Chinese / informal names → canonical key (cn_index key OR US ^ticker).
INDEX_NAME_TO_KEY = {
    "上证指数": "sh000001", "上证综指": "sh000001", "上证综合指数": "sh000001", "上证": "sh000001",
    "深证成指": "sz399001", "深成指": "sz399001", "深证": "sz399001",
    "创业板指": "sz399006", "创业板": "sz399006",
    "沪深300": "sh000300", "沪深300指数": "sh000300", "hs300": "sh000300",
    "上证50": "sh000016",
    "科创50": "sh000688", "科创板50": "sh000688",
    "中证500": "sh000905", "中证500指数": "sh000905",
    "中证1000": "sh000852",
    "中证800": "sh000906",
    "深证100": "sz399330",
    "北证50": "bj899050",
    "纳指": "^IXIC", "纳斯达克": "^IXIC", "纳斯达克综合指数": "^IXIC",
    "标普500": "^GSPC", "标普": "^GSPC",
    "道指": "^DJI", "道琼斯": "^DJI", "道琼斯指数": "^DJI",
}


def _resolve_fund_name(name: str) -> tuple:
    """Resolve a Chinese fund short name to (code, display_name) via akshare.
    Returns (None, None) if not found or akshare unavailable. The fund name
    table is cached for the duration of one run.
    """
    if not name:
        return (None, None)
    if not any("一" <= c <= "鿿" for c in name):
        return (None, None)  # no CJK chars, definitely not a fund name
    if not _check_source("akshare"):
        return (None, None)
    try:
        import akshare as ak
        df = _get_spot_snapshot("fund_name_em", ak.fund_name_em)
        if df is None or df.empty or "基金简称" not in df.columns:
            return (None, None)
        matches = df[df["基金简称"] == name]
        if matches.empty:
            # secondary: case-insensitive prefix match (e.g. "华富数字经济" matches A class)
            matches = df[df["基金简称"].str.startswith(name, na=False)]
        if matches.empty:
            return (None, None)
        row = matches.iloc[0]
        return (str(row["基金代码"]), str(row["基金简称"]))
    except Exception as e:
        _log(f"fund name resolve failed for '{name}': {e}")
        return (None, None)


def classify_stock(code: str) -> tuple:
    """
    Returns (market, normalized_code, display_code)
    market: 'cn_a', 'cn_hk', 'us', 'cn_index', 'us_index', 'cn_fund'
    """
    code = code.strip()
    upper = code.upper()

    # 0. 中文/俗称索引名: "上证指数" -> ('cn_index', 'sh000001', '上证指数')
    if code in INDEX_NAME_TO_KEY:
        key = INDEX_NAME_TO_KEY[code]
        if key.startswith("^"):
            return ("us_index", key, US_INDEX_REGISTRY.get(key, key))
        return ("cn_index", key, INDEX_REGISTRY[key]["name"])

    # 0.5 显式基金代码: fund:018358 / F018358 / 018358.OF / OF018358 -> cn_fund
    if upper.startswith("FUND:"):
        tail = upper[5:]
        if tail.isdigit() and len(tail) == 6:
            return ("cn_fund", tail, tail)
    if upper.endswith(".OF"):
        base = upper[:-3]
        if base.isdigit() and len(base) == 6:
            return ("cn_fund", base, base)
    if upper.startswith("OF") and len(upper) == 8 and upper[2:].isdigit():
        return ("cn_fund", upper[2:], upper[2:])
    if upper.startswith("F") and len(upper) == 7 and upper[1:].isdigit():
        return ("cn_fund", upper[1:], upper[1:])

    # 1. 美股指数 ^IXIC / ^GSPC -> ('us_index', '^IXIC', '纳斯达克综合指数')
    if upper.startswith("^") and 2 <= len(upper) <= 8:
        return ("us_index", upper, US_INDEX_REGISTRY.get(upper, upper))

    # 2. 港股: HK00700 -> ('cn_hk', '00700', 'HK00700')
    if upper.startswith("HK") and upper[2:].isdigit():
        return ("cn_hk", upper[2:], upper)

    # 3. 带 sh/sz/bj 前缀: sh000001 -> 指数(若命中白名单) 否则当作 A 股
    if len(upper) >= 8 and upper[:2] in ("SH", "SZ", "BJ"):
        rest = upper[2:]
        if rest.isdigit() and len(rest) == 6:
            key = upper.lower()
            if key in INDEX_REGISTRY:
                return ("cn_index", key, INDEX_REGISTRY[key]["name"])
            # sz000001 → 平安银行 (A 股，去前缀)
            return ("cn_a", rest, rest)

    # 4. 带后缀: 000001.SH -> 指数(若命中白名单) 否则 A 股
    if "." in upper:
        base, suffix = upper.rsplit(".", 1)
        if base.isdigit() and suffix in ("SH", "SS", "SZ", "BJ"):
            prefix = {"SH": "sh", "SS": "sh", "SZ": "sz", "BJ": "bj"}[suffix]
            key = f"{prefix}{base}"
            if key in INDEX_REGISTRY:
                return ("cn_index", key, INDEX_REGISTRY[key]["name"])
            return ("cn_a", base, base)

    # 5. 纯数字: 399xxx / 899xxx 仅作指数；其他 6 位为 A 股个股
    if upper.isdigit() and len(upper) == 6:
        if upper.startswith("399"):
            key = f"sz{upper}"
            if key in INDEX_REGISTRY:
                return ("cn_index", key, INDEX_REGISTRY[key]["name"])
        if upper.startswith("899"):
            key = f"bj{upper}"
            if key in INDEX_REGISTRY:
                return ("cn_index", key, INDEX_REGISTRY[key]["name"])
        return ("cn_a", upper, upper)

    # 6. 美股个股: TSLA -> ('us', 'TSLA', 'TSLA')
    if upper.isalpha() and 1 <= len(upper) <= 5:
        return ("us", upper, upper)

    # 7. 中文基金简称: "华富数字经济混合A" -> ('cn_fund', '018358', '华富数字经济混合A')
    fund_code, fund_name = _resolve_fund_name(code)
    if fund_code:
        return ("cn_fund", fund_code, fund_name or code)

    return ("unknown", code, code)


def to_yfinance_code(code: str, market: str) -> str:
    """Convert to Yahoo Finance ticker format. Returns '' if no mapping."""
    if market == "us_index":
        return code  # already ^TICKER
    if market == "cn_index":
        info = INDEX_REGISTRY.get(code, {})
        return info.get("yf") or ""
    if market == "cn_hk":
        num = code.lstrip("0") or "0"
        return f"{num.zfill(4)}.HK"
    if market == "us":
        return code
    # A股
    if code.startswith(("600", "601", "603", "605", "688")):
        return f"{code}.SS"
    if code.startswith(("51", "52", "56", "58")):
        return f"{code}.SS"
    return f"{code}.SZ"


def parse_stock_codes(raw: str) -> list:
    """Parse comma, whitespace, or newline separated stock codes."""
    return [c.strip() for c in re.split(r"[,\s]+", raw or "") if c.strip()]


# ============================================================
# SECTION 2: Data Fetchers (with graceful degradation)
# ============================================================

def _df_to_ohlcv(df, days):
    """Convert a normalized DataFrame to OHLCV list."""
    import pandas as pd
    for c in ["open", "close", "high", "low", "volume", "amount", "pct_chg"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.sort_values("date").tail(days).reset_index(drop=True)
    ohlcv = []
    for _, row in df.iterrows():
        ohlcv.append({
            "date": str(row.get("date", "")),
            "open": _safe_float(row.get("open")),
            "high": _safe_float(row.get("high")),
            "low": _safe_float(row.get("low")),
            "close": _safe_float(row.get("close")),
            "volume": _safe_float(row.get("volume")),
            "amount": _safe_float(row.get("amount")),
            "pct_chg": _safe_float(row.get("pct_chg")),
        })
    return ohlcv


# --- Tushare Pro (Priority 0, needs TUSHARE_TOKEN) ---

def _fetch_tushare_a(code: str, days: int):
    """Fetch A-share via Tushare Pro. Returns (ohlcv, source) or raises."""
    token = os.environ.get("TUSHARE_TOKEN")
    if not token:
        raise EnvironmentError("TUSHARE_TOKEN not set")
    import tushare as ts
    pro = ts.pro_api(token)
    ts_code = f"{code}.SH" if code.startswith(("600", "601", "603", "688")) else f"{code}.SZ"
    end_date = datetime.now().strftime("%Y%m%d")
    start_date = (datetime.now() - timedelta(days=days * 2)).strftime("%Y%m%d")
    df = pro.daily(ts_code=ts_code, start_date=start_date, end_date=end_date)
    if df is None or df.empty:
        raise ValueError(f"Tushare returned no data for {code}")
    col_map = {
        "trade_date": "date", "open": "open", "close": "close",
        "high": "high", "low": "low", "vol": "volume",
        "amount": "amount", "pct_chg": "pct_chg",
    }
    df = df.rename(columns=col_map)
    df["date"] = df["date"].apply(lambda x: f"{x[:4]}-{x[4:6]}-{x[6:]}" if len(str(x)) == 8 else x)
    _log(f"[{code}] Using Tushare Pro (premium)")
    return _df_to_ohlcv(df, days), "tushare"


# --- efinance (Priority 1, free) ---

def _fetch_efinance_a(code: str, days: int):
    """Fetch A-share via efinance (EastMoney). Returns (ohlcv, source) or raises."""
    import efinance as ef
    df = ef.stock.get_quote_history(code)
    if df is None or df.empty:
        raise ValueError(f"efinance returned no data for {code}")
    col_map = {
        "日期": "date", "开盘": "open", "收盘": "close",
        "最高": "high", "最低": "low", "成交量": "volume",
        "成交额": "amount", "涨跌幅": "pct_chg",
    }
    df = df.rename(columns=col_map)
    _log(f"[{code}] Using efinance (free)")
    return _df_to_ohlcv(df, days), "efinance"


def _fetch_efinance_hk(code: str, days: int):
    """Fetch HK stock via efinance."""
    import efinance as ef
    df = ef.stock.get_quote_history(code, stock_type="hk")
    if df is None or df.empty:
        raise ValueError(f"efinance returned no data for HK{code}")
    col_map = {
        "日期": "date", "开盘": "open", "收盘": "close",
        "最高": "high", "最低": "low", "成交量": "volume",
        "成交额": "amount", "涨跌幅": "pct_chg",
    }
    df = df.rename(columns=col_map)
    _log(f"[HK{code}] Using efinance (free)")
    return _df_to_ohlcv(df, days), "efinance"


# --- akshare (Priority 2, free) ---

def _fetch_akshare_a(code: str, days: int):
    """Fetch A-share via akshare."""
    import akshare as ak
    end_date = datetime.now().strftime("%Y%m%d")
    start_date = (datetime.now() - timedelta(days=days * 2)).strftime("%Y%m%d")
    try:
        df = ak.stock_zh_a_hist(symbol=code, period="daily",
                                start_date=start_date, end_date=end_date, adjust="qfq")
    except Exception:
        df = ak.stock_zh_a_hist(symbol=code, period="daily",
                                start_date=start_date, end_date=end_date, adjust="")
    if df is None or df.empty:
        raise ValueError(f"akshare returned no data for {code}")
    col_map = {
        "日期": "date", "开盘": "open", "收盘": "close",
        "最高": "high", "最低": "low", "成交量": "volume",
        "成交额": "amount", "涨跌幅": "pct_chg",
    }
    df = df.rename(columns=col_map)
    _log(f"[{code}] Using akshare (free)")
    return _df_to_ohlcv(df, days), "akshare"


def _fetch_akshare_index(key: str, days: int):
    """Fetch CN index via akshare. key is like 'sh000001' / 'sz399006' / 'bj899050'."""
    import akshare as ak
    base = key[2:]  # strip prefix
    # Try stock_zh_index_daily first (returns full history, then we tail)
    df = None
    try:
        df = ak.stock_zh_index_daily(symbol=key)
    except Exception:
        df = None
    # Fallback to index_zh_a_hist (uses 6-digit symbol, supports date range)
    if df is None or df.empty:
        end_date = datetime.now().strftime("%Y%m%d")
        start_date = (datetime.now() - timedelta(days=days * 2)).strftime("%Y%m%d")
        df = ak.index_zh_a_hist(symbol=base, period="daily",
                                start_date=start_date, end_date=end_date)
    if df is None or df.empty:
        raise ValueError(f"akshare returned no data for index {key}")
    col_map = {
        "日期": "date", "开盘": "open", "收盘": "close",
        "最高": "high", "最低": "low", "成交量": "volume",
        "成交额": "amount", "涨跌幅": "pct_chg",
    }
    df = df.rename(columns=col_map)
    _log(f"[{key}] Using akshare index (free)")
    return _df_to_ohlcv(df, days), "akshare"


def _fetch_akshare_fund_nav(code: str, days: int):
    """Fetch fund NAV history via akshare. Returns (ohlcv, source).

    Funds have no intraday OHLC — set open=high=low=close=NAV, volume=None.
    """
    import akshare as ak
    df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
    if df is None or df.empty:
        raise ValueError(f"akshare returned no NAV data for fund {code}")
    df = df.sort_values("净值日期").tail(days).reset_index(drop=True)
    ohlcv = []
    for _, row in df.iterrows():
        nav = _safe_float(row.get("单位净值"))
        ohlcv.append({
            "date": str(row.get("净值日期", "")),
            "open": nav, "high": nav, "low": nav, "close": nav,
            "volume": None, "amount": None,
            "pct_chg": _safe_float(row.get("日增长率")),
        })
    _log(f"[fund:{code}] Using akshare fund NAV (free)")
    return ohlcv, "akshare"


def _fetch_realtime_fund(code: str) -> dict:
    """Fetch today's NAV estimate via akshare.fund_value_estimation_em (cached)."""
    if not _check_source("akshare"):
        return {}
    try:
        import akshare as ak
        df = _get_spot_snapshot("fund_value_est_em", ak.fund_value_estimation_em)
        if df is None or df.empty or "基金代码" not in df.columns:
            return {}
        row = df[df["基金代码"] == code]
        if row.empty:
            return {}
        r = row.iloc[0]
        # Column names embed today's date; find them dynamically
        est_val_col = next((c for c in df.columns if "估算值" in c), None)
        est_pct_col = next((c for c in df.columns if "估算增长率" in c), None)
        pub_nav_col = next((c for c in df.columns if "公布数据-单位净值" in c), None)
        pub_pct_col = next((c for c in df.columns if "公布数据-日增长率" in c), None)
        prev_nav_col = next((c for c in df.columns if "单位净值" in c
                             and "公布" not in c and "估算" not in c), None)
        def _coerce(v):
            if v is None or v == "---" or str(v).strip() == "":
                return None
            if isinstance(v, str) and v.endswith("%"):
                return _safe_float(v.rstrip("%"))
            return _safe_float(v)
        pub_nav = _coerce(r.get(pub_nav_col)) if pub_nav_col else None
        est_val = _coerce(r.get(est_val_col)) if est_val_col else None
        pub_pct = _coerce(r.get(pub_pct_col)) if pub_pct_col else None
        est_pct = _coerce(r.get(est_pct_col)) if est_pct_col else None
        return {
            "name": str(r.get("基金名称", code)),
            "price": pub_nav or est_val,  # prefer official close, fall back to estimate
            "change_pct": pub_pct if pub_pct is not None else est_pct,
            "estimate_nav": est_val,
            "estimate_pct": est_pct,
            "published_nav": pub_nav,
            "pre_close": _coerce(r.get(prev_nav_col)) if prev_nav_col else None,
            "is_estimate": pub_nav is None and est_val is not None,
        }
    except Exception as e:
        _log(f"[fund:{code}] realtime estimate failed: {e}")
        return {}


def _fetch_fund_basic(code: str) -> dict:
    """Fetch fund basics (size, manager, type, established) via akshare."""
    if not _check_source("akshare"):
        return {}
    try:
        import akshare as ak
        df = ak.fund_individual_basic_info_xq(symbol=code)
        if df is None or df.empty:
            return {}
        # df has columns 'item' / 'value' — pivot to dict
        kv = {str(row["item"]): row["value"] for _, row in df.iterrows()}
        return {
            "name": kv.get("基金名称") or kv.get("基金简称"),
            "full_name": kv.get("基金全称"),
            "fund_type": kv.get("基金类型"),
            "manager": kv.get("基金经理"),
            "company": kv.get("基金公司"),
            "established": kv.get("成立时间"),
            "size": kv.get("最新规模"),
            "benchmark": kv.get("业绩比较基准"),
            "rating": kv.get("基金评级"),
        }
    except Exception as e:
        _log(f"[fund:{code}] basic info failed: {e}")
        return {}


def _fetch_fund_holdings(code: str, top_n: int = 10) -> list:
    """Fetch top-N holdings via akshare. Tries current year, then previous."""
    if not _check_source("akshare"):
        return []
    import akshare as ak
    for year in (datetime.now().year, datetime.now().year - 1):
        try:
            df = ak.fund_portfolio_hold_em(symbol=code, date=str(year))
            if df is not None and not df.empty:
                holdings = []
                for _, row in df.head(top_n).iterrows():
                    holdings.append({
                        "rank": int(row.get("序号", 0)) if row.get("序号") else None,
                        "stock_code": str(row.get("股票代码", "")),
                        "stock_name": str(row.get("股票名称", "")),
                        "pct": _safe_float(row.get("占净值比例")),
                        "value_wan": _safe_float(row.get("持仓市值")),
                        "quarter": str(row.get("季度", "")),
                    })
                return holdings
        except Exception as e:
            _log(f"[fund:{code}] holdings {year} failed: {e}")
    return []


def fetch_cn_fund(code: str, days: int) -> dict:
    """Fetch fund NAV history + realtime + basic info + top holdings."""
    if not _check_source("akshare"):
        raise ValueError(f"akshare required for fund {code}")
    ohlcv, source = _fetch_akshare_fund_nav(code, days)
    basic = _fetch_fund_basic(code)
    holdings = _fetch_fund_holdings(code)
    realtime = _fill_realtime_from_ohlcv(_fetch_realtime_fund(code), ohlcv,
                                         basic.get("name") or code, code)
    name = realtime.get("name") or basic.get("name") or code
    return {
        "ohlcv": ohlcv,
        "realtime": realtime,
        "name": name,
        "source": source,
        "fund_info": basic,
        "holdings": holdings,
    }


def _fetch_akshare_hk(code: str, days: int):
    """Fetch HK stock via akshare."""
    import akshare as ak
    end_date = datetime.now().strftime("%Y%m%d")
    start_date = (datetime.now() - timedelta(days=days * 2)).strftime("%Y%m%d")
    try:
        df = ak.stock_hk_hist(symbol=code, period="daily",
                              start_date=start_date, end_date=end_date, adjust="qfq")
    except Exception:
        df = ak.stock_hk_hist(symbol=code, period="daily",
                              start_date=start_date, end_date=end_date, adjust="")
    if df is None or df.empty:
        raise ValueError(f"akshare returned no data for HK{code}")
    col_map = {
        "日期": "date", "开盘": "open", "收盘": "close",
        "最高": "high", "最低": "low", "成交量": "volume",
        "成交额": "amount", "涨跌幅": "pct_chg",
    }
    df = df.rename(columns=col_map)
    _log(f"[HK{code}] Using akshare (free)")
    return _df_to_ohlcv(df, days), "akshare"


# --- yfinance (Priority 3, free, fallback for all markets) ---

def _fetch_yfinance(code: str, market: str, days: int):
    """Fetch any stock via yfinance (universal fallback)."""
    import yfinance as yf
    yf_code = to_yfinance_code(code, market)
    ticker = yf.Ticker(yf_code)
    hist = ticker.history(period=f"{days}d")
    if hist is None or hist.empty:
        raise ValueError(f"yfinance returned no data for {yf_code}")
    ohlcv = []
    for idx, row in hist.iterrows():
        date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
        ohlcv.append({
            "date": date_str,
            "open": _safe_float(row.get("Open")),
            "high": _safe_float(row.get("High")),
            "low": _safe_float(row.get("Low")),
            "close": _safe_float(row.get("Close")),
            "volume": _safe_float(row.get("Volume")),
            "amount": None, "pct_chg": None,
        })
    for i in range(1, len(ohlcv)):
        prev = ohlcv[i - 1]["close"]
        if prev and prev > 0:
            ohlcv[i]["pct_chg"] = round((ohlcv[i]["close"] - prev) / prev * 100, 2)
    _log(f"[{code}] Using yfinance (free, fallback)")
    return ohlcv, "yfinance"


# --- Realtime quote fetchers ---

def _fetch_realtime_a(code: str) -> dict:
    """Fetch A-share realtime quote with fallback."""
    # Try akshare spot (most reliable for realtime)
    if _check_source("akshare"):
        try:
            import akshare as ak
            spot_df = _get_spot_snapshot("ak_a_spot", ak.stock_zh_a_spot_em)
            if spot_df is None:
                raise RuntimeError("a-share spot snapshot unavailable")
            row = spot_df[spot_df["代码"] == code]
            if not row.empty:
                r = row.iloc[0]
                return {
                    "name": str(r.get("名称", code)),
                    "price": _safe_float(r.get("最新价")),
                    "change_pct": _safe_float(r.get("涨跌幅")),
                    "change_amount": _safe_float(r.get("涨跌额")),
                    "volume": _safe_float(r.get("成交量")),
                    "amount": _safe_float(r.get("成交额")),
                    "amplitude": _safe_float(r.get("振幅")),
                    "turnover_rate": _safe_float(r.get("换手率")),
                    "pe_ratio": _safe_float(r.get("市盈率-动态")),
                    "pb_ratio": _safe_float(r.get("市净率")),
                    "total_mv": _safe_float(r.get("总市值")),
                    "circ_mv": _safe_float(r.get("流通市值")),
                    "high": _safe_float(r.get("最高")),
                    "low": _safe_float(r.get("最低")),
                    "open": _safe_float(r.get("今开")),
                    "pre_close": _safe_float(r.get("昨收")),
                    "volume_ratio": _safe_float(r.get("量比")),
                }
        except Exception:
            pass
    # Try efinance
    if _check_source("efinance"):
        try:
            import efinance as ef
            qt = ef.stock.get_realtime_quotes([code])
            if qt is not None and not qt.empty:
                r = qt.iloc[0]
                return {
                    "name": str(r.get("股票名称", code)),
                    "price": _safe_float(r.get("最新价")),
                    "change_pct": _safe_float(r.get("涨跌幅")),
                }
        except Exception:
            pass
    return {}


def _fetch_realtime_hk(code: str) -> dict:
    """Fetch HK realtime quote."""
    if _check_source("akshare"):
        try:
            import akshare as ak
            spot_df = _get_spot_snapshot("ak_hk_spot", ak.stock_hk_spot_em)
            if spot_df is None:
                raise RuntimeError("hk spot snapshot unavailable")
            matched = spot_df[spot_df["代码"] == code]
            if not matched.empty:
                r = matched.iloc[0]
                return {
                    "name": str(r.get("名称", f"HK{code}")),
                    "price": _safe_float(r.get("最新价")),
                    "change_pct": _safe_float(r.get("涨跌幅")),
                    "volume": _safe_float(r.get("成交量")),
                    "pe_ratio": _safe_float(r.get("市盈率")),
                    "pb_ratio": _safe_float(r.get("市净率")),
                    "total_mv": _safe_float(r.get("总市值")),
                }
        except Exception:
            pass
    return {}


def _fetch_realtime_index(key: str) -> dict:
    """Fetch CN index realtime spot via akshare. key like 'sh000001'.

    Source priority: sina > eastmoney. Sina's spot table keys on 'sh000001'
    style codes directly (matches our INDEX_REGISTRY key) and avoids the
    push2.eastmoney.com endpoint that often gets proxy-blocked on
    institutional networks.
    """
    name = INDEX_REGISTRY.get(key, {}).get("name", key)
    bare = key[2:]
    if not _check_source("akshare"):
        return {"name": name}
    import akshare as ak

    def _row_to_dict(r, fallback_name):
        return {
            "name": str(r.get("名称", fallback_name)),
            "price": _safe_float(r.get("最新价")),
            "change_pct": _safe_float(r.get("涨跌幅")),
            "change_amount": _safe_float(r.get("涨跌额")),
            "volume": _safe_float(r.get("成交量")),
            "amount": _safe_float(r.get("成交额")),
            "amplitude": _safe_float(r.get("振幅")),
            "high": _safe_float(r.get("最高")),
            "low": _safe_float(r.get("最低")),
            "open": _safe_float(r.get("今开")),
            "pre_close": _safe_float(r.get("昨收")),
        }

    # Priority 1: sina (prefix-keyed, robust against eastmoney proxy blocks)
    try:
        spot_df = _get_spot_snapshot("ak_index_spot_sina", ak.stock_zh_index_spot_sina)
        if spot_df is not None and "代码" in spot_df.columns:
            row = spot_df[spot_df["代码"] == key]
            if not row.empty:
                _log(f"[{key}] index realtime via akshare/sina")
                return _row_to_dict(row.iloc[0], name)
    except Exception as e:
        _log(f"[{key}] index realtime sina failed: {e}")

    # Priority 2: eastmoney (bare-code keyed)
    try:
        spot_df = _get_spot_snapshot("ak_index_spot_em", ak.stock_zh_index_spot_em)
        if spot_df is not None and "代码" in spot_df.columns:
            row = spot_df[spot_df["代码"] == bare]
            if row.empty and "名称" in spot_df.columns:
                row = spot_df[spot_df["名称"] == name]
            if not row.empty:
                _log(f"[{key}] index realtime via akshare/em")
                return _row_to_dict(row.iloc[0], name)
    except Exception as e:
        _log(f"[{key}] index realtime em failed: {e}")

    return {"name": name}


def _fetch_realtime_us(code: str) -> dict:
    """Fetch US realtime quote via yfinance.

    Tries .info first (richer but flaky), then falls back to .fast_info
    (slimmer but more reliable). Returns whatever fields succeeded; callers
    must tolerate partial data.
    """
    try:
        import yfinance as yf
    except ImportError:
        return {}

    ticker = yf.Ticker(code)
    result = {}

    # Primary: .info — richer data but unstable across yfinance versions
    try:
        info = ticker.info or {}
        if info:
            result = {
                "name": info.get("shortName") or info.get("longName") or code,
                "price": _safe_float(info.get("currentPrice") or info.get("regularMarketPrice")),
                "change_pct": _safe_float(info.get("regularMarketChangePercent")),
                "volume": _safe_float(info.get("regularMarketVolume")),
                "pe_ratio": _safe_float(info.get("trailingPE")),
                "pb_ratio": _safe_float(info.get("priceToBook")),
                "total_mv": _safe_float(info.get("marketCap")),
                "high": _safe_float(info.get("dayHigh")),
                "low": _safe_float(info.get("dayLow")),
                "open": _safe_float(info.get("regularMarketOpen")),
                "pre_close": _safe_float(info.get("regularMarketPreviousClose")),
                "week_52_high": _safe_float(info.get("fiftyTwoWeekHigh")),
                "week_52_low": _safe_float(info.get("fiftyTwoWeekLow")),
                "avg_volume": _safe_float(info.get("averageVolume")),
                "dividend_yield": _safe_float(info.get("dividendYield")),
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
            }
    except Exception as e:
        _log(f"[{code}] yfinance .info failed: {e} — falling back to .fast_info")

    # Fallback: .fast_info — only fill missing fields, don't overwrite .info data
    if not result.get("price"):
        try:
            fi = ticker.fast_info
            result.setdefault("name", code)
            for key, attr in [
                ("price", "last_price"),
                ("pre_close", "previous_close"),
                ("open", "open"),
                ("high", "day_high"),
                ("low", "day_low"),
                ("volume", "last_volume"),
                ("total_mv", "market_cap"),
                ("week_52_high", "year_high"),
                ("week_52_low", "year_low"),
            ]:
                if not result.get(key):
                    result[key] = _safe_float(getattr(fi, attr, None))

            # Derive change_pct from price/pre_close if .info didn't provide it
            if not result.get("change_pct"):
                price = result.get("price")
                pc = result.get("pre_close")
                if price is not None and pc and pc > 0:
                    result["change_pct"] = round((price - pc) / pc * 100, 2)

            _log(f"[{code}] Filled US realtime from fast_info")
        except Exception as e:
            _log(f"[{code}] yfinance .fast_info also failed: {e}")

    return result


# --- Priority router ---

def _fill_realtime_from_ohlcv(realtime: dict, ohlcv: list, name: str, log_code: str) -> dict:
    """Fill missing realtime price fields from the latest OHLCV bar."""
    realtime = realtime or {}
    if not realtime.get("price") and ohlcv:
        last = ohlcv[-1]
        realtime.setdefault("name", name)
        realtime["price"] = last.get("close")
        if not realtime.get("change_pct"):
            realtime["change_pct"] = last.get("pct_chg")
        _log(f"[{log_code}] Realtime fallback to last OHLCV bar")
    return realtime

def fetch_cn_a(code: str, days: int) -> dict:
    """Fetch A-share with priority: Tushare > efinance > akshare > yfinance."""
    ohlcv = None
    source = "unknown"
    errors = []

    # Priority 0: Tushare Pro (if token configured)
    if os.environ.get("TUSHARE_TOKEN") and _check_source("tushare"):
        try:
            ohlcv, source = _fetch_tushare_a(code, days)
        except Exception as e:
            errors.append(f"tushare: {e}")

    # Priority 1: efinance
    if ohlcv is None and _check_source("efinance"):
        try:
            ohlcv, source = _fetch_efinance_a(code, days)
        except Exception as e:
            errors.append(f"efinance: {e}")

    # Priority 2: akshare
    if ohlcv is None and _check_source("akshare"):
        try:
            ohlcv, source = _fetch_akshare_a(code, days)
        except Exception as e:
            errors.append(f"akshare: {e}")

    # Priority 3: yfinance (universal fallback)
    if ohlcv is None and _check_source("yfinance"):
        try:
            ohlcv, source = _fetch_yfinance(code, "cn_a", days)
        except Exception as e:
            errors.append(f"yfinance: {e}")

    if ohlcv is None:
        raise ValueError(f"All data sources failed for A-share {code}: {'; '.join(errors)}")

    realtime = _fill_realtime_from_ohlcv(_fetch_realtime_a(code), ohlcv, code, code)
    name = realtime.get("name", code)
    return {"ohlcv": ohlcv, "realtime": realtime, "name": name, "source": source}


def fetch_hk(code: str, days: int) -> dict:
    """Fetch HK stock with priority: efinance > akshare > yfinance."""
    ohlcv = None
    source = "unknown"
    errors = []

    if _check_source("efinance"):
        try:
            ohlcv, source = _fetch_efinance_hk(code, days)
        except Exception as e:
            errors.append(f"efinance: {e}")

    if ohlcv is None and _check_source("akshare"):
        try:
            ohlcv, source = _fetch_akshare_hk(code, days)
        except Exception as e:
            errors.append(f"akshare: {e}")

    if ohlcv is None and _check_source("yfinance"):
        try:
            ohlcv, source = _fetch_yfinance(code, "cn_hk", days)
        except Exception as e:
            errors.append(f"yfinance: {e}")

    if ohlcv is None:
        raise ValueError(f"All data sources failed for HK{code}: {'; '.join(errors)}")

    realtime = _fill_realtime_from_ohlcv(_fetch_realtime_hk(code), ohlcv, f"HK{code}", f"HK{code}")
    name = realtime.get("name", f"HK{code}")
    return {"ohlcv": ohlcv, "realtime": realtime, "name": name, "source": source}


def fetch_us(code: str, days: int) -> dict:
    """Fetch US stock via yfinance (primary source for US)."""
    ohlcv, source = _fetch_yfinance(code, "us", days)
    realtime = _fill_realtime_from_ohlcv(_fetch_realtime_us(code), ohlcv, code, code)
    name = realtime.get("name", code)
    return {"ohlcv": ohlcv, "realtime": realtime, "name": name, "source": source}


def fetch_cn_index(key: str, days: int) -> dict:
    """Fetch CN index with priority: akshare > yfinance (only if yf mapping)."""
    ohlcv = None
    source = "unknown"
    errors = []

    if _check_source("akshare"):
        try:
            ohlcv, source = _fetch_akshare_index(key, days)
        except Exception as e:
            errors.append(f"akshare: {e}")

    if ohlcv is None:
        yf_ticker = INDEX_REGISTRY.get(key, {}).get("yf", "")
        if yf_ticker and _check_source("yfinance"):
            try:
                ohlcv, source = _fetch_yfinance(yf_ticker, "us", days)  # treat as raw yf ticker
            except Exception as e:
                errors.append(f"yfinance: {e}")

    if ohlcv is None:
        raise ValueError(f"All data sources failed for index {key}: {'; '.join(errors)}")

    name = INDEX_REGISTRY.get(key, {}).get("name", key)
    realtime = _fill_realtime_from_ohlcv(_fetch_realtime_index(key), ohlcv, name, key)
    realtime.setdefault("name", name)
    return {"ohlcv": ohlcv, "realtime": realtime, "name": name, "source": source}


def fetch_us_index(ticker: str, days: int) -> dict:
    """Fetch US index via yfinance (^IXIC, ^GSPC, ^DJI ...)."""
    if not _check_source("yfinance"):
        raise ValueError(f"yfinance unavailable; cannot fetch US index {ticker}")
    ohlcv, source = _fetch_yfinance(ticker, "us", days)
    name = US_INDEX_REGISTRY.get(ticker, ticker)
    # yfinance .info on indices is unreliable; derive realtime from last bar only
    realtime = _fill_realtime_from_ohlcv({"name": name}, ohlcv, name, ticker)
    return {"ohlcv": ohlcv, "realtime": realtime, "name": name, "source": source}


# ============================================================
# SECTION 2.5: News Search (optional, with graceful degradation)
# ============================================================

def search_news(stock_name: str, code: str, max_results: int = 5) -> list:
    """
    Search news with priority: Tavily > SerpAPI > empty (let web_search).
    Returns list of {"title": ..., "content": ..., "url": ..., "date": ...}
    """
    # Priority 0: Tavily
    tavily_key = os.environ.get("TAVILY_API_KEY")
    if tavily_key:
        try:
            from tavily import TavilyClient
            client = TavilyClient(api_key=tavily_key)
            query = f"{stock_name} {code} stock news"
            resp = client.search(query=query, max_results=max_results, search_depth="basic")
            results = []
            for r in resp.get("results", [])[:max_results]:
                results.append({
                    "title": r.get("title", ""),
                    "content": r.get("content", "")[:200],
                    "url": r.get("url", ""),
                    "source": "tavily",
                })
            if results:
                _log(f"[{code}] News via Tavily ({len(results)} results)")
                return results
        except Exception as e:
            _log(f"[{code}] Tavily failed: {e}")

    # Priority 1: SerpAPI
    serpapi_key = os.environ.get("SERPAPI_KEY")
    if serpapi_key:
        try:
            from serpapi import GoogleSearch
            params = {
                "q": f"{stock_name} stock news",
                "api_key": serpapi_key,
                "num": max_results,
            }
            search = GoogleSearch(params)
            data = search.get_dict()
            results = []
            for r in data.get("organic_results", [])[:max_results]:
                results.append({
                    "title": r.get("title", ""),
                    "content": r.get("snippet", "")[:200],
                    "url": r.get("link", ""),
                    "source": "serpapi",
                })
            if results:
                _log(f"[{code}] News via SerpAPI ({len(results)} results)")
                return results
        except Exception as e:
            _log(f"[{code}] SerpAPI failed: {e}")

    # No API keys configured — return empty, let Claude use WebSearch
    _log(f"[{code}] No news API configured, skipping (Claude will use WebSearch)")
    return []


# ============================================================
# SECTION 3: Technical Indicator Calculations
# ============================================================

def _safe_float(val) -> float:
    """Safely convert to float."""
    if val is None:
        return None
    try:
        import math
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 4)
    except (ValueError, TypeError):
        return None


def calc_ema(data: list, period: int) -> list:
    """Calculate Exponential Moving Average."""
    if not data or len(data) < period:
        return [None] * len(data)
    result = [None] * (period - 1)
    multiplier = 2.0 / (period + 1)
    # First EMA = SMA of first 'period' values
    sma = sum(data[:period]) / period
    result.append(sma)
    for i in range(period, len(data)):
        ema = (data[i] - result[-1]) * multiplier + result[-1]
        result.append(ema)
    return result


def calc_ma(closes: list, periods: list) -> dict:
    """Calculate Simple Moving Averages."""
    result = {}
    for p in periods:
        key = f"MA{p}"
        if len(closes) >= p:
            ma_val = sum(closes[-p:]) / p
            result[key] = round(ma_val, 4)
        else:
            result[key] = None

    # MA alignment status
    ma5 = result.get("MA5")
    ma10 = result.get("MA10")
    ma20 = result.get("MA20")

    if all(v is not None for v in [ma5, ma10, ma20]):
        if ma5 > ma10 > ma20:
            result["alignment"] = "bullish"
            spread = (ma5 - ma20) / ma20 * 100 if ma20 > 0 else 0
            result["alignment_detail"] = "strong_bullish" if spread > 5 else "bullish"
        elif ma5 < ma10 < ma20:
            result["alignment"] = "bearish"
            spread = (ma20 - ma5) / ma20 * 100 if ma20 > 0 else 0
            result["alignment_detail"] = "strong_bearish" if spread > 5 else "bearish"
        elif ma5 > ma10 and ma10 <= ma20:
            result["alignment"] = "weak_bullish"
            result["alignment_detail"] = "weak_bullish"
        elif ma5 < ma10 and ma10 >= ma20:
            result["alignment"] = "weak_bearish"
            result["alignment_detail"] = "weak_bearish"
        else:
            result["alignment"] = "consolidation"
            result["alignment_detail"] = "consolidation"
    else:
        result["alignment"] = "insufficient_data"
        result["alignment_detail"] = "insufficient_data"

    return result


def calc_macd(closes: list, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    """Calculate MACD: DIF, DEA, Histogram, and cross signals."""
    if len(closes) < slow + signal:
        return {"DIF": None, "DEA": None, "hist": None, "signal": "insufficient_data"}

    ema_fast = calc_ema(closes, fast)
    ema_slow = calc_ema(closes, slow)

    dif_list = []
    for i in range(len(closes)):
        if ema_fast[i] is not None and ema_slow[i] is not None:
            dif_list.append(ema_fast[i] - ema_slow[i])
        else:
            dif_list.append(None)

    # DEA = EMA of DIF
    valid_dif = [d for d in dif_list if d is not None]
    if len(valid_dif) < signal:
        return {"DIF": None, "DEA": None, "hist": None, "signal": "insufficient_data"}

    dea_list = calc_ema(valid_dif, signal)

    # Current values
    curr_dif = valid_dif[-1] if valid_dif else None
    curr_dea = dea_list[-1] if dea_list else None
    prev_dif = valid_dif[-2] if len(valid_dif) >= 2 else None
    prev_dea = dea_list[-2] if len(dea_list) >= 2 else None

    hist = round((curr_dif - curr_dea) * 2, 4) if curr_dif is not None and curr_dea is not None else None

    # Cross signal detection
    macd_signal = "neutral"
    if all(v is not None for v in [curr_dif, curr_dea, prev_dif, prev_dea]):
        curr_diff = curr_dif - curr_dea
        prev_diff = prev_dif - prev_dea

        if prev_diff <= 0 and curr_diff > 0:
            macd_signal = "golden_cross_above_zero" if curr_dif > 0 else "golden_cross"
        elif prev_diff >= 0 and curr_diff < 0:
            macd_signal = "death_cross"
        elif curr_dif > 0 and curr_dea > 0:
            macd_signal = "bullish"
        elif curr_dif < 0 and curr_dea < 0:
            macd_signal = "bearish"

        # Zero axis cross
        if prev_dif is not None and curr_dif is not None:
            if prev_dif < 0 and curr_dif >= 0:
                macd_signal = "crossing_above_zero"
            elif prev_dif > 0 and curr_dif <= 0:
                macd_signal = "crossing_below_zero"

    return {
        "DIF": round(curr_dif, 4) if curr_dif is not None else None,
        "DEA": round(curr_dea, 4) if curr_dea is not None else None,
        "hist": hist,
        "signal": macd_signal,
    }


def calc_rsi(closes: list, periods: list) -> dict:
    """Calculate RSI using Wilder's method."""
    result = {}
    for period in periods:
        key = f"RSI{period}"
        if len(closes) < period + 1:
            result[key] = None
            continue

        deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
        gains = [max(0, d) for d in deltas]
        losses = [max(0, -d) for d in deltas]

        # First average
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period

        # Smoothed averages (Wilder's method)
        for i in range(period, len(deltas)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period

        if avg_loss == 0:
            rsi = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))

        result[key] = round(rsi, 2)

    # RSI zone
    rsi12 = result.get("RSI12")
    if rsi12 is not None:
        if rsi12 >= 80:
            result["zone"] = "overbought"
        elif rsi12 >= 60:
            result["zone"] = "strong"
        elif rsi12 >= 40:
            result["zone"] = "neutral"
        elif rsi12 >= 20:
            result["zone"] = "weak"
        else:
            result["zone"] = "oversold"
    else:
        result["zone"] = "unknown"

    return result


def calc_volume_analysis(volumes: list, closes: list) -> dict:
    """Analyze volume patterns."""
    if len(volumes) < 6 or len(closes) < 2:
        return {"vol_ratio": None, "trend": "insufficient_data"}

    # 5-day average volume (excluding today)
    avg_vol_5 = sum(volumes[-6:-1]) / 5 if len(volumes) >= 6 else volumes[-1]
    curr_vol = volumes[-1]

    vol_ratio = round(curr_vol / avg_vol_5, 2) if avg_vol_5 > 0 else None

    # Price change direction
    price_up = closes[-1] >= closes[-2]

    # Volume trend classification
    if vol_ratio is None:
        trend = "unknown"
    elif vol_ratio >= 1.5 and price_up:
        trend = "heavy_volume_up"
    elif vol_ratio >= 1.5 and not price_up:
        trend = "heavy_volume_down"
    elif vol_ratio <= 0.7 and not price_up:
        trend = "shrink_pullback"
    elif vol_ratio <= 0.7 and price_up:
        trend = "shrink_up"
    else:
        trend = "normal"

    return {"vol_ratio": vol_ratio, "trend": trend}


def calc_bias(closes: list, ma_data: dict) -> dict:
    """Calculate bias ratio (乖离率)."""
    if not closes:
        return {}
    curr = closes[-1]
    result = {}
    for key in ["MA5", "MA10", "MA20"]:
        ma_val = ma_data.get(key)
        if ma_val and ma_val > 0:
            bias = round((curr - ma_val) / ma_val * 100, 2)
            result[f"bias_{key.lower()}"] = bias
    return result


def calc_support(closes: list, ma_data: dict) -> dict:
    """Check if price is supported by MA lines."""
    if not closes:
        return {"support_ma5": False, "support_ma10": False}
    curr = closes[-1]
    ma5 = ma_data.get("MA5")
    ma10 = ma_data.get("MA10")

    support_ma5 = False
    support_ma10 = False

    if ma5 and curr > 0:
        # Price within 1% of MA5
        support_ma5 = abs(curr - ma5) / curr * 100 <= 1.0
    if ma10 and curr > 0:
        support_ma10 = abs(curr - ma10) / curr * 100 <= 1.5

    return {"support_ma5": support_ma5, "support_ma10": support_ma10}


# ============================================================
# SECTION 4: Composite Trend Scoring (100 points)
# ============================================================
#
# Scoring weights, per-dimension score tables, signal thresholds and hard
# rules are externalized into references/strategy.yaml (the Strategy DSL).
# That file is the single editable source of truth. _DEFAULT_STRATEGY below
# is a degraded-mode fallback used ONLY when PyYAML is missing or the YAML
# file is unreadable — keep it in sync, but at runtime YAML wins.

# Embedded fallback — must mirror references/strategy.yaml.
_DEFAULT_STRATEGY = {
    "name": "default-embedded",
    "weights": {
        "trend": 30, "bias": 20, "volume": 15,
        "macd": 15, "rsi": 10, "support": 10,
    },
    "trend_scores": {
        "strong_bullish": 30, "bullish": 26, "weak_bullish": 18,
        "consolidation": 12, "weak_bearish": 8, "bearish": 4,
        "strong_bearish": 0, "insufficient_data": 12,
    },
    "trend_default": 12,
    "bias_null_score": 10,
    "bias_default_score": 10,
    "bias_bands": [
        {"min": -3, "max": 0, "score": 20},
        {"min": 0, "max": 2, "score": 18},
        {"min": 2, "max": 5, "score": 14},
        {"min": 5, "max": None, "score": 4},
        {"min": -5, "max": -3, "score": 14},
        {"min": None, "max": -5, "score": 6},
    ],
    "volume_scores": {
        "shrink_pullback": 15, "heavy_volume_up": 12, "normal": 10,
        "shrink_up": 6, "heavy_volume_down": 0, "insufficient_data": 8,
        "unknown": 8,
    },
    "volume_default": 8,
    "macd_scores": {
        "golden_cross_above_zero": 15, "crossing_above_zero": 13,
        "golden_cross": 12, "bullish": 10, "neutral": 7,
        "bearish": 3, "death_cross": 0, "crossing_below_zero": 1,
        "insufficient_data": 7,
    },
    "macd_default": 7,
    "rsi_scores": {
        "oversold": 10, "strong": 8, "neutral": 5,
        "weak": 3, "overbought": 0, "unknown": 5,
    },
    "rsi_default": 5,
    "support_ma5_points": 5,
    "support_ma10_points": 5,
    "signal_rules": [
        {"signal": "strong_buy", "min_score": 75,
         "require_alignment": ["bullish", "strong_bullish"]},
        {"signal": "buy", "min_score": 60,
         "require_alignment": ["bullish", "strong_bullish", "weak_bullish"]},
        {"signal": "hold", "min_score": 45},
        {"signal": "wait", "min_score": 30},
        {"signal": "strong_sell", "require_alignment": ["bearish", "strong_bearish"]},
        {"signal": "sell"},
    ],
    "signal_cn": {
        "strong_buy": "强烈买入", "buy": "买入", "hold": "持有",
        "wait": "观望", "sell": "卖出", "strong_sell": "强烈卖出",
    },
    "hard_rules": {
        "applies_to_signals": ["strong_buy", "buy"],
        "downgrade_to": "hold",
        "rules": [
            {"id": "rsi_overbought", "type": "rsi_zone_equals",
             "value": "overbought", "message": "RSI > 80 (overbought)"},
            {"id": "bias_overextended", "type": "bias_ma5_above",
             "threshold": 5,
             "message_template": "MA5 乖离 {value:+.2f}% > 5% (overextended)"},
        ],
    },
}

_STRATEGY_CACHE = None  # loaded once per run


def load_strategy() -> dict:
    """Load the Strategy DSL from references/strategy.yaml.

    Graceful degradation: if PyYAML is unavailable or the file cannot be
    read/parsed, fall back to _DEFAULT_STRATEGY and log to stderr. The main
    flow must never crash because of strategy config issues.
    """
    global _STRATEGY_CACHE
    if _STRATEGY_CACHE is not None:
        return _STRATEGY_CACHE

    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "strategy.yaml")
    try:
        import yaml  # optional dependency
        with open(path, "r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f)
        if not isinstance(loaded, dict):
            raise ValueError("strategy.yaml did not parse into a mapping")
        # Shallow-merge over defaults so a partial YAML still works.
        merged = dict(_DEFAULT_STRATEGY)
        merged.update(loaded)
        _STRATEGY_CACHE = merged
        print(f"[strategy] loaded {path} (name={merged.get('name')})", file=sys.stderr)
    except ImportError:
        _STRATEGY_CACHE = _DEFAULT_STRATEGY
        print("[strategy] PyYAML not installed -- using embedded default strategy",
              file=sys.stderr)
    except Exception as e:  # noqa: BLE001 -- never crash on config issues
        _STRATEGY_CACHE = _DEFAULT_STRATEGY
        print(f"[strategy] failed to load {path} ({e}) -- using embedded default",
              file=sys.stderr)
    return _STRATEGY_CACHE


def _score_bias(bias_ma5, strategy: dict) -> int:
    """Map MA5 bias into a score using the strategy's bias_bands."""
    if bias_ma5 is None:
        return strategy.get("bias_null_score", 10)
    for band in strategy.get("bias_bands", []):
        lo, hi = band.get("min"), band.get("max")
        if (lo is None or bias_ma5 >= lo) and (hi is None or bias_ma5 < hi):
            return band.get("score", strategy.get("bias_default_score", 10))
    return strategy.get("bias_default_score", 10)


def _check_hard_rules(signal: str, rsi_data: dict, bias_data: dict,
                      strategy: dict):
    """Apply hard-rule vetoes. Returns (new_signal, triggered_messages).

    Each rule `type` maps to a fixed handler here (no eval). Adding a new
    rule type requires adding a branch below.
    """
    hr = strategy.get("hard_rules", {})
    triggered = []
    if signal not in hr.get("applies_to_signals", []):
        return signal, triggered

    for rule in hr.get("rules", []):
        rtype = rule.get("type")
        if rtype == "rsi_zone_equals":
            if rsi_data.get("zone") == rule.get("value"):
                triggered.append(rule.get("message", rule.get("id", "rule")))
        elif rtype == "bias_ma5_above":
            val = bias_data.get("bias_ma5")
            thr = rule.get("threshold")
            if val is not None and thr is not None and val > thr:
                tmpl = rule.get("message_template")
                triggered.append(tmpl.format(value=val) if tmpl
                                 else rule.get("message", rule.get("id", "rule")))
        # Unknown rule types are ignored (forward-compatible).

    if triggered:
        signal = hr.get("downgrade_to", "hold")
    return signal, triggered


def calc_trend_score(ma_data: dict, macd_data: dict, rsi_data: dict,
                     vol_data: dict, bias_data: dict, support_data: dict,
                     strategy: dict = None) -> dict:
    """
    Composite scoring system (100 points total). All weights, score tables,
    signal thresholds and hard rules come from the Strategy DSL
    (references/strategy.yaml); see load_strategy(). Dimension maxima:
    - Trend/MA alignment: 30 pts
    - Bias (乖离率): 20 pts
    - Volume: 15 pts
    - MACD: 15 pts
    - RSI: 10 pts
    - Support: 10 pts
    """
    if strategy is None:
        strategy = load_strategy()

    breakdown = {}

    # 1. Trend score
    alignment = ma_data.get("alignment_detail", "consolidation")
    breakdown["trend"] = strategy["trend_scores"].get(
        alignment, strategy.get("trend_default", 12))

    # 2. Bias score - prefer slightly below MA5
    breakdown["bias"] = _score_bias(bias_data.get("bias_ma5", 0), strategy)

    # 3. Volume score
    vol_trend = vol_data.get("trend", "normal")
    breakdown["volume"] = strategy["volume_scores"].get(
        vol_trend, strategy.get("volume_default", 8))

    # 4. MACD score
    macd_signal = macd_data.get("signal", "neutral")
    breakdown["macd"] = strategy["macd_scores"].get(
        macd_signal, strategy.get("macd_default", 7))

    # 5. RSI score
    rsi_zone = rsi_data.get("zone", "neutral")
    breakdown["rsi"] = strategy["rsi_scores"].get(
        rsi_zone, strategy.get("rsi_default", 5))

    # 6. Support score (additive)
    sup_score = 0
    if support_data.get("support_ma5"):
        sup_score += strategy.get("support_ma5_points", 5)
    if support_data.get("support_ma10"):
        sup_score += strategy.get("support_ma10_points", 5)
    breakdown["support"] = sup_score

    total = sum(breakdown.values())

    # Signal generation — first matching rule wins.
    alignment_val = ma_data.get("alignment", "consolidation")
    signal = "sell"
    for rule in strategy.get("signal_rules", []):
        min_score = rule.get("min_score")
        req_align = rule.get("require_alignment")
        if min_score is not None and total < min_score:
            continue
        if req_align is not None and alignment_val not in req_align:
            continue
        signal = rule["signal"]
        break

    # Hard rules — product guardrails that downgrade buy signals.
    signal, hard_rules_triggered = _check_hard_rules(
        signal, rsi_data, bias_data, strategy)

    signal_cn = strategy.get("signal_cn", {})

    return {
        "total": total,
        "breakdown": breakdown,
        "hard_rules_triggered": hard_rules_triggered,
        "signal": signal,
        "signal_cn": signal_cn.get(signal, signal),
    }


# ============================================================
# SECTION 5: Main Orchestrator
# ============================================================

def analyze_stock(code: str, days: int = 120, fetch_news: bool = False) -> dict:
    """Full analysis pipeline for a single stock."""
    market, normalized, display = classify_stock(code)

    if market == "unknown":
        raise ValueError(f"Cannot classify stock code: {code}")

    # Fetch data with graceful degradation
    if market == "cn_a":
        raw = fetch_cn_a(normalized, days)
    elif market == "cn_hk":
        raw = fetch_hk(normalized, days)
    elif market == "cn_index":
        raw = fetch_cn_index(normalized, days)
    elif market == "us_index":
        raw = fetch_us_index(normalized, days)
    elif market == "cn_fund":
        raw = fetch_cn_fund(normalized, days)
    else:
        raw = fetch_us(normalized, days)

    ohlcv = raw["ohlcv"]
    if not ohlcv or len(ohlcv) < 10:
        raise ValueError(f"Insufficient data for {code}: only {len(ohlcv)} bars")

    closes = [bar["close"] for bar in ohlcv if bar["close"] is not None]
    volumes = [bar["volume"] for bar in ohlcv if bar["volume"] is not None]

    if len(closes) < 10:
        raise ValueError(f"Insufficient valid close prices for {code}")

    # Calculate all indicators
    ma = calc_ma(closes, [5, 10, 20, 60])
    macd = calc_macd(closes)
    rsi = calc_rsi(closes, [6, 12, 24])
    vol = calc_volume_analysis(volumes, closes)
    bias = calc_bias(closes, ma)
    support = calc_support(closes, ma)
    score = calc_trend_score(ma, macd, rsi, vol, bias, support)

    # News search (optional)
    news = []
    if fetch_news:
        stock_name = raw.get("name", display)
        news = search_news(stock_name, display)

    result = {
        "code": display,
        "market": market,
        "is_index": market in ("cn_index", "us_index"),
        "is_fund": market == "cn_fund",
        "name": raw.get("name", display),
        "data_source": raw.get("source", "unknown"),
        "realtime": raw.get("realtime", {}),
        "indicators": {
            "ma": ma,
            "macd": macd,
            "rsi": rsi,
            "volume": vol,
            "bias": bias,
            "support": support,
        },
        "trend_score": score,
        "recent_bars": ohlcv[-10:],
        "total_bars": len(ohlcv),
        "fetch_time": datetime.now().isoformat(),
    }

    # Fund-specific extras
    if market == "cn_fund":
        result["fund_info"] = raw.get("fund_info", {})
        result["holdings"] = raw.get("holdings", [])
        # Clearing-line warning: fund size <5000万 is near regulatory clearing threshold
        size_str = (raw.get("fund_info") or {}).get("size") or ""
        warnings = []
        try:
            # size_str examples: "5731.42万" / "12.34亿"
            if "亿" in size_str:
                size_yi = float(size_str.replace("亿", ""))
                size_wan = size_yi * 10000
            elif "万" in size_str:
                size_wan = float(size_str.replace("万", ""))
            else:
                size_wan = None
            if size_wan is not None:
                if size_wan < 5000:
                    warnings.append(f"清盘红色预警：基金规模 {size_str} 已低于 5000 万元清盘红线")
                elif size_wan < 10000:
                    warnings.append(f"清盘黄色预警：基金规模 {size_str} 接近 5000 万元清盘线")
        except (ValueError, AttributeError):
            pass
        if warnings:
            result["warnings"] = warnings
    if news:
        result["news"] = news
    return result


# ============================================================
# SECTION 5b: Signal Persistence (for backtesting)
# ============================================================

_SIGNAL_FILE_LOCK = threading.Lock()


def persist_signals(results: list, signal_file: str, analysis_date: str) -> int:
    """
    Append one JSONL line per stock result to the signal journal.

    Each line records the signal snapshot — code, price, signal, score
    breakdown, entry/target/stop prices — so that a backtest script can
    later look up the real outcome at +1/+3/+5/+10 trading days.

    This is intentionally minimal: a JSONL append. No schema migration,
    no storage engine, no outcome computation here. The backtest script
    handles all of that.
    """
    lines = 0
    with _SIGNAL_FILE_LOCK:
        try:
            os.makedirs(os.path.dirname(signal_file) or ".", exist_ok=True)
            with open(signal_file, "a", encoding="utf-8") as f:
                for r in results:
                    ts = r.get("trend_score", {})
                    realtime = r.get("realtime", {})
                    rec = {
                        "date": analysis_date,
                        "recorded_at": datetime.now().isoformat(),
                        "code": r.get("code"),
                        "name": r.get("name"),
                        "market": r.get("market"),
                        "price": realtime.get("price"),
                        "signal": ts.get("signal"),
                        "signal_cn": ts.get("signal_cn"),
                        "score_total": ts.get("total"),
                        "score_breakdown": ts.get("breakdown"),
                        "hard_rules_triggered": ts.get("hard_rules_triggered"),
                        # Entry / target / stop as provided by AI analysis
                        # (populated by post-processing; here we seed with
                        #  None — the backtest script can fill them from
                        #  the AI output if the user records it separately)
                        "entry": None,
                        "target": None,
                        "stop_loss": None,
                        "outcomes": {},  # to be filled by backtest script
                    }
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    lines += 1
            _log(f"persisted {lines} signal(s) to {signal_file}")
        except OSError as e:
            _log(f"signal persist failed ({e}) — continuing anyway")
    return lines


def main():
    parser = argparse.ArgumentParser(
        description="Stock Data Fetcher + Holiday Calendar"
    )
    parser.add_argument(
        "--stocks",
        help="Comma-separated stock codes (required unless --holiday is used)"
    )
    parser.add_argument(
        "--days",
        type=int,
        default=120,
        help="History trading days"
    )
    parser.add_argument(
        "--news",
        action="store_true",
        help="Also search news (requires TAVILY_API_KEY or SERPAPI_KEY)"
    )
    parser.add_argument(
        "--holiday",
        action="store_true",
        help="Check trading day status for today or a specific date"
    )
    parser.add_argument(
        "--date",
        help="Specific date to check (YYYY-MM-DD format, used with --holiday)"
    )
    parser.add_argument(
        "--save-signal",
        action="store_true",
        help="Persist signals to signals.jsonl for later backtesting"
    )
    parser.add_argument(
        "--signal-file",
        default=None,
        help="Path to signal JSONL file (default: <cwd>/signals.jsonl)"
    )
    args = parser.parse_args()

    # Holiday calendar mode
    if args.holiday:
        check_date = None
        if args.date:
            try:
                check_date = datetime.strptime(args.date, "%Y-%m-%d").date()
            except ValueError:
                print(json.dumps({
                    "error": f"Invalid date format: {args.date}. "
                             f"Use YYYY-MM-DD format."
                }, ensure_ascii=False, indent=2))
                sys.exit(1)

        status = get_trading_day_status(check_date)

        # Report chinese_calendar availability
        sources_status = {
            "chinese_calendar": "available" if _check_chinese_calendar()
                                else "not installed (fallback to weekday check)"
        }

        output = {
            "check_date": status["date"],
            "is_trading_day": status["is_trading_day"],
            "weekday": status["weekday"],
            "weekday_name": status["weekday_name"],
            "last_trading_day": status["last_trading_day"],
            "next_trading_day": status["next_trading_day"],
            "calendar_source": sources_status["chinese_calendar"],
            "check_time": datetime.now().isoformat(),
        }

        print(json.dumps(output, ensure_ascii=False, indent=2))
        return

    # Stock analysis mode (original behavior)
    if not args.stocks:
        parser.error("--stocks is required unless --holiday is used")

    codes = parse_stock_codes(args.stocks)
    results = []
    errors = []

    # Report available data sources
    sources_status = {}
    for lib in ["tushare", "efinance", "akshare", "yfinance", "chinese_calendar"]:
        sources_status[lib] = "available" if _check_source(lib) else "not installed"
    sources_status["tushare_token"] = "configured" if os.environ.get("TUSHARE_TOKEN") else "not set"
    sources_status["tavily_api"] = "configured" if os.environ.get("TAVILY_API_KEY") else "not set"
    sources_status["serpapi"] = "configured" if os.environ.get("SERPAPI_KEY") else "not set"
    _log(f"Data sources: {json.dumps(sources_status)}")

    # Check if today is a trading day
    today_status = get_trading_day_status()
    _log(f"Today ({today_status['date']}) is_trading_day={today_status['is_trading_day']} "
         f"({today_status['weekday_name']})")

    max_workers = min(len(codes), 8)
    _log(f"Fetching {len(codes)} stocks in parallel (max_workers={max_workers})")
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_code = {
            executor.submit(analyze_stock, code, args.days, fetch_news=args.news): code
            for code in codes
        }
        for future in as_completed(future_to_code):
            code = future_to_code[future]
            try:
                result = future.result(timeout=120)
                results.append(result)
            except Exception as e:
                errors.append({"code": code, "error": str(e), "type": type(e).__name__})

    output = {
        "analysis_date": datetime.now().strftime("%Y-%m-%d"),
        "analysis_time": datetime.now().strftime("%H:%M:%S"),
        "trading_day_status": today_status,
        "data_sources": sources_status,
        "stocks": results,
        "errors": errors,
        "total_requested": len(codes),
        "total_success": len(results),
    }

    # Persist signals for backtesting (opt-in via --save-signal)
    if args.save_signal:
        signal_file = args.signal_file or os.path.join(
            os.getcwd(), "signals.jsonl")
        persist_signals(results, signal_file, output["analysis_date"])

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
