# Antler 邮箱密码登录、注册与找回密码

登录使用 `signInWithPassword({ email, password })`，不发送验证码。注册先调用 `signUp({ email, password })` 设置密码并发送注册验证码，再通过 `verifyOtp({ email, token, type: "signup" })` 确认邮箱并建立会话。重发调用 `resend({ email, type: "signup" })`。确认后的账号后续使用邮箱密码登录。

## 自托管 Supabase 配置

内网主机的 `/home/junqing/opt/supabase/.env` 通过 `COMPOSE_FILE=docker-compose.yml:docker-compose.email-templates.yml` 加载两个配置文件。主文件 `docker-compose.yml` 的 `auth.environment` 设置验证码策略：

```yaml
GOTRUE_MAILER_OTP_LENGTH: "6"
GOTRUE_MAILER_OTP_EXP: "600"
GOTRUE_SMTP_MAX_FREQUENCY: "60s"
```

实际的邮件模板地址与主题在 `docker-compose.email-templates.yml` 的 `auth.environment` 中设置，覆盖文件优先于主配置：

```yaml
GOTRUE_MAILER_TEMPLATES_CONFIRMATION: "http://templates-server:8080/confirmation.html"
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: "http://templates-server:8080/magic_link.html"
GOTRUE_MAILER_TEMPLATES_RECOVERY: "http://templates-server:8080/recovery.html"
GOTRUE_MAILER_SUBJECTS_CONFIRMATION: "xiaoanai 注册验证码"
GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: "xiaoanai 登录验证码"
GOTRUE_MAILER_SUBJECTS_RECOVERY: "Antler 重置密码验证码"
```

`.env` 保留以下设置，SMTP 地址、账号与密码沿用现有配置：

```dotenv
SITE_URL=https://xiaoanai.top/
API_EXTERNAL_URL=https://supabase.xiaoanai.top/auth/v1
SMTP_SENDER_NAME=xiaoanai
ENABLE_EMAIL_SIGNUP=true
DISABLE_SIGNUP=false
ENABLE_EMAIL_AUTOCONFIRM=false
```

注册邮件模板源文件为 `app/public/auth-email-otp.html`，恢复密码模板为 `app/public/auth-email-recovery.html`。分别同步到内网主机的 `volumes/templates/confirmation.html` 和 `volumes/templates/recovery.html`；现有 `templates-server` 服务通过只读目录挂载提供它们。模板使用 `{{ .Token }}`，不包含确认链接。页面使用 confirmation 注册验证码和 recovery 重置密码验证码；magic_link 模板为历史配置，当前页面不调用验证码登录。GoTrue v2.197.0 通过 HTTP(S) 获取模板，不支持直接读取本地文件；先更新内网模板文件，确认 confirmation 和 recovery URL 返回模板 HTML，再重建认证容器：

```sh
cd /home/junqing/opt/supabase
docker compose config --quiet
docker compose up -d --no-deps --wait --wait-timeout 120 auth
```

验证码有效期 10 分钟，重发间隔 60 秒；前端倒计时只改善交互，限制由认证服务执行。网页刷新后倒计时会重置，服务端限制仍然有效。此有效期也影响 Supabase 其他认证邮件令牌。

## 找回密码

登录页点击“忘记密码？”，输入注册邮箱发送验证码，通过验证后设置并确认新密码，成功后返回登录页面。发送与重发均使用 `resetPasswordForEmail(email)`，验证使用 `verifyOtp({ email, token, type: "recovery" })`，更新密码使用 `updateUser({ password })`。更新失败时保留已验证的恢复会话，允许修改密码后重试，无需重复使用一次性验证码。

恢复流程使用独立 Supabase 客户端：不持久化 session、不自动刷新、不解析 URL 登录信息，验证邮件不会使主应用提前进入聊天界面。完成、取消或卸载表单后丢弃内存恢复会话。恢复流程不改变主客户端的登录会话。

上线必须将新增模板同步到上述路径并配置 `GOTRUE_MAILER_TEMPLATES_RECOVERY` 和 `GOTRUE_MAILER_SUBJECTS_RECOVERY`，再重建 auth 容器。默认恢复邮件通常是链接模板；只更新前端不足以启用验证码找回密码。Supabase 托管项目可在 Dashboard 的 Authentication → Email Templates → Reset Password 中使用同一模板。邮件使用 `{{ .Token }}` 占位符，验证码长度和有效期沿用上述服务端配置。

2026-10-20 已修正内网认证服务：原配置虽已指向 `recovery.html`，该文件仍使用 `{{ .ConfirmationURL }}` 输出链接。现已同步仓库中的验证码模板，主题改为“Antler 重置密码验证码”，并重建 auth 容器。容器网络内验证 recovery 模板 HTTP 200、包含 `{{ .Token }}` 且不含链接占位符或超链接，auth 健康接口 HTTP 200；未执行真实邮箱收信验收。原模板和 Compose 覆盖文件备份在 `/home/junqing/opt/supabase/private/before-recovery-otp-20261020-010620/`。后续检查必须同时核对模板 URL 和实际返回的模板内容。

## 验证与回退

本地运行 `pnpm check`、`pnpm test`、`pnpm --filter @antler/app build`。线上核对默认登录页出现邮箱和密码，切换注册后出现“注册并发送验证码”，认证容器能获取模板且包含原始的 `{{ .Token }}` 占位符。注册时设置密码并发送验证码，输入验证码后应进入 Antler；退出后使用邮箱密码登录；同一码不能重复使用。找回密码还需验证：收到恢复验证码、错误或过期验证码不进入设置密码页、两次密码不一致时不能提交、修改成功后旧密码不能登录且新密码可以登录。

更改前备份 Supabase 两个 compose 文件、邮件模板和 `.env`；回退时同时恢复旧前端与认证服务配置，避免验证码页面收到链接邮件。既有账号、会话和业务数据不需要迁移。

参考：[Supabase 邮箱验证码文档](https://supabase.com/docs/guides/auth/auth-email-passwordless)。

## 重复注册时收不到邮件

已验证的邮箱重复调用 `signUp` 时，Supabase 可能返回 HTTP 200 和 `identities: []` 的占位用户，不会实际发送注册邮件。前端检测此结果并提示邮箱已注册，不进入验证码输入步骤。测试注册邮件需要使用未注册的新邮箱；已有邮箱不能通过重复注册来更改登录密码。

恢复接口参考：[发送恢复邮件](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)、[验证恢复验证码](https://supabase.com/docs/reference/javascript/auth-verifyotp)、[更新密码](https://supabase.com/docs/reference/javascript/auth-updateuser)。
