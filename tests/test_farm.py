"""The 3D farm loads in a real (headless) browser and every activity runs without a JavaScript error.

Needs Playwright (pip install playwright && playwright install chromium). Without it this test is skipped on your
computer, but it must run on GitHub (CI=true), so a broken farm can't reach the Pi.
"""
import os
import threading

import pytest

from conftest import PASSWORD, nevet_app

playwright = pytest.importorskip("playwright.sync_api", reason="Playwright isn't installed") if not os.environ.get("CI") \
    else __import__("playwright.sync_api", fromlist=["sync_playwright"])

GL = ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]


@pytest.fixture(scope="module")
def server():
    from werkzeug.serving import make_server
    srv = make_server("127.0.0.1", 0, nevet_app.app, threaded=True)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_farm_runs_every_activity(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(args=GL)
        page = browser.new_page(viewport={"width": 1000, "height": 700})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(server + "/login")
        page.fill("input[name=name]", "Michael") if page.locator("input[name=name]").is_visible() else \
            page.locator(".picker-hero[data-name='Michael']").first.click()
        page.fill("input[name=password]", PASSWORD)
        page.locator("button[type=submit]").first.click()
        page.wait_for_url(lambda u: "/login" not in u)
        page.goto(server + "/farm")
        page.wait_for_function("window.NevetFarm && NevetFarm.heroes && NevetFarm.heroes.length > 0", timeout=60000)
        for act in ["harvest", "water", "plant", "animals", "play", "campfire", "party", "campfire"]:
            page.evaluate(f"NevetFarm.setActivity('{act}'); NevetFarm.simulate(12)")
        assert page.evaluate("NevetFarm.debugFold().t") == 0          # back at the campfire: the arena is open again
        page.evaluate("NevetFarm.setActivity('party'); NevetFarm.simulate(8)")
        assert page.evaluate("NevetFarm.debugFold().t") == 1          # the party: folded into the fire tower
        # the farming lands: heroes walk round the crops, and from the yard (through the arch) to the mud pit
        assert page.evaluate("NevetFarm.blocked(-30, 100, 0.3)")       # the wheat
        assert page.evaluate("NevetFarm.blocked(46, 37, 0.3)")         # the vineyard
        assert not page.evaluate("NevetFarm.blocked(0, 81.6, 0.3)")    # the farm track
        route = page.evaluate("NevetFarm.path([0, -6], [0, 30])")
        assert route and abs(route[-1][0]) < 1 and abs(route[-1][1] - 30) < 1, route
        assert not errors, errors
        browser.close()


def test_guest_farm_and_tv_view(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(args=GL)
        page = browser.new_page(viewport={"width": 800, "height": 600})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        for url in ["/farm", "/farm?tv=1"]:
            page.goto(server + url)
            page.wait_for_function("window.NevetFarm && NevetFarm.heroes", timeout=60000)
            page.evaluate("NevetFarm.simulate(5)")
        assert not errors, errors
        browser.close()


def test_mother_tree_page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(args=GL)
        page = browser.new_page(viewport={"width": 1000, "height": 700})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(server + "/time?view=tree")
        page.wait_for_function("window.NevetTime && NevetTime.state().mode === 'tree'", timeout=60000)
        page.wait_for_timeout(1500)
        st = page.evaluate("NevetTime.state()")
        assert st["grown"] == st["heroes"] and st["generations"] >= 2, st          # every hero on the tree
        assert page.locator(".tt-node").count() == st["heroes"] + 1                  # and the farm, the root
        page.locator(".tt-node:not(.root)").first.click()
        page.wait_for_timeout(500)
        assert page.evaluate("NevetTime.state().selected")
        assert not errors, errors
        browser.close()
