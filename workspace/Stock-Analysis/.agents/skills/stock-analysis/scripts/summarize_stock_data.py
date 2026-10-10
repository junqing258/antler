#!/usr/bin/env python3
"""Print analysis fields using the fetcher's actual schema, without raw bars."""
import argparse
import json


def summarize(data):
    stocks = []
    for stock in data.get("stocks", []):
        indicators = stock.get("indicators", {})
        stocks.append({
            "code": stock.get("code"),
            "name": stock.get("name"),
            "market": stock.get("market"),
            "data_source": stock.get("data_source"),
            "fetch_time": stock.get("fetch_time"),
            "realtime": stock.get("realtime", {}),
            "indicators": {key: indicators.get(key, {}) for key in
                           ("ma", "macd", "rsi", "volume", "bias", "support")},
            "trend_score": stock.get("trend_score", {}),
            "news_status": stock.get("news_status", {"status": "unknown"}),
            "news": [{key: item.get(key) for key in ("title", "date", "source", "url")}
                     for item in stock.get("news", [])],
            **{key: stock[key] for key in ("fund_info", "holdings", "warnings") if key in stock},
        })
    return {
        **{key: data.get(key) for key in ("schema_version", "status", "analysis_date",
                                         "trading_day_status", "data_sources", "errors",
                                         "pending_codes", "total_requested", "total_success")},
        "stocks": stocks,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="Fetcher JSON checkpoint file")
    args = parser.parse_args()
    try:
        with open(args.path, encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict) or not isinstance(data.get("stocks"), list):
            raise ValueError("Expected a fetcher object with a stocks array")
    except (OSError, ValueError) as error:
        parser.exit(1, f"Cannot read analysis JSON: {error}\n")
    print(json.dumps(summarize(data), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
