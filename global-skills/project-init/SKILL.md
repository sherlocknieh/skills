---
name: project-init
description: 按场景为项目安装技能，并初始化项目级 AGENTS.md 与 .github/copilot-instructions.md。适用于新项目接入、切换项目类型、项目技能链接失效或重建。用户在对话中（非开头）只说「提交」时也触发本技能：这通常意味着项目还没初始化自动提交规则，先弹窗说明这一点并询问是否现在初始化，再继续原本要做的事。关键词：提交、project-init、项目初始化、项目技能、符号链接、复制安装、.agents/skills、AGENTS.md、copilot-instructions、接续执行 dev-init、frontend-init、system-init、opencode-init。全局技能安装由 skills-init 负责，全局 AGENTS.md 由 agents-init 安装。
---

# project-init

职责：初始化项目范围内的技能与提示词。

- **项目技能**：按项目场景调用 `skills-init` 的安装脚本，把本仓库的技能链接或复制到 `<project>/.agents/skills/`。
- **项目提示词**：`<project>/AGENTS.md` 缺失时，`dev` 场景由 `dev-init` 原样复制 `AGENTS-example.md`（保留占位符作为弹窗入口），其他场景建最小骨架；已有则只补缺失的「自动提交」小节；并建 `.github/copilot-instructions.md` 指向它的符号链接。

技能默认建链接，不复制内容；需要固定版本或在项目内修改技能时才用 `--copy` 复制。仓库更新后链接自动生效。项目 `AGENTS.md` 只在缺失时建一次，本技能不改已有正文，只补「自动提交」约定；`dev` 场景的正文由 `dev-init` 复制模板后逐步弹窗补齐。

全局常驻技能由 `skills-init` 安装；全局 `AGENTS.md` 由 `agents-init` 管理。本技能只处理项目级技能与 `AGENTS.md`。

分工：显式初始化、切换场景、重建链接用 `project-init`；会话中按需识别工作类型并提议加载用 `skills-init`。本技能只在用户明确要初始化时执行，不代做按需探测。

## 何时执行

- 新项目或首次接入 AI，需要决定项目应加载哪些技能
- 项目类型变化，需要增删项目技能
- 全局 `AGENTS.md` 缺失或链接失效时，先执行 `agents-init` 技能，不要用本技能补装
- 项目缺少 `AGENTS.md` 或 `.github/copilot-instructions.md`
- 项目里 `.agents/skills/` 缺失、链接失效或指向旧路径
- 用户在对话中（非开头）只说「提交」时，按下一节处理

会话中首次出现领域任务的按需加载提议由 `skills-init` 负责，不要用本技能代做。

已经能正常工作时不要执行，也不必每次会话都检查。本技能是幂等的，但没必要每次会话都跑。

## 用户手动说「提交」

当当前仓库是本 skills 仓库（仓库根目录同时存在 `global-skills/` 与 `global-skills/project-init/`）时，始终只提交现有工作区改动：跳过初始化检查与弹窗，不新增初始化文件。

手动说「提交」，说明项目还没有自动提交约定。先确认：

```bash
grep -q '^## 自动提交' AGENTS.md && echo rules-ok
test -d .agents/skills && echo skills-ok
```

两条都命中时不要重复初始化，直接按既有约定提交。未命中时弹窗，标题写「检测到「提交」，触发 project-init 技能:」，正文两句话：

> 本项目还未初始化，所以没有自动提交规则。要现在初始化吗？

选项：「现在初始化（project）」/「跳过」。选跳过就只做本次提交，不要补任何文件。

## 1. 定位技能仓库

本技能自身位于仓库的 `global-skills/project-init/` 下。全局安装时 `~/.agents/skills/global-skills` 是整个目录的符号链接，先解析真实路径：

```bash
SKILL_DIR=$(dirname "$(readlink -f ~/.agents/skills/global-skills/project-init/SKILL.md)")
REPO_ROOT=$(dirname "$(dirname "$SKILL_DIR")")
test -f "$REPO_ROOT/AGENTS.md" && test -f "$REPO_ROOT/global-skills/skills-init/link-skills.sh" && echo "$REPO_ROOT"
```

`~/.agents/skills/global-skills/project-init` 不存在时，用当前会话实际加载到的 `global-skills/project-init/SKILL.md` 路径取上两级。仍不确定就问用户仓库位置，不要猜。

仓库根目录必须同时有 `AGENTS.md` 和 `global-skills/skills-init/link-skills.sh`。两者都对不上时停下，告诉用户把本仓库 clone 到任意固定目录（如 `~/Projects/skills`），再把 `global-skills` 整目录链到 `~/.agents/skills/global-skills`。

## 2. 项目范围与职责边界

本技能只处理当前项目。用户要安装全局常驻技能时，交由 `skills-init`；需要安装或修复全局 `AGENTS.md` 时，交由 `agents-init`。不要在本技能里代做全局安装。

## 3. 项目技能安装入口

项目技能的场景选择与项目初始化由本技能编排；实际链接或复制通过 `skills-init` 的脚本完成：

```bash
SKILLS_INIT=$(dirname "$(readlink -f ~/.agents/skills/global-skills/skills-init/SKILL.md)")
"$SKILLS_INIT/link-skills.sh" --scenario dev
```

目标默认为当前项目的 `.agents/skills`。全局场景与 `~/.agents/skills/global-skills` 由 `skills-init` 单独管理。

## 4. 确认目标项目

- 在项目根目录执行；项目场景的链接目标默认为 `$PWD/.agents/skills`
- 先看现有内容：`ls -la .agents/skills 2>/dev/null`
- 已有链接保留不动，脚本只补缺、改错指向，遇到同名实体目录会跳过而不是删除
- 若项目实际从子目录启动 Agent，确认 `.agents/skills` 应放在仓库根目录

## 5. 询问场景

用提问工具让用户选择，不要自行猜测。可多选，也可以补充单个技能。按项目当前主要做什么来选：

| 场景 | 简要说明 |
| --- | --- |
| `dev` 软件开发 | 写代码、修 bug、做用户脚本的流程技能：代码规范、项目初始化、前端工程初始化、调试、复盘、向导、交接 |
| `system` 系统管理 | Linux 桌面与硬件排障：Fedora、GNOME、蓝牙、输入法、远程桌面，以及 OpenCode 自身配置 |
| `learn` 学习 | 以理解概念、跟学一项技能为主：系统讲解、资料调研、要求重讲、追问式压测 |
| `create` 内容创作 | 视频、PDF、文档等产出型工作：视频制作、PDF 书签整理、资料调研、写作规范 |
| `other` 其他 | 以上都不贴切时选，不装默认技能；按名补装项目需要的技能，如 `other diagnosing-bugs` |

需要看每个场景包含哪些技能时，运行（命令自带源路径解析，不依赖上一条命令的变量）：

```bash
SKILLS_INIT=$(dirname "$(readlink -f ~/.agents/skills/global-skills/skills-init/SKILL.md)")
"$SKILLS_INIT/link-skills.sh" --list
```

用户拿不准时，按项目实际内容给一项推荐，说明理由，再让用户确认。用户选择「其他」时，只问要补哪些具体技能；没给技能名就说明 other 不装默认技能，让用户补。

选中 `dev` 或 `system` 时，安装后会在第 7 节接续执行 `dev-init` / `system-init`；若本次目标包含 OpenCode 配置，再按需执行 `opencode-init`。用户不需要时当场确认跳过。

## 6. 安装

```bash
SKILLS_INIT=$(dirname "$(readlink -f ~/.agents/skills/global-skills/skills-init/SKILL.md)")
"$SKILLS_INIT/link-skills.sh" --scenario dev
# 多选：--scenario dev --scenario learn
# 复制安装（目标已有同名目录时跳过）：--scenario dev --copy
# 场景外补充：--scenario other diagnosing-bugs
```

- `--dest` 只用于目标不在项目根目录的 `.agents/skills` 时
- `--dry-run` 先看将执行的动作
- 默认用绝对路径建链接；不要改成相对路径，否则仓库移动后会断
- `--copy` 复制成项目自有副本，可修改、可提交；目标已存在（含符号链接）时跳过，不覆盖。复制后仓库更新不会同步，需要更新时先备份项目内改动，再删目录重新复制
- 目标同名实体目录不会被覆盖；先和用户确认其中内容，再决定是否备份移走
- `other` 不装默认技能，必须跟技能名；只给 `--scenario other` 会报错退出

安装后每个技能应满足 `.agents/skills/<name>/SKILL.md` 可读。

不再需要的技能，确认是符号链接且指向本仓库后再删：

```bash
readlink -f .agents/skills/<name>
rm .agents/skills/<name>
```

不要删仓库里的技能目录，也不要删别处的同名链接。

## 7. 建项目 AGENTS.md 与 Copilot 链接

在项目根目录执行。先确定 `AGENTS.md`，再建链接；已有 `AGENTS.md` 不覆盖。

`AGENTS.md` 缺失时按场景处理：

- `dev` 场景：本步不建文件、也不建 Copilot 链接，第 8 步 `dev-init` 会原样复制模板并建链接。提前建会留下指向不存在文件的悬空链接。
- 其他场景：建下面的最小骨架，再建链接。

```bash
# 第 5 步确认的场景，多个用空格分隔，如 "dev learn"
SCENARIOS="dev"

if [[ ! -e AGENTS.md && ! -L AGENTS.md ]] && [[ " $SCENARIOS " != *" dev "* ]]; then
  cat > AGENTS.md <<'EOF'
# <项目名>

<一句话：项目是什么、主要技术栈>

## 文档地图

| 要知道什么 | 去哪里 |
| --- | --- |
| 目录与文件职责 | 待补充 |

## 开工流程

1. 定位：按文档地图找承载文件，不改无关文件。
2. 实现：取最小完整集，能改现有代码就不新增实体。
3. 验证：跑本项目的构建 / 测试命令，如实报告结果。
4. 记录：重要结论写回本文件或 `docs/`。

## 自动提交

每轮对话后自行提交（除非只有单处微小细节改动）；仓库有发布脚本时走发布脚本，不先单独 `git commit`；发现会话外改动先弹框问用户如何提交。
EOF
fi

# 已有 AGENTS.md：只补缺失的「自动提交」小节（dev 模板自带该章节）
if [[ -e AGENTS.md ]] && ! grep -q '^## 自动提交' AGENTS.md; then
  printf '\n## 自动提交\n\n每轮对话后自行提交（除非只有单处微小细节改动）；仓库有发布脚本时走发布脚本，不先单独 `git commit`；发现会话外改动先弹框问用户如何提交。\n' >> AGENTS.md
fi

# 文件已存在才建链接，避免 dev 场景留下悬空链接
if [[ -e AGENTS.md || -L AGENTS.md ]]; then
  mkdir -p .github
  ln -sfn ../AGENTS.md .github/copilot-instructions.md
  readlink .github/copilot-instructions.md   # 应为 ../AGENTS.md
fi
```

- 占位符（`<项目名>`、`<一句话…>`、模板里的 `<...>` / `[待定]`）原样保留，它们是后续会话弹窗提问的触发点；不要预填，也不要为了"完整"删掉。
- 已有 `AGENTS.md` 混入项目细节时，本步不改正文；选中 `dev` 时第 8 步执行 `dev-init`，按「细节外移」搬到 `docs/`，并逐节对照模板补齐 `开发流程`、`调试约定` 等缺失章节。
- 「自动提交」小节是项目的固定约定，不是可选章节：骨架与 dev 模板都自带；已有 `AGENTS.md` 缺它时追加到末尾，已有则跳过（`grep -q '^## 自动提交'`）。
- `AGENTS.md` 是符号链接时，追加到它指向的文件，不要替换链接本身。
- `.github/copilot-instructions.md` 是 Copilot 项目指令的优先注入入口；用相对符号链接让它指向 `AGENTS.md`，避免重复维护指令正文。用户问起这个文件是什么时，再说明它是 Copilot 用来优先读取项目指令的入口，以及链接到 `AGENTS.md` 的作用。
- dev 场景的链接由 `dev-init` 建；若用户跳过 `dev-init`，本步结束时 `AGENTS.md` 与链接都未创建，报告里要写明。
- 已有指向 `AGENTS.md` 的链接：跳过。
- 已有实体文件：内容与 `AGENTS.md` 相同就替换成链接；不同则先 `cp` 到 `.github/copilot-instructions.md.bak.<日期>` 再替换，并在报告里写出备份路径。
- 只处理 `.github/copilot-instructions.md`，不要动 `*.instructions.md` 等模块化指令。
- 用户明确说只要「装技能链接」时跳过本节，并在报告里写明跳过。

## 8. 按场景执行 init 技能

技能链接完成后，按本次选中的场景与项目目标接续执行对应的 init 技能，不要只装链接就结束：

| 触发条件 | init 技能 | 作用 |
| --- | --- | --- |
| 选中 `dev` | `dev-init` | 复制 `AGENTS-example.md` 为 `AGENTS.md`（占位符保留），已有文件补齐缺失章节 |
| 选中 `dev` 且项目是前端项目 | `frontend-init` | 补齐前端工程默认配置（Vite `server.open`、scripts、目录、lint/format、测试） |
| 选中 `dev` 且项目是用户脚本 | `userscript-dev` | 按用户脚本骨架检查目录分层、版本与发布、CSP 调试路径，不做前端工程默认值 |
| 选中 `system` | `system-init` | 探测系统环境，写入或补齐 `AGENTS.md` 的系统环境章节 |
| 本次目标包含 OpenCode 配置 | `opencode-init` | 初始化 OpenCode 配置与用户设置 |
| 其余情况 | 无 | 没有对应的 init 技能，跳过并说明 |

执行方式：读取该技能目录下的 `SKILL.md`，按其步骤继续执行；此时它的前置条件已经满足（技能已链接、仓库根已解析）。

- `dev-init`：在项目根目录运行；把 `AGENTS-example.md` 原样复制为 `AGENTS.md`，占位符保留给后续会话弹窗自迭代；已有文件则补齐缺失章节并把项目细节搬到 `docs/`；Copilot 链接由 `dev-init` 自己建，不要重写。
- `frontend-init`：在 `dev-init` 之后运行，只补缺失的工程配置（含 `vite.config` 的 `server.open: true`）；已有工具链不替换，用户脚本项目交给 `userscript-dev`。
- `system-init`：同样只补缺失章节；与 `dev-init` 同时执行时先跑 `dev-init` 建基础结构，再由 `system-init` 补「系统环境」等章节，不要重写已有内容。
- `opencode-init`：属于全局配置，动手前先备份 `~/.config/opencode`（备份放本机，不进技能目录）。全局规则 `AGENTS.md` 由 `agents-init` 技能以软链安装，只维护仓库真源，不要在任何技能里另存正文副本。
- 用户明确说只要「装技能链接」时跳过本节，并在报告里写明跳过。
- init 技能失败时不要回滚已建好的链接；报告失败原因与下一步。

## 9. 校验与报告

```bash
ls -la .agents/skills
readlink -f .agents/skills/dev-init
```

逐项确认链接指向 `$REPO_ROOT/<分组>/<name>`，且 `SKILL.md` 存在。复制安装时目标不是符号链接，确认目录内有 `SKILL.md` 即可。只报告本次实际发生的事：新建了哪些、替换了哪些、跳过了哪些、哪些因实体文件冲突未处理。

项目范围还要确认 `.github/copilot-instructions.md` 是指向 `AGENTS.md` 的相对符号链接：

```bash
readlink .github/copilot-instructions.md   # 应为 ../AGENTS.md
readlink -f .github/copilot-instructions.md # 应等于项目根目录下的 AGENTS.md
```

项目 `AGENTS.md`、其中的「自动提交」小节与 Copilot 链接由第 7 步处理；`dev` 场景跳过第 7 步，由第 8 步 `dev-init` 复制模板时一并建好。报告里写明是复制模板、新建骨架、补了「自动提交」还是都已存在（跳过）。跳过本节或用户只要链接时，写明未创建。

```bash
grep -n '^## 自动提交' AGENTS.md   # 应能命中一行
```
