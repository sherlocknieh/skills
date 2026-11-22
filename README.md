# 我的 skills 和 AGENTS.md 备份

## 全局技能

安装路径: `~/.agents/skills`
各主流 Agent 都支持此路径;

安装到此处的技能 name 和 description 会暴露给所有 Agent / 所有项目 / 所有会话; 故只放 `global-skills/` 全局常驻技能，其他技能随项目按需安装。


1. 把仓库 clone 到任何 Agent 不会自动加载的目录，例如 `~/Projects/skills`；
2. 执行命令:
```bash
REPO_ROOT="$HOME/Projects"
mkdir -p $REPO_ROOT && cd $REPO_ROOT
git clone https://github.com/sherlocknieh/skills.git

mkdir -p ~/.agents/skills
ln -sfn $REPO_ROOT/skills/global-skills/*/ ~/.agents/skills/
```


## 全局提示词

安装路径:

各 Agent 支持的路径不统一, 需使用符号链接安装到对应路径:

- OpenCode: `~/.config/opencode/AGENTS.md`
- Claude Code: `~/.claude/CLAUDE.md`
- Codex: `~/.codex/AGENTS.md`
- Copilot: `~/.copilot/copilot-instructions.md`
- ...


安装好全局技能后, 通过 `agent-init` 技能即可自动安装全局提示词。

任意新开一个 Agent 会话，agent 会自动发现 `agent-init`；
直接说「你好」「测试」或「初始化」即可, agent 会探测到关键词并触发 `agent-init` 技能;


安装后任意项目会话都会加载其全部内容, 注意保持内容精简;
具体项目专用提示词应安装在项目目录下: `<project>/AGENTS.md`.


## 项目技能 & 项目提示词

安装路径: `<project>/.agents/skills` 和 `<project>/AGENTS.md`。

VS Code Copilot 无法保证最先加载到 `AGENTS.md`, 只能保证最先加载的是 `.github/copilot-instructions.md`，所以需创建符号链接 `.github/copilot-instructions.md` 指向 `AGENTS.md`;

使用技能 `project-init` 会完成上述安装和符号链接创建，并触发对应场景的 init 技能完成更细致的配置。

会话中首次出现明确领域任务时，常驻技能 `skill-router` 会识别工作类型，并提议临时加载、链接安装或复制安装对应场景的技能；不需要每次手动执行 `project-init`。
