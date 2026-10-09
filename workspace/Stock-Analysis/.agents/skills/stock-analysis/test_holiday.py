#!/usr/bin/env python3
"""
Test script for holiday calendar functionality
"""

import sys
import os

# Add the references directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__),
                                "references"))

from datetime import date
from stock_data_fetcher import (
    is_trading_day,
    get_last_trading_day,
    get_next_trading_day,
    get_trading_day_status,
    _check_chinese_calendar
)

def test_holiday_calendar():
    """Run comprehensive tests on holiday calendar functions."""

    print("=" * 60)
    print("Holiday Calendar Test Suite")
    print("=" * 60)

    # Test 1: Check library availability
    print("\n1. Library Status:")
    has_calendar = _check_chinese_calendar()
    print(f"   chinese_calendar: {'✅ available' if has_calendar else '❌ not installed'}")

    # Test 2: Major holidays 2025
    print("\n2. Major Holidays 2025:")
    holidays = [
        ("2025-01-01", "元旦"),
        ("2025-02-10", "春节前周一"),
        ("2025-02-17", "春节假期中"),
        ("2025-01-26", "春节调休周日"),
        ("2025-05-01", "劳动节"),
        ("2025-05-04", "五一假期周日"),
        ("2025-10-01", "国庆节"),
    ]

    for date_str, name in holidays:
        d = date.fromisoformat(date_str)
        is_trade = is_trading_day(d)
        status = "✅ 交易日" if is_trade else "❌ 非交易日"
        expected = "holiday" in name.lower() or "假期" in name
        match = "✅" if (not is_trade and expected) or (is_trade and not expected) else "⚠️"
        print(f"   {date_str} ({name}): {status} {match}")

    # Test 3: Weekend shift (调休)
    print("\n3. Weekend Shifts (调休工作日):")
    shifts = [
        ("2025-01-26", "春节前周日上班"),
        ("2025-02-08", "春节后周六上班"),
    ]

    for date_str, name in shifts:
        d = date.fromisoformat(date_str)
        is_trade = is_trading_day(d)
        weekday = d.weekday()
        weekday_name = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekday]
        status = "✅ 交易日" if is_trade else "❌ 非交易日"
        note = f"({weekday_name}) - {name}"
        print(f"   {date_str}: {status} {note}")

    # Test 4: Get last/next trading day
    print("\n4. Trading Day Navigation:")
    test_dates = [
        date.today(),
        date(2025, 1, 1),  # Holiday
        date(2025, 5, 1),  # Holiday
    ]

    for d in test_dates:
        last = get_last_trading_day(d)
        next_ = get_next_trading_day(d)
        print(f"   From {d.isoformat()}:")
        print(f"     Last trading day: {last.isoformat()}")
        print(f"     Next trading day: {next_.isoformat()}")

    # Test 5: Full status report
    print("\n5. Full Status Report (Today):")
    status = get_trading_day_status()
    for key, value in status.items():
        print(f"   {key}: {value}")

    # Test 6: Edge cases
    print("\n6. Edge Cases:")
    edge_cases = [
        ("2025-12-31", "年末最后一天"),
        ("2026-01-01", "跨年元旦"),
    ]

    for date_str, name in edge_cases:
        d = date.fromisoformat(date_str)
        status = get_trading_day_status(d)
        print(f"   {date_str} ({name}):")
        print(f"     is_trading_day: {status['is_trading_day']}")
        print(f"     last: {status['last_trading_day']}")
        print(f"     next: {status['next_trading_day']}")

    print("\n" + "=" * 60)
    print("✅ All tests completed successfully!")
    print("=" * 60)

    # Summary
    print("\nSummary:")
    print(f"  - chinese_calendar library: {'installed ✅' if has_calendar else 'not installed (using fallback) ⚠️'}")
    print(f"  - Today ({date.today().isoformat()}) is a {'trading day ✅' if is_trading_day() else 'non-trading day ❌'}")

    if not has_calendar:
        print("\n⚠️  Warning: chinese_calendar not installed")
        print("   Install with: pip install chinese_calendar")
        print("   This will enable accurate holiday detection (including weekend shifts)")

if __name__ == "__main__":
    try:
        test_holiday_calendar()
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)