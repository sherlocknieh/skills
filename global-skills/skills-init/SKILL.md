---
name: skills-init
description: 为系统/项目/会话安装技能；首次出现开发、系统管理、学习或创作任务时识别工作类型，项目缺少对应技能则提议临时加载、链接或复制安装。关键词：skills-init、全局技能、按需加载、临时加载、链接安装、复制安装、工作类型、修输入法、蓝牙、GNOME、调试、学习、做视频。
---

# skills-init

职责：管理本仓库技能的安装；根据用户对话里的真实需求识别工作类型，只在该项目缺少对应技能时提议一次加载方式。

分工：全局常驻技能的安装，以及会话中的技能按需加载由本技能负责；`project-init` 负责项目提示词初始化，并在项目安装流程中调用本技能的安装脚本。

## 安装全局常驻技能

用户明确要求安装全局技能、初始化新环境或切换 Agent 时，把整个 `global-skills` 目录链接到 `~/.agents/skills/global-skills`：

```bash
SKILLS_INIT=$(dirname "$(readlink -f ~/.agents/skills/global-skills/skills-init/SKILL.md)")
"$SKILLS_INIT/link-skills.sh" --scenario global
```

`--scenario global` 只产出这一条目录链接，等价于 `ln -sfn <仓库>/global-skills ~/.agents/skills/global-skills`，顺带清掉旧版留下的逐技能散链接。仓库换路径后重跑该命令即可恢复，不要逐个修链接。

仓库根目录需要同时包含 `AGENTS.md` 与 `global-skills/skills-init/`。全局只暴露 `global-skills` 这一层，所以该目录只放常驻技能；全局提示词由 `agents-init` 管理，领域技能按需安装到项目，不要把整个技能仓库链入全局目录。

## 何时判断

- 会话开头用户直接给出具体任务，例如「修一下输入法」「这个 bug 帮忙看下」「讲讲 Transformer」
- 会话中途首次出现明确的领域任务，且此前没有判断过
- 用户明确要求查找或安装全局常驻技能

纯闲聊、只问一句事实、或用户已明确要求直接动手且不需要专项技能时跳过。不要在每个问题上都判断。

## 工作类型映射

| 工作类型 | 场景 | 典型信号 |
| --- | --- | --- |
| 软件开发 | `dev` | 写/改代码、修 bug、调试、测试、重构、脚本、前端后端 |
| 系统管理 | `system` | Fedora/GNOME、输入法、蓝牙、Wi-Fi、驱动、桌面、远程桌面、OpenCode 配置 |
| 学习 | `learn` | 学习、讲解、原理、概念、调研、帮我理解 |
| 内容创作 | `create` | 视频、PDF、文档、封面、语音、字幕、排版 |
| 其他 | `other` | 都不贴切，按名补单个技能 |

拿不准时选最接近的一项，在弹窗里说明理由，不要一次列出全部场景让用户做选择题。

## 先查已装

```bash
ls .agents/skills 2>/dev/null
ls ~/.agents/skills/global-skills 2>/dev/null
```

- 该场景需要的技能已在项目或全局技能目录里：不弹窗，直接继续任务
- 项目没有 `.agents/skills/`，或缺少该场景的关键技能：进入下一步
- 用户本次会话已选过「跳过」：同一场景不再询问

## 定位源仓库

`skills-init` 自身位于仓库 `global-skills/skills-init/`；全局安装时 `~/.agents/skills/global-skills` 是整个目录的符号链接，`readlink -f` 会一路解析回仓库：

```bash
SKILL_DIR=$(dirname "$(readlink -f ~/.agents/skills/global-skills/skills-init/SKILL.md 2>/dev/null || echo "$PWD/global-skills/skills-init/SKILL.md")")
REPO_ROOT=$(dirname "$(dirname "$SKILL_DIR")")
test -f "$REPO_ROOT/global-skills/skills-init/link-skills.sh" && echo "$REPO_ROOT"
```

路径对不上时问用户仓库位置，不要猜。

## 弹窗

用提问工具，标题写「检测到<工作类型>任务，触发 skills-init 技能:」，正文说明推荐场景和将加载的技能，选项：

| 选项 | 行为 |
| --- | --- |
| 临时加载 | 本次会话直接读源仓库里的 `SKILL.md` 并按它执行；不写任何文件 |
| 链接安装 | 项目内在 `.agents/skills/` 逐技能建符号链接，跟随仓库更新；全局安装则是整目录链接；项目仓库内推荐 |
| 复制安装 | 复制成项目自有副本，可修改、可提交；需要固定版本或在项目内改技能时选 |
| 跳过 | 不加载，按通用能力继续；本次会话不再问同一场景 |

在项目仓库内默认推荐「链接安装」；在桌面等非项目目录开的一次性会话，默认推荐「临时加载」，避免往 `$HOME/Desktop` 写 `.agents/`。

## 三种加载

### 临时加载

读取源仓库中该场景每个技能的 `SKILL.md`，按其步骤执行。只读与当前任务直接相关的技能，不要整组读完。

```bash
cat "$REPO_ROOT/system-skills/fedora-ibus-rime-ice/SKILL.md"
```

### 链接安装

```bash
"$REPO_ROOT/global-skills/skills-init/link-skills.sh" --scenario system
```

### 复制安装

```bash
"$REPO_ROOT/global-skills/skills-init/link-skills.sh" --scenario system --copy
```

- 复制只在目标不存在时进行；已有同名目录会跳过并报告，不覆盖
- 复制后仓库更新不会同步到项目；需要更新时先备份项目内改动，再删目录重新复制
- 判断不了该复制还是链接时选链接；复制只用于需要固定或修改技能的场景

## 安装后

- 链接/复制安装完成后，按 `project-init` 第 8 节接续执行对应 init 技能（`dev-init` / `system-init` / `opencode-init`），不要只装链接就结束
- 临时加载不需要 init 技能，直接按技能步骤做
- 只报告本次实际发生的事：场景、加载了哪些技能、用了哪种方式、哪些跳过
