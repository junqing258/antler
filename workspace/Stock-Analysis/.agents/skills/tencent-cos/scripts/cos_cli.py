#!/usr/bin/env python3
"""Small Tencent COS CLI for this workspace."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


DEFAULT_SCHEME = "https"


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


def make_client() -> Any:
    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency: cos-python-sdk-v5. Install with: pip install -U cos-python-sdk-v5"
        ) from exc

    repo_root = Path(__file__).resolve().parents[4]
    load_dotenv(repo_root / ".env")

    secret_id = os.environ.get("COS_SECRET_ID")
    secret_key = os.environ.get("COS_SECRET_KEY")
    if not secret_id or not secret_key:
        raise SystemExit("Missing COS_SECRET_ID or COS_SECRET_KEY in environment or .env")

    region_value = required_env("COS_REGION")
    token = os.environ.get("COS_TOKEN") or None
    scheme = os.environ.get("COS_SCHEME", DEFAULT_SCHEME)
    endpoint = os.environ.get("COS_ENDPOINT") or None

    config = CosConfig(
        Region=region_value,
        SecretId=secret_id,
        SecretKey=secret_key,
        Token=token,
        Endpoint=endpoint,
        Scheme=scheme,
    )
    return CosS3Client(config)


def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing {name} in environment or .env")
    return value


def bucket() -> str:
    bucket_value = required_env("COS_BUCKET")
    app_id = os.environ.get("COS_APP_ID")
    if app_id and "-" not in bucket_value:
        return f"{bucket_value}-{app_id}"
    return bucket_value


def region() -> str:
    return required_env("COS_REGION")


def public_url(key: str) -> str:
    normalized = key.lstrip("/")
    endpoint = os.environ.get("COS_ENDPOINT")
    if endpoint:
        return f"https://{endpoint.rstrip('/')}/{normalized}"
    return f"https://{bucket()}.cos.{region()}.myqcloud.com/{normalized}"


def print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def cmd_upload(args: argparse.Namespace) -> None:
    local_path = Path(args.local_path).expanduser()
    if not local_path.is_file():
        raise SystemExit(f"Local file not found: {local_path}")

    key = args.key.lstrip("/")
    client = make_client()
    response = client.upload_file(
        Bucket=bucket(),
        LocalFilePath=str(local_path),
        Key=key,
        PartSize=args.part_size,
        MAXThread=args.max_thread,
        EnableMD5=args.enable_md5,
    )
    print_json(
        {
            "action": "upload",
            "bucket": bucket(),
            "region": region(),
            "key": key,
            "etag": response.get("ETag"),
            "url": public_url(key),
        }
    )


def cmd_list(args: argparse.Namespace) -> None:
    prefix = args.prefix.lstrip("/")
    client = make_client()
    marker = ""
    objects: list[dict[str, Any]] = []

    while True:
        response = client.list_objects(
            Bucket=bucket(),
            Prefix=prefix,
            Marker=marker,
            MaxKeys=args.max_keys,
        )
        for item in response.get("Contents", []):
            objects.append(
                {
                    "key": item.get("Key"),
                    "size": int(item.get("Size", 0)),
                    "last_modified": item.get("LastModified"),
                    "etag": item.get("ETag"),
                    "url": public_url(item.get("Key", "")),
                }
            )

        if response.get("IsTruncated") == "true" and response.get("NextMarker"):
            marker = response["NextMarker"]
            if args.once:
                break
            continue
        break

    print_json(
        {
            "action": "list",
            "bucket": bucket(),
            "region": region(),
            "prefix": prefix,
            "count": len(objects),
            "objects": objects,
        }
    )


def cmd_download(args: argparse.Namespace) -> None:
    key = args.key.lstrip("/")
    local_path = Path(args.local_path).expanduser()
    local_path.parent.mkdir(parents=True, exist_ok=True)

    client = make_client()
    response = client.get_object(Bucket=bucket(), Key=key)
    response["Body"].get_stream_to_file(str(local_path))
    print_json(
        {
            "action": "download",
            "bucket": bucket(),
            "region": region(),
            "key": key,
            "local_path": str(local_path),
        }
    )


def cmd_delete(args: argparse.Namespace) -> None:
    key = args.key.lstrip("/")
    client = make_client()
    client.delete_object(Bucket=bucket(), Key=key)
    print_json(
        {
            "action": "delete",
            "bucket": bucket(),
            "region": region(),
            "key": key,
        }
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Tencent COS helper CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    upload = subparsers.add_parser("upload", help="Upload a local file to COS")
    upload.add_argument("local_path")
    upload.add_argument("key")
    upload.add_argument("--part-size", type=int, default=10)
    upload.add_argument("--max-thread", type=int, default=10)
    upload.add_argument("--enable-md5", action="store_true")
    upload.set_defaults(func=cmd_upload)

    list_cmd = subparsers.add_parser("list", help="List COS objects by prefix")
    list_cmd.add_argument("prefix", nargs="?", default="")
    list_cmd.add_argument("--max-keys", type=int, default=1000)
    list_cmd.add_argument("--once", action="store_true", help="Only fetch the first page")
    list_cmd.set_defaults(func=cmd_list)

    download = subparsers.add_parser("download", help="Download a COS object")
    download.add_argument("key")
    download.add_argument("local_path")
    download.set_defaults(func=cmd_download)

    delete = subparsers.add_parser("delete", help="Delete a COS object")
    delete.add_argument("key")
    delete.set_defaults(func=cmd_delete)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
