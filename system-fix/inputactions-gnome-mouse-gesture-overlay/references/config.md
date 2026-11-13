# 改手势配置

配置文件：`~/.config/inputactions/config.yaml`。改完只需：

```bash
inputactions config issues   # 应无输出
inputactions config reload   # 热生效，不用重编译、不用注销
```

## 手势怎么画

按住**鼠标右键**画，未松手就显示匹配到的动作名，松手执行。手势开始后停顿超过 **2 秒**会取消（轨迹和动作名一起消失，不执行）。正常松手时轨迹立即消失、动作名保留 0.8 秒。

四个斜向要求方向落在 **45°±`direction_tolerance`** 内（默认 18°，见 `overlay.mouse_stroke.direction_tolerance`）；略斜的水平/垂直会回落到直向，不会误触斜向。

## 当前映射

| 笔画 | 动作 | 范围 |
|---|---|---|
| → 右 | 右侧标签页（Ctrl+PageDown） | 浏览器 |
| ← 左 | 左侧标签页（Ctrl+PageUp） | 浏览器 |
| ↑ 上 | 滚动到顶部（Ctrl+Home） | 全局 |
| ↓ 下 | 滚动到底部（Ctrl+End） | 全局 |
| ↗ 右上 | 窗口最大化（Super+Up） | 全局 |
| ↘ 右下 / 右 → 下（折线） | 刷新页面（Ctrl+R） | 浏览器 |
| ↘ 右下 | 剪贴板（Super+V） | 全局 |
| ↖ 左上 | 截图（PrintScreen） | 全局 |
| ↙ 左下 | 取消最大化（Super+Down） | 全局 |
| 下 → 左（折线） | 撤销（Ctrl+Z） | 全局 |
| 下 → 右（折线） | 关闭标签页（Ctrl+W） | 全局 |
| 下 → 右 → 上（折线） | 关闭窗口（Alt+F4） | 全局 |
| 上 → 右（折线） | 新标签页（Ctrl+T） | 浏览器 |
| 左 → 右（折线） | 后退（Alt+Left） | 全局 |
| 右 → 左（折线） | 前进（Alt+Right） | 全局 |
| 左 → 下（折线） | 恢复标签页（Ctrl+Shift+T） | 浏览器 |
| → 右（直线） | 前进（Alt+Right） | 文件管理器 |
| ← 左（直线） | 后退（Alt+Left） | 文件管理器 |

配置本身是唯一事实来源；表只是速查，改完以 `config.yaml` 为准。

## 条件作用域

`mouse.gestures[0].gestures` 是一个有序列表；带 `conditions` 的项只在条件满足时匹配，同一笔画可以在不同应用里绑定不同动作。

- 浏览器组：`$window_class contains chrome / chromium / firefox / brave / edge`，或 `$window_class == Navigator`
- 文件管理器组：`$window_class contains Nautilus / dolphin / thunar / nemo / caja / pcmanfm`
- 不带 `conditions` 的项全局生效

要支持新的应用，往对应组的 `any` 列表加窗口 class。`$window_class` 由 InputActions 的 GNOME 辅助扩展提供。

## 新增笔画

1. 运行 `inputactions record-stroke`，按住右键画一次，复制输出的 base64。
2. 在目标条件组里加一项：

```yaml
- id: 动作名
  strokes: [ '<base64>' ]
  actions:
    - input:
        - keyboard: [ LEFTALT+LEFT ]
```

3. 折线模板用 3 个点（起点/拐点/终点），拐点 `t=0.5`，两段 alpha 写对应方向；实测 1:2～2:1 的两段长度比可稳定匹配。现有折线的 base64 可直接复用。
   - 手工构造/镜像折线时注意 base64 结构：每个点 4 字节 `x, y, 进度, 方向角`，数值都是 `值×100`（-1..1）；方向角按 `atan2/π` 编码：右=0、下=50、上=-50、左=100。改方向时**几何坐标和方向角要一起改**，只换 x/y 会让形状和角度序列对不上，笔画会命中另一条折线。
4. 重新校验并加载：

```bash
inputactions config issues && inputactions config reload
```

## 常见改动

- **同一笔画重复**：同笔画在多个条件组/全局出现时，激活阶段都会命中，结束时按轨迹得分取最高、同分取列表中靠前的一项。想让某个应用优先，就把它的条件组放在前面，并复用同一份 base64 模板；例如浏览器的「右下」刷新排在全局「右下」剪贴板之前。
- **方向反了**：交换动作里的 `LEFTALT+RIGHT` / `LEFTALT+LEFT`。
- **文件管理器左右滑**：文件管理器组里 `→` 前进（Alt+Right）、`←` 后退（Alt+Left）；同一对直线笔画在浏览器组里是切标签页。
- **改斜向容差**：改 `direction_tolerance` 后 `inputactions config reload`。
- **加快捷键**：键名用 InputActions 写法，例如 `LEFTCTRL+LEFTSHIFT+T`。

## 配置相关的坑

- `record-stroke` 录的模板依赖设备加速度曲线；用 uinput 合成轨迹录出来的匹配不上，要用真实鼠标录。
- `stroke` 与 `swipe` 同时配置会两个都失效，本配置只用 stroke。
- 停顿 2 秒取消手势的时长由客户端补丁常量 `MouseTriggerHandler::GESTURE_PAUSE_TIMEOUT{2000}` 控制，改时长要重新编译（见 `development.md`）。
- 斜向模板只接受 45°±`direction_tolerance` 的直线；非法值可能被 `inputactions config issues` 报出。
