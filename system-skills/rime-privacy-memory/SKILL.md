---
name: rime-privacy-memory
description: 管理本机 ibus-rime（雾凇拼音）的敏感词屏蔽与用户词典"记忆模型"：加删屏蔽词、临时显示、查看词频变化与使用模式、按临时/短期/长期分层衰减、开启或关闭权重写回、清空记忆。适用于用户说记忆清理、清理记忆、清词频、清空词库、屏蔽词、敏感词、权重变化、使用模式、记忆曲线、输入法老冒出某些词时。关键词：rime、ibus-rime、雾凇、词频、用户词典、记忆模型、记忆清理、屏蔽词、敏感词、权重变化、使用模式、rime-hide、rime-memory。
---

# rime-privacy-memory

两套机制，别混用：

- **屏蔽词**：命中词表的候选项直接不出现，立即生效、永久有效。
- **记忆模型**：每天给用户词典拍快照，算出每个词的使用间隔与频率，分临时/短期/长期三层，决定它衰减多快。Rime 只存累计次数、没有时间戳，时间维度全靠每日快照自己记账。

所有操作都不需要 sudo，也不手改 `build/`。

## 0. 先看现状

```bash
rime-hide --list
rime-memory status
rime-memory report --days 7
```

完成判据：能说出词表几条、观察期第几天、写回是否开启、最近一次快照的使用词数。

## 1. 加 / 删屏蔽词

```bash
rime-hide 词一 词二          # 整词匹配（推荐）
rime-hide --sub 片段         # 包含匹配
rime-hide --remove 词一      # 删除
rime-hide --list             # 查看
```

每条命令自动 `rm -rf build` 并 `ibus restart`，约 5 秒。词存在 `~/.config/ibus/rime/rime_ice.custom.yaml`，该文件被 `.gitignore` 忽略，`git pull` 不会覆盖。**整词模式会自动同步到 `~/.config/rime-memory/sensitive.txt`**，让这些词的记忆衰减更快（见第 2 节）；`--sub` 只做隐藏同步。

临时要输入被屏蔽的词：`Ctrl+Shift+H` 切到「显示」（或 F4 勾选），重启后回到「隐藏」。

完成判据：`rime-hide --list` 能看到改动，且实际打该词拼音时候选里不出现。

## 2. 记忆模型

每词维护稳定性 `S`，可提取度 `R = exp(-未用天数/S)`：

- 当天用过：间隔越长、越接近遗忘时复习，`S` 涨得越多（间隔效应）；单日次数也加成。
- 当天没用：`S` 不变，`R` 按天衰减。
- 分层：`S<3` 临时、`3~10` 短期、`>10` 长期。
- 写回权重 `≈ 150 × R × (1-e^(-S/3))`：长期≈150，短期几十，久未用的接近 0 并从词典移除。

### 敏感词更快衰减

`sensitive.txt` 里的词有两道上限：`S ≤ 2`、写回权重 `≤ 60`。当天打得再多也只会停在「临时记忆」，第二天权重通常已降到 40 以下。已经在表里的高频词，即使当天没用，下一次 tick 也会把历史 S 压回上限。

```bash
rime-memory sensitive list
rime-memory sensitive add 词...
rime-memory sensitive remove 词...
```

每日 04:00 由 `rime-memory.timer` 跑一次 `rime-memory tick`。

### 观察期（当前阶段）

写回**关闭**：只拍快照、更新模型，不改 Rime 的词频。攒够 7 天数据、看过报表确认分层合理，再开闭环。

```bash
rime-memory status            # 观察期进度
rime-memory report --days 7   # 今日活跃、近 7 天热词、三层分布、正在淡出（敏感词默认隐藏）
rime-memory report --show-sensitive   # 连同敏感词一起显示
rime-memory word 某词         # 单词语史火花线
rime-memory tick              # 手动补一次快照（同一天重复跑会覆盖当天记录）
rime-memory report --web       # 生成 HTML 报表并打开（页内可勾选显示敏感词）
rime-memory doctor            # 环境自检：目录、词典、工具、定时器
```

完成判据：`report` 里今日使用词数与你当天实际输入的印象一致，三层分布不出现"全部堆在临时"或"全部堆在长期"。

### 开启闭环写回

```bash
rime-memory write on       # 次日 tick 起按模型改写权重
rime-memory write off      # 随时退回只观察
rime-memory tick --force-write   # 本次立刻写回一次
```

写回前每天的快照都保留，排序不满意可 `rime-memory write off` 再观察。用户词典目录另有备份（`~/.local/share/rime-memory/backups/`，留 7 份）。

完成判据：`rime-memory status` 显示「开启」，且改写后打常用词仍在前列、只打过一次的词开始靠后。

### 调模型参数

参数在 `~/.config/rime-memory/config.toml`（不存在就新建），改完不用重启服务，下次 tick 生效：

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `stability_gain` | 0.6 | 每次复习的巩固幅度，越大越"记牢" |
| `daily_bonus` | 0.5 | 当天重复次数的加成 |
| `max_weight` | 150 | 写回权重上限 |
| `short_term` / `long_term` | 3 / 10 | 三层分界 |
| `sensitive_max_stability` | 2.0 | 敏感词稳定性上限（天） |
| `sensitive_max_weight` | 60 | 敏感词写回权重上限 |
| `observe_days` | 7 | status 里的观察期提示 |

## 3. 清空记忆

```bash
rime-memory reset --yes      # 清空用户词典，先备份
```

只清词频、不动屏蔽词表。

## 4. 不生效怎么查

```bash
grep -c 'lua_filter@\*privacy_hide' ~/.config/ibus/rime/build/rime_ice.schema.yaml   # 应为 1
grep -i 'lua\|privacy' /tmp/rime.ibus.WARNING | tail                                 # 应无 lua 报错
git -C ~/.config/ibus/rime status --short                                            # 只应有 lua/privacy_hide.lua
tail -5 ~/.local/state/rime-memory.log                                               # tick 结果
systemctl --user list-timers rime-memory.timer --no-pager
```

按顺序排查：词表 → 开关是否在「显示」→ build 是否重建 → 引擎是否重启 → DB 里有没有当天快照。

## 5. 已知边界

- 只覆盖 `rime_ice`。libpinyin 是另一套引擎、独立用户词典。
- 快照和写回都会结束 rime 引擎进程，1 秒内由 ibus 自动拉起；定时在 04:00。
- 首次 `tick` 只是基线，当天 `delta` 全为 0，从第二天起才有使用数据。
- 一天内多次 `tick` 会覆盖当天记录，不会重复累计。
- 简繁转换后的候选也会比对原文，不会漏。

## 文件位置

| 路径 | 作用 |
| --- | --- |
| `~/.config/ibus/rime/lua/privacy_hide.lua` | 屏蔽词过滤器 |
| `~/.config/ibus/rime/rime_ice.custom.yaml` | 开关、快捷键、过滤器挂载、词表 |
| `~/.local/bin/rime-hide` | 加删词表并重新部署 |
| `~/.local/bin/rime-memory` | 安装脚本生成的启动器，指向下面的源码 |
| `~/Projects/rime-memory-fading-system/` | 开源项目源码（命令实现、测试、文档） |
| `~/.config/rime-memory/config.toml` | 模型参数（可选） |
| `~/.config/rime-memory/sensitive.txt` | 敏感词表（`rime-hide` 自动同步） |
| `~/.local/share/rime-memory/memory.db` | 每日快照 + 每词状态 |
| `~/.local/share/rime-memory/backups/` | 写回与 reset 前的备份 |
| `~/.local/state/rime-memory.log` | 每日运行日志 |
| `~/.local/share/rime-memory/report.html` | `rime-memory report --web` 生成的 HTML 报表 |
| `~/.config/systemd/user/rime-memory.{service,timer}` | 每日 04:00 |
| `~/Projects/skills/system-skills/rime-privacy-memory/` | 本技能源文件，改完记得提交 |

改完项目源码后：`cd ~/Projects/rime-memory-fading-system && ./install.sh` 重新生成启动器与系统单元；只改 Python 代码不需要重装，启动器直接引用源码目录。
