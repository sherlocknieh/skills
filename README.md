# 我的 AGENTS.md 与 skills 备份


## 1. 全局提示词: [AGENTS.md](./AGENTS.md)

各种主流 Agent 默认加载的全局提示词路径不统一:

| Agent | 路径 |
| --- | --- |
| Pi | `~/.pi/agent/AGENTS.md` |
| Copilot | `~/.copilot/copilot-instructions.md` |
| OpenCode | `~/.config/opencode/AGENTS.md` |
| DeepSeek Harness | `~/.dsh/AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |
| ... |... |

我打算让所有 Agent 都加载同一份全局提示词， 以本仓库下的 `AGENTS.md` 为唯一源文件，按需链接到各 Agent 的默认路径下：

- 以 OpenCode 为例：
```bash
ln -s <仓库所在目录>/skills/AGENTS.md ~/.config/opencode/AGENTS.md
```

> [!TIP] 自动安装
> - 用任意 Agent 打开本仓库，让它读取并执行 `agents-init` 技能，即可交互式地完成安装。

> [!WARNING] 移动仓库位置
> - 创建符号链接后，移动或重命名仓库导致路径变化时，符号链接会失效。变化后需重新安装一次。


## 2. 全局技能: [global-skills](./global-skills/)

全局技能的 name 和 description 会暴露给所有 Agent、所有项目和所有会话；

故只选了三个技能：`agents-init`、`project-init` 和 `skills-init` 做全局技能，其他技能都属于项目技能，由具体项目按需安装。

### 手动安装

只需把 `global-skills` 目录链接到 `~/.agents/skills/global-skills` 即可：

```bash
ln -sfn <仓库所在目录>/skills/global-skills/ ~/.agents/skills/
```

各大主流 Agent 都支持 `~/.agents/skills` 技能目录。

> [!TIP] 自动安装
> - 用任意 Agent 打开本仓库，让它读取并执行 `skills-init` 技能进行自动安装。


## 三、项目技能 & 项目提示词

| 类型 | 路径 |
| --- | --- |
| 知识学习技能 | [`learning-skills`](./learning-skills/)
| 操作系统管理技能 | [`system-skills`](./system-skills/) | 
| 项目开发技能 | [`dev-skills`](./dev-skills/) |
| 其他个人技能 | [`user-skills`](./user-skills/) |

- 项目技能 `<project>/.agents/skills/`
- 项目提示词 `<project>/AGENTS.md`

> [!NOTE] VSCode 特例
> - 各主流 Agent 都支持读取 `<project>/AGENTS.md` 作为项目提示词；
> - 但 VSCode Copilot 对该文件的加载会有延迟，会出现先读代码后读规则的情况；
> - 要保证提示词被注入会话顶部，需把 `<project>/AGENTS.md` 软链接到 `<project>/.github/copilot-instructions.md`，Copilot 对它的加载优先级更高；反过来链接也可以；
> - 我选择以 `<project>/AGENTS.md` 为源文件， `<project>/.github/copilot-instructions.md` 为符号链接。

> [!TIP] 安装步骤
> 全局技能安装后:
> - 在任意项目下使用 `project-init` 技能完成项目相关技能与提示词的安装。
> - 在任意目录下打开会话直接开始工作, `skills-init` 技能会智能识别你的需求, 并提示你是否加载相关技能。
