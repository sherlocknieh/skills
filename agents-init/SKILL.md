---
name: agents-init
description: 用符号链接把仓库里的 AGENTS.md 安装到当前 Agent 的全局指令路径，并校验链接。适用于用户要求安装或修复全局提示词、新机器初始化、换了 Agent、AGENTS.md 缺失或链接失效后重建。关键词：agents-init、安装全局 AGENTS.md、符号链接、重建链接。
---

# agents-init

职责：把 `~/.agents/skills/AGENTS.md` 符号链接到当前 Agent 的全局指令路径。skills 目录由用户自己安装，本技能不 clone、不复制内容。

## 何时执行

- 用户要求安装、修复或重建全局规则
- 确认当前 Agent 读不到全局规则，或链接缺失、指向错误
- 新机器、换了 Agent、仓库路径变更

已经能正常读到全局规则时不要执行，也不必每次会话都检查。

## 1. 确认源

```bash
test -f ~/.agents/skills/AGENTS.md && readlink -f ~/.agents/skills/AGENTS.md
```

源不存在就停下，告诉用户先把这个仓库放到 `~/.agents/skills`（技能装在别处时，用技能目录的上一级替换）。源存在才继续。

## 2. 建链接

只处理当前 Agent 对应的那一行：

| Agent | 全局指令路径 |
| --- | --- |
| OpenCode | `~/.config/opencode/AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| Copilot | `~/.copilot/copilot-instructions.md` |

路径不确定时查该 Agent 的文档，不要猜。未列出的 Agent 用它的全局指令文件路径。

```bash
TARGET=~/.config/opencode/AGENTS.md   # 换成当前 Agent 的路径
mkdir -p "$(dirname "$TARGET")"
ln -sfn ~/.agents/skills/AGENTS.md "$TARGET"
```

- 目标不存在：直接建链接。
- 已是正确链接：本步结束，不重写。
- 是链接但指向别处：直接改指到源。
- 是实体文件但内容相同：替换成链接。
- 是实体文件且内容不同：先 `cp "$TARGET" "$TARGET.bak.$(date +%F)"`，再替换，并在报告里写出备份路径。

完成判据：`readlink -f "$TARGET"` 指向 `~/.agents/skills/AGENTS.md`。

## 3. 校验与报告

```bash
diff -q ~/.agents/skills/AGENTS.md "$TARGET"
```

`diff` 无输出即通过。只报告本次实际发生的事：新建链接、改指向、替换实体文件、跳过；替换了实体文件的，列出备份路径。

Copilot 用 `copilot-instructions.md` 而不是 `~/.copilot/instructions/*.instructions.md`，后者是模块化指令，同一份正文放两处会重复注入；细节见 `opencode-init` 第 3 节。
