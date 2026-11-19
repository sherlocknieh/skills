---
name: project-init
description: 按项目场景把本仓库中对应的技能符号链接到当前项目的 .agents/skills/，只向会话暴露这个项目真正需要的技能。适用于新项目接入 AI、想减少全局技能数量、切换项目类型（软件开发/系统管理/学习/内容创作/opencode），或项目里的技能链接缺失、指向错误、需要重建时。关键词：project-init、项目技能初始化、按场景暴露技能、链接技能、.agents/skills、符号链接、重建链接。
---

# project-init

职责：从本技能所在的 skills 仓库中，挑出当前场景需要的技能，用符号链接装到项目的 `.agents/skills/`。只建链接，不复制内容；仓库更新后链接自动生效。

全局 `~/.agents/skills/` 只放 `agents-init` 与 `project-init` 这类无处不用的技能，不要把所有技能都装进去。场景技能一律按项目安装。

## 何时执行

- 新项目或首次接入 AI，需要决定暴露哪些技能
- 项目类型变化，需要增删技能
- 项目里 `.agents/skills/` 缺失、链接失效或指向旧路径

已能正常工作时不要重复执行，本技能是幂等的，但没必要每次会话都跑。

## 1. 定位技能仓库

本技能自身位于仓库的 `project-init/` 下。全局安装时 `~/.agents/skills/project-init` 是指向仓库的符号链接，先解析真实路径：

```bash
SKILL_DIR=$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")
REPO_ROOT=$(dirname "$SKILL_DIR")
test -f "$REPO_ROOT/AGENTS.md" && echo "$REPO_ROOT"
```

`~/.agents/skills/project-init` 不存在时，用当前会话实际加载到的 `project-init/SKILL.md` 路径取上一级。仍不确定就问用户仓库位置，不要猜。

仓库根目录必须同时有 `AGENTS.md` 和 `project-init/`。两者都对不上时停下，告诉用户把本仓库 clone 到任意固定目录（如 `~/Projects/skills`），再把 `project-init` 链到 `~/.agents/skills/`。

## 2. 确认目标项目

- 在项目根目录执行；链接目标默认为 `$PWD/.agents/skills`
- 先看现有内容：`ls -la .agents/skills 2>/dev/null`
- 已有链接保留不动，脚本只补缺、改错指向，遇到同名实体目录会跳过而不是删除
- 若项目实际从子目录启动 Agent，确认 `.agents/skills` 应放在仓库根目录

## 3. 询问场景

用提问工具让用户选择，不要自行猜测。可多选，也可以补充单个技能：

| 场景 | 适合的项目 |
| --- | --- |
| `dev` 软件开发 | 写代码、修 bug、做用户脚本 |
| `system` 系统管理 | Linux 桌面、Fedora、GNOME、硬件与外设修复 |
| `learn` 学习 | 以理解概念、跟学一项技能为主 |
| `create` 内容创作 | 视频、PDF、文档等产出型工作 |
| `opencode` OpenCode 自身配置 | 改 `~/.config/opencode`、服务与提权 |
| `other` 其他 | 先装 `find-skills`，再按需补 |

需要看每个场景包含哪些技能时，运行（命令自带源路径解析，不依赖上一条命令的变量）：

```bash
REPO_ROOT=$(dirname "$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")")
"$REPO_ROOT/project-init/link-skills.sh" --list
```

用户拿不准时，按项目实际内容给一项推荐，说明理由，再让用户确认。用户选择「其他」时，先装 `find-skills`，然后问是否要补具体技能。

## 4. 安装

```bash
REPO_ROOT=$(dirname "$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")")
"$REPO_ROOT/project-init/link-skills.sh" --scenario dev
# 多选：--scenario dev --scenario learn
# 场景外补充：--scenario other diagnosing-bugs
```

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

## 5. 校验与报告

```bash
ls -la .agents/skills
readlink -f .agents/skills/dev-init
```

逐项确认链接指向 `$REPO_ROOT/<分组>/<name>`，且 `SKILL.md` 存在。只报告本次实际发生的事：新建了哪些、替换了哪些、跳过了哪些、哪些因实体文件冲突未处理。

不要顺带创建项目 `AGENTS.md`；那一步由 `dev-init` 负责。
