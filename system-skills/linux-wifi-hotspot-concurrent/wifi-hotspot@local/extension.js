'use strict';

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

// 后端脚本负责实际创建/销毁热点，以及读写热点配置。
// 扩展本身只通过参数调用脚本，不直接修改 NetworkManager 或 hostapd 的状态。
const SCRIPT = '/usr/local/bin/wifi-hotspot';

// 后端脚本创建的 AP 接口名称。通过检查该接口是否存在来判断热点是否正在运行。
const AP_IF = 'ap0';

// 快捷设置按钮和普通空闲状态共用的图标。
const ICON = 'network-wireless-hotspot-symbolic';

// 检查后端创建的 AP 网络接口是否存在，以判断热点当前是否正在运行。
function hotspotRunning() {
    // /sys/class/net 中的接口由内核实时暴露，因此比缓存一个“已开启”标记更可靠。
    return GLib.file_test(`/sys/class/net/${AP_IF}`, GLib.FileTest.EXISTS);
}

// 异步执行外部命令，并返回命令是否成功及其标准输出。
function spawn(argv) {
    // Gio.Subprocess 的异步封装：GNOME Shell 主线程不能同步等待外部命令，
    // 否则脚本执行期间整个桌面界面都会卡住。
    return new Promise(resolve => {
        let proc;
        try {
            // 只读取标准输出；错误输出由 STDERR_SILENCE 屏蔽，避免把脚本的诊断信息
            // 直接混入扩展逻辑。调用方通过 ok 判断命令是否成功。
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            // 进程无法创建（例如脚本不存在或参数无效）时，统一转换为失败结果。
            resolve({ok: false, stdout: ''});
            return;
        }
        proc.communicate_utf8_async(null, null, (p, res) => {
            let ok = false;
            let stdout = '';
            try {
                const [, out] = p.communicate_utf8_finish(res);
                stdout = out ?? '';
                ok = p.get_successful();
            } catch (e) {
                // 通信过程也可能失败，例如子进程被异常终止；这种情况不能当作成功。
                ok = false;
            }
            resolve({ok, stdout});
        });
    });
}
// 热点开关、配置表单和客户端列表。
const HotspotToggle = GObject.registerClass(
class HotspotToggle extends QuickMenuToggle {
    // 创建热点快捷开关、配置表单和已连接客户端列表，并注册周期性刷新任务。
    _init(host) {
        super._init({
            title: 'Wi-Fi 热点',
            iconName: ICON,
            toggleMode: true,
        });

        this._host = host;
        // _busy 防止用户在 start/stop 尚未完成时重复触发操作。
        this._busy = false;
        // 客户端列表只在热点运行时显示；初始值用于让按钮在首次刷新前也有合理状态。
        this._clientCount = 0;
        this._wasRunning = false;

        const ssidRow = this._makeEntryRow('网络名', false);
        const passRow = this._makeEntryRow('密码', true);
        this._ssidEntry = ssidRow.entry;
        this._passEntry = passRow.entry;

        const content = new St.BoxLayout({
            x_expand: true,
            vertical: true,
            style_class: 'wifi-hotspot-content',
        });
        content.add_child(ssidRow.row);
        content.add_child(passRow.row);

        this._applyButton = new St.Button({
            label: '应用',
            x_expand: true,
            can_focus: true,
            style_class: 'button wifi-hotspot-apply',
        });
        content.add_child(this._applyButton);

        const settingsItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        settingsItem.add_child(content);

        this._settingsSeparator = new PopupMenu.PopupSeparatorMenuItem('热点设置');
        this._settingsSeparator.add_style_class_name('wifi-hotspot-section-separator');
        this.menu.addMenuItem(this._settingsSeparator);
        this.menu.addMenuItem(settingsItem);
        this._settingsItem = settingsItem;

        this._clientsContent = new St.BoxLayout({
            x_expand: true,
            vertical: true,
            style_class: 'wifi-hotspot-clients-content',
        });
        this._clientsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._clientsItem.add_child(this._clientsContent);
        this._clientsSeparator = new PopupMenu.PopupSeparatorMenuItem('已连接用户');
        this.menu.addMenuItem(this._clientsSeparator);
        this.menu.addMenuItem(this._clientsItem);

        // “应用”按钮和两个输入框的回车键使用同一条配置保存路径。
        this._applyButton.connect('clicked', () => this._applyConfig());
        this._ssidEntry.clutter_text.connect('activate', () => this._applyConfig());
        this._passEntry.clutter_text.connect('activate', () => this._applyConfig());
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                // 打开菜单时读取最新配置和客户端列表，避免显示过期数据。
                this._refreshConfig();
                this._refreshClients();
            }
        });

        // 初始化一次界面，然后分别以较低频率同步热点状态、以较高频率更新客户端数量。
        this._sync();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            if (!this._busy) {
                this._sync();
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._clientsTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (!this._busy && hotspotRunning())
                this._refreshClients();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('clicked', () => {
            // checked 已由 QuickMenuToggle 更新，点击前后即可用它推断目标状态。
            if (this._busy)
                return;
            const turningOn = this.checked;
            this._run(turningOn ? 'start' : 'stop', turningOn);
        });

        this.connect('destroy', () => {
            // 扩展卸载时必须移除定时器，否则回调会继续访问已销毁的 Shell 对象。
            if (this._timeoutId) {
                GLib.source_remove(this._timeoutId);
                this._timeoutId = 0;
            }
            if (this._clientsTimeoutId) {
                GLib.source_remove(this._clientsTimeoutId);
                this._clientsTimeoutId = 0;
            }
        });
    }

    // 创建一个带标签的文本输入行；密码行使用支持显示/隐藏按钮的密码输入框。
    _makeEntryRow(labelText, isPassword) {
        const row = new St.BoxLayout({
            x_expand: true,
            style_class: 'wifi-hotspot-row',
        });
        const label = new St.Label({
            text: labelText,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'wifi-hotspot-label',
        });
        const entry = isPassword
            ? new St.PasswordEntry({
                x_expand: true,
                can_focus: true,
                show_peek_icon: true,
                style_class: 'wifi-hotspot-entry wifi-hotspot-password-entry',
            })
            : new St.Entry({
                x_expand: true,
                can_focus: true,
                style_class: 'wifi-hotspot-entry',
            });
        row.add_child(label);
        row.add_child(entry);
        return {row, entry};
    }

    // 根据真实网络接口状态同步开关、标题、副标题以及菜单区域的可见性。
    _sync() {
        const running = hotspotRunning();
        // checked 是开关的视觉状态；只有实际 AP 接口状态变化时才需要赋值。
        if (this.checked !== running)
            this.checked = running;

        // 从停止变为运行时，客户端数量先归零，等待下一次 iw 查询填充真实值。
        if (running && !this._wasRunning)
            this._clientCount = 0;
        this.subtitle = running ? `${this._clientCount} 用户已连接` : null;
        this._wasRunning = running;

        // 配置表单只在停止状态显示，避免用户在热点运行期间修改配置。
        // 客户端区域则只在运行状态显示，保持快捷设置菜单紧凑。
        this._settingsSeparator.visible = !running;
        this._settingsItem.visible = !running;
        this._clientsSeparator.visible = running;
        this._clientsItem.visible = running;
    }

    // 查询当前连接到 AP 接口的客户端，并更新快捷设置中的客户端列表。
    async _refreshClients() {
        // 定时器和菜单打开事件可能同时请求刷新；同一时间只允许一个 iw 查询。
        if (this._clientsRefreshBusy || !hotspotRunning())
            return;
        this._clientsRefreshBusy = true;
        const {ok, stdout} = await spawn(['iw', 'dev', AP_IF, 'station', 'dump']);
        this._clientsRefreshBusy = false;
        if (!ok || !hotspotRunning())
            return;

        // iw 的 station dump 每个设备以 “Station <MAC>” 开头。
        // 只提取 MAC 地址，忽略信号强度等其余字段，避免把易变信息展示给用户。
        this._clientsContent.destroy_all_children();
        const clients = stdout.split('\n')
            .map(line => line.match(/^Station\s+([0-9a-f]{2}(?::[0-9a-f]{2}){5})\s/i)?.[1])
            .filter(Boolean)
            .map(mac => ({mac}));
        this._clientCount = clients.length;
        this.subtitle = `${clients.length} 用户已连接`;
        if (clients.length === 0) {
            // 保留一个明确的空状态，而不是显示空白区域。
            this._clientsContent.add_child(new St.Label({
                text: '暂无已连接用户',
                style_class: 'wifi-hotspot-empty',
            }));
            return;
        }

        for (const client of clients) {
            // 当前后端只提供 MAC 地址，因此每个客户端显示一个固定说明和 MAC。
            const row = new St.BoxLayout({
                x_expand: true,
                style_class: 'wifi-hotspot-client-row',
            });
            row.add_child(new St.Label({
                text: '已连接设备',
                x_expand: true,
                style_class: 'wifi-hotspot-client-details',
            }));
            row.add_child(new St.Label({
                text: client.mac,
                style_class: 'wifi-hotspot-client-mac',
            }));
            this._clientsContent.add_child(row);
        }
    }

    // 从后端脚本读取热点 SSID 和密码，并填充到配置表单。
    async _refreshConfig() {
        // -n 要求 sudo 不弹出密码提示；GNOME Shell 中无法安全地交互式输入 sudo 密码。
        const {ok, stdout} = await spawn(['sudo', '-n', SCRIPT, 'get-config']);
        if (!ok)
            return;

        // 后端以两行输出 SSID 和密码。缺少任意一行时使用空字符串，避免残留旧值。
        const [ssid = '', pass = ''] = stdout.split('\n');
        this._ssidEntry.set_text(ssid);
        this._passEntry.set_text(pass);
    }

    // 校验并保存用户填写的热点配置；热点运行时由后端负责重新应用配置。
    async _applyConfig() {
        const ssid = this._ssidEntry.get_text().trim();
        const pass = this._passEntry.get_text();

        // 先在前端校验，减少无效 sudo 调用，并给用户即时反馈。
        if (!ssid) {
            this._host.notify('Wi-Fi 热点', '网络名不能为空');
            return;
        }
        if (pass.length < 8) {
            this._host.notify('Wi-Fi 热点', '密码至少 8 位');
            return;
        }

        // 执行热点配置命令，等待结果反馈。
        const {ok} = await spawn(['sudo', '-n', SCRIPT, 'set-config', ssid, pass]);
        if (!ok) {
            // 失败时保留菜单和输入内容，方便用户修正 sudo 配置或重新尝试。
            this._host.notify('Wi-Fi 热点', '保存失败（检查免密 sudo 配置）');
            return;
        }

        // 保存成功后关闭菜单并重新同步；运行中的热点通常会由脚本重启以应用配置。
        this.menu.close();
        this._sync();
        this._host.notify('Wi-Fi 热点',
            hotspotRunning() ? `已更新为 "${ssid}"，热点已重启` : `已保存 "${ssid}"`);
    }

    // 执行热点启动或停止操作，并在完成后恢复控件状态和发送结果通知。
    async _run(action, turningOn) {
        // 禁用交互并切换为加载图标，防止重复 start/stop 以及给用户明确的进行中反馈。
        this._busy = true;
        this.reactive = false;
        this.iconName = 'content-loading-symbolic';

        // 执行热点切换命令，等待结果反馈。
        const {ok} = await spawn(['sudo', '-n', SCRIPT, action]);

        this._busy = false;
        this.reactive = true;
        this.iconName = ICON;
        this._sync();

        if (!ok)
            this._host.notify('Wi-Fi 热点', '开启失败, 不支持 5GHz 频段, 请切换 Wi-Fi 连接');
        // else if (turningOn)
        //     this._host.notify('Wi-Fi 热点', '已开启');
        // else
        //     this._host.notify('Wi-Fi 热点', '已关闭');
    }
});
// 热点指示器，包含开关、配置表单和客户端列表。
const HotspotIndicator = GObject.registerClass(
class HotspotIndicator extends SystemIndicator {
    // 创建热点快捷开关，并将其注册为系统快捷设置中的外部指示器。
    _init(host) {
        super._init();
        this._toggle = new HotspotToggle(host);
        this.quickSettingsItems.push(this._toggle);
    }
});
// 扩展主类，负责初始化通知源和系统快捷设置中的热点指示器。
export default class WifiHotspotExtension extends Extension {
    // 初始化通知源和系统快捷设置中的热点指示器。
    enable() {
        this._source = new MessageTray.Source({title: 'Wi-Fi 热点'});
        Main.messageTray.add(this._source);

        this._indicator = new HotspotIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    // 移除快捷设置控件、通知源及其相关资源。
    disable() {
        if (this._indicator) {
            // 先销毁子项，再销毁指示器，确保快捷设置菜单中的所有 actor 都被清理。
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
        // 通知源也属于扩展生命周期的一部分，禁用时一并释放。
        this._source?.destroy();
        this._source = null;
    }

    // 向通知中心发送一条热点操作结果通知。
    notify(title, body) {
        if (!this._source)
            return;
        this._source.addNotification(new MessageTray.Notification({
            source: this._source,
            title,
            body,
        }));
    }
}
