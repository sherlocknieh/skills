import shutil
import subprocess

from gi.repository import GObject, Nautilus

TERMINALS = (
    ("ptyxis", ["-d", "{path}", "--"]),
    ("xdg-terminal-exec", ["--dir={path}"]),
    ("kgx", ["--working-directory={path}", "--"]),
    ("gnome-terminal", ["--working-directory={path}", "--"]),
)


def _launch_opencode(path):
    for name, args in TERMINALS:
        executable = shutil.which(name)
        if executable is None:
            continue
        argv = [executable]
        argv += [arg.format(path=path) for arg in args]
        argv.append("opencode")
        subprocess.Popen(argv, cwd=path, start_new_session=True)
        return
    subprocess.Popen(["opencode", path], cwd=path, start_new_session=True)


class OpenInOpenCodeExtension(GObject.GObject, Nautilus.MenuProvider):
    def _open(self, _menu, files):
        seen = set()
        for f in files:
            path = f.get_location().get_path()
            if path and path not in seen:
                seen.add(path)
                _launch_opencode(path)

    def _make_item(self, name):
        return Nautilus.MenuItem(
            name=name,
            label="用 OpenCode 打开",
            tip="在 OpenCode 中打开",
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
