import os
import subprocess
import sys

PYTHON_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Runs in a fresh interpreter: any attempt to import Qt or hidapi raises ImportError.
BLOCKER = """
import sys

class Blocker:
    BLOCKED = ("PyQt5", "hid", "hidraw")

    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in self.BLOCKED:
            raise ImportError("blocked import: " + name)
        return None

sys.meta_path.insert(0, Blocker())
"""


def run_isolated(code):
    return subprocess.run([sys.executable, "-c", BLOCKER + code], cwd=PYTHON_ROOT,
                          capture_output=True, text=True, timeout=60)


def test_protocol_core_imports_without_qt_or_hid():
    result = run_isolated("import protocol.keyboard_comm, protocol.qmk_settings_codec, transport")
    assert result.returncode == 0, result.stderr
