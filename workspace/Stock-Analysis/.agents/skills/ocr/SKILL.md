---
name: ocr
description: |
  OCR 图片文字识别技能。用于识别截图、照片、扫描件、中文/英文混排图片、表格截图和用户上传的图片附件，并输出可复制文本或结构化 JSON。

  触发场景：用户要求 OCR、识别图片文字、提取截图文字、读取附件图片、转写照片内容、识别中文图片、从图像中提取列表/表格文本。
allowed-tools:
  - read
  - read_skill_resource
  - bash
metadata:
  trigger: 当用户要求识别图片文字或从附件图片提取文本时触发
  version: "1.0.0"
  last_updated: "2026-06-11"
---

# OCR Skill

## Antler 运行约定

- 当前工作目录为 `Stock-Analysis`，下文命令均从该目录执行。
- Skill 目录为 `.agents/skills/ocr`；无需 Claude 专用环境变量。
- 读取本 Skill 的 `references/`、`scripts/` 等资源时，使用 `read_skill_resource`，传入 `skillId: "ocr"` 和相对资源路径；读取工作目录内文件使用 `read`，写入使用 `write`，执行命令使用 `bash`。

识别图片中的文字，优先处理中文/英文混排截图。若用户直接上传了图片且图像内容在对话中可见，先用视觉能力直接转写；若用户给出本地图片路径、需要批量处理、需要 JSON 输出或需要可复现结果，使用随 Skill 提供的脚本。

## 首选脚本

```bash
uv run --project .agents/skills/ocr .agents/skills/ocr/scripts/ocr_image.py --help
```

如果已安装 Skill 私有虚拟环境，优先使用：

```bash
.agents/skills/ocr/.venv/bin/python .agents/skills/ocr/scripts/ocr_image.py --help
```

### 识别单张图片

```bash
.agents/skills/ocr/.venv/bin/python .agents/skills/ocr/scripts/ocr_image.py /path/to/image.jpg
```

### 输出 JSON

```bash
.agents/skills/ocr/.venv/bin/python .agents/skills/ocr/scripts/ocr_image.py /path/to/image.jpg --format json
```

### 指定语言

```bash
.agents/skills/ocr/.venv/bin/python .agents/skills/ocr/scripts/ocr_image.py /path/to/image.jpg --lang chi_sim+eng
```

## 工作流

1. 确认图片路径存在；若路径在工作区外，只读取，不复制到仓库。
2. 优先使用脚本自动选择本地 OCR 引擎；中文或中文/英文混排图片默认先用 `rapidocr_onnxruntime`，再回退到 `paddleocr`、`easyocr`、`tesseract`、`pytesseract`。
3. 英文图片默认先用 `tesseract` / `pytesseract`，再回退到 `rapidocr_onnxruntime`、`easyocr`、`paddleocr`。
4. 若没有可用 OCR 引擎，但用户上传的图片在对话中可见，直接用视觉能力转写并说明这是视觉识别结果。
5. 输出时保留原始换行；如果是列表或表格截图，可在原始文本后整理成条目或 Markdown 表格。
6. 对金融、合同、医疗、证件等高风险内容，明确提示 OCR 可能有误，关键数字和名称需要人工复核。

## 依赖提示

脚本只强制依赖 Python 标准库和 Pillow。当前仓库已可用 `uv` 时，推荐在 Skill 私有虚拟环境中安装：

```bash
uv venv .agents/skills/ocr/.venv --clear
uv pip install --python .agents/skills/ocr/.venv/bin/python pillow pytesseract rapidocr-onnxruntime
```

若当前环境缺少 OCR 引擎，也可按用途安装一种：

```bash
sudo apt-get install tesseract-ocr tesseract-ocr-chi-sim
pip install pytesseract
```

或：

```bash
pip install rapidocr-onnxruntime
```

中文截图优先推荐 `rapidocr-onnxruntime`；需要对比或处理纯英文扫描件时再使用 `tesseract` / `pytesseract`。