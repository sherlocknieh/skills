# 我的 skills 和 AGENTS.md 备份

## skills / 全局技能

安装路径: `~/.agents/skills`
各主流 Agent 都支持此路径;

安装到此处的技能 name 和 description 会暴露给所有 Agent / 所有项目 / 所有会话; 故只放 `global-skills/` 全局常驻技能，其他技能随项目按需安装。


1. 把仓库 clone 到任何 Agent 不会自动加载的目录，例如 `~/Projects/skills`；
2. 执行命令:
```bash
mkdir -p ~/Projects

git clone https://github.com/sherlocknieh/skills.git ~/Projects/skills

ln -sfn ~/Projects/skills/global-skills ~/.agents/skills
```


## AGENTS.md / 全局提示词

安装路径:

各 Agent 支持的路径不统一, 需使用符号链接安装到对应路径:

- OpenCode: `~/.config/opencode/AGENTS.md`
- Claude Code: `~/.claude/CLAUDE.md`
- Codex: `~/.codex/AGENTS.md`
- Copilot: `~/.copilot/copilot-instructions.md`
- ...


安装好全局技能后, 可通过 `agent-init` 技能来安装全局提示词。

任意新开一个 Agent 会话，agent 会自动发现 `agent-init`；
直接说「你好」即可, agent 会询问是否安装全局提示词, 选择「是」即可。


安装后任意项目会话都会加载其全部内容, 注意保持内容精简;
具体项目专用提示词应安装在项目目录下: `<project>/AGENTS.md`.


## skills / 项目技能

安装路径: `<project>/.agents/skills`
只在对应项目的会话中加载, 不影响其他项目;
项目专用提示词放在项目目录下: `<project>/AGENTS.md`。

项目要装哪些技能由场景决定，用常驻技能 `project-init` 安装：在项目根目录开一个 Agent 会话，说「初始化项目技能」，按它询问的场景（软件开发 / 系统管理 / 学习 / 内容创作 / 其他）多选即可。也可以手动执行：

```bash
cd <project>
~/.agents/skills/project-init/link-skills.sh --scenario dev --scenario system

# 查看场景与技能对应关系
~/.agents/skills/project-init/link-skills.sh --list
```

- 目标目录默认为当前目录的 `.agents/skills`，只链接所选场景对应的技能；OpenCode 自身配置归在「系统管理」场景；
- 仓库 `git pull` 后链接自动指向新内容，无需重装；
- 安装后按场景接续执行 init 技能：`dev` → `dev-init`（创建/补齐项目 `AGENTS.md`），`system` → `system-init`（补系统环境章节），需要配置 OpenCode 时再执行 `opencode-init`。

全局提示词由常驻技能 `agent-init` 安装，不在 `project-init` 里。`agent-init` 随 `global` 场景链入 `~/.agents/skills/`，agent 每个会话都能看到它并自动触发；`project-init` 只负责按场景装技能。
