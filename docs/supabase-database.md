# 自托管 Supabase 数据库连接

本地开发读取根目录 `.env`，线上部署脚本合并 `.env` 与 `.env.deploy`，后者覆盖同名变量。两个文件均不应提交到 Git。

| 用途 | PostgreSQL 地址 | 说明 |
| --- | --- | --- |
| 本地开发 | `192.168.31.120:5432` | 内网 Supavisor 会话池 |
| 阿里云 backend 容器 | `host.docker.internal:15432` | 经宿主机 FRP 转发到内网 `127.0.0.1:5432` |
| 公网事务池映射 | `47.100.210.56:16543` | 对应内网 `6543`，当前项目不使用它执行 Prisma 迁移 |

数据库为 `postgres`，连接池用户名格式为 `postgres.<POOLER_TENANT_ID>`。密码取自自托管 Supabase 配置，并进行 URL 编码。

`https://supabase.xiaoanai.top` 是 HTTP API 地址，不能代替 PostgreSQL 连接地址。公网 HTTP 网关端口为 `18000`，也不用于数据库连接。

本地需要能够访问上述内网主机。线上容器需要 Compose 中的 `host.docker.internal:host-gateway` 映射，以及两端 FRP 持续运行。此次验证发现开发电脑直接访问公网数据库端口会断连，因此本地采用已验证的内网路径。

## 表结构与权限

`pnpm --filter @antler/server db:deploy` 应用现有表结构迁移。开发启动和线上镜像启动也会执行 `prisma migrate deploy`。切换连接不会复制旧数据库的业务数据。

后端业务表启用 RLS，不提供匿名或 authenticated API 角色的访问策略；业务访问由后端 PostgreSQL 管理连接完成。不要为这些表添加公开读取策略。将来改用不绕过 RLS 的数据库账号时，需要同时设计对应访问策略。

## 验证与回退

切换后检查 backend 的数据库查询及 `/health`。线上修改前的环境文件保存在 `/opt/antler/.env.before-supabase-db-*`，权限为 `600`。

回退时恢复该环境文件并重新创建 backend 容器；旧数据库没有被搬迁或删除。不要将含数据库密码的连接串、备份文件或通知渠道凭据提交到 Git。
