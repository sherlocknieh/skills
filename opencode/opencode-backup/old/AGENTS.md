# 全局规则

## 工具调用旁白/注释

调用工具前后要有旁白/注释：调用前一句话说目的，调用后一句话说结论。

- 调用前：用「正在用……做……」的句式，一句话点明手段与目的
- 调用后：一句话说明结果，例如成功、失败、关键发现、下一步依据。
- 同一批并行调用：一行前旁白，配一行后结论，不必每个子调用各写一句。
- 例：前「正在用 grep 搜这个报错从哪来」→ 后「定位到是配置项缺失」。

## OpenCode 配置备份/恢复

每当 OpenCode 配置文件发生变化时，使用 opencode-backup 技能自动备份配置文件。

## OpenCode 密码交互设置

SSH 已经配置了 `SSH_ASKPASS`，直接使用 ssh 命令会弹出密码输入框。

SUDO 先自检，再决定用哪条路：`grep -m1 NoNewPrivs /proc/self/status`

- `0`：直接用 `sudo -A <命令>`。
- `1`：sudo/pkexec/`systemd-run --scope` 都会被拒绝并报「已设置"no new privileges"标志」，改用 `sudo-run`：
```
sudo-run <命令>          # 等价 sudo -A
sudo-run -t <命令>       # 需要彩色输出/进度条/伪终端时
```
`sudo-run`（`~/.local/bin/sudo-run`）把命令交给 systemd 用户级临时服务执行（该服务 NoNewPrivs=0），并注入 `DISPLAY`/`WAYLAND_DISPLAY`/`XDG_RUNTIME_DIR`/`DBUS_SESSION_BUS_ADDRESS`/`SUDO_ASKPASS` 让 zenity 密码框正常弹出；保留工作目录，被中断时连带停掉服务单元。

这个 `1` 不是恒定的：它来自 opencode-cli 的派生链——同一个桌面 app，服务由 Electron 主进程直接派生时为 `0`，经由沙箱辅助进程派生时才是 `1`，重启服务/应用后会变化（实测重启后从 1 变回 0）。所以每次先自检，别默认只能用 `sudo-run`。

使用注意：
- 需要确认的命令自带 `-y`/`--noconfirm`；stdin 为空时命令不会等待输入。
- 环境不继承：`HOME=/root`、`PATH` 是 secure_path，没有 `SSH_AUTH_SOCK`、代理变量、nvm/cargo，必要时在命令内显式 export 或写绝对路径。
- 多条命令合并成一次 `bash -c`，避免反复启动服务的开销。
- sudo 时间戳是 `global`、5 分钟：首次弹框后 5 分钟内免密提权，这是额外暴露面，用完不必刻意保留。

### root 问题的报告格式

遇到 sudo / 提权失败，先采集再按固定格式报告。一次跑完：

```bash
grep -m1 NoNewPrivs /proc/self/status
sudo -A id 2>&1 | tail -1
systemctl --user is-active opencode.service
pid=$(python3 -c 'import json;print(json.load(open("/home/who/.local/state/opencode/service.json"))["pid"])')
ppid=$(awk '{print $4}' /proc/$pid/stat)
echo "pid=$pid"; tr '\0' ' ' </proc/$ppid/cmdline | cut -c1-60
```

输出固定两段，先状态后指导：

**当前状态**

| 项 | 值 |
|---|---|
| opencode.service | enabled / active (exited) |
| 服务端口 | 127.0.0.1:49374 |
| 服务进程 | pid 3010311，父进程是 Electron 主进程 |
| 当前 shell NNP | 0 |
| `sudo -A id` | `uid=0(root)` ✅ |

每行填实测值。失败就把原文写进去（如「已设置"no new privileges"标志」「Failed to connect to user scope bus」），不写「异常」「有问题」这类判断词。

**操作指导**

- 我能直接做的：给一个可粘贴的命令块。
- 需要用户动手的：编号步骤，每步附验证命令。
- 涉及重启服务的：先写明 `systemctl --user restart opencode.service` 会掐断当前会话（见「OpenCode 后台服务」一节），再给正确顺序。

### `sudo-run` 也失败时

典型症状：`Failed to connect to bus`、`zenity: command not found`、密码框不弹、仍报 no new privileges。按顺序处理：

1. 提醒用户**在他自己的终端里**重启 opencode，并给出可直接粘贴的命令；不要让用户或自己用 `pkill` 在会话内杀进程（会连同当前会话一起杀掉）：
   - 桌面应用：先在托盘/菜单退出，再在终端执行 `/opt/OpenCode/ai.opencode &`（或 `setsid /opt/OpenCode/ai.opencode >/dev/null 2>&1 &`）。
   - VSCode 扩展：命令面板执行 `Developer: Reload Window`；或终端 `code --reuse-window` 重开该窗口。
   - 后台服务：终端执行 `opencode service restart`；用 systemd 单元时 `systemctl --user restart opencode.service`。
   - 想要一个 NNP=0 的会话（`sudo -A` 直接可用）：在终端里直接跑 `opencode`（TUI），或继续用 VSCode 扩展，而不是桌面 app。
2. 重启后自检：`grep NoNewPrivs /proc/self/status`。为 0 则 `sudo -A` 直接可用；仍为 1 就继续用 `sudo-run`，别在提权上反复试。

3. 仍失败时不要反复尝试提权：把需要 root 的命令整理成一段可直接粘贴的脚本，交给用户在 opencode 之外的终端手动执行，并说明预期输出与验证方式。

## OpenCode 后台服务（systemd）

- `~/.config/systemd/user/opencode.service` 已 enable：登录时执行 `opencode service start`，由 systemd（NoNewPrivs=0）拉起托管服务。
- 服务端口 49374；运行状态在 `~/.local/state/opencode/service.json`，配置在 `~/.config/opencode/service.json`（改端口用 `opencode service set port <port>`）。
- `opencode service start` 遇到健康服务会直接复用并退出 0，所以单元显示 `active (exited)` 是正常的。
- **绝不能在这个 app 打开时 `systemctl --user restart opencode.service`**：ExecStop 会执行 `opencode service stop`，当场掐断正在用的服务，会话直接断开（已实测踩过）。要换服务，顺序是：退出 app → 操作服务 → 再开 app。
- 排查三连：`opencode service status`、`ss -ltnp | grep 49374`、`grep NoNewPrivs /proc/<server-pid>/status`。

## 代码项目工作约定

### 如无必要, 勿增实体

### 复用优先检查

新功能先找现成的承载点, 别急着新建页面、入口、组件或服务。

先读项目说明和目录结构, 盘点现有的页面/路由、入口、宿主组件、composable 与 service, 找出职责最接近、生命周期也匹配的那个。

如果新功能和现有页面属于同一类任务, 就扩展那个页面、复用已有流程。比如图片获取、预览、识别、通知, 先看现有上传/识别页面能不能多一种输入方式, 而不是直接新建页面。只有现有承载点在生命周期、权限、交互或职责上确实不合适时, 才新增实体, 并说明为什么不复用。

提方案前至少比较一次“复用现有承载点”和“新增承载点”, 优先选改动更小、能复用既有流程的方案。


### 极简主义 UI 设计

能用图标表示的, 就用图标表示, 而不是用文字描述;
能复用系统功能的, 就复用系统功能, 而不是自定义实现;


## 注释要求

每块代码上方一句话说明在做什么。
使开发者不看代码, 只看注释就能理解代码的目的、手段和结果。
注释要包含上下游信息, 能从注释里知道代码的调用源和去向。

改动代码时同步重写受影响的注释, 保留最初动机和最新现状, 不写变更史。者从注释里看不出这段代码改过几次, 就好像它一开始就是这么写的。

## 提交要求

- 每轮对话后有一定量改动、适合提交时，自行提交当前对话产生的改动。
- 检测到会话外的改动时，弹出交互提示框让用户选择如何提交。
