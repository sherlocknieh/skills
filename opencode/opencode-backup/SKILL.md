---
name: opencode-backup
description: "OpenCode 配置备份/恢复：备份和恢复 OpenCode 的配置文件、全局规则与用户设置"
---

# 备份配置文件

把 OpenCode 最新配置备份到当前技能目录下, 只保留最近两个版本备份: old/new
每当 OpenCode 配置文件发生变化时, 把 new 备份覆盖 old 备份, 并把最新配置文件备份到 new 备份中

**排除含凭据的文件**：本仓库是公开的，`service.json`（服务认证 token）、任何含密码/token/key 的文件都不备份，也不加入版本控制（已在 `.gitignore` 里）。配置的「生成方式」由 `opencode-init` / `opencode-askpass` / `opencode-service` 负责还原，备份只作快照对照。

备份清单：`AGENTS.md`、`cli.json`、`opencode.json`、`ssh-askpass.sh`、`sudo-askpass.sh`、`plugins/askpass.js`、`cny-cost/`。

# 恢复配置文件

检查当前技能目录下备份的配置文件和实际配置文件的差异, 并提示用户选择哪些恢复到实际配置文件