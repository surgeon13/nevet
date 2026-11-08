"""The code itself: every Python file compiles, every page template parses, every script is valid JavaScript."""
import py_compile
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import ROOT, nevet_app

PY = sorted(p for p in ROOT.rglob("*.py") if ".git" not in p.parts and "__pycache__" not in p.parts)
JS = sorted((ROOT / "webapp" / "static" / "js").glob("*.js"))


@pytest.mark.parametrize("path", PY, ids=lambda p: str(p.relative_to(ROOT)))
def test_python_compiles(path):
    py_compile.compile(str(path), doraise=True)


def test_templates_parse():
    env = nevet_app.app.jinja_env
    for name in env.list_templates():
        if name.endswith(".html"):
            env.get_template(name)


@pytest.mark.skipif(not shutil.which("node"), reason="node isn't installed")
@pytest.mark.parametrize("path", JS, ids=lambda p: p.name)
def test_javascript_parses(path):
    r = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_shell_scripts_parse():
    for sh in sorted((ROOT / "scripts").glob("*.sh")) + [ROOT / "install.sh"]:
        r = subprocess.run(["bash", "-n", str(sh)], capture_output=True, text=True)
        assert r.returncode == 0, f"{sh.name}: {r.stderr}"
