---
name: agents-init
description: 把唯一全局 AGENTS.md 以符号链接方式装到常见 Agent 的全局提示词路径下。也用于修复/卸载。触发关键词：你好、hi、hello、测试、初始化、agents-init、全局 AGENTS.md、全局提示词、全局规则。
---

只维护仓库根目录这一份 `AGENTS.md`，任何技能里都不要另存副本。

## 1. 定位

`install-agents.sh` 与本文同目录。拿到 `SKILL.md` 路径就直接取其目录，拿不到再按顺序探测：

```bash
AGENT_INIT=
for p in "<SKILL.md 路径>" \
         "$(git rev-parse --show-toplevel 2>/dev/null)/global-skills/agents-init/SKILL.md" \
         ~/.agents/skills/global-skills/agents-init/SKILL.md; do
  [[ -f $p ]] && { AGENT_INIT=$(dirname -- "$(readlink -f -- "$p")"); break; }
done
REPO_ROOT=$(dirname -- "$(dirname -- "${AGENT_INIT:-/}")")
```

`readlink -f` 把三条入口（仓库内直开、粘贴路径、经 `~/.agents/skills/global-skills` 软链接）解析到同一处。`$AGENT_INIT` 为空或 `$REPO_ROOT/AGENTS.md` 不存在时，问用户仓库位置，不要猜。

## 2. 检测

```bash
"$AGENT_INIT/install-agents.sh" --list
```

按「已安装 / 未安装」两组列出每个 Agent 的全局指令路径与链接状态（`已链接` / `指向别处` / `实体文件` / `无链接`）。是否已安装只看配置目录是否存在（`dsh` 认 `DSH_HOME`，`pi` 认 `PI_CODING_AGENT_DIR`），不看可执行文件在不在 PATH。路径以这条输出为准，不要凭记忆填。

`--agent` 可选：opencode、claude、codex、copilot、gemini、qwen、iflow、droid、crush、windsurf、kiro、dsh、pi、all。

## 3. 询问

用当前 Agent 的提问工具连问两次，选项只取「已安装」组：

1. 选要处理的 Agent（多选）：标注链接状态，默认勾上非 `已链接` 的。
2. 选动作（单选）：`安装 / 修复` 或 `卸载`。

- 未安装的不进选项；用户点名要装，再加 `--force` 执行。
- 什么都不勾就回「保持原样」，不动手。
- 装一个、卸另一个：分两轮。

## 4. 执行

```bash
"$AGENT_INIT/install-agents.sh" --agent opencode --agent copilot       # 安装
"$AGENT_INIT/install-agents.sh" --agent opencode --uninstall           # 卸载
"$AGENT_INIT/install-agents.sh" --target ~/.config/myagent/RULES.md    # 自定义路径
"$AGENT_INIT/install-agents.sh" --agent all --dry-run                  # 预演
```

脚本幂等，直接跑，不用先探测：

- 安装：无链接就建（缺目录会创建）；已链接跳过；指向别处改指过来；实体文件内容相同改成链接，不同则备份为 `<目标>.bak.<日期>` 再改。
- 卸载：只删指向本源的链接；实体文件始终不删；指向别处的链接加 `--force` 才删。
- 未安装的 Agent 默认跳过，`--force` 才建目录并链接；`all` 默认也只处理已安装的。

## 5. 汇报

只讲本次真实发生的事：新建、改指向、替换（附备份路径）、移除、跳过。复核用 `diff -q "$REPO_ROOT/AGENTS.md" <目标>`，无输出即通过；卸载后确认目标已不存在。给未安装的 Agent 加了 `--force` 时，补一句「装好该 Agent 后才会读取」。

## Agent 差异

- **Copilot**：用 `~/.copilot/copilot-instructions.md`；不要写 `~/.copilot/instructions/*.instructions.md`，那是模块化指令，会重复注入。
- **Kiro**：目录式，链接放 `~/.kiro/steering/`，该目录下 `*.md` 全部常驻。
- **Windsurf**：`global_rules.md` 上限 6000 字符，超长被截断；接近上限时先提醒。
- **dsh**：还会读 `~/.agents/AGENTS.md`；只链 `$DSH_HOME/AGENTS.md`，`~/.agents/` 是技能目录，不要放正文。
- **Pi**：同目录的 `CLAUDE.md` 与 `AGENTS.override.md`（优先）也生效；只链 `AGENTS.md`，用户留了 override 就以它为准。
- 只管全局路径：项目级 `<project>/.github/copilot-instructions.md` 由 `project-init` 建，`dev-init` / `system-init` 兜底，不要代建。
