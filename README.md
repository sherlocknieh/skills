# 我的 skills 和 AGENTS.md 备份

## AGENTS.md / 全局提示词

安装路径:

各 Agent 支持的路径不统一, 需使用符号链接安装到对应路径:

- OpenCode: `~/.config/opencode/AGENTS.md`
- Claude Code: `~/.claude/CLAUDE.md`
- Codex: `~/.codex/AGENTS.md`
- Copilot: `~/.copilot/copilot-instructions.md`
- ...

安装后任意项目会话都会加载其全部内容, 注意精简内容;
具体项目专用提示词应安装在项目目录下: `<project>/AGENTS.md`。

由常驻全局技能 `agent-init` 安装。先把 `global` 场景链入 `~/.agents/skills/`（`agent-init` 在其中）：

```bash
git clone https://github.com/sherlocknieh/skills.git ~/Projects/skills
~/Projects/skills/global-skills/project-init/link-skills.sh --scenario global
```

之后新开一个 Agent 会话，agent 会自动发现 `agent-init`；直接说「安装全局 AGENTS.md / 全局规则」即可。也可以手动运行：

```bash
~/.agents/skills/agent-init/install-agents.sh --agent opencode
# 查看映射：--list；多个：--agent opencode --agent copilot；全部：--agent all
```

脚本重复执行安全：已是正确链接则跳过，指向别处则改指，实体文件内容不同会先备份为 `<target>.bak.<日期>` 再替换。全局规则只维护仓库根目录的真源，不要在任何技能里另存正文副本。

## skills / 全局技能

安装路径: `~/.agents/skills`
各主流 Agent 都支持此路径;

安装后任意项目会话都会加载每条技能的 name 和 description, 注意不要装太多;
具体项目专用技能应安装在项目目录下: `<project>/.agents/skills`。

`global-skills/` 下只放 4 条核心常驻技能，frontmatter 约 1.9KB：

| 技能 | 作用 |
| --- | --- |
| `agent-init` | 安装/修复全局 `AGENTS.md`，agent 自动发现并触发 |
| `project-init` | 按场景链技能（全局常驻 / 项目） |
| `find-skills` | 发现并安装外部技能 |
| `writing-for-agents` | 写 AGENTS.md / 技能文档 |

其余技能按域存放：开发流程在 `dev-skills/`，教学与调研在 `learning-skills/`，系统配置在 `system-skills/`，产出型任务在 `user-skills/`；它们由场景清单按需暴露，不常驻。

一键安装（链入全局常驻技能，含 `agent-init`）:

```bash
git clone https://github.com/sherlocknieh/skills.git ~/Projects/skills
~/Projects/skills/global-skills/project-init/link-skills.sh --scenario global
```

链入后，任意 Agent 会话都能发现 `agent-init`；需要装全局规则时它会自动触发，也可以直接说「安装全局 AGENTS.md」。

标准安装（把仓库全部技能都装进全局，不推荐）:

```bash
git clone https://github.com/sherlocknieh/skills.git ~/Projects/skills
mkdir -p ~/.agents/skills
~/Projects/skills/global-skills/project-init/link-skills.sh \
  --scenario global --scenario dev --scenario system \
  --scenario learn --scenario create --dest ~/.agents/skills
```

## 高级安装（按项目暴露技能）

标准安装会把所有技能装进 `~/.agents/skills`，每个会话都加载每条技能的 name 和 description。想按场景控制暴露范围时：

1. 把仓库 clone 到任何 Agent 不会自动加载的目录，例如 `~/Projects/skills`；
2. `~/.agents/skills/` 只链入 `global-skills/` 的常驻技能（含 `agent-init`）；
3. 新开会话，agent 发现 `agent-init` 后按提示安装全局 `AGENTS.md`，或手动运行 `~/.agents/skills/agent-init/install-agents.sh --agent <当前 Agent>`；
4. 其余技能在具体项目里执行 `project-init`，按场景链到 `<project>/.agents/skills/`。

```bash
mkdir -p ~/Projects
git clone https://github.com/sherlocknieh/skills.git ~/Projects/skills
~/Projects/skills/global-skills/project-init/link-skills.sh --scenario global

# 新开 Agent 会话后，直接说「安装全局 AGENTS.md」；或手动：
~/.agents/skills/agent-init/install-agents.sh --agent opencode
```

旧版装过 `agents-init` 的，删掉 `~/.agents/skills/agents-init` 这个链接即可；全局规则改由 `agent-init` 技能安装。
旧布局的 `~/.agents/skills/project-init` 指向仓库根目录的 `project-init/`，移动后该链接会悬空：删掉重跑上面的安装命令即可。

之后在项目根目录执行 `project-init`：

- 它会询问场景（软件开发 / 系统管理 / 学习 / 内容创作 / 其他），可多选；OpenCode 自身配置归在「系统管理」场景；
- 只给该项目链接对应技能，仓库 `git pull` 后链接自动指向新内容；
- 安装后按场景接续执行 init 技能：`dev` → `dev-init`（创建/补齐项目 `AGENTS.md`），`system` → `system-init`（补系统环境章节），需要配置 OpenCode 时再执行 `opencode-init`；
- 查看场景与技能对应关系：`~/.agents/skills/project-init/link-skills.sh --list`。

全局提示词由常驻技能 `agent-init` 安装，不再放在 `project-init` 里。`agent-init` 随 `global` 场景链入 `~/.agents/skills/`，agent 每个会话都能看到它并自动触发；`project-init` 只负责按场景装技能。
