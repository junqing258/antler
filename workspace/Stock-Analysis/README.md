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

Antler 每次 bash 调用都会从项目设置的工作目录启动，上一条命令的 `cd` 不会保留。这里已经是 `workspace/Stock-Analysis`，无需再执行 `cd Stock-Analysis` 或 `mkdir Stock-Analysis`。首次运行先校验位置：

```bash
pwd
test -f .agents/skills/stock-analysis/pyproject.toml
```

若校验失败，检查 Projects 中的工作目录是否指向现有项目根目录；不要移动文件来修补层级。在外部终端运行时，先切换到已确认的项目绝对路径；在 Antler 中临时切换时，`cd` 必须与目标命令放在同一次 bash 调用中。

## Python 依赖

需要 Python 3.10+ 和 `uv`。以下命令均从本工作目录执行，按需初始化依赖：

```bash
uv sync --project .agents/skills/stock-analysis
uv sync --project .agents/skills/ocr
uv sync --project .agents/skills/tencent-cos
```

股票分析的增强数据源可通过 `uv sync --project .agents/skills/stock-analysis --extra enhanced` 安装。HTML 报告无需 Python 依赖。原目录的虚拟环境与缓存未复制，`uv` 会在本目录下重新创建虚拟环境。

依赖就绪后获取行情（新闻在分析流程中单独搜索）：

```bash
uv run --no-sync --project .agents/skills/stock-analysis \
  .agents/skills/stock-analysis/references/stock_data_fetcher.py \
  --stocks "sh000001,sz399001" --workers 2 \
  --stock-timeout 35 --batch-timeout 45 --output reports/indices.json

uv run --no-sync --project .agents/skills/stock-analysis \
  .agents/skills/stock-analysis/scripts/summarize_stock_data.py reports/indices.json
```

`--output` 在启动及每只行情完成时原子保存完整 JSON，stdout 仅返回文件路径、成功数与错误摘要。不传 `--output` 时仍输出完整 JSON。单只请求默认限时 35 秒、整批数据获取默认限时 45 秒，超时会保留成功行情并列出失败代码。多只标的分成独立命令的小批次执行；依赖初始化不计入数据获取时限，需单独完成。

不要把 stdout 重定向到同一个检查点文件，也不要用 `2>/dev/null` 丢弃错误。读取 `status`、`errors` 和 `pending_codes` 判断是否完成，仅重试未获取行情的代码。需要脚本搜索新闻时安装 enhanced 依赖并加 `--news`，新闻超时会保留行情。

字段说明见 [data-output-schema.md](.agents/skills/stock-analysis/references/data-output-schema.md)：RSI 数值为 `RSI6/RSI12/RSI24`，均线为 `MA5/MA10/MA20/MA60`，总评分为 `trend_score.total`。新闻空数组的原因见 `news_status`，不能将缺 Key 或搜索失败解读为“近期无重大消息”。

## 本地配置

首次配置由用户在本地编辑器或自己的终端中参考 `.env.example` 创建 `.env`，按需填写数据源和 COS 配置。Antler 工具保护这两个文件，分析流程无需读取、移动或覆盖它们。脚本优先使用进程环境变量，并自动加载本工作目录的配置。原项目的私密配置未复制。

`secret_access_denied` 表示配置文件访问被拒绝，不是路径或依赖故障；取消相关文件操作，保留现有配置，并继续正常的数据获取与报告任务。需要诊断时读取行情 JSON 的 `data_sources` / `news_status`，不要输出密钥。

Antler 的 `web_search` 工具还需要在服务端环境中配置 `TAVILY_API_KEY`；本目录的 `.env` 供 Python 脚本使用。工具不可用且数据脚本未获取新闻时，分析会注明消息面未获取。

`.env`、虚拟环境、缓存、报告和回测信号不会进入 Git。
