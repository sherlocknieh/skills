---
name: project-init
description: 一条入口完成三件事：把仓库的 AGENTS.md 符号链接到当前 Agent 的全局指令路径（原 agents-init），把 global 场景的常驻技能链到 ~/.agents/skills/，以及按项目场景把技能链到项目的 .agents/skills/，只向会话暴露这个项目真正需要的技能。适用于安装或修复全局提示词、安装或调整全局常驻技能、新机器初始化、换 Agent、链接失效重建；也适用于新项目接入 AI、想减少全局技能数量、切换项目类型（软件开发/系统管理/学习/内容创作）。关键词：project-init、agents-init、安装全局 AGENTS.md、全局规则、全局技能、global-skills、常驻技能、copilot-instructions、符号链接、重建链接、项目技能初始化、按场景暴露技能、.agents/skills、接续执行 dev-init、system-init、opencode-init。
---

# project-init

职责：一个入口，三种作用范围。

- **全局规则**：把仓库的 `AGENTS.md` 符号链接到当前 Agent 的全局指令路径（已合并原 `agents-init`）。
- **全局技能**：把 `global` 场景的常驻技能链到 `~/.agents/skills/`。
- **项目技能**：按项目场景把本仓库的技能链到 `<project>/.agents/skills/`。

只建链接，不复制内容；仓库更新后链接自动生效。

全局 `~/.agents/skills/` 只放 `global` 场景那两条常驻技能（安装入口 + 技能发现入口），不要把所有技能都装进去。其余场景技能一律按项目安装。

## 何时执行

- 安装、修复或重建全局规则（原 `agents-init` 的场景）
- 安装或调整全局常驻技能（`global` 场景）
- 确认当前 Agent 读不到全局规则，或链接缺失、指向错误
- 新机器、换了 Agent、仓库路径变更
- 新项目或首次接入 AI，需要决定暴露哪些技能
- 项目类型变化，需要增删技能
- 项目里 `.agents/skills/` 缺失、链接失效或指向旧路径

已经能正常工作时不要执行，也不必每次会话都检查。本技能是幂等的，但没必要每次会话都跑。

## 1. 定位技能仓库（三种范围共用）

本技能自身位于仓库的 `global-skills/project-init/` 下。全局安装时 `~/.agents/skills/project-init` 是指向该目录的符号链接，先解析真实路径：

```bash
SKILL_DIR=$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")
REPO_ROOT=$(dirname "$(dirname "$SKILL_DIR")")
test -f "$REPO_ROOT/AGENTS.md" && test -d "$REPO_ROOT/global-skills/project-init" && echo "$REPO_ROOT"
```

`~/.agents/skills/project-init` 不存在时，用当前会话实际加载到的 `global-skills/project-init/SKILL.md` 路径取上两级。仍不确定就问用户仓库位置，不要猜。

仓库根目录必须同时有 `AGENTS.md` 和 `global-skills/project-init/`。两者都对不上时停下，告诉用户把本仓库 clone 到任意固定目录（如 `~/Projects/skills`），再把 `global-skills/project-init` 链到 `~/.agents/skills/project-init`。

## 2. 确认作用范围

用提问工具让用户选择，不要自行猜测：

| 范围 | 做什么 |
| --- | --- |
| `global` 全局 | 把 `AGENTS.md` 链到全局指令路径，并把 `global` 场景技能链到 `~/.agents/skills/` |
| `project` 项目技能 | 只按场景把技能链到项目 `.agents/skills/` |
| `both` 两者 | 先装全局规则与全局技能，再装项目技能 |

判断依据：用户说“初始化这个项目”归 `project`；说“装全局提示词 / 修 AGENTS.md / 换机器”归 `global`；新机器第一次接入通常选 `both`。

## 3. 全局：安装 AGENTS.md

只处理当前 Agent 对应的那一行；路径不确定时查该 Agent 的文档，不要猜：

| Agent | 全局指令路径 |
| --- | --- |
| OpenCode | `~/.config/opencode/AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| Copilot | `~/.copilot/copilot-instructions.md` |

先看映射或预演动作（命令自带源路径解析，不依赖上一条命令的变量）：

```bash
PROJECT_INIT=$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")
"$PROJECT_INIT/install-agents.sh" --list
"$PROJECT_INIT/install-agents.sh" --agent opencode --dry-run
```

执行：

```bash
PROJECT_INIT=$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")
"$PROJECT_INIT/install-agents.sh" --agent opencode
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

完成判据：

```bash
PROJECT_INIT=$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")
REPO_ROOT=$(dirname "$(dirname "$PROJECT_INIT")")
readlink -f ~/.config/opencode/AGENTS.md   # 必须指向 $REPO_ROOT/AGENTS.md
diff -q "$REPO_ROOT/AGENTS.md" ~/.config/opencode/AGENTS.md
```

`diff` 无输出即通过。只报告本次实际发生的事：新建链接、改指向、替换实体文件、跳过；替换了实体文件的，列出备份路径。

Copilot 用 `copilot-instructions.md` 而不是 `~/.copilot/instructions/*.instructions.md`，后者是模块化指令，同一份正文放两处会重复注入。

`global` 范围除了规则，还要装全局技能：

```bash
PROJECT_INIT=$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")
"$PROJECT_INIT/link-skills.sh" --scenario global
```

只选 `global` 场景且没给 `--dest` 时，脚本默认写到 `~/.agents/skills`。装完 `readlink -f ~/.agents/skills/<name>` 应指向 `$REPO_ROOT/global-skills/<name>`。

## 4. 确认目标项目

- 在项目根目录执行；项目场景的链接目标默认为 `$PWD/.agents/skills`（`global` 场景默认 `~/.agents/skills`）
- 先看现有内容：`ls -la .agents/skills 2>/dev/null`
- 已有链接保留不动，脚本只补缺、改错指向，遇到同名实体目录会跳过而不是删除
- 若项目实际从子目录启动 Agent，确认 `.agents/skills` 应放在仓库根目录

## 5. 询问场景

用提问工具让用户选择，不要自行猜测。可多选，也可以补充单个技能：

| 场景 | 适合的项目 |
| --- | --- |
| `global` 全局技能 | 常驻所有会话的安装入口与跨项目元技能；一般只在初始化机器时装一次 |
| `dev` 软件开发 | 写代码、修 bug、做用户脚本 |
| `system` 系统管理 | Linux 桌面、Fedora、GNOME、硬件与外设修复、OpenCode 自身配置 |
| `learn` 学习 | 以理解概念、跟学一项技能为主 |
| `create` 内容创作 | 视频、PDF、文档等产出型工作 |
| `other` 其他 | 先确认 `find-skills` 已在全局，再按需补 |

需要看每个场景包含哪些技能时，运行（命令自带源路径解析，不依赖上一条命令的变量）：

```bash
PROJECT_INIT=$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")
"$PROJECT_INIT/link-skills.sh" --list
```

用户拿不准时，按项目实际内容给一项推荐，说明理由，再让用户确认。用户选择「其他」时，确认 `find-skills` 已随 `global` 场景装好，然后问是否要补具体技能。

选中 `dev` 或 `system` 时，安装后会在第 7 节接续执行 `dev-init` / `system-init`；若本次目标包含 OpenCode 配置，再按需执行 `opencode-init`。用户不需要时当场确认跳过。

## 6. 安装

```bash
PROJECT_INIT=$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")
"$PROJECT_INIT/link-skills.sh" --scenario dev
# 多选：--scenario dev --scenario learn
# 全局技能（装到 ~/.agents/skills）：--scenario global
# 场景外补充：--scenario other diagnosing-bugs
```

- 只选 `global` 场景且没给 `--dest` 时，目标自动为 `~/.agents/skills`
- `--dest` 只用于目标不在项目根目录的 `.agents/skills` 时
- `--dry-run` 先看将执行的动作
- 脚本用绝对路径建链接；不要改成相对路径，也不要改成复制，否则仓库更新不会同步
- 目标同名实体目录不会被覆盖；先和用户确认其中内容，再决定是否备份移走

安装后每个技能应满足 `.agents/skills/<name>/SKILL.md` 可读。

不再需要的技能，确认是符号链接且指向本仓库后再删：

```bash
readlink -f .agents/skills/<name>
rm .agents/skills/<name>
```

不要删仓库里的技能目录，也不要删别处的同名链接。

## 7. 按场景执行 init 技能

技能链接完成后，按本次选中的场景与项目目标接续执行对应的 init 技能，不要只装链接就结束：

| 触发条件 | init 技能 | 作用 |
| --- | --- | --- |
| 选中 `dev` | `dev-init` | 探测仓库事实，创建或补齐项目根目录 `AGENTS.md` |
| 选中 `system` | `system-init` | 探测系统环境，写入或补齐 `AGENTS.md` 的系统环境章节 |
| 本次目标包含 OpenCode 配置 | `opencode-init` | 初始化 OpenCode 配置与用户设置 |
| 其余情况 | 无 | 没有对应的 init 技能，跳过并说明 |

执行方式：读取该技能目录下的 `SKILL.md`，按其步骤继续执行；此时它的前置条件已经满足（技能已链接、仓库根已解析）。

- `dev-init`：在项目根目录运行，只补缺失章节。项目 `AGENTS.md` 由它创建，project-init 自己不要创建。
- `system-init`：同样只补缺失章节；与 `dev-init` 同时执行时先跑 `dev-init` 建基础结构，再由 `system-init` 补「系统环境」等章节，不要重写已有内容。
- `opencode-init`：属于全局配置，动手前先按 `opencode-rules` 备份 `~/.config/opencode`。全局规则 `AGENTS.md` 由本技能的 `install-agents.sh` 以软链安装，只维护仓库真源，不要在任何技能里另存正文副本。
- 用户明确说只要「装技能链接」时跳过本节，并在报告里写明跳过。
- init 技能失败时不要回滚已建好的链接；报告失败原因与下一步。

## 8. 校验与报告

```bash
ls -la .agents/skills
readlink -f .agents/skills/dev-init
```

逐项确认链接指向 `$REPO_ROOT/<分组>/<name>`，且 `SKILL.md` 存在。只报告本次实际发生的事：新建了哪些、替换了哪些、跳过了哪些、哪些因实体文件冲突未处理。

不要顺带创建项目 `AGENTS.md`；那一步由 `dev-init` 负责。
