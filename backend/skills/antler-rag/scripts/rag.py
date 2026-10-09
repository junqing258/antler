#!/usr/bin/env python3
"""Small, dependency-free client for the Antler RAG data API (Python 3.9+)."""

import argparse
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from uuid import UUID


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward an API key to a redirect target."""

    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def uuid_arg(value):
    try:
        UUID(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a UUID") from error
    return value


def top_k_arg(value):
    try:
        number = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be an integer from 1 to 20") from error
    if not 1 <= number <= 20:
        raise argparse.ArgumentTypeError("must be an integer from 1 to 20")
    return number


def score_arg(value):
    try:
        number = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a number from 0 to 1") from error
    if not 0 <= number <= 1:
        raise argparse.ArgumentTypeError("must be a number from 0 to 1")
    return number


def parser():
    cli = argparse.ArgumentParser(
        description="Query Antler RAG using an API key from the environment"
    )
    commands = cli.add_subparsers(dest="command", required=True)
    commands.add_parser("list-kbs", help="List knowledge bases (kb:read)")
    for name in ("retrieve", "ask", "graph-search"):
        command = commands.add_parser(name, help="Read the query from stdin")
        command.add_argument("--kb", required=True, type=uuid_arg, help="Knowledge base UUID")
        command.add_argument("--top-k", type=top_k_arg, default=5)
        if name != "ask":
            command.add_argument("--document-ids", nargs="+", type=uuid_arg, metavar="UUID")
        if name == "retrieve":
            command.add_argument("--score-threshold", type=score_arg)
            command.add_argument("--rerank", action="store_true")
    return cli


def base_url():
    value = os.environ.get("ANTLER_RAG_URL", "").strip().rstrip("/")
    if not value:
        raise ValueError(
            "Set ANTLER_RAG_URL to the service origin (for example http://localhost:8001)"
        )
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("ANTLER_RAG_URL must be a service origin without credentials or a path")
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("ANTLER_RAG_URL must use HTTPS outside localhost")
    return value


def request_body(args, cli):
    if args.command == "list-kbs":
        return None
    try:
        raw = getattr(sys.stdin, "buffer", sys.stdin).read()
        query = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    except UnicodeError:
        cli.error("stdin must contain UTF-8 text")
    if not query.strip():
        cli.error("stdin must contain a non-empty question")
    if len(query) > 10_000:
        cli.error("question exceeds the API limit of 10000 characters")
    body = {"knowledge_base_id": args.kb, "top_k": args.top_k}
    body["message" if args.command == "ask" else "query"] = query
    if args.command != "ask" and args.document_ids is not None:
        body["document_ids"] = args.document_ids
    if args.command == "retrieve":
        if args.score_threshold is not None:
            body["score_threshold"] = args.score_threshold
        if args.rerank:
            body["rerank"] = True
    return body


def report(code, message, request_id=None):
    suffix = f" (request_id: {request_id})" if request_id else ""
    print(f"[{code}] {message}{suffix}", file=sys.stderr)
    return 1


def main():
    cli = parser()
    args = cli.parse_args()
    body = request_body(args, cli)
    try:
        origin = base_url()
    except ValueError as error:
        return report("configuration_error", str(error))
    key = os.environ.get("ANTLER_RAG_KEY", "")
    if not key:
        return report("configuration_error", "Set ANTLER_RAG_KEY in the agent process environment")
    endpoints = {
        "list-kbs": "/api/v1/knowledge-bases",
        "retrieve": "/api/v1/retrieve",
        "ask": "/api/v1/agentic-rag",
        "graph-search": "/api/v1/graph/search",
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        origin + endpoints[args.command],
        data=data,
        headers={
            "X-API-Key": key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="GET" if body is None else "POST",
    )
    timeout = 120 if args.command == "ask" else 30
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload = json.load(error)
        except (ValueError, UnicodeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        code = payload.get("code") or (
            "authentication_required" if error.code == 401 else "http_error"
        )
        message = payload.get("message") or f"HTTP {error.code}"
        return report(code, message, payload.get("request_id") or error.headers.get("X-Request-ID"))
    except TimeoutError:
        return report("timeout", f"The request timed out after {timeout} seconds")
    except urllib.error.URLError as error:
        if isinstance(error.reason, (socket.timeout, TimeoutError)):
            return report("timeout", f"The request timed out after {timeout} seconds")
        return report("connection_error", "Could not connect to the Antler RAG service")
    except (ValueError, UnicodeError):
        return report("invalid_response", "The service returned invalid JSON")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
