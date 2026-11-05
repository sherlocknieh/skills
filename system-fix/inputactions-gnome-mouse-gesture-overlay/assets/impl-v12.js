import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BUS_NAME = 'org.inputactions.overlay';
const OBJ_PATH = '/org/inputactions/overlay/MouseStrokeOverlay';

const IFACE_XML = `
<node>
  <interface name="org.inputactions.overlay.MouseStrokeOverlay">
    <method name="show"/>
    <method name="hide"/>
    <method name="cancel"/>
    <method name="showLabel">
      <arg type="s" direction="in"/>
    </method>
  </interface>
</node>`;

function stageSize() {
    const w = global.screen_width;
    const h = global.screen_height;
    if (w > 0 && h > 0)
        return [w, h];

    const monitor = Main.layoutManager.primaryMonitor;
    return [monitor.width, monitor.height];
}

class StrokeOverlay {
    constructor() {
        this._area = null;
        this._points = [];
        this._timerId = 0;
        this._label = null;
        this._labelTimeout = 0;
        this._loggedDraw = false;
        this._unredirectDisabled = false;
    }

    show() {
        if (this._area)
            return;

        this._clearLabel();
        this._points = [];
        this._loggedDraw = false;

        const [x, y] = global.get_pointer();
        this._points.push([x, y]);

        const [sw, sh] = stageSize();
        this._disableUnredirect();
        log(`IA overlay show: pointer=${x},${y} size=${sw}x${sh} stage=${global.stage.width}x${global.stage.height}`);

        this._area = new St.DrawingArea({ reactive: false });
        this._area.set_size(sw, sh);
        this._area.connect('repaint', () => this._draw());
        global.stage.add_child(this._area);
        global.stage.set_child_above_sibling(this._area, null);
        this._area.show();
        this._area.queue_repaint();
        if (this._label)
            global.stage.set_child_above_sibling(this._label, null);
        log(`IA overlay area=${this._area.width}x${this._area.height} visible=${this._area.visible}`);

        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const [px, py] = global.get_pointer();
            const last = this._points[this._points.length - 1];
            if (!last || Math.abs(px - last[0]) + Math.abs(py - last[1]) >= 1) {
                this._points.push([px, py]);
                this._area?.queue_repaint();
            }
            if (this._label) {
                const [, lw] = this._label.get_preferred_width(-1);
                const [, lh] = this._label.get_preferred_height(lw);
                let lx = px + 18;
                let ly = py + 18;
                if (lx + lw > sw)
                    lx = px - lw - 18;
                if (ly + lh > sh)
                    ly = py - lh - 18;
                this._label.set_position(Math.max(0, lx), Math.max(0, ly));
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _draw() {
        if (!this._area || this._points.length < 2)
            return;

        const cr = this._area.get_context();
        if (!this._loggedDraw) {
            this._loggedDraw = true;
            log(`IA overlay first draw: points=${this._points.length}`);
        }

        cr.setLineWidth(2.5);
        cr.setLineCap(1);
        cr.setLineJoin(1);
        cr.setSourceRGBA(0.12, 0.78, 0.72, 1.0);
        cr.moveTo(this._points[0][0], this._points[0][1]);
        for (let i = 1; i < this._points.length; i++)
            cr.lineTo(this._points[i][0], this._points[i][1]);
        cr.stroke();
        cr.$dispose?.();
    }

    hide() {
        log('IA overlay hide');
        this._hideTrail();
        if (this._label)
            this._scheduleLabelHide();
        else
            this._enableUnredirect();
    }

    cancel() {
        log('IA overlay cancel');
        this._hideTrail();
        this._clearLabel();
    }

    _hideTrail() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (this._area) {
            this._area.destroy();
            this._area = null;
        }
        this._points = [];
    }

    showLabel(text) {
        text = String(text ?? '');
        log(`IA overlay label: ${text}`);
        if (!text) {
            this._clearLabel();
            return;
        }

        this._disableUnredirect();

        // 文本变化时重建标签，避免 St.Label 的 preferred size 缓存导致省略号截断
        if (this._label && this._label.get_text() !== text) {
            this._label.destroy();
            this._label = null;
        }

        if (!this._label) {
            this._label = new St.Label({
                text,
                style: 'background-color: rgba(40,40,40,0.92); color: #ffffff; ' +
                       'padding: 9px 15px; border-radius: 6px; ' +
                       'font-size: 17px; font-weight: bold;',
            });
            global.stage.add_child(this._label);
            this._label.show();
        }
        global.stage.set_child_above_sibling(this._label, null);

        const [x, y] = global.get_pointer();
        const [, natW] = this._label.get_preferred_width(-1);
        const [, natH] = this._label.get_preferred_height(natW);
        this._label.set_size(natW, natH);

        const [sw, sh] = stageSize();
        let lx = x + 18;
        let ly = y + 18;
        if (lx + natW > sw)
            lx = x - natW - 18;
        if (ly + natH > sh)
            ly = y - natH - 18;
        this._label.set_position(Math.max(0, lx), Math.max(0, ly));

        /* While a stroke is in progress the label stays; after release it fades out. */
        if (!this._area)
            this._scheduleLabelHide();
    }

    _scheduleLabelHide() {
        if (this._labelTimeout) {
            GLib.source_remove(this._labelTimeout);
            this._labelTimeout = 0;
        }
        if (!this._label)
            return;

        this._labelTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            this._labelTimeout = 0;
            this._clearLabel();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearLabel() {
        if (this._labelTimeout) {
            GLib.source_remove(this._labelTimeout);
            this._labelTimeout = 0;
        }
        if (this._label) {
            this._label.destroy();
            this._label = null;
        }
        if (!this._area)
            this._enableUnredirect();
    }

    _disableUnredirect() {
        if (this._unredirectDisabled)
            return;

        try {
            global.compositor?.disable_unredirect();
            this._unredirectDisabled = true;
        } catch (e) {
            logError(e, 'IA overlay: disable unredirect failed');
        }
    }

    _enableUnredirect() {
        if (!this._unredirectDisabled)
            return;

        try {
            global.compositor?.enable_unredirect();
        } catch (e) {
            logError(e, 'IA overlay: enable unredirect failed');
        }
        this._unredirectDisabled = false;
    }
}

export class Impl {
    enable() {
        try {
            this._overlay = new StrokeOverlay();

            this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, this._overlay);
            this._dbus.export(Gio.DBus.session, OBJ_PATH);

            this._nameId = Gio.bus_own_name_on_connection(
                Gio.DBus.session,
                BUS_NAME,
                Gio.BusNameOwnerFlags.NONE,
                null,
                null
            );
            log('IA overlay v12: enabled');
        } catch (e) {
            logError(e, 'IA overlay v12: enable failed');
        }
    }

    disable() {
        try {
            if (this._nameId) {
                Gio.bus_unown_name(this._nameId);
                this._nameId = 0;
            }
            if (this._dbus) {
                this._dbus.unexport();
                this._dbus = null;
            }
            this._overlay?.hide();
            this._overlay?._enableUnredirect();
            this._overlay = null;
            log('IA overlay v12: disabled');
        } catch (e) {
            logError(e, 'IA overlay v12: disable failed');
        }
    }
}
