"""Nevet on the Pi's own screen (tty1): the shop window fits the little display, and the login hook that starts it
(scripts/console_hook.sh) adds itself once, only for tty1, and can be turned off."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / "scripts" / "console_hook.sh"


def cells(s):
    sys.path.insert(0, str(ROOT / "scripts"))
    import nevet_show
    return nevet_show.cells(s)


@pytest.mark.parametrize("size", [(40, 30), (30, 20), (52, 24)])
def test_small_screen_pages_fit(size, monkeypatch):
    """Every page fits the Pi's little display exactly (nothing wraps or scrolls away), and the QR code is there."""
    sys.path.insert(0, str(ROOT / "scripts"))
    monkeypatch.setenv("TERM", "linux")
    import nevet_show
    monkeypatch.setattr(nevet_show, "all_links", lambda max_age=120: [("Garden WiFi", "http://192.168.1.20:8000/"),
                                                                      ("Tailscale", "http://100.102.237.3:8000/")])
    monkeypatch.setattr(nevet_show.scr, "join_target", lambda funnel=None: {
        "url": "http://192.168.1.20:8000/join", "shown": "192.168.1.20:8000/join", "where": "home", "invite": None,
        "note": "Phones on the garden's WiFi", "base": "http://192.168.1.20:8000/"})
    W, H = size
    pages = nevet_show.pages(W, H, seed=1)
    names = [name for name, _ in pages]
    assert names[:2] == ["farm", "join"] and names[-1] == "know"
    for name, lines in pages:
        assert len(lines) <= H - 1, (name, len(lines))
        for line in lines:
            assert cells(line) <= W, (name, line)
    links = "\n".join("\n".join(lines) for name, lines in pages if name in ("join", "links"))
    assert "192.168.1.20:8000" in links and "100.102.237.3:8000" in links      # every link, on the QR page or its own
    assert "▀" in "\n".join(pages[1][1]) or "█" in "\n".join(pages[1][1])      # the QR code


def run_hook(home, *args):
    env = dict(os.environ, HOME=str(home))
    return subprocess.run([str(HOOK), *args], env=env, capture_output=True, text=True, timeout=30)


def test_console_hook_adds_itself_once(tmp_path):
    (tmp_path / ".profile").write_text("export PATH=$HOME/bin:$PATH\n")
    assert run_hook(tmp_path, "auto").returncode == 0
    text = (tmp_path / ".profile").read_text()
    assert text.startswith("export PATH") and text.count(">>> nevet console >>>") == 1
    assert '"/dev/tty1"' in text and "nevet_console.sh" in text            # only the Pi's own screen
    run_hook(tmp_path, "auto")
    assert (tmp_path / ".profile").read_text() == text                      # (again: nothing changes)
    # a login shell elsewhere (SSH, a terminal) is untouched
    r = subprocess.run(["bash", "--login", "-c", "echo fine"], env=dict(os.environ, HOME=str(tmp_path)),
                       capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=30)
    assert r.stdout.strip() == "fine"


def test_console_hook_off_stays_off(tmp_path):
    run_hook(tmp_path, "auto")
    assert "off" in run_hook(tmp_path, "off").stdout.lower() or (tmp_path / ".nevet-console-off").exists()
    assert (tmp_path / ".nevet-console-off").exists()
    before = (tmp_path / ".profile").read_text()
    run_hook(tmp_path, "auto")                                              # the updater doesn't turn it back on
    assert (tmp_path / ".profile").read_text() == before
    assert "off" in run_hook(tmp_path, "status").stdout
    run_hook(tmp_path, "on")
    assert not (tmp_path / ".nevet-console-off").exists()


def test_console_hook_prefers_bash_profile(tmp_path):
    (tmp_path / ".bash_profile").write_text(". ~/.profile\n")
    (tmp_path / ".profile").write_text("# profile\n")
    run_hook(tmp_path, "auto")
    assert ">>> nevet console >>>" in (tmp_path / ".bash_profile").read_text()
    assert ">>> nevet console >>>" not in (tmp_path / ".profile").read_text()
