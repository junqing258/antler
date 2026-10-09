# Stock-Analysis 工作目录

股票、基金和指数分析工作目录。Skills 迁自 `/Users/zhangjunqing/financial/Stock-Analysis/.claude/skills`，保留脚本、参考资料、Python 依赖声明及锁文件，并适配 Antler 的 `.agents/skills` 加载方式。

## 在 Antler 中使用

1. 启动后在前端 **Projects** 列表中选择自动加载的 `Stock-Analysis` 项目（本地路径为 `workspace/Stock-Analysis`）。已有同目录项目会直接复用，重复启动不会创建副本或覆盖项目设置。
2. 将 Skill 模式设为自动，或选择需要的 Skill。
3. 输入任务，例如“分析上证指数和 TSLA，并生成 HTML 报告”。

| Skill | 用途 |
| --- | --- |
| `stock-analysis` | 股票、基金、指数行情、技术指标及 Markdown 决策看板 |
| `html-report-generator` | 将分析结果生成移动端适配的 HTML 报告 |
| `ocr` | 从图片中提取文字 |
| `tencent-cos` | 上传、下载和管理腾讯云 COS 对象 |

报告输出到 `reports/`。需要发布报告时，在任务中明确指定。

## Python 依赖

需要 Python 3.10+ 和 `uv`。以下命令均从本工作目录执行，按需初始化依赖：

```bash
uv sync --project .agents/skills/stock-analysis
uv sync --project .agents/skills/ocr
uv sync --project .agents/skills/tencent-cos
```

股票分析的增强数据源可通过 `uv sync --project .agents/skills/stock-analysis --extra enhanced` 安装。HTML 报告无需 Python 依赖。原目录的虚拟环境与缓存未复制，`uv` 会在本目录下重新创建虚拟环境。

例如获取行情和新闻：

```bash
uv run --project .agents/skills/stock-analysis \
  .agents/skills/stock-analysis/references/stock_data_fetcher.py \
  --stocks "sh000001,TSLA" --news
```

## 本地配置

复制 `.env.example` 为本工作目录的 `.env`，按需填写数据源和 COS 配置。脚本优先使用进程环境变量，并读取本工作目录的 `.env`。原项目的私密 `.env` 未复制。

Antler 的 `web_search` 工具还需要在服务端环境中配置 `TAVILY_API_KEY`；本目录的 `.env` 供 Python 脚本使用。工具不可用且数据脚本未获取新闻时，分析会注明消息面未获取。

`.env`、虚拟环境、缓存、报告和回测信号不会进入 Git。
