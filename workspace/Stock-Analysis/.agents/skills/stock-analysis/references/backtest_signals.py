#!/usr/bin/env python3
"""
Signal Backtest — reads signals.jsonl, fetches real outcome prices at
+1/+3/+5/+10 trading days, computes directional accuracy.

Usage:
  python3 backtest_signals.py [--signal-file signals.jsonl] [--days 1,3,5,10]

Output:
  - Per-signal outcome report (signal +N days → actual outcome)
  - Aggregate stats per signal type (buy vs sell accuracy, avg return)

The script can also update the JSONL entries with outcome data in-place
(--update-jsonl), so subsequent runs skip already-computed entries.
"""

import json
import os
import sys
import argparse
import warnings
from datetime import datetime, timedelta

warnings.filterwarnings("ignore")

# Allow importing from the same directory as this script
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)


def _import_fetcher_functions():
    """Lazy-import the shared fetcher helpers we need."""
    # Import the stock_data_fetcher module (not as __main__)
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "stock_data_fetcher_lib",
        os.path.join(_SCRIPT_DIR, "stock_data_fetcher.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_pending_signals(signal_file: str) -> list:
    """Read JSONL and return signals that don't yet have computed outcomes."""
    signals = []
    if not os.path.exists(signal_file):
        print(f"[backtest] signal file not found: {signal_file}")
        return signals
    with open(signal_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                sig = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Skip signals without a price or date
            if not sig.get("price") or not sig.get("date"):
                continue
            signals.append(sig)
    return signals


def fetch_price_at_date(fetcher, code: str, market: str, target_date: str):
    """
    Fetch the closing price for `code` on or immediately after `target_date`
    (YYYY-MM-DD). Returns (price, actual_date) or (None, None).

    Uses the public fetch_* functions from stock_data_fetcher, which return
    {"ohlcv": [...], "source": ..., "name": ...}.
    """
    try:
        from datetime import datetime as dt
        target = dt.strptime(target_date, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None, None

    try:
        if market == "cn_a":
            raw = fetcher.fetch_cn_a(code, 30)
        elif market == "cn_hk":
            raw = fetcher.fetch_hk(code, 30)
        elif market == "cn_index":
            raw = fetcher.fetch_cn_index(code, 30)
        elif market == "us_index":
            raw = fetcher.fetch_us_index(code, 30)
        elif market == "us":
            raw = fetcher.fetch_us(code, 30)
        elif market == "cn_fund":
            # Funds don't have typical OHLCV — skip for backtesting
            return None, None
        else:
            return None, None
    except Exception:
        return None, None

    ohlcv = raw.get("ohlcv", []) if raw else []

    # Find the first bar whose date is >= target_date
    target_str = target.strftime("%Y-%m-%d")
    for bar in ohlcv:
        bar_date = bar.get("date", "")
        if bar_date >= target_str:
            return bar.get("close"), bar_date

    # If all bars are before target, use the last one
    return ohlcv[-1].get("close"), ohlcv[-1].get("date")


def get_nth_trading_day(fetcher, base_date: str, n: int) -> str:
    """
    Return the date of the Nth trading day AFTER base_date.
    Uses get_trading_day_status() to skip weekends/holidays.
    """
    try:
        from datetime import datetime as dt
        base = dt.strptime(base_date, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None

    current = base
    found = 0
    safety = 0
    while found < n and safety < 60:
        current = current + timedelta(days=1)
        safety += 1
        status = fetcher.get_trading_day_status(current)
        if status.get("is_trading_day", False):
            found += 1
    if found < n:
        return None
    return current.strftime("%Y-%m-%d")


def compute_outcomes(fetcher, signal: dict, offsets: list) -> dict:
    """For one signal, compute price change% at each offset trading day."""
    outcomes = {}
    base_price = signal.get("price")
    base_date = signal.get("date")
    market = signal.get("market")
    code = signal.get("code")
    if not base_price or not base_date or not code:
        return outcomes
    try:
        base_price = float(base_price)
    except (TypeError, ValueError):
        return outcomes

    for n in offsets:
        target_date = get_nth_trading_day(fetcher, base_date, n)
        if not target_date:
            outcomes[f"day_{n}"] = {"status": "no_trading_day"}
            continue
        px, actual_date = fetch_price_at_date(fetcher, code, market, target_date)
        if px is None:
            outcomes[f"day_{n}"] = {"status": "no_data"}
            continue
        try:
            px = float(px)
        except (TypeError, ValueError):
            outcomes[f"day_{n}"] = {"status": "bad_price"}
            continue
        change_pct = (px - base_price) / base_price * 100
        outcomes[f"day_{n}"] = {
            "target_date": target_date,
            "actual_date": actual_date,
            "price": round(px, 4),
            "change_pct": round(change_pct, 2),
        }

    # Directional accuracy: for buy signals, positive change = correct;
    # for sell signals, negative change = correct.
    for n in offsets:
        key = f"day_{n}"
        if key in outcomes and "change_pct" in outcomes[key]:
            chg = outcomes[key]["change_pct"]
            if signal.get("signal") in ("strong_buy", "buy"):
                outcomes[key]["direction_correct"] = chg > 0
            elif signal.get("signal") in ("strong_sell", "sell"):
                outcomes[key]["direction_correct"] = chg < 0
            else:
                outcomes[key]["direction_correct"] = None  # hold/wait — no prediction

    return outcomes


def update_jsonl(signal_file: str, signals: list):
    """Rewrite the JSONL with updated outcome fields."""
    tmp = signal_file + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for sig in signals:
            f.write(json.dumps(sig, ensure_ascii=False) + "\n")
    os.replace(tmp, signal_file)
    print(f"[backtest] updated {signal_file} ({len(signals)} entries)")


def print_summary(signals: list, offsets: list):
    """Print aggregate statistics."""
    print(f"\n{'='*60}")
    print(f"Signal Backtest Summary — {len(signals)} signals")
    print(f"{'='*60}")

    # Group by signal type
    by_signal = {}
    for sig in signals:
        s = sig.get("signal", "unknown")
        by_signal.setdefault(s, []).append(sig)

    for signal_type in ["strong_buy", "buy", "hold", "wait", "sell", "strong_sell"]:
        group = by_signal.get(signal_type, [])
        if not group:
            continue
        cn = {"strong_buy": "强烈买入", "buy": "买入", "hold": "持有",
              "wait": "观望", "sell": "卖出", "strong_sell": "强烈卖出"}
        print(f"\n--- {cn.get(signal_type, signal_type)} ({len(group)} signals) ---")

        for n in offsets:
            key = f"day_{n}"
            results = []
            for sig in group:
                oc = sig.get("outcomes", {}).get(key, {})
                if "change_pct" in oc:
                    results.append(oc["change_pct"])
            if results:
                avg = sum(results) / len(results)
                correct = sum(
                    1 for sig in group
                    if sig.get("outcomes", {}).get(key, {}).get("direction_correct")
                )
                # Only count those with a defined direction (buy/sell)
                with_direction = sum(
                    1 for sig in group
                    if sig.get("outcomes", {}).get(key, {}).get("direction_correct") is not None
                )
                print(f"  +{n} trading days: avg return {avg:+.2f}%  "
                      f"| direction correct {correct}/{with_direction} "
                      f"({correct/with_direction*100:.0f}%)" if with_direction
                      else f"  +{n} trading days: avg return {avg:+.2f}%")
            else:
                print(f"  +{n} trading days: (no data)")

    # Quick per-signal detail
    print(f"\n{'='*60}")
    print("Per-Signal Detail")
    print(f"{'='*60}")
    for sig in signals:
        print(f"\n{sig['date']} {sig['code']} ({sig.get('name','')}) "
              f"{sig.get('signal_cn','')} @ {sig.get('price')}")
        for n in offsets:
            oc = sig.get("outcomes", {}).get(f"day_{n}", {})
            if "change_pct" in oc:
                status = "✓" if oc.get("direction_correct") else "✗"
                print(f"  +{n}d: {oc['change_pct']:+.2f}% ({oc.get('actual_date','')}) {status}")
            else:
                print(f"  +{n}d: {oc.get('status','?')}")


def main():
    parser = argparse.ArgumentParser(
        description="Signal Backtest — compute real outcome for persisted signals"
    )
    parser.add_argument(
        "--signal-file",
        default=None,
        help="Path to signal JSONL (default: <cwd>/signals.jsonl)",
    )
    parser.add_argument(
        "--days",
        default="1,3,5,10",
        help="Comma-separated look-ahead trading days (default: 1,3,5,10)",
    )
    parser.add_argument(
        "--update-jsonl",
        action="store_true",
        help="Update the JSONL file with computed outcomes in-place",
    )
    args = parser.parse_args()

    signal_file = args.signal_file or os.path.join(os.getcwd(), "signals.jsonl")
    offsets = [int(x.strip()) for x in args.days.split(",") if x.strip()]

    signals = load_pending_signals(signal_file)
    if not signals:
        print("[backtest] no pending signals to evaluate")
        return

    fetcher = _import_fetcher_functions()

    computed = 0
    for sig in signals:
        # Skip if already computed for ALL requested offsets
        existing = sig.get("outcomes", {})
        needed = [n for n in offsets if f"day_{n}" not in existing]
        if not needed:
            continue

        print(f"[backtest] evaluating {sig['date']} {sig['code']} "
              f"({sig.get('signal_cn','?')}) "
              f"offsets needed: {needed}")
        new_outcomes = compute_outcomes(fetcher, sig, needed)
        sig.setdefault("outcomes", {}).update(new_outcomes)
        computed += 1

    print(f"[backtest] computed outcomes for {computed}/{len(signals)} signals")

    if args.update_jsonl and computed > 0:
        update_jsonl(signal_file, signals)

    print_summary(signals, offsets)


if __name__ == "__main__":
    main()
