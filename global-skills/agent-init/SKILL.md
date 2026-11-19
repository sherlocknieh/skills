---
name: agent-init
description: 安装或修复当前 Agent 的全局指令文件，把本仓库根目录的 AGENTS.md 以符号链接装到对应路径：OpenCode 的 ~/.config/opencode/AGENTS.md、Claude Code 的 ~/.claude/CLAUDE.md、Codex 的 ~/.codex/AGENTS.md、Copilot 的 ~/.copilot/copilot-instructions.md。适用于新机器初始化、首次接入某个 Agent、换 Agent、全局规则缺失或链接失效、用户说装全局 AGENTS.md / 全局提示词 / 全局规则 / 修 AGENTS.md 时。关键词：agent-init、agents-init、安装全局 AGENTS.md、全局规则、全局提示词、copilot-instructions、CLAUDE.md、符号链接、重建链接、换 Agent、新机器。
---

# agent-init

职责只有一件：把仓库根目录的 `AGENTS.md` 装成当前 Agent 的全局指令文件。

- 只处理当前 Agent 对应的路径；不要一次改多个，除非用户明确要求。
- 只建符号链接，不复制正文；仓库更新后链接自动生效。
- 不装技能、不改项目 `.agents/skills/`，那是 `project-init` 的职责。

## 何时执行

- 新机器、首次接入某个 Agent
- 换了 Agent，或 Agent 的全局指令路径变化
- 当前 Agent 读不到全局规则
- 全局指令文件缺失、指向错误、或不再是链接
- 用户说「安装全局 AGENTS.md / 全局提示词 / 全局规则」

已经能正常工作时不要执行；脚本幂等，但没必要每次会话都跑。

## 1. 定位仓库根

本技能位于仓库的 `global-skills/agent-init/` 下。全局安装时 `~/.agents/skills/agent-init` 是指向该目录的符号链接：

```bash
AGENT_INIT=$(dirname "$(readlink -f ~/.agents/skills/agent-init/SKILL.md)")
REPO_ROOT=$(dirname "$(dirname "$AGENT_INIT")")
test -f "$REPO_ROOT/AGENTS.md" && test -f "$AGENT_INIT/install-agents.sh" && echo "$REPO_ROOT"
```

`~/.agents/skills/agent-init` 不存在时，用当前会话实际加载到的 `global-skills/agent-init/SKILL.md` 路径取上两级。仍不确定就问用户仓库位置，不要猜。

## 2. 确认目标 Agent

只处理当前 Agent 对应的那一行；路径不确定时查该 Agent 的文档，不要猜：

| Agent | 全局指令路径 |
| --- | --- |
| OpenCode | `~/.config/opencode/AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| Copilot | `~/.copilot/copilot-instructions.md` |

先看映射或预演动作：

```bash
"$AGENT_INIT/install-agents.sh" --list
"$AGENT_INIT/install-agents.sh" --agent opencode --dry-run
```

## 3. 安装

```bash
"$AGENT_INIT/install-agents.sh" --agent opencode
# 多个 Agent：--agent opencode --agent copilot
# 全部：--agent all
# 未列出的 Agent：--target <它的全局指令文件路径>
```

脚本按以下规则处理目标，重复执行安全：

- 目标不存在：直接建链接。
- 已是正确链接：跳过，不重写。
- 是链接但指向别处：直接改指到源。
- 是实体文件但内容相同：替换成链接。
- 是实体文件且内容不同：先 `cp` 到 `<target>.bak.<日期>`，再替换，并在报告里写出备份路径。
- 目标所在目录不存在：先创建目录。

## 4. 校验与报告

```bash
readlink -f ~/.config/opencode/AGENTS.md   # 必须指向 $REPO_ROOT/AGENTS.md
diff -q "$REPO_ROOT/AGENTS.md" ~/.config/opencode/AGENTS.md
```

`diff` 无输出即通过。只报告本次实际发生的事：新建链接、改指向、替换实体文件、跳过；替换了实体文件的，列出备份路径。

Copilot 用 `copilot-instructions.md` 而不是 `~/.copilot/instructions/*.instructions.md`，后者是模块化指令，同一份正文放两处会重复注入。

全局规则只维护仓库根目录的 `AGENTS.md` 真源，不要在任何技能里另存正文副本。
