# Redis 连接配置

独立 Redis 部署在 `192.168.31.120`，容器名为 `antler-redis`，部署目录为 `/home/junqing/services/redis`。

项目使用以下环境文件保存连接信息，真实密码不提交到 Git：

| 文件 | REDIS_URL 地址 | 使用场景 |
| --- | --- | --- |
| `.env` | `192.168.31.120:6379/0` | 本地开发直连内网 |
| `.env.deploy` | `host.docker.internal:16379/0` | 云服务器 Docker 容器经宿主机 FRP 连接 |

连接格式为 `redis://default:<URL 编码后的密码>@<地址>:<端口>/0`。部署脚本合并这两个文件，`.env.deploy` 覆盖同名配置，Compose 将合并结果注入后端容器。当前仅保存连接配置，应用尚未接入 Redis 客户端。

密码和公网连接串可在内网主机查看：

```bash
ssh junqing@192.168.31.120 'cat ~/services/redis/credentials.env'
```

FRP 映射为 `47.100.210.56:16379` → `192.168.31.120` 上的 `127.0.0.1:6379`。公网直连尚未验证通过，疑似需在云安全组放行 TCP 16379；云服务器本机经 FRP 的认证和读写已验证通过。FRP 传输启用 TLS，公网 Redis 客户端到 FRPS 的连接为普通 TCP。

Redis 启用密码、AOF（每秒同步）、RDB 和 `unless-stopped` 重启策略，数据保存在 Docker 卷 `redis_redis-data`。内网主机管理命令：

```bash
cd ~/services/redis
docker compose ps
docker compose logs --tail 100 redis
docker compose up -d
```

FRPC 配置位于内网主机 `~/.config/frp/frpc.toml`，由现有 cron 看护；FRPS 配置位于云服务器 `/etc/frp/frps.toml`，由 `frps.service` 管理。
