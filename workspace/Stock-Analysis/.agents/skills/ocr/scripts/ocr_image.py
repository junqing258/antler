#!/usr/bin/env python3
"""OCR helper for images.

The script discovers locally installed OCR engines and emits either plain text
or JSON. It keeps dependencies optional so the skill can be installed before an
OCR backend is available.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageEnhance, ImageOps
except ModuleNotFoundError as exc:
    raise SystemExit("Missing dependency: Pillow. Install with `pip install pillow`.") from exc


@dataclass
class OCRResult:
    engine: str
    text: str
    blocks: list[dict[str, Any]]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract text from an image with a local OCR engine.")
    parser.add_argument("image", help="Path to an image file.")
    parser.add_argument("--engine", default="auto", choices=["auto", "tesseract", "pytesseract", "rapidocr", "easyocr", "paddleocr"])
    parser.add_argument("--lang", default="chi_sim+eng", help="OCR language hint, e.g. chi_sim+eng or eng.")
    parser.add_argument("--format", default="text", choices=["text", "json"], help="Output format.")
    parser.add_argument("--no-preprocess", action="store_true", help="Pass the original image to OCR without preprocessing.")
    return parser.parse_args()


def preprocess_image(image_path: Path) -> Path:
    image = Image.open(image_path)
    image = ImageOps.exif_transpose(image)
    image = image.convert("L")

    width, height = image.size
    if max(width, height) < 1800:
        scale = min(3, max(2, int(1800 / max(width, height)) + 1))
        image = image.resize((width * scale, height * scale), Image.Resampling.LANCZOS)

    image = ImageOps.autocontrast(image)
    image = ImageEnhance.Contrast(image).enhance(1.7)
    image = ImageEnhance.Sharpness(image).enhance(1.4)

    tmp = tempfile.NamedTemporaryFile(prefix="ocr_", suffix=".png", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    image.save(tmp_path)
    return tmp_path


def normalize_text(lines: list[str]) -> str:
    return "\n".join(line.strip() for line in lines if line and line.strip()).strip()


def is_chinese_lang(lang: str) -> bool:
    normalized = lang.lower().replace("-", "_")
    return any(marker in normalized for marker in ("chi", "ch_sim", "zh", "cn", "chinese"))


def box_stats(box: Any) -> tuple[float, float, float]:
    points = [(float(point[0]), float(point[1])) for point in box]
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), sum(ys) / len(ys), max(ys) - min(ys)


def text_from_blocks(blocks: list[dict[str, Any]]) -> str:
    sortable: list[tuple[float, float, float, str]] = []
    for block in blocks:
        text = str(block.get("text", "")).strip()
        box = block.get("box")
        if not text or not box:
            continue
        left, center_y, height = box_stats(box)
        sortable.append((center_y, left, max(height, 1.0), text))

    if not sortable:
        return ""

    sortable.sort(key=lambda item: (item[0], item[1]))
    median_height = sorted(item[2] for item in sortable)[len(sortable) // 2]
    threshold = max(28.0, median_height * 0.65)

    lines: list[list[tuple[float, str]]] = []
    line_centers: list[float] = []
    for center_y, left, _height, text in sortable:
        if not lines or abs(center_y - line_centers[-1]) > threshold:
            lines.append([(left, text)])
            line_centers.append(center_y)
            continue
        lines[-1].append((left, text))
        line_centers[-1] = (line_centers[-1] + center_y) / 2

    ordered_lines = [" ".join(text for _left, text in sorted(line, key=lambda item: item[0])) for line in lines]
    return normalize_text(ordered_lines)


def run_tesseract(image_path: Path, lang: str) -> OCRResult:
    if not shutil.which("tesseract"):
        raise RuntimeError("tesseract executable not found")

    cmd = ["tesseract", str(image_path), "stdout", "-l", lang, "--psm", "6"]
    completed = subprocess.run(cmd, check=True, text=True, capture_output=True)
    return OCRResult(engine="tesseract", text=completed.stdout.strip(), blocks=[])


def run_pytesseract(image_path: Path, lang: str) -> OCRResult:
    try:
        import pytesseract
    except ModuleNotFoundError as exc:
        raise RuntimeError("pytesseract module not installed") from exc

    image = Image.open(image_path)
    text = pytesseract.image_to_string(image, lang=lang, config="--psm 6")
    return OCRResult(engine="pytesseract", text=text.strip(), blocks=[])


def run_rapidocr(image_path: Path, lang: str) -> OCRResult:
    del lang
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ModuleNotFoundError as exc:
        raise RuntimeError("rapidocr_onnxruntime module not installed") from exc

    engine = RapidOCR()
    results, _ = engine(str(image_path))
    blocks: list[dict[str, Any]] = []
    lines: list[str] = []
    for item in results or []:
        box, text, confidence = item
        blocks.append({"text": str(text), "confidence": float(confidence), "box": box})
    return OCRResult(engine="rapidocr", text=text_from_blocks(blocks) or normalize_text(lines), blocks=blocks)


def run_easyocr(image_path: Path, lang: str) -> OCRResult:
    try:
        import easyocr
    except ModuleNotFoundError as exc:
        raise RuntimeError("easyocr module not installed") from exc

    languages = ["ch_sim", "en"] if is_chinese_lang(lang) else ["en"]
    reader = easyocr.Reader(languages, gpu=False)
    results = reader.readtext(str(image_path), detail=1, paragraph=False)
    blocks: list[dict[str, Any]] = []
    lines: list[str] = []
    for box, text, confidence in results:
        blocks.append({"text": str(text), "confidence": float(confidence), "box": box})
    return OCRResult(engine="easyocr", text=text_from_blocks(blocks) or normalize_text(lines), blocks=blocks)


def run_paddleocr(image_path: Path, lang: str) -> OCRResult:
    try:
        from paddleocr import PaddleOCR
    except ModuleNotFoundError as exc:
        raise RuntimeError("paddleocr module not installed") from exc

    paddle_lang = "ch" if is_chinese_lang(lang) else "en"
    engine = PaddleOCR(use_angle_cls=True, lang=paddle_lang, show_log=False)
    results = engine.ocr(str(image_path), cls=True)
    blocks: list[dict[str, Any]] = []
    lines: list[str] = []
    for page in results or []:
        for line in page or []:
            box = line[0]
            text, confidence = line[1]
            blocks.append({"text": str(text), "confidence": float(confidence), "box": box})
    return OCRResult(engine="paddleocr", text=text_from_blocks(blocks) or normalize_text(lines), blocks=blocks)


ENGINES = {
    "tesseract": run_tesseract,
    "pytesseract": run_pytesseract,
    "rapidocr": run_rapidocr,
    "easyocr": run_easyocr,
    "paddleocr": run_paddleocr,
}


def run_ocr(image_path: Path, lang: str, engine: str) -> OCRResult:
    if engine == "auto" and is_chinese_lang(lang):
        order = ["rapidocr", "paddleocr", "easyocr", "tesseract", "pytesseract"]
    elif engine == "auto":
        order = ["tesseract", "pytesseract", "rapidocr", "easyocr", "paddleocr"]
    else:
        order = [engine]
    errors: list[str] = []

    for name in order:
        try:
            result = ENGINES[name](image_path, lang)
            if result.text:
                return result
            errors.append(f"{name}: no text returned")
        except Exception as exc:  # noqa: BLE001 - report all backend discovery failures.
            errors.append(f"{name}: {exc}")

    hint = (
        "No usable OCR engine found. Install one backend, for example:\n"
        "  sudo apt-get install tesseract-ocr tesseract-ocr-chi-sim\n"
        "  pip install pytesseract\n"
        "or:\n"
        "  pip install rapidocr-onnxruntime"
    )
    raise RuntimeError(hint + "\n\nTried:\n- " + "\n- ".join(errors))


def main() -> int:
    args = parse_args()
    original = Path(args.image).expanduser()
    if not original.exists():
        print(f"Image not found: {original}", file=sys.stderr)
        return 2
    if not original.is_file():
        print(f"Not a file: {original}", file=sys.stderr)
        return 2

    work_image = original
    tmp_image: Path | None = None
    if not args.no_preprocess:
        tmp_image = preprocess_image(original)
        work_image = tmp_image

    try:
        result = run_ocr(work_image, args.lang, args.engine)
    except Exception as exc:  # noqa: BLE001 - user-facing CLI error.
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        if tmp_image:
            try:
                tmp_image.unlink()
            except OSError:
                pass

    if args.format == "json":
        print(json.dumps({
            "image": str(original),
            "engine": result.engine,
            "text": result.text,
            "blocks": result.blocks,
        }, ensure_ascii=False, indent=2))
    else:
        print(result.text)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
