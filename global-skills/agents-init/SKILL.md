---
name: agents-init
description: 安装或卸载各 Agent 的全局指令文件：把本仓库根目录的 AGENTS.md 以符号链接装到 OpenCode、Claude Code、Codex、Copilot、Gemini CLI、Qwen Code、iFlow、Droid、Crush、Windsurf、Kiro、dsh、Pi 的全局提示词路径，或移除这些链接。触发后先用 --list 检测本机已安装哪些 Agent，再弹窗只列出已安装的 Agent 让用户勾选，并选择安装/修复还是卸载，按选择执行并校验。新会话开场、只打招呼（你好 / hi / hello）、只说「测试」「初始化」，或说「安装 / 卸载全局 AGENTS.md」「全局提示词」「全局规则」「修 AGENTS.md」时触发；开场只检查不弹窗，全部就绪则一句话说明并继续原对话。关键词：agents-init、安装全局 AGENTS.md、卸载全局提示词、全局规则、全局提示词、copilot-instructions、CLAUDE.md、GEMINI.md、QWEN.md、IFLOW.md、dsh、pi、符号链接、重建链接、换 Agent、新机器、你好、hi、hello、开场白、测试、初始化。
---

# agents-init

职责：把仓库根目录的 `AGENTS.md` 装成各 Agent 的全局指令文件，或把这些链接卸掉。

- 先检测：哪些 Agent 已装（配置目录存在）；未安装的不进弹窗选项。
- 再弹窗：只列已安装的 Agent 让用户勾选，再选动作是安装还是卸载；不替用户挑 Agent。
- 安装只建符号链接，不复制正文；仓库更新后链接自动生效。
- 卸载只删指向本仓库 `AGENTS.md` 的链接，不删实体文件、不删指向别处的链接。
- 不装技能、不改项目 `.agents/skills/`，那是 `project-init` 的职责。

## 何时执行

- 新会话开场，或用户只说了「你好 / hi / hello」
- 用户只说了「测试」「初始化」（验证触发链路，与打招呼同等处理）
- 新机器、首次接入某个 Agent；换了 Agent，或全局指令路径变化
- 当前 Agent 读不到全局规则；全局指令文件缺失、指向错误、或不再是链接
- 用户说「安装 / 卸载全局 AGENTS.md」「全局提示词」「全局规则」

三种情况不走弹窗：

- 打招呼或只说「测试」「初始化」：只跑 `--list` 检查。全部就绪就回一句已就绪，继续原对话，不要复述规则内容；有缺失或失效才进入下面的流程。
- 用户已点名 Agent 和动作，例如「给 copilot 装上」「把 claude 的卸掉」：直接执行，不再弹窗。
- 同一句话还命中其他技能，尤其「初始化」可能同时命中 `project-init`：按 `AGENTS.md` 第 2 条第 4 款先弹窗选技能，选定后再按本流程走。

## 1. 定位仓库根

本技能位于仓库的 `global-skills/agents-init/` 下。全局安装时 `~/.agents/skills/agents-init` 是指向该目录的符号链接：

```bash
AGENT_INIT=$(dirname "$(readlink -f ~/.agents/skills/agents-init/SKILL.md)")
REPO_ROOT=$(dirname "$(dirname "$AGENT_INIT")")
test -f "$REPO_ROOT/AGENTS.md" && test -f "$AGENT_INIT/install-agents.sh" && echo "$REPO_ROOT"
```

`~/.agents/skills/agents-init` 不存在时，用当前会话实际加载到的 `global-skills/agents-init/SKILL.md` 路径取上两级。仍不确定就问用户仓库位置，不要猜。

## 2. 检测

```bash
"$AGENT_INIT/install-agents.sh" --list
```

输出分两组：`已安装（N）` 与 `未安装（M）`，每行是 Agent、链接状态（`已链接` / `指向别处` / `实体文件` / `无链接`）、全局指令路径。弹窗只取「已安装」那组生成选项。

| Agent | 全局指令路径 | 已安装判定（配置目录） |
| --- | --- | --- |
| OpenCode | `~/.config/opencode/AGENTS.md` | `~/.config/opencode` |
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude` |
| Codex | `~/.codex/AGENTS.md` | `~/.codex` |
| Copilot | `~/.copilot/copilot-instructions.md` | `~/.copilot` |
| Gemini CLI | `~/.gemini/GEMINI.md` | `~/.gemini` |
| Qwen Code | `~/.qwen/QWEN.md` | `~/.qwen` |
| iFlow | `~/.iflow/IFLOW.md` | `~/.iflow` |
| Droid (Factory) | `~/.factory/AGENTS.md` | `~/.factory` |
| Crush | `~/.config/crush/CRUSH.md` | `~/.config/crush` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | `~/.codeium/windsurf` |
| Kiro | `~/.kiro/steering/AGENTS.md` | `~/.kiro` |
| dsh (DeepSeek Harness) | `~/.dsh/AGENTS.md` | `~/.dsh` |
| Pi | `~/.pi/agent/AGENTS.md` | `~/.pi/agent` |

判定只看配置目录是否存在，不看可执行文件在不在 PATH：CLI 装在别处、容器里或换过安装方式时目录照样能说明「这个 Agent 用过」。`dsh` 认 `DSH_HOME`，`pi` 认 `PI_CODING_AGENT_DIR`，设了就按它们指的位置。

`--list` 仍会输出「未安装」分组，那是给排查和手动安装用的；未安装的 Agent 不进弹窗选项，用户点名要装某个没装的 Agent 时直接加 `--force` 执行。

## 3. 弹窗

用当前 Agent 的提问工具（OpenCode 是 `question`）连弹两次，选项只取 `--list` 的「已安装」分组：

1. **选择要处理的 Agent**（多选）：每个选项标出链接状态（`已链接` / `无链接` / `指向别处` / `实体文件`）。默认勾上需要修的（不是 `已链接` 的那些），其余不勾；用户可自行增减。
2. **对选中的 Agent 执行什么**（单选）：`安装 / 修复` 或 `卸载`。

规则：

- 未安装的 Agent 不进第一问：每次列一长串用不上的选项只会干扰选择。用户想装到没检测到的 Agent，可在选项里自填名字，或点名后加 `--force` 执行。
- 已安装且 `已链接` 的 Agent 又选「安装」，脚本会跳过并计入「跳过」，不算错误。
- 卸载只对 `已链接` 生效；`指向别处` 和 `实体文件` 不会被删，避免误删别人的配置。
- 什么都不勾就什么都不做，回一句「保持原样」。
- 想装一个、卸另一个：先执行一轮，再走一次弹窗。

## 4. 执行

```bash
# 安装；选中的未安装 Agent 加 --force
"$AGENT_INIT/install-agents.sh" --agent opencode --agent copilot
"$AGENT_INIT/install-agents.sh" --agent gemini --agent kiro --force
# 卸载
"$AGENT_INIT/install-agents.sh" --agent opencode --uninstall
# 未列出的 Agent 或自定义路径
"$AGENT_INIT/install-agents.sh" --target ~/.config/myagent/RULES.md
# 先预演
"$AGENT_INIT/install-agents.sh" --agent all --dry-run
```

安装（默认），重复执行安全：

| 目标当前状态 | 行为 |
| --- | --- |
| 不存在 | 建链接（含多层目录，如 `~/.codeium/windsurf/memories`） |
| Agent 未安装（配置目录不存在） | 跳过，不建目录；加 `--force` 才建 |
| 已是正确链接 | 跳过，不重写 |
| 是链接但指向别处 | 直接改指到源 |
| 实体文件但内容相同 | 删除后改成链接 |
| 实体文件且内容不同 | 先 `cp` 到 `<target>.bak.<日期>`，再改成链接，并写出备份路径 |
| 目标所在目录不存在 | 先创建目录 |

卸载（`--uninstall`）：

| 目标当前状态 | 行为 |
| --- | --- |
| 指向本仓库 `AGENTS.md` 的链接 | 删除该链接 |
| 指向别处的链接 | 跳过；`--force` 才删 |
| 实体文件或目录 | 跳过，不删 |
| 无链接 | 跳过 |

`--agent all` 只处理已安装的 Agent，未安装的打印一行「未安装，跳过」；卸载时同理。

## 5. 校验与报告

```bash
readlink -f ~/.config/opencode/AGENTS.md   # 必须是 $REPO_ROOT/AGENTS.md
diff -q "$REPO_ROOT/AGENTS.md" ~/.config/opencode/AGENTS.md
test -e ~/.copilot/copilot-instructions.md || echo "已卸载"
```

路径逐条换成本次实际触碰的。`diff` 无输出即通过；卸载后 `test -e` 不成立即通过。只报告本次真实发生的事：新建链接、改指向、替换实体文件（附备份路径）、移除链接、跳过。选了未安装的 Agent 时，加一句「链接已就位，装好该 Agent 后才会读取」。

## 边界

- dsh 除了 `$DSH_HOME/AGENTS.md`，还会读 `~/.agents/AGENTS.md`；只链前者，别往 `~/.agents/` 放正文，那里是技能目录。
- Pi 在同一目录还认 `CLAUDE.md` 和 `AGENTS.override.md`，后者会覆盖 `AGENTS.md`；只链 `AGENTS.md`，用户自己留了 override 时以 override 为准。
- Kiro 是目录式：链接放进 `~/.kiro/steering/`，该目录下所有 `*.md` 常驻生效，不需要 frontmatter。
- Windsurf 的 `global_rules.md` 有 6000 字符上限，超长会被截断；真源接近上限时先提醒用户。
- Copilot 用 `copilot-instructions.md`，不要写 `~/.copilot/instructions/*.instructions.md`：后者是模块化指令，同一份正文放两处会重复注入。
- 本技能只处理全局路径；项目级 `AGENTS.md` 对应的 `<project>/.github/copilot-instructions.md` 符号链接由 `project-init` 第 7 步主建，`dev-init` / `system-init` 幂等兜底，不要在这里代建。
- 全局规则只维护仓库根目录的 `AGENTS.md` 真源，不要在任何技能里另存正文副本。
