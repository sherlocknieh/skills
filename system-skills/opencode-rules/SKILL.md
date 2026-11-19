---
name: opencode-rules
description: "OpenCode 自身的常驻工作规则：改 OpenCode 配置只改真源、不另存副本；执行 root 命令前自检 NoNewPrivs，按 0/1 选 sudo -A 或 sudo-run；以及 opencode 各类任务该交给哪个 skill。适用于修改 ~/.config/opencode 下的配置或全局规则 AGENTS.md、需要提权/密码弹框、排查 opencode 后台服务、以及用户提到 opencode 配置、sudo、NoNewPrivs、service.json 时。关键词：opencode 配置、AGENTS.md、opencode-askpass、opencode-service、opencode-init、NoNewPrivs、sudo -A、sudo-run、提权。"
---

# OpenCode 常驻规则

这些规则针对 OpenCode 自身，不需要用户提醒，命中场景就执行。

## 1. 配置真源

- `~/.config/opencode/` 下的 `opencode.json`、`cli.json`、`plugins/`、askpass 脚本，按 `opencode-init` / `opencode-askpass` 的说明直接改本机文件即可，不要在技能目录里另存配置副本。
- 例外：`service.json` 含认证 token，不进版本控制，重启服务会自动重建。
- 改的是全局规则 `AGENTS.md` 时，注意它是多处分身：真源是仓库根目录的 `AGENTS.md`（`readlink -f ~/.agents/skills/agent-init/SKILL.md` 取上两级），`~/.config/opencode/AGENTS.md` 与 `~/.copilot/copilot-instructions.md` 均为软链，只改真源，不要在任何技能里另存正文副本。安装与修链用常驻技能 `agent-init`（`~/.agents/skills/agent-init/install-agents.sh`），不要靠 `project-init` 或项目安装。

## 2. 提权

执行 root 命令前先自检：

```bash
grep -m1 NoNewPrivs /proc/self/status
```

- 输出 `0`：用 `sudo -A <命令>`。
- 输出 `1`：用 `sudo-run <命令>`。
- 失败时按 `opencode-askpass` 的格式报告，不在提权方式上反复试。

## 3. 细则落点

本技能只放触发条件，具体步骤去对应 skill：

| 场景 | skill |
|---|---|
| sudo/ssh 密码弹框、no new privileges、sudo-run、root 问题报告格式 | `opencode-askpass` |
| opencode 后台服务（systemd）状态、端口、重启与「重启掐断会话」 | `opencode-service` |
| OpenCode 配置初始化、用户设置的细则 | `opencode-init` |

代码与注释规范不属于 OpenCode 自身，见 `code-conventions` 技能。
