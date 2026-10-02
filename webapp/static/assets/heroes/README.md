# Hero graphics

Heroes (growers) are drawn by code right now: `static/js/hero3d.js`
builds each hero from simple 3D shapes, driven by `catalog.json`.

## catalog.json

The single list of every look and item. The web app validates saved
heroes against it and the 3D renderer draws from it, so editing this
file is all you need to add or rename options (no restart needed).

- `classes`: starting presets (Gardener, Worm Tamer, ...). Picking a
  class sets its `preset` gear; everything stays customizable.
- `looks`: gender, skin, hair, colours, eyes, mouth, facial hair.
- `gear`: head, earrings, outfit, tool, back.
- `companion`: the pet and its settings (colour, size, accessory). The
  pet's name is free text, saved as `petName`.
- Category `type`: `color` options need a `color` (shown as swatches),
  `face` options are drawn on the face, `choice` shows plain buttons
  (gender, companion size), `item` shows drawn icon tiles.
- `default` (optional, on a category): the option new and existing
  heroes start with; otherwise the first option. Add new categories with
  a neutral default so existing heroes don't change.
- `rarity`: `common`, `uncommon`, `rare`, `epic`, `legendary`, shown
  as coloured tiles like in RPG inventories.

## Adding a new item

1. Add it to the right slot in `catalog.json` with a new `id`.
2. Add a builder for that `id` in `hero3d.js` (tables `HEAD`, `EARRINGS`,
   `BODY`, `HAND_ITEMS`, `BACK`, `PETS`, `PET_ACCESSORIES`, `HAIR`). Until
   then it's selectable but draws nothing, so the catalog can run ahead
   of the art.
3. To make part of an item move, call `fx(mesh, kind)` in its builder:
   `spin`, `bob`, `flicker`, `flap`, `rise`, `twinkle` or `shimmer`.
   Effects pause with "reduce motion".

## Using real artwork later

- **Icons:** add `"icon": "assets/heroes/icons/straw_hat.png"` to an
  option. The customizer shows that image instead of the drawn icon.
  Square PNG/SVG with a transparent background, 128x128 is plenty.
- **3D models:** planned. Put `.glb` files in `assets/models/` and a
  `"model"` field on the option; `hero3d.js` will need a GLTF loader to
  use them in place of the built-in shapes.
