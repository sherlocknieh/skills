# 我的 skills 和 AGENTS.md 备份

## skills / 全局技能

安装路径: `~/.agents/skills`
各主流 Agent 都支持此路径;



安装后任意项目会话都会加载每条技能的 name 和 description, 注意不要装太多;
具体项目专用技能应安装在项目目录下: `<project>/.agents/skills`。


一键安装:

```bash
mkdir -p ~/.agents/skills
git clone https://github.com/sherlocknieh/skills.git ~/.agents/skills
```






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


一键安装:

打开 Agent 执行 `project-init` 技能, 选「全局规则」, 会自动完成上述安装过程。






## 高级安装（按项目暴露技能）

标准安装会把所有技能装进 `~/.agents/skills`，每个会话都加载每条技能的 name 和 description。想按场景控制暴露范围时：

1. 把仓库 clone 到任何 Agent 不会自动加载的目录，例如 `~/Projects/skills`；
2. `~/.agents/skills/` 只链入 `project-init`（全局规则与项目技能共用一个入口）；
3. 其余技能在具体项目里执行 `project-init`，按场景链到 `<project>/.agents/skills/`。

```bash
mkdir -p ~/Projects
git clone https://github.com/sherlocknieh/skills.git ~/Projects/skills

mkdir -p ~/.agents/skills
ln -s ~/Projects/skills/project-init ~/.agents/skills/project-init
```

旧版装过 `agents-init` 的，删掉 `~/.agents/skills/agents-init` 这个链接即可；全局规则改由 `project-init` 安装。

之后在项目根目录执行 `project-init`：

- 它会询问场景（软件开发 / 系统管理 / 学习 / 内容创作 / 其他），可多选；OpenCode 自身配置归在「系统管理」场景；
- 只给该项目链接对应技能，仓库 `git pull` 后链接自动指向新内容；
- 安装后按场景接续执行 init 技能：`dev` → `dev-init`（创建/补齐项目 `AGENTS.md`），需要配置 OpenCode 时再执行 `opencode-init`；
- 查看场景与技能对应关系：`~/.agents/skills/project-init/link-skills.sh --list`。

全局提示词也由 `project-init` 安装：选「全局规则」，或单独运行 `project-init/install-agents.sh --agent opencode`。它按自身符号链接解析仓库根目录，不要求仓库位于 `~/.agents/skills`。
