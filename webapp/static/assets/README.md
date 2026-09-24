# Nevet graphic assets

Everything in this folder is served live by Flask at `/static/assets/...`.
Drop a file in, refresh the browser — no restart or build step needed.
(If an old version keeps showing, do a hard refresh: Ctrl+Shift+R.)

| Folder      | What goes here                          | Formats              |
|-------------|-----------------------------------------|----------------------|
| `icons/`    | UI icons, life-stage badges, logos      | `.svg` (preferred), `.png` |
| `textures/` | Images wrapped onto 3D objects (soil, leaves, wood) | `.jpg`, `.png`, `.webp` (power-of-two sizes like 512x512 work best) |
| `models/`   | 3D models for the WebGL views           | `.glb` (preferred), `.gltf` |
| `sounds/`   | UI clicks, notification sounds          | `.ogg`, `.mp3`       |

## Using them

In a template:
```html
<img src="{{ url_for('static', filename='assets/icons/seed.svg') }}">
```

In three.js:
```js
new THREE.TextureLoader().load('/static/assets/textures/soil.jpg');
```

## Guidelines

- Keep files small: the Pi 3B serves them over WiFi. Aim for under
  ~200 KB per texture and ~1 MB per model.
- Only add assets you made yourself or that have a license allowing
  reuse (CC0, CC-BY, MIT). Note the source + license in `CREDITS.md`
  in the same folder when it isn't your own work.
- Lowercase file names with dashes: `worm-bin.glb`, not `Worm Bin.GLB`.
