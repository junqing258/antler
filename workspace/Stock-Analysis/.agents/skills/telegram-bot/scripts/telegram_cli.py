#!/usr/bin/env python3
"""Small Telegram Bot CLI for sending group messages."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


API_BASE = "https://api.telegram.org"


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def setup_env() -> None:
    repo_root = Path(__file__).resolve().parents[4]
    load_dotenv(repo_root / ".env")


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing {name} in environment or .env")
    return value


def token() -> str:
    return required_env("TELEGRAM_BOT_TOKEN")


def default_chat_id() -> str:
    return os.environ.get("TELEGRAM_CHAT_ID") or os.environ.get("TELEGRAM_NCHAT_ID") or required_env(
        "TELEGRAM_CHAT_ID"
    )


def masked_token(value: str) -> str:
    if len(value) <= 12:
        return "***"
    return f"{value[:6]}...{value[-4:]}"


def print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def opener() -> urllib.request.OpenerDirector:
    proxy = os.environ.get("TELEGRAM_PROXY")
    if proxy:
        return urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        )
    return urllib.request.build_opener()


def api_post(method: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    url = f"{API_BASE}/bot{token()}/{method}"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with opener().open(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Telegram API HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Telegram API request failed: {exc.reason}") from exc

    result = json.loads(body)
    if not result.get("ok"):
        raise SystemExit(f"Telegram API error: {json.dumps(result, ensure_ascii=False)}")
    return result


def message_text(args: argparse.Namespace) -> str:
    if args.stdin:
        text = sys.stdin.read()
    else:
        text = args.text or ""
    text = text.strip()
    if not text:
        raise SystemExit("Message text is empty")
    return text


def cmd_send(args: argparse.Namespace) -> None:
    setup_env()
    target_chat_id = args.chat_id or default_chat_id()
    text = message_text(args)

    payload: dict[str, Any] = {
        "chat_id": target_chat_id,
        "text": text,
        "disable_web_page_preview": args.disable_web_page_preview,
    }
    if args.parse_mode:
        payload["parse_mode"] = args.parse_mode
    if args.disable_notification:
        payload["disable_notification"] = True
    if args.reply_to_message_id:
        payload["reply_to_message_id"] = args.reply_to_message_id

    if args.dry_run:
        print_json(
            {
                "action": "send",
                "chat_id": target_chat_id,
                "dry_run": True,
                "text_length": len(text),
                "token": masked_token(token()),
            }
        )
        return

    response = api_post("sendMessage", payload, args.timeout)
    message = response["result"]
    print_json(
        {
            "action": "send",
            "chat_id": str(message.get("chat", {}).get("id", target_chat_id)),
            "date": message.get("date"),
            "message_id": message.get("message_id"),
            "text_length": len(text),
        }
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Telegram Bot helper CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    send = subparsers.add_parser("send", help="Send a message to a Telegram chat")
    send.add_argument("text", nargs="?", help="Message text. Omit when using --stdin.")
    send.add_argument("--stdin", action="store_true", help="Read message text from stdin")
    send.add_argument("--chat-id", help="Override TELEGRAM_CHAT_ID")
    send.add_argument("--parse-mode", choices=["Markdown", "MarkdownV2", "HTML"])
    send.add_argument("--disable-web-page-preview", action="store_true")
    send.add_argument("--disable-notification", action="store_true")
    send.add_argument("--reply-to-message-id", type=int)
    send.add_argument("--timeout", type=float, default=30.0)
    send.add_argument("--dry-run", action="store_true", help="Validate config without sending")
    send.set_defaults(func=cmd_send)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
