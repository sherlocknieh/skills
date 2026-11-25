# 我的 skills 与 AGENTS.md 备份

本仓库包含两类内容：所有项目共用的**全局常驻技能**，以及按项目安装的**项目专用技能**。

## 目录结构

| 目录 | 用途 |
| --- | --- |
| [`global-skills/`](./global-skills/) | 全局常驻技能，安装到 `~/.agents/skills` |
| [`dev-skills/`](./dev-skills/) | 开发场景技能 |
| [`system-skills/`](./system-skills/) | 系统管理场景技能 |
| [`learning-skills/`](./learning-skills/) | 学习场景技能 |
| [`user-skills/`](./user-skills/) | 其他个人场景技能 |

## 一、全局常驻技能

`~/.agents/skills` 是各大主流 Agent 都会自动加载的技能目录。安装在此处的技能，其**名称和描述**会暴露给所有 Agent、所有项目和所有会话，因此只放真正通用、常驻成本可接受的技能。

### 安装步骤

1. 把仓库克隆到任何 Agent 不会自动加载的目录，例如 `~/Projects/skills`。
2. 创建目录，并用符号链接安装全局技能（便于跟随仓库更新）：

   ```bash
   # 改成你自己的仓库父目录
   REPO_ROOT="$HOME/Projects"

   # 克隆仓库
   mkdir -p "$REPO_ROOT" && cd "$REPO_ROOT"
   git clone https://github.com/sherlocknieh/skills.git

   # 创建技能目录，并把全局技能链进去
   mkdir -p ~/.agents/skills
   ln -sfn "$REPO_ROOT/skills/global-skills/" ~/.agents/skills/
   ```

3. 安装结果


- `~/Projects/skills` | 实际技能仓库
- `~/.agents/skills/global-skills` | 指向全局技能目录的符号链接/快捷方式

现在, global-skills 下的所有技能都可以被任意 Agent 会话自动识别和使用。要卸载全局技能，只需删除 `~/.agents/skills/global-skills` 这个符号链接/快捷方式即可。


## 二、全局提示词

[AGENTS.md](./AGENTS.md) 是我的全局提示词。

各种主流 Agent 支持读取的路径不同:

| Agent | 路径 |
| --- | --- |
| OpenCode | `~/.config/opencode/AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| Copilot | `~/.copilot/copilot-instructions.md` |
| Gemini CLI | `~/.gemini/GEMINI.md` |
| Qwen Code | `~/.qwen/QWEN.md` |
| iFlow | `~/.iflow/IFLOW.md` |
| Droid (Factory) | `~/.factory/AGENTS.md` |
| Crush | `~/.config/crush/CRUSH.md` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` |
| Kiro | `~/.kiro/steering/AGENTS.md` |
| dsh (DeepSeek Harness) | `~/.dsh/AGENTS.md` |
| Pi | `~/.pi/agent/AGENTS.md` |

### 安装:

你可以手动把 `AGENTS.md` 链接/复制到各 Agent 的提示词目录下;

也可以使用 `agent-init` 技能自动安装:

完成第一节的 "安装全局技能" 后，打开任意 Agent 会话，直接说 "你好 / 测试 / 初始化"，就会触发 `agent-init` 技能。它会弹窗让你选择要为哪些 Agent 安装提示词，并自动完成安装。

> [!IMPORTANT]
> 任意项目会话都会加载全局提示词的全部内容，请保持精简。项目专用提示词应放在项目目录下的 `<project>/AGENTS.md`。

## 三、项目技能 & 项目提示词

| 内容 | 安装路径 |
| --- | --- |
| 项目技能 | `<project>/.agents/skills` |
| 项目提示词 | `<project>/AGENTS.md` |

### 安装步骤

完成第一节的 "安装全局技能" 后:

或者在任意目录下打开会话直接开始工作, 你的行为会被 `skill-init` 智能捕捉, 并提示你是否加载相关技能。


在任意项目目录下使用 `project-init` 技能会完成项目相关技能与提示词的安装。
