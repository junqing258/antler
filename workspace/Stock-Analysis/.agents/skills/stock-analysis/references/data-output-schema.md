# 行情 JSON 字段约定

`stock_data_fetcher.py` 保留原有指标结构，新增 `schema_version: "1.1"`、进度和新闻诊断。

| 路径 | 含义 |
| --- | --- |
| `status` | `running` 正在获取或被外层中断；`complete` 所有任务完成；`partial` 有失败/超时，详见 `errors`。新闻需兜底也可能出现在已完成任务中 |
| `stocks` | 已获取的行情分析，按输入顺序排列；每次完成行情即保存，不等新闻 |
| `errors[]` | `code`、`error`、`type`；`TimeoutError` 为行情超时，`NewsTimeoutError` 为行情已获取但新闻超时 |
| `pending_codes` | 尚未完成的输入代码；正常收尾（包括失败）时为空；中断后可用于恢复 |
| `total_requested` / `total_success` | 请求数 / 已有行情分析数，新闻超时不扣除成功行情 |
| `trading_day_status` | 顶层共享交易日信息，初始化阶段可能为 `null` |
| `data_sources` | 库是否可用与 Key 是否配置，初始化阶段可能为空对象 |
| `stocks[].code` / `name` / `market` | 显示代码、名称、市场；指数的 `code` 可能是中文名，重试使用 `errors[].code` 或 `pending_codes` 的原始输入 |
| `stocks[].realtime.price` / `change_pct` | 现价 / 涨跌幅；价格可能由最近 K 线降级补齐 |
| `stocks[].indicators.ma` | `MA5`、`MA10`、`MA20`、`MA60`、`alignment`、`alignment_detail` |
| `stocks[].indicators.macd` | `DIF`、`DEA`、`hist`、`signal` |
| `stocks[].indicators.rsi` | `RSI6`、`RSI12`、`RSI24`、`zone`；没有 `value` 字段 |
| `stocks[].indicators.volume` | `vol_ratio`、`trend` |
| `stocks[].indicators.bias` | `bias_ma5`、`bias_ma10`、`bias_ma20` |
| `stocks[].indicators.support` | `support_ma5`、`support_ma10` |
| `stocks[].trend_score` | `total`、`breakdown`、`signal`、`signal_cn`、`hard_rules_triggered`；没有 `score` 字段 |
| `stocks[].news` | 始终为数组，可能为空；空数组不能证明近期无重大消息 |
| `stocks[].news_status.status` | `not_requested` 未请求、`pending` 正在搜索、`ok` 已获取、`fallback_required` 需兜底 |
| `stocks[].news_status.attempts` | 每个 provider 的失败原因：`missing_api_key`、`not_installed`、`request_failed`、`empty_results` 或超时类型 |
| `stocks[].fetch_time` | 本次行情计算时间，不能替代 K 线交易日期 |
| `stocks[].recent_bars` | 最近 10 根 K 线/净值，按需读取；摘要脚本省略 |

指标值可能为 `null`（历史不足），部分指标键可能缺失。用 `.get()` 读取并标记数据不足，不默认填 0。新闻搜索缺库、缺 Key、失败或超时后，使用 Antler 的 `web_search`；工具同样不可用时注明“消息面未获取”。

脚本退出并输出 JSON 后仍需检查 `errors` 和成功数；`complete` 表示数据任务结束，不保证新闻已经获取。摘要脚本兼容旧报告中缺少进度和 `news_status` 的情况。
