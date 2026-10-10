"""Offline regressions for bounded fetching, checkpoints, schema and news fallback."""
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import tempfile
import time
import types
import unittest
from datetime import date
from unittest.mock import patch

import stock_data_fetcher as fetcher


def fake_worker(connection, code, days, fetch_news):
    if code == "crash":
        os._exit(2)
    if code == "error":
        connection.send(("error", {"code": code, "error": "no data", "type": "ValueError"}))
    elif code in ("slow", "queued"):
        time.sleep(10)
    else:
        connection.send(("result", {"code": code, "news": [], "news_status": {"status": "pending"}}))
        if code == "news_slow":
            time.sleep(10)
        connection.send(("done", None))
    connection.close()


class FetcherTests(unittest.TestCase):
    def output(self):
        return {"stocks": [], "errors": [], "status": "running"}

    def test_weekend_makeup_workday_is_not_trading_day(self):
        calendar = types.SimpleNamespace(is_workday=lambda day: True)
        with patch.object(fetcher, "_check_chinese_calendar", return_value=True), \
                patch.dict("sys.modules", {"chinese_calendar": calendar}):
            self.assertFalse(fetcher.is_trading_day(date(2026, 10, 10)))
            self.assertEqual(fetcher.get_trading_day_status(date(2026, 10, 12))["next_trading_day"],
                             "2026-10-13")

    def test_checkpoint_contains_result_while_news_pending(self):
        snapshots = []
        original = fetcher.write_checkpoint

        def record(path, output):
            original(path, output)
            snapshots.append(json.loads(Path(path).read_text()))

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(fetcher, "write_checkpoint", side_effect=record):
            fetcher.run_batch(["news_slow"], 120, True, self.output(),
                              str(Path(directory) / "report.json"),
                              stock_timeout=0.7, batch_timeout=2, worker_target=fake_worker)
        interim = next(snapshot for snapshot in snapshots if snapshot["total_success"] == 1)
        self.assertEqual(interim["status"], "running")
        self.assertEqual(interim["stocks"][0]["news_status"]["status"], "pending")

    def test_atomic_write_failure_preserves_previous_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "report.json")
            fetcher.write_checkpoint(path, {"stocks": ["previous"]})
            with patch.object(fetcher.os, "replace", side_effect=OSError("disk error")):
                with self.assertRaises(OSError):
                    fetcher.write_checkpoint(path, {"stocks": ["new"]})
            self.assertEqual(json.loads(Path(path).read_text()), {"stocks": ["previous"]})
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_timeout_retains_success_and_atomic_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "report.json")
            started = time.monotonic()
            output = fetcher.run_batch(["fast", "slow", "error", "crash"], 120, False,
                                       self.output(), path, workers=2,
                                       stock_timeout=0.7, batch_timeout=3,
                                       worker_target=fake_worker)
            self.assertLess(time.monotonic() - started, 4)
            self.assertEqual(output["total_success"], 1)
            self.assertEqual(output["stocks"][0]["code"], "fast")
            self.assertEqual({error["type"] for error in output["errors"]},
                             {"TimeoutError", "ValueError", "WorkerError"})
            self.assertEqual(output["pending_codes"], [])
            self.assertEqual(output["status"], "partial")
            self.assertEqual(json.loads(Path(path).read_text()), output)
            self.assertEqual(list(Path(directory).iterdir()), [Path(path)])

    def test_batch_deadline_includes_queued_stocks(self):
        output = fetcher.run_batch(["slow", "queued"], 120, False, self.output(),
                                   workers=1, stock_timeout=10, batch_timeout=0.5,
                                   worker_target=fake_worker)
        self.assertEqual(len(output["errors"]), 2)
        self.assertIn("before starting", output["errors"][1]["error"])
        self.assertFalse(output["pending_codes"])

    def test_news_timeout_keeps_price_analysis(self):
        output = fetcher.run_batch(["news_slow"], 120, True, self.output(),
                                   stock_timeout=0.7, batch_timeout=2,
                                   worker_target=fake_worker)
        self.assertEqual(output["total_success"], 1)
        self.assertEqual(output["errors"][0]["type"], "NewsTimeoutError")
        self.assertEqual(output["stocks"][0]["news_status"]["status"], "fallback_required")

    def test_output_order_and_duplicate_codes(self):
        output = fetcher.run_batch(["B", "A", "B"], 120, False, self.output(),
                                   stock_timeout=2, batch_timeout=4,
                                   worker_target=fake_worker)
        self.assertEqual([stock["code"] for stock in output["stocks"]], ["B", "A", "B"])
        self.assertEqual(output["status"], "complete")

    def test_no_worker_leaks(self):
        before = {process.pid for process in multiprocessing.active_children()}
        fetcher.run_batch(["slow"], 120, False, self.output(), stock_timeout=0.3,
                          batch_timeout=1, worker_target=fake_worker)
        self.assertEqual({process.pid for process in multiprocessing.active_children()}, before)

    def test_news_diagnostics(self):
        diagnostics = {}
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(fetcher.search_news("index", "sh000001", diagnostics=diagnostics), [])
        self.assertEqual(diagnostics["status"], "fallback_required")
        self.assertEqual([attempt["reason"] for attempt in diagnostics["attempts"]],
                         ["missing_api_key", "missing_api_key"])
        with patch.dict(os.environ, {"TAVILY_API_KEY": "test"}, clear=True), \
                patch.object(fetcher, "_check_source", return_value=False):
            fetcher.search_news("index", "sh000001", diagnostics=diagnostics)
        self.assertEqual(diagnostics["attempts"][0]["reason"], "not_installed")

    def test_news_provider_failure_falls_back(self):
        class TavilyClient:
            def __init__(self, **kwargs):
                pass

            def search(self, **kwargs):
                raise RuntimeError("test provider failure")

        class GoogleSearch:
            def __init__(self, params):
                pass

            def get_dict(self):
                return {"organic_results": [{"title": "news", "link": "https://example.com"}]}

        diagnostics = {}
        with patch.dict(os.environ, {"TAVILY_API_KEY": "test", "SERPAPI_KEY": "test"}, clear=True), \
                patch.object(fetcher, "_check_source", return_value=True), \
                patch.dict("sys.modules", {"tavily": types.SimpleNamespace(TavilyClient=TavilyClient),
                                           "serpapi": types.SimpleNamespace(GoogleSearch=GoogleSearch)}):
            news = fetcher.search_news("index", "sh000001", diagnostics=diagnostics)
        self.assertEqual(news[0]["source"], "serpapi")
        self.assertEqual(diagnostics["status"], "ok")
        self.assertEqual(diagnostics["attempts"][0]["reason"], "request_failed")

    def test_summary_matches_real_indicator_schema(self):
        spec = importlib.util.spec_from_file_location(
            "summary", Path(__file__).parents[1] / "scripts/summarize_stock_data.py")
        summary = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(summary)
        bars = [{"date": f"day-{i}", "close": 100 + i % 7, "volume": 1000 + i}
                for i in range(120)]
        with patch.object(fetcher, "fetch_cn_index", return_value={
                "ohlcv": bars, "name": "上证指数", "source": "fixture", "realtime": {"price": 100}}):
            stock = fetcher.analyze_stock("sh000001")
        data = summary.summarize({"stocks": [stock], "trading_day_status": {"date": "2026-10-10"}})
        indicators = data["stocks"][0]["indicators"]
        self.assertIsInstance(indicators["ma"]["MA5"], float)
        self.assertIsInstance(indicators["rsi"]["RSI12"], float)
        self.assertIsInstance(data["stocks"][0]["trend_score"]["total"], int)
        self.assertNotIn("recent_bars", data["stocks"][0])
        self.assertEqual(data["trading_day_status"]["date"], "2026-10-10")
        self.assertEqual(stock["news_status"]["status"], "not_requested")


if __name__ == "__main__":
    unittest.main()
