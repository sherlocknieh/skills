import os
import subprocess

from gi.repository import GObject, Nautilus

# 打开 Web UI 的共享启动脚本（按目录建会话并打开浏览器），与 DING 桌面右键复用同一份逻辑
LAUNCHER = os.path.expanduser('~/.local/bin/opencode-webui')


def _launch_opencode_webui(path):
    subprocess.Popen([LAUNCHER, path], cwd=path, start_new_session=True)


class OpenInOpenCodeExtension(GObject.GObject, Nautilus.MenuProvider):
    def _open(self, _menu, files):
        seen = set()
        for f in files:
            path = f.get_location().get_path()
            if path and path not in seen:
                seen.add(path)
                _launch_opencode_webui(path)

    def _make_item(self, name):
        return Nautilus.MenuItem(
            name=name,
            label="用 OpenCode 打开",
            tip="在 OpenCode Web UI 中打开",
        )

    def get_file_items(self, *args):
        files = args[-1]
        if not files:
            return []
        if not all(f.is_directory() for f in files):
            return []
        item = self._make_item("OpenInOpenCodeExtension::open")
        item.connect("activate", self._open, files)
        return [item]

    def get_background_items(self, *args):
        folder = args[-1]
        item = self._make_item("OpenInOpenCodeExtension::open_background")
        item.connect("activate", self._open, [folder])
        return [item]
