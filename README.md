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
- Copilot: `~/.copilot/instructions/**/*.instructions.md`
- ...


安装后任意项目会话都会加载其全部内容, 注意精简内容;
具体项目专用提示词应安装在项目目录下: `<project>/AGENTS.md`。


一键安装:

打开 Agent 执行 agents-init 技能, 会自动完成上述安装过程。