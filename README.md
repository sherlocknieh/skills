# 我的 AGENTS.md 与 skills 备份


## 1. 全局提示词: [AGENTS.md](./AGENTS.md)

各种主流 Agent 默认加载的全局提示词路径不统一:

| Agent | 路径 |
| --- | --- |
| Copilot | `~/.copilot/copilot-instructions.md` |
| OpenCode | `~/.config/opencode/AGENTS.md` |
| Pi | `~/.pi/agent/AGENTS.md` |
| dsh (DeepSeek Harness) | `~/.dsh/AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| ... |... |

我打算让所有 Agent 都加载同一份全局提示词，方便统一管理和更新。

### 手动安装

- 把本仓库克隆到固定的个人惯用路径下，例如 `~/Projects/skills`；
- 然后可以按需把 `AGENTS.md` 链接到各 Agent 的默认路径下；
  ```bash
  # OpenCode:
  ln -s ~/Projects/skills/AGENTS.md ~/.config/opencode/AGENTS.md
  ```

### 自动安装

- 用任意 Agent 打开本仓库，让它调用 `agents-init` 技能自动安装。

> [!INFO]
> 任意项目会话都会加载全局提示词的全部内容，请保持精简。项目专用提示词应放在项目目录下的 `<project>/AGENTS.md`。


## 2. 全局技能: [global-skills](./global-skills/)

全局技能的 name 和 description 会暴露给所有 Agent、所有项目和所有会话（技能的 description 内容放在 SKILL.md 中和放在 AGENTS.md 中基本没有区别）；

只留三个元技能：`agents-init`、`project-init` 和 `skills-init`。

### 自动安装

- 用任意 Agent 打开本仓库，让它调用 `skills-init` 技能自动安装。

### 手动安装

各大主流 Agent 都支持自动加载 `~/.agents/skills` 技能目录。

为了按需暴露技能，应把本仓库克隆到不被任何 Agent 自动加载的路径，
再把 `global-skills` 整个目录链接到 `~/.agents/skills/global-skills`：

```bash
# 改成你的惯用目录
DIR="$HOME/Projects"
# 进入目录
mkdir -p "$DIR" && cd "$DIR"
# 克隆仓库
git clone https://github.com/sherlocknieh/skills.git
# 创建 ~/.agents/skills 目录（如果不存在）
mkdir -p ~/.agents/skills
# 链接安装全局技能
ln -sfn $DIR/skills/global-skills/ ~/.agents/skills/
```

## 三、项目技能 & 项目提示词

| 目录 | 用途 |
| --- | --- |
| [`dev-skills/`](./dev-skills/) | 项目开发技能 |
| [`user-skills/`](./user-skills/) | 其他个人技能 |
| [`system-skills/`](./system-skills/) | 操作系统管理技能 |
| [`learning-skills/`](./learning-skills/) | 知识学习技能 |

| 内容 | 安装路径 |
| --- | --- |
| 项目技能 | `<project>/.agents/skills` |
| 项目提示词 | `<project>/AGENTS.md` |

### 安装步骤

完成第一节的 "安装全局技能" 后:

或者在任意目录下打开会话直接开始工作, 你的行为会被 `skills-init` 智能捕捉, 并提示你是否加载相关技能。


在任意项目目录下使用 `project-init` 技能会完成项目相关技能与提示词的安装。
