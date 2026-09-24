---
name: sudo-askpass
description: 配置、修复、排查 opencode 无 TTY 时的提权与 SSH 密码输入（askpass + zenity）。适用于 opencode 里执行 sudo 报 'no tty present'、'a password is required'、'no askpass program specified'，或 ssh/scp 登录时无法输入密码/密钥口令（'Host key verification'、'Permission denied'），需要弹出图形密码框、安装/重装 askpass helper 或插件、或想知道 opencode 里 sudo/ssh 该怎么用。关键词：sudo、ssh、scp、askpass、SUDO_ASKPASS、SSH_ASKPASS、SSH_ASKPASS_REQUIRE、zenity、no tty present、password is required、--askpass、提权、opencode bash 无 TTY。
---

# opencode sudo / ssh askpass 提权配置

opencode 的 bash 工具没有 TTY，`sudo` 和 `ssh` 都无法交互读密码，分别会报
`sudo: a terminal is required to read the password` /
`no askpass program specified`，或 `ssh` 卡住/`Permission denied`。
本 skill 用 `SUDO_ASKPASS` / `SSH_ASKPASS` + zenity 解决：
需要密码时调用 GUI 对话框，用户输入后回传。

## 组成

| 组件 | 路径 | 作用 |
| --- | --- | --- |
| 环境变量 | `SUDO_ASKPASS` / `SSH_ASKPASS` | 指向 helper 脚本，sudo/ssh 据此找密码程序 |
| sudo helper | `~/.config/opencode/sudo-askpass.sh` | 弹 zenity 密码框，密码输出到 stdout |
| ssh helper | `~/.config/opencode/ssh-askpass.sh` | 同上，标题为「SSH 需要密码」 |
| 插件 | `~/.config/opencode/plugins/sudo-askpass.js` | 每次 shell 执行前注入两个变量 |
| 规则文档 | `~/.config/opencode/AGENTS.md` | 告知 agent：用 `sudo --askpass`，别索要密码 |

## sudo 用法

对任何需要提权的命令，直接运行：

```bash
sudo --askpass <命令>
```

sudo 会自动调用 `$SUDO_ASKPASS`（已由插件注入），弹出
`sudo 需要密码 (opencode)` 对话框。**不要要求用户手动在终端输密码。**
`sudo -A <命令>` 与 `sudo --askpass` 等价。

> 注意：普通 `sudo <命令>` 若 `SUDO_ASKPASS` 已设置且终端不可用，sudo
> 也会自动走 askpass；但显式 `--askpass` 最稳妥。

## ssh 用法

`ssh`/`scp`/`sftp` 用的是 `SSH_ASKPASS`（与 `SUDO_ASKPASS` 无关）。
opencode 的 bash 无 TTY，插件已注入 `SSH_ASKPASS`，通常无需额外参数即可
在需要时弹框输入密码或私钥口令：

```bash
ssh user@host          # 无 TTY 时自动走 SSH_ASKPASS 弹框
scp file user@host:/path
```

若 ssh 仍尝试读 TTY 而不弹框，显式强制：

```bash
SSH_ASKPASS_REQUIRE=force ssh user@host
```

也可临时指定 helper：

```bash
SSH_ASKPASS=~/.config/opencode/ssh-askpass.sh SSH_ASKPASS_REQUIRE=force ssh user@host
```

注意：
- `SSH_ASKPASS` 仅在**无 TTY** 时自动生效；有 TTY 的普通终端里点框不会弹，
  这是期望行为。插件**不设** `SSH_ASKPASS_REQUIRE`，以免影响正常终端 ssh。
- ssh 还要求设置了 `DISPLAY`（图形会话一般已有）。
- 只处理**密码/口令**提示；首次连接的 `Are you sure you want to continue connecting (yes/no)?`
  主机指纹确认走的是 TTY，askpass 覆盖不到，需预先写 `~/.ssh/known_hosts`
  或改用 `StrictHostKeyChecking=accept-new`。

## 安装 / 重建

1. sudo helper 脚本 `~/.config/opencode/sudo-askpass.sh`（需可执行）：

   ```sh
   #!/usr/bin/env sh
   # sudo askpass helper for opencode.
   # sudo has no TTY in opencode's bash tool, so it calls this program to read
   # the password. It prints the password to stdout, which sudo reads.
   exec zenity --password --title="sudo 需要密码 (opencode)" 2>/dev/null
   ```

   ```bash
   chmod +x ~/.config/opencode/sudo-askpass.sh
   ```

   依赖 `zenity`（`sudo --askpass dnf install -y zenity`）。

2. ssh helper 脚本 `~/.config/opencode/ssh-askpass.sh`（需可执行）：

   ```sh
   #!/usr/bin/env sh
   # ssh askpass helper for opencode.
   # ssh has no TTY in opencode's bash tool; when SSH_ASKPASS is set it calls this
   # program to read the password/passphrase. It prints the answer to stdout.
   exec zenity --password --title="SSH 需要密码 (opencode)" 2>/dev/null
   ```

   ```bash
   chmod +x ~/.config/opencode/ssh-askpass.sh
   ```

3. 插件 `~/.config/opencode/plugins/sudo-askpass.js`（同时注入两个变量）：

   ```js
   // Injects interactive askpass helpers into every shell opencode runs.
   export const SudoAskpassPlugin = async () => {
     return {
       "shell.env": async (_input, output) => {
         if (!output.env.SUDO_ASKPASS) {
           output.env.SUDO_ASKPASS = "/home/who/.config/opencode/sudo-askpass.sh"
         }
         if (!output.env.SSH_ASKPASS) {
           output.env.SSH_ASKPASS = "/home/who/.config/opencode/ssh-askpass.sh"
         }
       },
     }
   }
   ```

   插件放在 `plugins/` 目录会被自动发现，无需在 `opencode.jsonc` 注册。
   若改用其他路径，记得同步改这里和脚本路径（用绝对路径，别用 `~`）。
   不要把 `SSH_ASKPASS_REQUIRE=force` 写进插件，否则会影响有 TTY 的正常终端。

4. 全局规则 `~/.config/opencode/AGENTS.md`（让 agent 知道该用 askpass、
   且不要向用户索要密码）：

   ````markdown
   # Global opencode rules

   ## sudo / ssh 无障碍执行

   `SUDO_ASKPASS` 已设置为 `/home/who/.config/opencode/sudo-askpass.sh`，`SSH_ASKPASS` 已设置为 `/home/who/.config/opencode/ssh-askpass.sh`。在 opencode 的 bash 工具里没有 TTY，这两个脚本会自动弹出图形密码对话框（zenity）取得密码并回传。因此提权命令可直接运行：

   ```
   sudo --askpass <命令>
   ```

   ssh/scp 直接运行即可（无 TTY 时自动弹框）：

   ```
   ssh user@host
   ```

   或让 sudo 自动调用 askpass（无需交互）。无需手动输入密码，也不要在提示中要求用户提供密码。
   ````

5. 重启 opencode（配置/插件/skill 只在启动时加载，不热重载）。

## 验证与排查

```bash
echo "$SUDO_ASKPASS"                                   # 应指向 sudo helper
echo "$SSH_ASKPASS"                                    # 应指向 ssh helper
test -x ~/.config/opencode/sudo-askpass.sh && echo ok
test -x ~/.config/opencode/ssh-askpass.sh && echo ok
sudo --askpass true && echo "提权成功"                # 弹框后返回 0
```

- 弹框不出现：确认在图形会话（有 `DISPLAY`/`WAYLAND_DISPLAY`），且已装 `zenity`。
- `SUDO_ASKPASS`/`SSH_ASKPASS` 为空：插件未加载，检查文件名/语法，重启 opencode。
- 路径生效但脚本无执行权限：`chmod +x`。
- 用户取消对话框：zenity 退出码非 0，认证失败，属正常。
- ssh 有 TTY 时不弹框：这是设计如此；需要强制可加 `SSH_ASKPASS_REQUIRE=force`。
- ssh 卡在 `(yes/no)` 主机指纹确认：askpass 管不到，预先写 `known_hosts`
  或用 `StrictHostKeyChecking=accept-new`。

## 卸载 / 恢复

删除 sudo helper、ssh helper、插件三个文件即可（插件删除后重启 opencode
即不再注入）。如需恢复默认，一并删掉 `AGENTS.md` 里的「sudo / ssh 无障碍执行」一节。
