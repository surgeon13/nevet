"""The village view's levels (farm_levels.py): from real records, only ever growing, never past the top."""
import farm_levels


def test_level_steps():
    assert farm_levels.level_of(0, 1) == (0, 0.0)
    assert farm_levels.level_of(1, 1)[0] == 1
    assert farm_levels.level_of(2, 1)[0] == 2                     # (level 2 at 1.6: a whole 2)
    assert farm_levels.level_of(10 ** 9, 1) == (farm_levels.MAX, 1.0)
    last = 0
    for v in range(0, 500):                                      # more never means a lower level
        lv = farm_levels.level_of(v, 1)[0]
        assert lv >= last
        last = lv


def test_levels_for_the_farm():
    out = farm_levels.levels()
    ids = {l["id"] for l in out}
    assert {"arena", "stage", "garden", "barn", "worms", "orchard", "wheat", "haybarn"} <= ids
    for l in out:
        assert l["view"] in ("village", "fields") and 0 <= l["level"] <= farm_levels.MAX and 0 <= l["pct"] <= 1
        assert l["grows"] and l["shown"]
        if l["level"] < farm_levels.MAX:
            assert l["next"] > 0 and l["next_shown"]
    by = {l["id"]: l for l in out}
    assert by["barn"]["level"] >= 1 and by["mother"]["level"] >= 1          # the test farm harvested 1.2 kg and has heroes
