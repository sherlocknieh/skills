---
name: project-init
description: 把 global 场景常驻技能链到 ~/.agents/skills/，按项目场景把技能链到项目的 .agents/skills/；项目缺少 AGENTS.md 时建最小骨架，并建 .github/copilot-instructions.md 符号链接。适用于新机器接入、换 Agent、链接失效重建、新项目接入、切换项目类型（软件开发/系统管理/学习/内容创作）。关键词：project-init、全局技能、常驻技能、符号链接、重建链接、项目技能初始化、.agents/skills、AGENTS.md、copilot-instructions、接续执行 dev-init、system-init、opencode-init。全局 AGENTS.md 由 agent-init 安装，不在本技能范围。
---

# project-init

职责：一个入口，三种作用范围。

- **全局技能**：把 `global` 场景的常驻技能链到 `~/.agents/skills/`。
- **项目技能**：按项目场景把本仓库的技能链到 `<project>/.agents/skills/`。
- **项目提示词**：`<project>/AGENTS.md` 缺失时建最小骨架，已有则只补缺失的「自动提交」小节，并建 `.github/copilot-instructions.md` 指向它的符号链接。

技能只建链接，不复制内容；仓库更新后链接自动生效。项目 `AGENTS.md` 只在缺失时建一次骨架，已有文件不重写，只补「自动提交」约定；其余章节由 `dev-init` / `system-init` 补全。

全局 `~/.agents/skills/` 只放 `global` 场景那四条常驻技能（全局规则入口 + 技能安装入口 + 技能发现入口 + 文档写作规范），不要把所有技能都装进去。其余场景技能一律按项目安装。

全局 `AGENTS.md`（原 `agents-init`）不在这里安装：它由常驻全局技能 `agent-init` 负责。`agent-init` 随 `global` 场景链入 `~/.agents/skills/`，agent 会自动发现并触发。本技能只处理项目级 `AGENTS.md`。

## 何时执行

- 安装或调整全局常驻技能（`global` 场景）
- 新机器、换了 Agent、仓库路径变更
- 全局 `AGENTS.md` 缺失或链接失效时，先执行 `agent-init` 技能，不要用本技能补装
- 新项目或首次接入 AI，需要决定暴露哪些技能
- 项目缺少 `AGENTS.md` 或 `.github/copilot-instructions.md`
- 项目类型变化，需要增删技能
- 项目里 `.agents/skills/` 缺失、链接失效或指向旧路径

已经能正常工作时不要执行，也不必每次会话都检查。本技能是幂等的，但没必要每次会话都跑。

## 1. 定位技能仓库（两种范围共用）

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
| `global` 全局技能 | 把 `global` 场景技能链到 `~/.agents/skills/` |
| `project` 项目技能 | 按场景把技能链到项目 `.agents/skills/`，并建项目 `AGENTS.md` 骨架与 Copilot 链接 |
| `both` 两者 | 先装全局常驻技能，再装项目技能与项目提示词 |

判断依据：用户说“初始化这个项目”归 `project`；说“装全局技能 / 换机器”归 `global`；新机器第一次接入通常选 `both`，但前提是全局 `AGENTS.md` 已由 `agent-init` 装好。

## 3. 全局技能：装到 ~/.agents/skills/

`global` 范围只装常驻技能；全局 `AGENTS.md` 由 `agent-init` 技能负责，本技能不改它。

```bash
PROJECT_INIT=$(dirname "$(readlink -f ~/.agents/skills/project-init/SKILL.md)")
"$PROJECT_INIT/link-skills.sh" --scenario global
```

只选 `global` 场景且没给 `--dest` 时，脚本默认写到 `~/.agents/skills`。装完 `readlink -f ~/.agents/skills/<name>` 应指向 `$REPO_ROOT/global-skills/<name>`。

若发现全局 `AGENTS.md` 缺失或失效：停止本技能，让用户先执行 `agent-init` 技能（或手动运行 `~/.agents/skills/agent-init/install-agents.sh --agent <当前 Agent>`），然后再回来装技能。不要在本技能里代装。

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

## 7. 建项目 AGENTS.md 与 Copilot 链接

项目范围（`project` / `both`）在项目根目录执行。先建最小骨架，再建链接；已有 `AGENTS.md` 不覆盖、不重写，只补缺失的「自动提交」小节。

```bash
if [[ ! -e AGENTS.md && ! -L AGENTS.md ]]; then
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

# 已有 AGENTS.md：只补缺失的「自动提交」小节，其他内容不动
if [[ -e AGENTS.md ]] && ! grep -q '^## 自动提交' AGENTS.md; then
  printf '\n## 自动提交\n\n每轮对话后自行提交（除非只有单处微小细节改动）；仓库有发布脚本时走发布脚本，不先单独 `git commit`；发现会话外改动先弹框问用户如何提交。\n' >> AGENTS.md
fi

mkdir -p .github
ln -sfn ../AGENTS.md .github/copilot-instructions.md
readlink .github/copilot-instructions.md   # 应为 ../AGENTS.md
```

- `<项目名>` 与一句话简介按仓库实际填写，不要留占位符；其余章节留给 init 技能补全。
- 「自动提交」小节是项目的固定约定，不是可选章节：骨架里自带；已有 `AGENTS.md` 缺它时追加到末尾，已有则跳过（`grep -q '^## 自动提交'`）。
- `AGENTS.md` 是符号链接时，追加到它指向的文件，不要替换链接本身。
- Copilot 会读 `AGENTS.md`，但不保证最先加载；`.github/copilot-instructions.md` 保证最先注入，所以用相对符号链接指向它，不复制正文。
- 已有指向 `AGENTS.md` 的链接：跳过。
- 已有实体文件：内容与 `AGENTS.md` 相同就替换成链接；不同则先 `cp` 到 `.github/copilot-instructions.md.bak.<日期>` 再替换，并在报告里写出备份路径。
- 只处理 `.github/copilot-instructions.md`，不要动 `*.instructions.md` 等模块化指令。
- 用户明确说只要「装技能链接」时跳过本节，并在报告里写明跳过。

## 8. 按场景执行 init 技能

技能链接完成后，按本次选中的场景与项目目标接续执行对应的 init 技能，不要只装链接就结束：

| 触发条件 | init 技能 | 作用 |
| --- | --- | --- |
| 选中 `dev` | `dev-init` | 探测仓库事实，补齐项目根目录 `AGENTS.md` 的缺失章节 |
| 选中 `system` | `system-init` | 探测系统环境，写入或补齐 `AGENTS.md` 的系统环境章节 |
| 本次目标包含 OpenCode 配置 | `opencode-init` | 初始化 OpenCode 配置与用户设置 |
| 其余情况 | 无 | 没有对应的 init 技能，跳过并说明 |

执行方式：读取该技能目录下的 `SKILL.md`，按其步骤继续执行；此时它的前置条件已经满足（技能已链接、仓库根已解析）。

- `dev-init`：在项目根目录运行，只补缺失章节；`AGENTS.md` 与 Copilot 链接已由第 7 步建好，不要重写已有内容。
- `system-init`：同样只补缺失章节；与 `dev-init` 同时执行时先跑 `dev-init` 建基础结构，再由 `system-init` 补「系统环境」等章节，不要重写已有内容。
- `opencode-init`：属于全局配置，动手前先备份 `~/.config/opencode`（备份放本机，不进技能目录）。全局规则 `AGENTS.md` 由 `agent-init` 技能以软链安装，只维护仓库真源，不要在任何技能里另存正文副本。
- 用户明确说只要「装技能链接」时跳过本节，并在报告里写明跳过。
- init 技能失败时不要回滚已建好的链接；报告失败原因与下一步。

## 9. 校验与报告

```bash
ls -la .agents/skills
readlink -f .agents/skills/dev-init
```

逐项确认链接指向 `$REPO_ROOT/<分组>/<name>`，且 `SKILL.md` 存在。只报告本次实际发生的事：新建了哪些、替换了哪些、跳过了哪些、哪些因实体文件冲突未处理。

项目范围还要确认 `.github/copilot-instructions.md` 是指向 `AGENTS.md` 的相对符号链接：

```bash
readlink .github/copilot-instructions.md   # 应为 ../AGENTS.md
readlink -f .github/copilot-instructions.md # 应等于项目根目录下的 AGENTS.md
```

项目 `AGENTS.md`、其中的「自动提交」小节与 Copilot 链接由第 7 步处理；报告里写明是新建骨架、补了「自动提交」还是两者都已存在（跳过）。跳过本节或用户只要链接时，写明未创建。

```bash
grep -n '^## 自动提交' AGENTS.md   # 应能命中一行
```
