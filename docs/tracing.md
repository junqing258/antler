# OpenObserve traces

后端使用 OpenTelemetry SDK 创建 span，经主机共享 Vector 的 OTLP/HTTP 接收端转发到 OpenObserve。Vector 的配置和写入令牌在独立仓库 `../observability` 管理；业务容器不持有 OpenObserve 凭据。

```text
HTTP 请求 → agent.run → gen_ai.chat / tool.execute
                  ↓ OTLP protobuf
共享 Vector → OpenObserve default/antler_traces
```

## 启用

可直接在仓库根目录 `.env` 中配置；默认部署脚本会合并可选的 `.env.deploy`，后者覆盖同名变量。修改配置后需重新创建远端后端容器；镜像中已有 tracing 代码时无需重新构建镜像。

```dotenv
ANTLER_TRACING_ENABLED=true
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://host.docker.internal:4318/v1/traces
OTEL_SERVICE_NAME=antler-backend
OTEL_SERVICE_VERSION=your-image-tag
ANTLER_TRACE_SAMPLE_RATIO=1
```

Antler Compose 通过 `extra_hosts: ["host.docker.internal:host-gateway"]` 注入宿主机地址。共享 Vector 使用同一映射，在启动时解析实际 IPv4 网关并绑定 4317/4318；`VECTOR_OTLP_BIND=host-gateway`，无需写死网关 IP。接收端继续只绑定内部网关地址。Docker 网关配置变化后，应重新创建这两个容器，刷新映射。导出器固定使用 OTLP protobuf，不能改为普通 JSON。默认不启用 traces；设 `ANTLER_TRACING_ENABLED=false` 或 `OTEL_SDK_DISABLED=true` 可关闭，重启生效。

以上导出地址适用于带有上述映射的远端 Docker 部署（Docker Engine 20.10+）。`127.0.0.1` 和 `127.1.0.1` 都是后端容器自身的回环地址，无法访问宿主机 Vector。本机开发需配置本机可达的 OTLP 地址，或关闭 tracing。`OTEL_SERVICE_VERSION` 应填写实际部署版本，例如 `aaf4adb`，避免保留示例占位值。

采样比例为 0–1，默认 1；遵循上游 W3C `traceparent` 的采样决策。SDK 异步批量导出，队列有上限，导出失败不阻塞模型或 HTTP 请求，进程正常退出时尝试刷新。队列溢出、强制退出或转发故障可能丢失 spans。

## 采集范围

- HTTP：方法、路由模板、状态码、请求 ID、耗时；响应返回 `x-trace-id`，支持上游 `traceparent` / `tracestate`。`/health` 健康检查不创建或导出 span（含 GET、HEAD 和查询参数），请求日志继续保留。
- Agent Run：Run ID、结束状态、错误代码。Run、模型和工具 span 均携带 `gen_ai.conversation.id`（业务 conversationId）、`gen_ai.agent.name=antler` 和 `antler.project.id`，支持跨轮会话聚合。异步执行保留创建请求的父 span，Run 可持续到 HTTP 响应结束之后。
- 模型：每个 Agent turn 一个 `gen_ai.chat`，包含供应商、模型、结束原因和 token 用量。
- 工具：每次工具执行的名称、耗时与错误状态。

不采集提示词、模型正文、思考正文、工具参数和结果、请求体、认证头、查询参数、异常消息。元数据中的已知密钥通过现有 SecretGuard 脱敏。模型 SDK 的内部重试和 `/compact` 内部摘要调用暂未单独创建 span；RAG 服务当前只接入日志，尚未贯通其内部 trace。

请求完成日志增加 `trace_id` / `span_id`；Run 完成日志增加 `run_id` 及相同 trace 上下文，Vector 提取为独立字段。

健康检查过滤上线后，实测 GET、HEAD（含查询参数）四次 `/health` 请求均不返回 trace ID，OpenObserve 中无对应新增 span；普通接口继续入库，健康检查日志保留。上线前已入库的健康检查 traces 保留。

## 查看

访问 <http://47.100.210.56:55080/web/>，选择组织 `default`，在 Traces 中选择 `antler_traces`、服务 `antler-backend`，时间选择最近 15 分钟。日志位于 `antler_backend`，可用 `trace_id` 查找同一链路；Run span 的 `antler.run.id` 可对应业务运行记录。

## 当前部署与回滚

线上已通过完整部署更新至 `antler/backend:aaf4adb`。初次 tracing 接入使用 `antler/backend:69c7fdf-otel-nohealth-20261016`，在原生产镜像 `69c7fdf` 上加入五项锁定的 OpenTelemetry 直接依赖和六个 tracing 相关编译文件，未发布当前主分支的其他业务功能，也未更改数据库结构或前端。可审查的源代码保存在本机隔离工作树 `/private/tmp/antler-tracing-release`，tracing 初始补丁材料位于服务器 `/opt/antler/releases/traces-69c7fdf`，健康检查过滤补丁位于 `/opt/antler/releases/traces-exclude-health`，仅替换请求 tracing 模块。

2026-10-16 验收：线上后端和 RAG 健康；真实 400/404 请求的上游 trace ID、父 span、响应头和日志字段一致；包含 Run、两次模型和一次工具事件的测试链路一次批量写入五个 span，父子关系完整，测试正文、参数和结果未入库。模型/工具验证使用模拟事件，未调用付费模型。生产基线全部 124 项后端测试通过，新增 tracing 测试 10 项通过（包括健康检查过滤），Vector 配置测试 10 项通过。当前开发分支 `pnpm check` 通过，全量测试另有一项既有的环境测试被本机 `.env` 中的调度配置影响。

仅回滚健康检查过滤时，可恢复 `/opt/antler/releases/traces-exclude-health/.env.before` 到 `/opt/antler/.env` 并重新启动后端。完整回滚 traces 可在服务器 `/opt/antler` 恢复部署前备份的 `.env.before-traces`，执行 `docker compose -f docker-compose.remote.yml up -d backend`；原镜像保留。Vector 原配置与私有环境保存在 `/opt/observability/private/before-traces/`。本地目前没有 `.env.deploy`；当前启用配置保存在 `.env`。若需区分本机开发与远端部署，可将远端 tracing 设置放入 `.env.deploy`，覆盖基础配置。

参考：[Vector OTLP source](https://vector.dev/docs/reference/configuration/sources/opentelemetry/)、[Vector OTLP sink](https://vector.dev/docs/reference/configuration/sinks/opentelemetry/)、[OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/instrumentation/)。Vector 的 traces 支持仍属实验性质，升级时需验证父子关系和多 span 批量转发。

2026-10-16 host-gateway 切换验收：Antler 和 Vector 均通过 Docker 的 `host.docker.internal` 映射获取宿主机地址，Vector 仅绑定实际内部网关；新请求 trace 与关联日志入库正常，`/health` 继续不生成 trace。配置备份：`/opt/observability/private/before-host-gateway-20261016231015`。网关变化后重新创建两个容器以刷新映射。

## LLM 会话

在支持 Sessions 的 OpenObserve 版本中，进入 AI → Monitor → Sessions，使用 Stream 模式选择 `antler_traces`，并选择包含新运行的时间范围。同一业务会话每轮使用独立 Trace，通过 `gen_ai.conversation.id` 聚合；工具和模型 span 使用相同会话 ID。有归属用户时，Run、模型和工具 span 同时上报经 SecretGuard 脱敏的 `user.id`，用于 Sessions 用户显示与搜索；无用户的运行不伪造用户。无需新增数据库字段或导出配置。此变更需构建并部署后端后生效，历史 span 不会自动补齐会话 ID。

当前仅导出元数据，可用于会话关联及 Token、耗时和错误分析；没有导出提问和回复，因此不支持完整正文回放、首条消息展示或按正文搜索。费用需要在 OpenObserve Model Pricing 中配置对应模型的价格。
