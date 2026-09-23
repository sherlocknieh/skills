import os
import subprocess

from gi.repository import GObject, Nautilus


class OpenInVSCodeExtension(GObject.GObject, Nautilus.MenuProvider):
    def _open(self, _menu, files):
        seen = set()
        for f in files:
            path = f.get_location().get_path()
            if path and path not in seen:
                seen.add(path)
                subprocess.Popen(["code", path])

    def _make_item(self, name):
        return Nautilus.MenuItem(
            name=name,
            label="用 VSCode 打开",
            tip="在 Visual Studio Code 中打开",
        )

    def get_file_items(self, *args):
        files = args[-1]
        if not files:
            return []
        if not all(f.is_directory() for f in files):
            return []
        item = self._make_item("OpenInVSCodeExtension::open")
        item.connect("activate", self._open, files)
        return [item]

    def get_background_items(self, *args):
        folder = args[-1]
        item = self._make_item("OpenInVSCodeExtension::open_background")
        item.connect("activate", self._open, [folder])
        return [item]
