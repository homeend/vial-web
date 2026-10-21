""" Vial has no Qt any more, and what runs without a real keyboard never loads hidapi: run_isolated() runs code in a
fresh interpreter where importing either fails, for the tests that check that (fake mode, the API schema...) """
import ast
import os
import pathlib
import subprocess
import sys

PYTHON_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QT_PACKAGES = ("PyQt5", "PyQt6", "PySide2", "PySide6", "qtpy", "fbs_runtime")
""" Qt's Python bindings, and the runtime of fbs (the Qt app's packager) """

# Runs in a fresh interpreter: any attempt to import Qt or hidapi raises ImportError.
BLOCKER = """
import sys

class Blocker:
    BLOCKED = {blocked!r}

    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in self.BLOCKED:
            raise ImportError("blocked import: " + name)
        return None

sys.meta_path.insert(0, Blocker())
""".format(blocked=QT_PACKAGES + ("hid", "hidraw"))


def run_isolated(code):
    return subprocess.run([sys.executable, "-c", BLOCKER + code], cwd=PYTHON_ROOT,
                          capture_output=True, text=True, timeout=60)


def imported_packages(path):
    """ The top-level packages a source file imports, wherever in the file """
    found = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            found.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.add(node.module.split(".")[0])
    return found


def test_no_source_imports_qt():
    users = {}
    scanned = set()
    for path in sorted(pathlib.Path(PYTHON_ROOT).rglob("*.py")):
        scanned.add(path.relative_to(PYTHON_ROOT).as_posix())
        qt = imported_packages(path) & set(QT_PACKAGES)
        if qt:
            users[str(path.relative_to(PYTHON_ROOT))] = sorted(qt)
    assert {"vial_web.py", "server/app.py", "protocol/keyboard_comm.py"} <= scanned  # it looked at the sources
    assert users == {}


def test_protocol_core_imports_without_qt_or_hid():
    result = run_isolated("import protocol.keyboard_comm, protocol.qmk_settings_codec, protocol.flasher, transport")
    assert result.returncode == 0, result.stderr
