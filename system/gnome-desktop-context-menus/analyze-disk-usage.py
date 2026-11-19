import subprocess

from gi.repository import GObject, Nautilus


# Nautilus 右键菜单「分析磁盘占用」：文件夹图标右键或文件夹内空白右键时，
# 用 baobab（GNOME 磁盘占用分析器）打开所选目录。由 Nautilus 启动时加载，
# 与同目录 open-in-vscode.py / open-in-opencode.py 同级并存。
class AnalyzeDiskUsageExtension(GObject.GObject, Nautilus.MenuProvider):
    # 为每个不同目录各开一个 baobab 窗口（baobab 一次只接受一个目录）
    def _open(self, _menu, files):
        seen = set()
        for f in files:
            path = f.get_location().get_path()
            if path and path not in seen:
                seen.add(path)
                subprocess.Popen(["baobab", path])

    # 构造菜单项，label/tip 与其它扩展保持一致的中文风格
    def _make_item(self, name):
        return Nautilus.MenuItem(
            name=name,
            label="分析磁盘占用",
            tip="用磁盘占用分析器分析此文件夹",
        )

    # 仅当所选全部是文件夹时，在图标右键菜单中显示
    def get_file_items(self, *args):
        files = args[-1]
        if not files:
            return []
        if not all(f.is_directory() for f in files):
            return []
        item = self._make_item("AnalyzeDiskUsageExtension::open")
        item.connect("activate", self._open, files)
        return [item]

    # 文件夹内空白右键：分析当前所在文件夹
    def get_background_items(self, *args):
        folder = args[-1]
        item = self._make_item("AnalyzeDiskUsageExtension::open_background")
        item.connect("activate", self._open, [folder])
        return [item]
