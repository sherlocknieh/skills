---
name: system-init
description: 为系统管理项目初始化 AI 协作基线：探测本机发行版、桌面环境、硬件与权限模型，写入或补齐项目 AGENTS.md 的「系统环境」章节，让后续会话不必重复摸索。适用于新项目要做 Linux/Fedora/GNOME 配置与修复、项目缺少系统环境记录、或换机器后需要更新环境事实时。关键词：system-init、系统管理初始化、系统环境、AGENTS.md、发行版、桌面环境、Wayland、硬件、双系统、权限。
---

# system-init

目标是让后续会话在动手改系统前，先知道这台机器的发行版、桌面环境、硬件与约束。没有这份记录，每个会话都要重新探测，还可能把上一台机器的结论套过来。

前置：`system` 场景的技能已链接；需要 root 时按 `opencode-askpass` 处理密码弹框；改任何配置前先备份。

## 1. 探测事实

只记录命令的实际输出，不猜：

```bash
cat /etc/os-release
uname -r
echo "${XDG_CURRENT_DESKTOP:-unknown} ${XDG_SESSION_TYPE:-unknown}"
gnome-shell --version 2>/dev/null
hostnamectl 2>/dev/null | sed -n '1,12p'
```

按项目涉及范围补充：

- 硬件：`lspci -nn | grep -Ei 'vga|network|bluetooth'`、`lsusb`、`cat /sys/class/dmi/id/product_name`
- 双系统与安全启动：`mokutil --sb-state`、`lsblk -f`
- 显示与驱动：Wayland / X11、是否 NVIDIA
- 包管理：`dnf --version`、是否启用 rpmfusion / flatpak
- 权限：`sudo -n true` 是否免密；不免密时按 `opencode-askpass` 走弹框

## 2. 写入 AGENTS.md

- 没有 `AGENTS.md`：新建，只写系统环境相关章节。
- 已有：只补「系统环境」「约束」「验证」，不动其他章节；动手前列出要加的条目。

模板控制在 40 行内：

```markdown
# <项目名>

<一句话：要解决的系统问题、目标机器>

## 系统环境

| 项 | 值 |
| --- | --- |
| 发行版 | ... |
| 内核 | ... |
| 桌面 / 显示协议 | GNOME ... / Wayland |
| 硬件 | ... |
| 包管理 | ... |
| 权限 | sudo 需要密码 / 免密 |

## 约束

- 不能破坏的东西：双系统引导、加密盘、厂商驱动、公司策略等
- 已知不生效或需重登才生效的路径

## 验证

| 改动范围 | 怎么确认生效 |
| --- | --- |

## 记忆落点

已知坑与根因写进 `docs/known-issues.md`；仓库已有文档体系时沿用现有目录。
```

## 3. 为 Copilot 建项目指令链接

Copilot 会读 `AGENTS.md`，但不保证最先加载，可能先读到代码；`.github/copilot-instructions.md` 保证最先注入。为它建一个指向项目 `AGENTS.md` 的符号链接，不复制正文：

```bash
mkdir -p .github
ln -sfn ../AGENTS.md .github/copilot-instructions.md
readlink .github/copilot-instructions.md   # 应为 ../AGENTS.md
```

- 用相对链接，仓库移动或重新 clone 后仍有效。
- 已有指向 `AGENTS.md` 的链接：跳过。
- 已有实体文件：内容与 `AGENTS.md` 相同就替换成链接；不同则先 `cp` 到 `.github/copilot-instructions.md.bak.<日期>` 再替换，并在报告里写出备份路径。
- 只处理 `.github/copilot-instructions.md`，不要动 `*.instructions.md` 等模块化指令。

## 4. 校验与报告

- 环境表每一项都能对应到一条实际命令输出，没有占位符
- 「验证」里的命令能原样执行，写清预期结果
- 报告：新建还是补充了哪些章节、关键环境事实、建议接着执行哪些 `system` 场景技能
