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

const SCRIPT = '/usr/local/bin/wifi-hotspot';
const AP_IF = 'ap0';
const ICON = 'network-wireless-hotspot-symbolic';

function hotspotRunning() {
    return GLib.file_test(`/sys/class/net/${AP_IF}`, GLib.FileTest.EXISTS);
}

function spawn(argv) {
    return new Promise(resolve => {
        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
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
                ok = false;
            }
            resolve({ok, stdout});
        });
    });
}

const HotspotToggle = GObject.registerClass(
class HotspotToggle extends QuickMenuToggle {
    _init(host) {
        super._init({
            title: 'Wi-Fi 热点',
            iconName: ICON,
            toggleMode: true,
        });

        this._host = host;
        this._busy = false;

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

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('热点设置'));
        this.menu.addMenuItem(settingsItem);

        this._applyButton.connect('clicked', () => this._applyConfig());
        this._ssidEntry.clutter_text.connect('activate', () => this._applyConfig());
        this._passEntry.clutter_text.connect('activate', () => this._applyConfig());
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._refreshConfig();
        });

        this._sync();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            if (!this._busy)
                this._sync();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('clicked', () => {
            if (this._busy)
                return;
            const turningOn = this.checked;
            this._run(turningOn ? 'start' : 'stop', turningOn);
        });

        this.connect('destroy', () => {
            if (this._timeoutId) {
                GLib.source_remove(this._timeoutId);
                this._timeoutId = 0;
            }
        });
    }

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
                style_class: 'wifi-hotspot-entry',
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

    _sync() {
        const running = hotspotRunning();
        if (this.checked !== running)
            this.checked = running;
        this.subtitle = running ? '已开启（Wi-Fi 保持连接）' : '开启并保留当前 Wi-Fi';
    }

    async _refreshConfig() {
        const {ok, stdout} = await spawn(['sudo', '-n', SCRIPT, 'get-config']);
        if (!ok)
            return;
        const [ssid = '', pass = ''] = stdout.split('\n');
        this._ssidEntry.set_text(ssid);
        this._passEntry.set_text(pass);
    }

    async _applyConfig() {
        const ssid = this._ssidEntry.get_text().trim();
        const pass = this._passEntry.get_text();
        if (!ssid) {
            this._host.notify('Wi-Fi 热点', '网络名不能为空');
            return;
        }
        if (pass.length < 8) {
            this._host.notify('Wi-Fi 热点', '密码至少 8 位');
            return;
        }
        const {ok} = await spawn(['sudo', '-n', SCRIPT, 'set-config', ssid, pass]);
        if (!ok) {
            this._host.notify('Wi-Fi 热点', '保存失败（检查免密 sudo 配置）');
            return;
        }
        this.menu.close();
        this._sync();
        this._host.notify('Wi-Fi 热点',
            hotspotRunning() ? `已更新为 "${ssid}"，热点已重启` : `已保存 "${ssid}"`);
    }

    async _run(action, turningOn) {
        this._busy = true;
        this.reactive = false;
        this.iconName = 'content-loading-symbolic';

        const {ok} = await spawn(['sudo', '-n', SCRIPT, action]);

        this._busy = false;
        this.reactive = true;
        this.iconName = ICON;
        this._sync();

        if (!ok)
            this._host.notify('Wi-Fi 热点', '操作失败：请确认已配置免密 sudo（/etc/sudoers.d/wifi-hotspot）');
        else if (turningOn)
            this._host.notify('Wi-Fi 热点', '热点已开启，Wi-Fi 连接保持不变');
        else
            this._host.notify('Wi-Fi 热点', '热点已关闭');
    }
});

const HotspotIndicator = GObject.registerClass(
class HotspotIndicator extends SystemIndicator {
    _init(host) {
        super._init();
        this._toggle = new HotspotToggle(host);
        this.quickSettingsItems.push(this._toggle);
    }
});

export default class WifiHotspotExtension extends Extension {
    enable() {
        this._source = new MessageTray.Source({title: 'Wi-Fi 热点'});
        Main.messageTray.add(this._source);

        this._indicator = new HotspotIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
        this._source?.destroy();
        this._source = null;
    }

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
