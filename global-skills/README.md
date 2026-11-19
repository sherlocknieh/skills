# global-skills

常驻技能。安装到 `~/.agents/skills/`，每个项目会话都会加载它们的 name 和 description。

```bash
global-skills/project-init/link-skills.sh --scenario global
```

## 准入判据

三条同时满足才放这里：

1. **触发条件与项目类型无关**——写代码、修系统、学东西、做内容都可能用到；
2. **缺失会让行为明显变差**——不是「有时更方便」，而是没有它就会漏步骤或走错路；
3. **常驻成本可接受**——description 精简，全部加起来控制在 1KB 左右。

领域专用技能（`dev-skills/`、`system-skills/`、`learning-skills/`、`user-skills/`）一律按项目安装。

## 当前成员

| 技能 | 为什么常驻 |
| --- | --- |
| `project-init` | 唯一安装入口；缺了就没法装规则和项目技能 |
| `find-skills` | 全局技能刻意装得少，需要兜底发现外部技能 |

两条合计约 1KB frontmatter。

## 拆分记录

其余技能按域下沉，场景清单仍会按需暴露它们：

| 技能 | 去处 | 为什么不再常驻 |
| --- | --- | --- |
| `writing-for-agents` | `learning-skills/` | 只在改 AGENTS.md、写技能文档时触发 |
| `handoff` | `dev-skills/` | 项目收尾才用，不是每会话都发生 |
| `wizard` | `dev-skills/` | 一次性配置、迁移与凭据设置 |
| `diagnosing-bugs` | `dev-skills/` | 只在报错、变慢时启动，行为侵入性强 |
| `research` | `learning-skills/` | 以调研、学习为目的 |
| `wait-what` | `learning-skills/` | 重新解释与理解纠偏 |

`research`、`wait-what`、`wizard`、`writing-for-agents` 等仍被 dev/system/create 场景按需引用，只是不再常驻。

## 增删流程

1. 用 `git mv` 把技能目录移入或移出本目录（保留历史）；
2. 同步 `project-init/link-skills.sh` 里 `global` 场景的清单；
3. 检查其他场景是否还引用旧路径（`--scenario <场景> --dry-run` 会报告缺失的 `SKILL.md`）；
4. 本机重跑 `--scenario global`，旧链接指向旧路径时需要先删再建。
