# Holiday Calendar Usage Guide

## 功能说明

`stock_data_fetcher.py` 现已支持中国节假日和交易日判断功能。

## 数据源优先级

1. **chinese_calendar** (推荐) - 官方节假日 + 调休工作日
   - 安装: `pip install chinese_calendar`
   - 自动更新年度节假日安排
   - 支持周末调休上班

2. **简单工作日判断** (降级方案)
   - 当 `chinese_calendar` 未安装时自动降级
   - 仅判断周一至周五为工作日
   - 不识别法定节假日和调休

## 使用方法

### 1. 查询今日交易日状态

```bash
python3 stock_data_fetcher.py --holiday
```

输出示例:
```json
{
  "check_date": "2026-06-09",
  "is_trading_day": true,
  "weekday": 1,
  "weekday_name": "Tuesday",
  "last_trading_day": "2026-06-08",
  "next_trading_day": "2026-06-11",
  "calendar_source": "available",
  "check_time": "2026-06-09T14:52:35.811081"
}
```

### 2. 查询指定日期

```bash
# 查询元旦
python3 stock_data_fetcher.py --holiday --date 2025-01-01

# 查询劳动节
python3 stock_data_fetcher.py --holiday --date 2025-05-01

# 查询国庆节
python3 stock_data_fetcher.py --holiday --date 2025-10-01
```

### 3. 股票分析时自动包含交易日状态

```bash
python3 stock_data_fetcher.py --stocks "600519" --days 10
```

输出中会包含 `trading_day_status` 字段:
```json
{
  "analysis_date": "2026-06-09",
  "analysis_time": "14:53:55",
  "trading_day_status": {
    "date": "2026-06-09",
    "is_trading_day": true,
    "weekday": 1,
    "weekday_name": "Tuesday",
    "last_trading_day": "2026-06-08",
    "next_trading_day": "2026-06-11"
  },
  "stocks": [...]
}
```

## 测试结果

### 2025年主要节假日测试

| 日期 | 星期 | 是否交易日 | 说明 |
|------|------|-----------|------|
| 2025-01-01 | 周三 | ❌ | 元旦 |
| 2025-02-10 | 周一 | ✅ | 春节前正常工作日 |
| 2025-01-26 | 周日 | ✅ | 春节调休上班 |
| 2025-05-01 | 周四 | ❌ | 劳动节 |
| 2025-05-04 | 周日 | ❌ | 五一假期 |
| 2025-10-01 | 周三 | ❌ | 国庆节 |

## API 接口

### Python 函数调用

```python
from stock_data_fetcher import (
    is_trading_day,
    get_last_trading_day,
    get_next_trading_day,
    get_trading_day_status
)
from datetime import date

# 判断是否为交易日
is_trade = is_trading_day(date(2025, 1, 1))  # False

# 获取最近交易日
last_trade = get_last_trading_day()  # date object

# 获取下一个交易日
next_trade = get_next_trading_day()  # date object

# 获取详细状态
status = get_trading_day_status(date(2025, 5, 1))
# {
#   "date": "2025-05-01",
#   "is_trading_day": False,
#   "weekday": 3,
#   "weekday_name": "Thursday",
#   "last_trading_day": "2025-04-30",
#   "next_trading_day": "2025-05-06"
# }
```

## 注意事项

1. **优雅降级**: 未安装 `chinese_calendar` 时自动降级为简单工作日判断,不会报错
2. **缓存机制**: 节假日判断结果在单次运行中缓存,避免重复计算
3. **时区**: 所有日期使用本地时区
4. **更新**: `chinese_calendar` 库每年更新,建议定期升级:
   ```bash
   pip install --upgrade chinese_calendar
   ```

## 集成建议

### 在交易策略中使用

```python
# 只在交易日执行策略
if is_trading_day():
    execute_trading_strategy()
else:
    log("Today is not a trading day, skipping")

# 获取最近交易日的历史数据
last_trade = get_last_trading_day()
data = fetch_data(last_trade)
```

### 在数据获取中使用

```python
# 如果今天不是交易日,使用最近交易日数据
if not is_trading_day():
    last_trade = get_last_trading_day()
    log(f"Using data from last trading day: {last_trade}")
    data = fetch_data(last_trade)
else:
    data = fetch_data(today)
```
