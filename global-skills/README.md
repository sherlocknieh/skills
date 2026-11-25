# global-skills

常驻技能。安装到 `~/.agents/skills/`，每个项目会话都会加载它们的 name 和 description。

其中 `agent-init` 负责安装全局 `AGENTS.md`：它随本组技能链入 `~/.agents/skills/`，agent 每个会话都会看到它的 name 和 description，在需要时自动发现并触发。全局规则不由 `project-init` 安装。

在仓库根目录运行：

```bash
global-skills/project-init/link-skills.sh --scenario global
```

链入后新开一个 Agent 会话，说「你好」「测试」「初始化」或「安装全局 AGENTS.md」即可触发 `agent-init`：它先用 `--list` 检测本机已安装哪些 Agent，再弹窗只列已安装的那些让你勾选，并选择安装/修复还是卸载（已装好且只是打声招呼时只回一句已就绪）；也可手动运行 `~/.agents/skills/agent-init/install-agents.sh --agent opencode` 或 `--agent opencode --uninstall`。

会话中出现明确任务（如「修一下输入法」）时，`skill-init` 会识别工作类型，并提议临时加载、链接安装或复制安装对应场景的技能。

## 准入判据

三条判据同时满足才放这里：

1. **触发条件与项目类型无关**——写代码、修系统、学东西、做内容都可能用到；
2. **缺失会让行为明显变差**——不是「有时更方便」，而是没有它就会漏步骤或走错路；
3. **常驻成本可接受**——description 精简，全部加起来控制在 3KB 以内。

领域专用技能（`dev-skills/`、`system-skills/`、`learning-skills/`、`user-skills/`）一律按项目安装。

## 当前成员

| 技能 | 为什么常驻 |
| --- | --- |
| `agent-init` | 全局规则的安装入口；agent 自动发现并触发，缺了就读不到全局 `AGENTS.md` |
| `project-init` | 技能安装入口；缺了就没法按场景装技能 |
| `skill-init` | 会话中识别工作类型并按需提议加载；缺了就不会主动提示安装对口技能 |
三条常驻技能保持精简，description 合计控制在 3KB 以内。

## 拆分记录

其余技能按域下沉，场景清单仍会按需暴露它们：

| 技能 | 去处 | 为什么不再常驻 |
| --- | --- | --- |
| `handoff` | `dev-skills/` | 项目收尾才用，不是每会话都发生 |
| `wizard` | `dev-skills/` | 一次性配置、迁移与凭据设置 |
| `diagnosing-bugs` | `dev-skills/` | 只在报错、变慢时启动，行为侵入性强 |
| `research` | `learning-skills/` | 以调研、学习为目的 |
| `wait-what` | `learning-skills/` | 重新解释与理解纠偏 |

`research`、`wait-what`、`wizard` 等仍被 dev/system/create 场景按需引用，只是不再常驻。

## 增删流程

1. 用 `git mv` 把技能目录移入或移出本目录（保留历史）；
2. 同步 `project-init/link-skills.sh` 里 `global` 场景的清单；
3. 检查其他场景是否还引用旧路径（`--scenario <场景> --dry-run` 会报告缺失的 `SKILL.md`）；
4. 本机重跑 `--scenario global`，旧链接指向旧路径时需要先删再建。
