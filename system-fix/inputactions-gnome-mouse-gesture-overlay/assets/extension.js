import Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

/*
 * Thin, cache-stable loader.
 *
 * GNOME Shell caches ESM modules by URL for the lifetime of the session, so
 * editing extension.js and calling disable()/enable() does NOT load new code.
 * The actual implementation therefore lives in a versioned file (impl-vN.js)
 * and its name is read from impl-current.txt at enable() time. Bumping the
 * file name yields a fresh module import without logging out.
 */

export default class InputActionsOverlayLoader extends Extension {
    enable() {
        this._enabled = true;
        this._impl = null;

        let name = 'impl-v1.js';
        try {
            const [ok, contents] = this.dir
                .get_child('impl-current.txt')
                .load_contents(null);
            if (ok) {
                const value = [...contents]
                    .map(b => String.fromCharCode(b))
                    .join('')
                    .trim();
                if (value)
                    name = value;
            }
        } catch (e) {
            logError(e, 'IA overlay: cannot read impl-current.txt');
        }

        const path = this.dir.get_child(name).get_path();
        const url = `file://${path}`;
        log(`IA overlay: loading ${name}`);

        import(url).then(mod => {
            if (!this._enabled)
                return;
            try {
                this._impl = new mod.Impl();
                this._impl.enable();
            } catch (e) {
                logError(e, 'IA overlay: impl enable failed');
            }
        }).catch(e => {
            logError(e, `IA overlay: failed to import ${name}`);
        });
    }

    disable() {
        this._enabled = false;
        try {
            this._impl?.disable();
        } catch (e) {
            logError(e, 'IA overlay: impl disable failed');
        }
        this._impl = null;
    }
}
