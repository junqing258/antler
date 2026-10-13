# 定时任务

后端提供持久化的单机调度 API，支持 node-cron v4 的五/六字段表达式，以及 `delay:毫秒` 一次性任务。Cron 使用服务器本地时区；部署时可设置 `TZ=Asia/Shanghai`。

## 启动和迁移

从仓库根目录运行：

```bash
pnpm --filter @antler/server db:generate
pnpm --filter @antler/server db:deploy
pnpm dev:server
```

`dev:server` 的 predev 会自动应用迁移。生产部署在启动服务前执行 `db:deploy`。迁移新增 `scheduled_tasks` 和 `task_executions`；启动时自动加载启用的任务，并将进程中断留下的 `running` 执行记录标记为失败。应用关闭先停止调度、取消待重试的等待、等待当前执行完成，再断开数据库。

## 会话首页入口

会话首页左侧导航的“定时任务”打开任务管理面板；手机端从导航抽屉进入。支持创建助手任务（周期 Cron 或延迟执行一次）、查看所有调度任务、启停、立即执行、删除及查看执行历史。面板中新建的任务通过 `taskService.create` 提交给助手，使用后端默认工作区与模型。历史列表打开期间会自动刷新。

## API

| 方法 | 路径 | 结果 |
| --- | --- | --- |
| POST | `/api/scheduled-tasks` | 创建，201 |
| GET | `/api/scheduled-tasks` | 列表，支持 enabled/type/page/limit |
| GET / PUT / DELETE | `/api/scheduled-tasks/:id` | 查询 / 更新 / 删除；删除返回 204 |
| POST | `/api/scheduled-tasks/:id/enable` | 启用 |
| POST | `/api/scheduled-tasks/:id/disable` | 禁用并停止后续重试 |
| POST | `/api/scheduled-tasks/:id/trigger` | 立即受理，202 + executionId/status |
| GET | `/api/scheduled-tasks/:id/executions` | 历史，支持 limit，返回 executions 数组 |
| GET | `/api/task-executions/:executionId` | 执行详情 |

无效输入返回 400，不存在返回 404，同一任务执行中再次触发返回 409。数据库故障返回 500。禁用的任务手动触发返回 400，且不创建执行记录。列表默认每页 20 条，历史默认 50 条，limit 最大 200。

```bash
# 配置 ANTLER_ACCESS_TOKEN 后，所有调度 API 使用现有的 x-antler-token 鉴权。
curl http://localhost:3210/api/scheduled-tasks \
  -H "x-antler-token: $ANTLER_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"健康检查","type":"http","schedule":"*/5 * * * *","payload":{"url":"http://localhost:3210/health","method":"GET"},"timeout":5000}'
```

任务字段：name、description、type、schedule、enabled、payload、retryCount、retryDelay、timeout。type 创建后不可修改。retryCount 为 0–10，默认 0；retryDelay 默认 60000ms；timeout 默认 300000ms。timeout、retryDelay 和 delay 均受 Node 定时器上限 2147483647ms（约 24.8 天）约束；timeout 必须大于零。

## 执行类型

- `http`：payload 包含 url、method（GET/POST/PUT/DELETE/PATCH），可选 headers、body、expectedStatus；GET 不支持 body。默认成功状态码为 200/201/204，JSON、文本和空响应均可记录。
- `service`：payload 包含 service、method、可选 args 数组。应用注册了 `taskService.create` 和 `taskService.get`。例如 `{"service":"taskService","method":"create","args":["检查工作区并汇总待办事项"]}`；create 的执行成功表示 Agent run 已创建，Agent 后续状态通过现有 run API 查询。
- `script`：payload 包含 command，可选 args 字符串数组、cwd、env 字符串映射。使用 spawn 数组参数，不隐式启动 shell；stdout/stderr 各截断至 64Ki 字符。

Script 默认拒绝执行；仅 `ANTLER_SCHEDULER_ENABLE_SCRIPT=true` 开启。子进程只继承 PATH 和 payload.env。对外提供服务时，应配置 `ANTLER_ACCESS_TOKEN` 或外部认证网关。任务 payload 会持久化，避免在其中存储密钥。

新增 service 方法时，在 `createApp` 的 serviceRegistry 中显式暴露对象自身的方法；不允许调用继承方法或 constructor。执行器在 args 末尾附加 AbortSignal。可取消的服务应监听 signal；不可取消的方法超时后仍可能继续运行，应设置 retryCount: 0，避免与重试重叠。

## 一次性任务和重试

创建 `delay:` 任务时持久化 runAt；重启使用剩余时间，已到期任务立即执行。禁用保留 runAt，重新启用仍按原时刻调度。执行前原子清空 runAt，执行结束后禁用：领取后崩溃不会重放，采用 at-most-once 语义。

仅修改名称、payload 等字段不会重置倒计时；显式更新 schedule（即使值相同）会重置 runAt。已领取的一次性任务需要修改 schedule 后重新启用。手动触发一次性任务会立即领取并消费它。执行中改期，旧执行不会禁用新计划；新计划到期时等待旧执行释放锁。

每次重试单独保存执行记录和 retryAttempt。重试读取最新配置，禁用、删除或关闭应用后停止重试。执行状态为 running、succeeded、failed 或 timeout；lastExecutedAt 在整轮执行（含重试）结束后更新。

本版本不支持多实例协调、任务依赖或可视化管理 UI。

## 验证

```bash
pnpm check
pnpm test
# 单独运行调度器测试
pnpm --filter @antler/server exec vitest run test/scheduler
```

测试覆盖本地 HTTP、服务和脚本执行、超时、重试、输入校验、执行锁、一次性任务重启/改期、API 状态码、迁移、鉴权及数据库断开前的优雅关闭。
