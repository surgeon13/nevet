/* Garden map page: Leaflet + OpenStreetMap / satellite tiles, drawing
 * with Leaflet-Geoman. Data comes from window.NEVET_MAP (see app.py
 * map_page) and is saved through the /api/map/* JSON endpoints.
 *
 * Kinds of map items: area (beds, zones), path (walkways, irrigation),
 * point (tap, compost, tree...), asset (a plant / worm bin pin).
 */
(function () {
  'use strict';
  var D = window.NEVET_MAP;
  if (!D || typeof L === 'undefined') return;
  var CSRF = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var CATS = D.categories, PALETTE = D.palette;

  function $(id) { return document.getElementById(id); }
  var shell = $('map-shell'), mapEl = $('garden-map'), sheet = $('map-sheet'), sheetBody = $('sheet-body');

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('Something went wrong (' + r.status + ').'));
        return j;
      });
    }, function () { throw new Error("Can't reach Nevet right now. Check the connection and try again."); });
  }
  function store(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
  }

  var ICONS = {
    drop: '<path d="M12 3c3.6 4.3 6 7.6 6 10.6a6 6 0 0 1-12 0C6 10.6 8.4 7.3 12 3z"/>',
    recycle: '<path d="M3.5 19.5h17M5.5 19.5c.8-4.6 3.4-7.5 6.5-7.5s5.7 2.9 6.5 7.5M12 12V8.5M12 10c0-2.2-1.6-3.6-4-3.6 0 2.2 1.6 3.6 4 3.6zM12 9c0-1.9 1.4-3.1 3.5-3.1 0 1.9-1.4 3.1-3.5 3.1z"/>',
    tree: '<path d="M12 21.5v-6M9 21.5h6M12 15.5c-3.9 0-6.5-2.4-6.5-5.6a4.6 4.6 0 0 1 2.9-4.3A4.2 4.2 0 0 1 12 2.5a4.2 4.2 0 0 1 3.6 3.1 4.6 4.6 0 0 1 2.9 4.3c0 3.2-2.6 5.6-6.5 5.6z"/>',
    tools: '<path d="M3 11l9-7 9 7M5.5 9.5V20h13V9.5M9.5 20v-6h5v6"/>',
    bench: '<path d="M4 10.5h16M4.5 14.5h15M6.5 14.5v5M17.5 14.5v5M6.5 10.5V6.5M17.5 10.5V6.5M6.5 6.5h11"/>',
    hive: '<path d="M7 5h10l2.5 3.5L17 12H7L4.5 8.5zM7 12h10l2.5 3.5L17 19H7l-2.5-3.5z"/><circle cx="12" cy="15.5" r="1.1" class="fill"/>',
    barrel: '<path d="M7 3.5h10M7 20.5h10M7.5 3.5c-1.6 3-1.6 14 0 17M16.5 3.5c1.6 3 1.6 14 0 17M6.3 9h11.4M6.3 15h11.4"/>',
    gate: '<path d="M4 21V4M20 21V4M4 7.5h16M4 18h16M8.5 7.5V18M12 7.5V18M15.5 7.5V18"/>',
    antenna: '<path d="M12 13v8M8.5 21h7M9 9.6a4.2 4.2 0 0 1 6 0M6.4 7a8 8 0 0 1 11.2 0"/><circle cx="12" cy="11.6" r="1.4" class="fill"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
    sprout: '<path d="M12 21v-9M12 12c0-4-3-6.5-7-6.5 0 4 3 6.5 7 6.5zM12 10c0-3 2.2-5 6-5 0 3-2.2 5-6 5zM7 21h10"/>',
    worm: '<path d="M3 15c2-4.5 4-4.5 6 0s4 4.5 6 0 3.5-4 5.5-1.5"/><circle cx="20.5" cy="12.5" r=".8" class="fill"/>',
    area: '<path d="M5 7.5l7-4 7 5-2 11H7z"/><circle cx="5" cy="7.5" r="1.4" class="fill"/><circle cx="12" cy="3.5" r="1.4" class="fill"/><circle cx="19" cy="8.5" r="1.4" class="fill"/><circle cx="17" cy="19.5" r="1.4" class="fill"/><circle cx="7" cy="19.5" r="1.4" class="fill"/>',
    path: '<path d="M4 19c4-1 3.2-7.4 8-8.5S17 6.4 20 5"/><circle cx="4" cy="19" r="1.4" class="fill"/><circle cx="12" cy="10.5" r="1.4" class="fill"/><circle cx="20" cy="5" r="1.4" class="fill"/>',
    trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
    shape: '<path d="M4 18l5-12 6 4 5-3"/><rect x="2.5" y="16.5" width="3" height="3" rx=".6"/><rect x="7.5" y="4.5" width="3" height="3" rx=".6"/><rect x="13.5" y="8.5" width="3" height="3" rx=".6"/><rect x="18.5" y="5.5" width="3" height="3" rx=".6"/>',
    move: '<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  function svg(name) { return '<svg class="mi" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.pin) + '</svg>'; }

  function catOf(kind, id) {
    var list = CATS[kind] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function kindIcon(kind, cat) {
    if (kind === 'area') return 'area';
    if (kind === 'path') return 'path';
    var c = catOf(kind, cat);
    return (c && c.icon) || 'pin';
  }

  // measurements (match garden_map.py)
  function rad(d) { return d * Math.PI / 180; }
  function areaM2(lls) {
    var n = lls.length, t = 0, R = 6378137;
    if (n < 3) return 0;
    for (var i = 0; i < n; i++) {
      var a = lls[i], b = lls[(i + 1) % n];
      t += rad(b.lng - a.lng) * (2 + Math.sin(rad(a.lat)) + Math.sin(rad(b.lat)));
    }
    return Math.abs(t * R * R / 2);
  }
  function lengthM(lls) {
    var d = 0;
    for (var i = 1; i < lls.length; i++) d += lls[i - 1].distanceTo(lls[i]);
    return d;
  }
  function fmtArea(m2) {
    if (m2 < 100) return m2.toFixed(1) + ' m²';
    var s = Math.round(m2).toLocaleString() + ' m²';
    if (m2 >= 1000) s += ' · ' + (m2 / 1000).toFixed(m2 >= 10000 ? 0 : 1) + ' dunam';
    return s;
  }
  function fmtLen(m) {
    if (m >= 1000) return (m / 1000).toFixed(2) + ' km';
    return (m < 10 ? m.toFixed(1) : Math.round(m)) + ' m';
  }
  function flatLatLngs(layer) {
    var ll = layer.getLatLngs();
    while (ll.length && Array.isArray(ll[0])) ll = ll[0];
    return ll;
  }
  function measureLayer(kind, layer) {
    if (kind === 'area') return fmtArea(areaM2(flatLatLngs(layer)));
    if (kind === 'path') return fmtLen(lengthM(flatLatLngs(layer)));
    return '';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ---------------------------------------------------------------- map
  var map = L.map(mapEl, { zoomControl: false, maxZoom: 22, worldCopyJump: true, boxZoom: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 110 }).addTo(map);

  var BASES = {
    street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 22, maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 22, maxNativeZoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics'
    })
  };
  var baseName = store('nevet-map-base') === 'satellite' ? 'satellite' : 'street';
  function setBase(name) {
    Object.keys(BASES).forEach(function (k) { if (k !== name) map.removeLayer(BASES[k]); });
    BASES[name].addTo(map);
    baseName = name;
    mapEl.classList.toggle('is-satellite', name === 'satellite');
    document.querySelectorAll('.map-layer-seg button').forEach(function (b) { b.classList.toggle('active', b.dataset.base === name); });
    store('nevet-map-base', name);
  }
  document.querySelectorAll('.map-layer-seg button').forEach(function (b) {
    b.addEventListener('click', function () { setBase(b.dataset.base); });
  });
  setBase(baseName);

  map.pm.setGlobalOptions({ snappable: true, snapDistance: 16, allowSelfIntersection: false });

  function fitShell() {                 // the map fills the screen below the top bar
    var nav = document.querySelector('.topnav');
    shell.style.setProperty('--nav-h', (nav ? nav.offsetHeight : 0) + 'px');
    map.invalidateSize();
  }
  window.addEventListener('resize', fitShell);
  fitShell();

  function updateLabels() { mapEl.classList.toggle('labels-on', map.getZoom() >= 18); mapEl.classList.toggle('labels-areas', map.getZoom() >= 17); }
  map.on('zoomend', updateLabels);

  // ---------------------------------------------------------------- items
  var groups = { area: L.featureGroup().addTo(map), path: L.featureGroup().addTo(map),
                 point: L.featureGroup().addTo(map), asset: L.featureGroup().addTo(map) };
  var items = {};                       // id -> {f: GeoJSON feature, layer}
  var assets = {};                      // asset id -> asset info
  D.assets.forEach(function (a) { assets[a.id] = a; });

  function styleFor(p, selected) {
    var c = p.color || '#5f9e4f';
    if (p.kind === 'area') {
      return { color: c, weight: selected ? 3.5 : 2, opacity: 0.95, fillColor: c, fillOpacity: selected ? 0.42 : 0.24 };
    }
    var dash = p.category === 'irrigation' ? '6 8' : p.category === 'fence' ? '1 8' : null;
    return { color: c, weight: (p.category === 'path' ? 6 : 4) + (selected ? 2 : 0), opacity: 0.95, dashArray: dash, lineCap: 'round' };
  }
  function assetDone(p) { var a = p.kind === 'asset' && assets[p.asset_id]; return !!(a && a.done); }
  function pinIcon(p, selected) {
    var cls = 'map-pin' + (selected ? ' is-selected' : '') + (p.kind === 'asset' ? ' is-asset' : '') + (assetDone(p) ? ' is-done' : '');
    return L.divIcon({
      className: 'map-pin-wrap', iconSize: [34, 34], iconAnchor: [17, 17],
      html: '<div class="' + cls + '" style="--c:' + esc(p.color || '#4c9a5b') + '">' + svg(kindIcon(p.kind, p.category)) + '</div>'
    });
  }
  function titleOf(p) { return p.name || p.category_label || 'Map item'; }
  function toLatLngs(coords) { return coords.map(function (c) { return L.latLng(c[1], c[0]); }); }

  function makeLayer(f) {
    var p = f.properties, g = f.geometry, layer;
    if (p.kind === 'area') layer = L.polygon(toLatLngs(g.coordinates[0].slice(0, -1)), styleFor(p));
    else if (p.kind === 'path') layer = L.polyline(toLatLngs(g.coordinates), styleFor(p));
    else layer = L.marker([g.coordinates[1], g.coordinates[0]], { icon: pinIcon(p), title: titleOf(p), riseOnHover: true });
    if (p.name && p.kind !== 'path') {
      layer.bindTooltip(esc(p.name), {
        permanent: true, interactive: false, direction: p.kind === 'area' ? 'center' : 'bottom',
        offset: p.kind === 'area' ? [0, 0] : [0, 15], className: 'map-label map-label-' + p.kind
      });
    }
    layer.on('click', function (e) {
      if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      if (mode === 'idle') select(p.id);
    });
    return layer;
  }
  function addItem(f) {
    removeItem(f.id);
    var layer = makeLayer(f);
    groups[f.properties.kind].addLayer(layer);
    items[f.id] = { f: f, layer: layer };
    if (f.properties.kind === 'asset' && assets[f.properties.asset_id]) assets[f.properties.asset_id].pinned = true;
    updateCount();
    return items[f.id];
  }
  function removeItem(id) {
    var it = items[id];
    if (!it) return;
    groups[it.f.properties.kind].removeLayer(it.layer);
    if (it.f.properties.kind === 'asset' && assets[it.f.properties.asset_id]) assets[it.f.properties.asset_id].pinned = false;
    delete items[id];
    updateCount();
  }
  function updateCount() { $('map-count').textContent = Object.keys(items).length; }
  function pinForAsset(assetId) {
    for (var id in items) if (items[id].f.properties.asset_id === assetId) return items[id];
    return null;
  }

  D.features.features.forEach(addItem);
  updateLabels();

  // ---------------------------------------------------------------- view
  function sheetPadding() {
    var wide = window.innerWidth >= 820, open = !sheet.hidden;
    var pad = { paddingTopLeft: L.point(30, 80), paddingBottomRight: L.point(30, 90) };
    if (open && wide) pad.paddingTopLeft = L.point(sheet.offsetWidth + 40, 80);
    if (open && !wide) pad.paddingBottomRight = L.point(30, sheet.offsetHeight + 30);
    return pad;
  }
  function boundsOf(layer) {
    return layer.getBounds ? layer.getBounds() : L.latLngBounds([layer.getLatLng(), layer.getLatLng()]);
  }
  function showLayer(layer, maxZoom) {
    var o = sheetPadding(); o.maxZoom = maxZoom || 20;
    map.fitBounds(boundsOf(layer), o);
  }
  function allBounds() {
    var b = L.latLngBounds([]);
    Object.keys(groups).forEach(function (k) { if (map.hasLayer(groups[k]) && groups[k].getLayers().length) b.extend(groups[k].getBounds()); });
    return b;
  }
  function goHome(animate) {
    if (D.home) return map.setView([D.home.lat, D.home.lng], D.home.zoom, { animate: !!animate });
    var b = allBounds();
    if (b.isValid()) return map.fitBounds(b, { padding: [40, 40], maxZoom: 20, animate: !!animate });
    map.setView([D.defaultView.lat, D.defaultView.lng], D.defaultView.zoom, { animate: !!animate });
  }
  $('map-home').addEventListener('click', function () { goHome(true); });

  // ---------------------------------------------------------------- toast
  var toastTimer = null, toastUndo = null;
  function toast(text, undo) {
    $('map-toast-text').textContent = text;
    $('map-toast-undo').hidden = !undo;
    toastUndo = undo || null;
    $('map-toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('map-toast').hidden = true; toastUndo = null; }, undo ? 9000 : 5000);
  }
  $('map-toast-undo').addEventListener('click', function () {
    var fn = toastUndo;
    $('map-toast').hidden = true; toastUndo = null;
    if (fn) fn();
  });

  // ---------------------------------------------------------------- locate
  var youAreHere = null;
  $('map-locate').addEventListener('click', function () {
    if (!window.isSecureContext) {
      toast('Your browser only shares your location over a secure (https) link. Search for your address instead.');
      return;
    }
    toast('Finding you…');
    map.locate({ setView: true, maxZoom: 19, enableHighAccuracy: true });
  });
  map.on('locationfound', function (e) {
    if (youAreHere) map.removeLayer(youAreHere);
    youAreHere = L.layerGroup([
      L.circle(e.latlng, { radius: e.accuracy, color: '#3d85c6', weight: 1, fillOpacity: 0.08, interactive: false }),
      L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 3, fillColor: '#3d85c6', fillOpacity: 1, interactive: false })
    ]).addTo(map);
    toast('You are here (within about ' + Math.round(e.accuracy) + ' m).');
  });
  map.on('locationerror', function () { toast("Couldn't get your location. Allow location access, or search for your address."); });

  // ---------------------------------------------------------------- search
  var searchForm = $('map-search'), searchQ = $('map-search-q'), results = $('map-search-results');
  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = searchQ.value.trim();
    if (!q) return;
    results.hidden = false;
    results.innerHTML = '<li class="muted">Searching…</li>';
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=' + encodeURIComponent(q) +
              '&accept-language=' + encodeURIComponent(navigator.language || 'en');
    fetch(url).then(function (r) { return r.json(); }).then(function (list) {
      if (!list.length) { results.innerHTML = '<li class="muted">Nothing found. Try a street and town.</li>'; return; }
      results.innerHTML = list.map(function (p, i) {
        return '<li><button type="button" data-i="' + i + '">' + esc(p.display_name) + '</button></li>';
      }).join('');
      results.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = list[+b.dataset.i], bb = p.boundingbox;
          results.hidden = true;
          searchQ.blur();
          if (bb) map.fitBounds([[+bb[0], +bb[2]], [+bb[1], +bb[3]]], { maxZoom: 19 });
          else map.setView([+p.lat, +p.lon], 18);
        });
      });
    }).catch(function () { results.innerHTML = '<li class="muted">Search needs an internet connection.</li>'; });
  });
  searchQ.addEventListener('input', function () { if (!searchQ.value) results.hidden = true; });
  map.on('click', function () { results.hidden = true; });

  // ---------------------------------------------------------------- sheet
  function openSheet(html, cls) {
    sheetBody.innerHTML = html;
    sheet.className = 'map-sheet' + (cls ? ' ' + cls : '');
    sheet.hidden = false;
    $('map-bar').hidden = true;
    sheetBody.scrollTop = 0;
  }
  function closeSheet() {
    sheet.hidden = true;
    sheetBody.innerHTML = '';
    $('map-bar').hidden = false;
  }
  $('sheet-close').addEventListener('click', function () {
    if (editing) cancelEdit(); else closeSheet();
  });

  // ---------------------------------------------------------------- modes
  // idle | draw | place | shape
  var mode = 'idle', drawShape = null, placeCb = null;
  function setHint(text, opts) {
    opts = opts || {};
    $('map-hint-text').innerHTML = text;
    $('hint-undo').hidden = !opts.undo;
    $('hint-done').hidden = !opts.done;
    $('hint-done').textContent = opts.doneLabel || 'Finish';
    $('map-hint').hidden = false;
    $('map-bar').hidden = true;
  }
  function clearHint() {
    $('map-hint').hidden = true;
    $('map-crosshair').hidden = true;
    mapEl.classList.remove('is-placing');
    if (sheet.hidden) $('map-bar').hidden = false;
  }
  function stopModes() {
    if (mode === 'draw') map.pm.disableDraw();
    if (mode === 'place') map.off('click', onPlaceClick);
    mode = 'idle'; drawShape = null; placeCb = null;
    clearHint();
  }
  $('hint-cancel').addEventListener('click', function () {
    if (mode === 'shape') { cancelEdit(); return; }
    stopModes();
  });
  $('hint-undo').addEventListener('click', function () {
    var d = drawShape && map.pm.Draw[drawShape];
    if (d && d._removeLastVertex) d._removeLastVertex();
  });
  $('hint-done').addEventListener('click', function () {
    if (mode === 'draw') {
      var d = map.pm.Draw[drawShape];
      var n = d && d._layer ? d._layer.getLatLngs().length : 0;
      var need = drawShape === 'Polygon' ? 3 : 2;
      if (n < need) { toast('Tap at least ' + need + ' points first.'); return; }
      d._finishShape();
    } else if (mode === 'place') {
      var cb = placeCb; stopModes(); cb(map.getCenter());
    } else if (mode === 'shape') {
      finishShapeEdit();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (mode === 'draw' || mode === 'place') stopModes();
    else if (editing) cancelEdit();
    else if (!sheet.hidden) closeSheet();
  });

  function startDraw(kind) {
    closeSheet(); deselect();
    var shape = kind === 'area' ? 'Polygon' : 'Line';
    var color = (CATS[kind][0] || {}).color || '#5f9e4f';
    mode = 'draw'; drawShape = shape;
    map.pm.enableDraw(shape, {
      tooltips: false, snappable: true, allowSelfIntersection: false, finishOn: null,
      templineStyle: { color: color, weight: 3 },
      hintlineStyle: { color: color, weight: 2, dashArray: '5 6' },
      pathOptions: styleFor({ kind: kind, color: color, category: kind === 'path' ? 'path' : 'bed' })
    });
    setHint(kind === 'area'
      ? '<strong>Draw the bed or area.</strong> Tap each corner, then tap the first corner or <b>Finish</b>.'
      : '<strong>Draw the path or line.</strong> Tap along it, then <b>Finish</b>.', { undo: true, done: true });
  }
  map.on('pm:create', function (e) {
    if (mode !== 'draw') return;
    var kind = drawShape === 'Polygon' ? 'area' : 'path';
    stopModes();
    var cat = kind === 'area' ? 'bed' : 'path';
    var f = { type: 'Feature', id: null, geometry: e.layer.toGeoJSON().geometry,
              properties: { id: null, kind: kind, category: cat, name: '', notes: '', color: catOf(kind, cat).color, category_label: catOf(kind, cat).label } };
    map.removeLayer(e.layer);
    var layer = makeLayer(f);
    groups[kind].addLayer(layer);
    startEdit({ f: f, layer: layer }, true);
  });

  function onPlaceClick(e) { var cb = placeCb; stopModes(); cb(e.latlng); }
  function startPlace(text, cb) {
    closeSheet(); deselect();
    mode = 'place'; placeCb = cb;
    mapEl.classList.add('is-placing');
    $('map-crosshair').hidden = false;
    setHint(text + ' Tap the map, or move it under the cross and press <b>Place here</b>.', { done: true, doneLabel: 'Place here' });
    setTimeout(function () { map.on('click', onPlaceClick); }, 50);    // not the click that opened this
  }
  function startPoint(cat) {
    var c = catOf('point', cat);
    startPlace('<strong>Where is the ' + esc(c.label.toLowerCase()) + '?</strong>', function (ll) {
      var f = { type: 'Feature', id: null, geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
                properties: { id: null, kind: 'point', category: cat, name: '', notes: '', color: c.color, category_label: c.label } };
      var layer = makeLayer(f);
      groups.point.addLayer(layer);
      startEdit({ f: f, layer: layer }, true);
    });
  }
  function startPinAsset(a) {
    startPlace('<strong>Where does ' + esc(a.name) + ' grow?</strong>', function (ll) {
      var moving = !!a.pinned;
      api('POST', D.urls.features, { kind: 'asset', asset_id: a.id, geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } })
        .then(function (f) { addItem(f); select(f.id); toast((moving ? 'Moved ' : 'Pinned ') + a.name + ' on the map.'); })
        .catch(function (err) { toast(err.message); });
    });
  }

  // ---------------------------------------------------------------- add menu
  function openAdd() {
    deselect();
    var html = '<h2 class="sheet-title">Add to the map</h2><div class="add-grid">' +
      addBtn('area', 'area', 'Bed or area', 'Draw its outline') +
      addBtn('path', 'path', 'Path or line', 'Walkways, irrigation, fences') +
      addBtn('point', 'pin', 'Point', 'Tap, compost, tree, Nevet node…') +
      addBtn('asset', 'sprout', 'Plant or worm bin', 'Pin where it grows') + '</div>';
    openSheet(html, 'is-add');
    sheetBody.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.add;
        if (k === 'area' || k === 'path') startDraw(k);
        else if (k === 'point') openPointPicker();
        else openAssetPicker();
      });
    });
  }
  function addBtn(kind, icon, title, sub) {
    return '<button type="button" class="add-card" data-add="' + kind + '"><span class="add-icon">' + svg(icon) +
           '</span><span class="add-text"><b>' + title + '</b><small>' + sub + '</small></span></button>';
  }
  function openPointPicker() {
    var html = '<h2 class="sheet-title">What are you adding?</h2><div class="cat-grid">' +
      CATS.point.map(function (c) {
        return '<button type="button" class="cat-card" data-cat="' + c.id + '"><span class="map-pin" style="--c:' + c.color + '">' +
               svg(c.icon) + '</span>' + esc(c.label) + '</button>';
      }).join('') + '</div><button type="button" class="link-btn" data-back>← Back</button>';
    openSheet(html, 'is-add');
    sheetBody.querySelectorAll('[data-cat]').forEach(function (b) {
      b.addEventListener('click', function () { startPoint(b.dataset.cat); });
    });
    sheetBody.querySelector('[data-back]').addEventListener('click', openAdd);
  }
  function openAssetPicker() {
    var list = D.assets;
    var html = '<h2 class="sheet-title">Pin a plant or worm bin</h2>';
    if (!list.length) {
      html += '<p class="muted">No plants yet. <a href="/plants/new">Add a plant</a> first, then pin it here.</p>';
    } else {
      html += '<ul class="asset-pick">' + list.map(function (a) {
        return '<li><button type="button" data-asset="' + a.id + '" class="' + (a.done ? 'is-done' : '') + '">' +
          '<span class="map-pin is-asset" style="--c:' + (a.type === 'worm_bin' ? '#8d6e52' : '#4c9a5b') + '">' + svg(a.type === 'worm_bin' ? 'worm' : 'sprout') + '</span>' +
          '<span class="ap-text"><b>' + esc(a.name) + '</b><small>' + esc([a.variety, a.stage, a.owner].filter(Boolean).join(' · ')) + '</small></span>' +
          '<span class="ap-state">' + (a.pinned ? 'Move pin' : 'Pin') + '</span></button></li>';
      }).join('') + '</ul>';
    }
    html += '<button type="button" class="link-btn" data-back>← Back</button>';
    openSheet(html, 'is-add');
    sheetBody.querySelectorAll('[data-asset]').forEach(function (b) {
      b.addEventListener('click', function () { startPinAsset(assets[+b.dataset.asset]); });
    });
    sheetBody.querySelector('[data-back]').addEventListener('click', openAdd);
  }
  $('open-add').addEventListener('click', function () { if (mode === 'idle') openAdd(); });

  // ---------------------------------------------------------------- select / edit
  var selectedId = null, editing = null;   // editing = {it, isNew, draft, shapeChanged}
  function highlight(it, on) {
    var p = it.f.properties;
    if (p.kind === 'area' || p.kind === 'path') { it.layer.setStyle(styleFor(p, on)); if (on && it.layer.bringToFront) it.layer.bringToFront(); }
    else it.layer.setIcon(pinIcon(p, on));
  }
  function deselect() {
    if (editing) cancelEdit(true);
    if (selectedId && items[selectedId]) highlight(items[selectedId], false);
    selectedId = null;
  }
  function select(id, opts) {
    var it = items[id];
    if (!it) return;
    deselect();
    selectedId = id;
    highlight(it, true);
    startEdit(it, false);
    if (opts && opts.show) showLayer(it.layer, it.f.properties.kind === 'area' ? 20 : 19);
  }

  function previewDraft() {
    var it = editing.it, d = editing.draft;
    var p = Object.assign({}, it.f.properties, { category: d.category, color: d.color || (catOf(it.f.properties.kind, d.category) || {}).color });
    if (p.kind === 'area' || p.kind === 'path') it.layer.setStyle(styleFor(p, true));
    else if (p.kind === 'point') it.layer.setIcon(pinIcon(p, true));
    var m = sheetBody.querySelector('.ed-measure');
    if (m) m.textContent = measureLayer(p.kind, it.layer);
  }

  function startEdit(it, isNew) {
    var p = it.f.properties, kind = p.kind;
    editing = { it: it, isNew: isNew, shapeChanged: false,
                draft: { name: p.name || '', category: p.category, color: p.color, notes: p.notes || '' } };
    var cat = catOf(kind, p.category) || {};
    var measure = measureLayer(kind, it.layer);
    var h = '<div class="ed">';
    h += '<div class="ed-head"><span class="map-pin" style="--c:' + esc(p.color || cat.color) + '" id="ed-icon">' + svg(kindIcon(kind, p.category)) + '</span>' +
         '<div><h2 class="sheet-title">' + esc(isNew ? 'New ' + (cat.label || kind).toLowerCase() : titleOf(p)) + '</h2>' +
         '<p class="ed-sub">' + esc(kind === 'asset' ? (p.category_label + (p.stage ? ' · ' + p.stage : '')) : (cat.label || '')) +
         (measure ? ' · <span class="ed-measure">' + measure + '</span>' : '') + '</p></div></div>';
    if (kind === 'asset') {
      var a = assets[p.asset_id] || {};
      var bits = [p.variety && 'Variety: ' + esc(p.variety), p.owner && 'Grower: ' + esc(p.owner)].filter(Boolean);
      if (bits.length) h += '<p class="ed-info">' + bits.join(' · ') + '</p>';
      h += '<div class="ed-links">' +
           (a.url ? '<a class="btn btn-ghost btn-sm" href="' + esc(a.url) + '">' + svg('open') + ' Open</a>' : '') +
           (a.log_url ? '<a class="btn btn-primary btn-sm" href="' + esc(a.log_url) + '">' + svg('plus') + ' Log an action</a>' : '') + '</div>';
    } else {
      h += '<label class="ed-field"><span>Name</span><input type="text" id="ed-name" maxlength="60" value="' + esc(p.name || '') +
           '" placeholder="' + (kind === 'area' ? 'e.g. Tomato bed' : kind === 'path' ? 'e.g. Main drip line' : 'e.g. Big fig tree') + '"></label>';
      h += '<div class="ed-field"><span>Type</span><div class="ed-chips">' + CATS[kind].map(function (c) {
        return '<button type="button" class="chip' + (c.id === p.category ? ' active' : '') + '" data-cat="' + c.id + '" style="--c:' + c.color + '">' + esc(c.label) + '</button>';
      }).join('') + '</div></div>';
      h += '<div class="ed-field"><span>Colour</span><div class="ed-swatches">' +
           '<button type="button" class="sw sw-auto' + (!p.color || p.color === cat.color ? ' active' : '') + '" data-color="" title="Type colour">Auto</button>' +
           PALETTE.map(function (c) { return '<button type="button" class="sw' + (p.color === c && c !== cat.color ? ' active' : '') + '" data-color="' + c + '" style="--c:' + c + '" title="' + c + '"></button>'; }).join('') +
           '</div></div>';
    }
    h += '<label class="ed-field"><span>Notes</span><textarea id="ed-notes" maxlength="500" rows="2" placeholder="Anything worth remembering">' + esc(p.notes || '') + '</textarea></label>';
    if (!isNew && p.created_at) {
      h += '<p class="ed-meta">Added' + (p.created_by ? ' by ' + esc(p.created_by) : '') + ' · ' + fmtDate(p.created_at) +
           (p.updated_at ? ' · edited' + (p.updated_by ? ' by ' + esc(p.updated_by) : '') + ' ' + fmtDate(p.updated_at) : '') + '</p>';
    }
    h += '<p class="ed-error" id="ed-error" hidden></p>';
    if (!isNew) {
      h += '<div class="ed-tools"><button type="button" class="btn btn-ghost btn-sm" id="ed-shape">' + svg(kind === 'area' || kind === 'path' ? 'shape' : 'move') + (kind === 'area' || kind === 'path' ? ' Edit shape' : ' Move') + '</button>' +
           '<button type="button" class="btn btn-ghost btn-sm ed-delete" id="ed-delete">' + svg('trash') + (kind === 'asset' ? ' Unpin' : ' Delete') + '</button></div>';
    }
    h += '<div class="ed-actions"><button type="button" class="btn btn-ghost" id="ed-cancel">' + (isNew ? 'Discard' : 'Close') + '</button>' +
         '<button type="button" class="btn btn-primary" id="ed-save">Save</button></div></div>';
    openSheet(h, 'is-edit');

    var nameEl = $('ed-name');
    if (nameEl) nameEl.addEventListener('input', function () { editing.draft.name = nameEl.value; });
    $('ed-notes').addEventListener('input', function () { editing.draft.notes = $('ed-notes').value; });
    sheetBody.querySelectorAll('.ed-chips .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        var oldCat = catOf(kind, editing.draft.category) || {};
        editing.draft.category = b.dataset.cat;
        if (!editing.draft.color || editing.draft.color === oldCat.color) editing.draft.color = null;   // follow the new type's colour
        sheetBody.querySelectorAll('.ed-chips .chip').forEach(function (x) { x.classList.toggle('active', x === b); });
        syncSwatches(); previewDraft(); syncIcon();
      });
    });
    sheetBody.querySelectorAll('.ed-swatches .sw').forEach(function (b) {
      b.addEventListener('click', function () { editing.draft.color = b.dataset.color || null; syncSwatches(); previewDraft(); syncIcon(); });
    });
    $('ed-save').addEventListener('click', saveEdit);
    $('ed-cancel').addEventListener('click', function () { cancelEdit(); });
    if ($('ed-shape')) $('ed-shape').addEventListener('click', startShapeEdit);
    if ($('ed-delete')) $('ed-delete').addEventListener('click', deleteItem);
    if (isNew && nameEl) setTimeout(function () { if (window.innerWidth >= 820) nameEl.focus(); }, 60);
  }
  function syncSwatches() {
    var d = editing.draft, cat = catOf(editing.it.f.properties.kind, d.category) || {};
    sheetBody.querySelectorAll('.ed-swatches .sw').forEach(function (x) {
      var c = x.dataset.color;
      x.classList.toggle('active', c ? (d.color === c && c !== cat.color) : (!d.color || d.color === cat.color));
    });
  }
  function syncIcon() {
    var d = editing.draft, kind = editing.it.f.properties.kind, cat = catOf(kind, d.category) || {};
    var icon = $('ed-icon');
    if (icon) { icon.style.setProperty('--c', d.color || cat.color); icon.innerHTML = svg(kindIcon(kind, d.category)); }
  }
  function showError(msg) { var e = $('ed-error'); if (e) { e.textContent = msg; e.hidden = false; } else toast(msg); }

  function startShapeEdit() {
    var it = editing.it, kind = it.f.properties.kind;
    mode = 'shape';
    sheet.hidden = true;
    if (kind === 'area' || kind === 'path') {
      it.layer.pm.enable({ allowSelfIntersection: false, snappable: true });
      it.layer.on('pm:edit', onShapeChanged);
      it.layer.on('pm:markerdrag', onShapeDrag);
      setHint('<strong>Drag the corners</strong> to reshape. Drag a middle dot to add a corner; tap a corner to remove it. <span class="hint-measure" id="hint-measure">' + measureLayer(kind, it.layer) + '</span>', { done: true, doneLabel: 'Done' });
    } else {
      it.layer.dragging.enable();
      it.layer.on('dragend', onShapeChanged);
      setHint('<strong>Drag the pin</strong> to where it really is.', { done: true, doneLabel: 'Done' });
    }
    showLayer(it.layer, kind === 'area' ? 21 : 20);
  }
  function onShapeDrag() { var m = $('hint-measure'); if (m && editing) m.textContent = measureLayer(editing.it.f.properties.kind, editing.it.layer); }
  function onShapeChanged() { if (editing) { editing.shapeChanged = true; onShapeDrag(); } }
  function endShapeEdit(it) {
    if (it.layer.pm && it.layer.pm.enabled && it.layer.pm.enabled()) it.layer.pm.disable();
    if (it.layer.dragging && it.layer.dragging.enabled && it.layer.dragging.enabled()) it.layer.dragging.disable();
    it.layer.off('pm:edit', onShapeChanged); it.layer.off('pm:markerdrag', onShapeDrag); it.layer.off('dragend', onShapeChanged);
  }
  function finishShapeEdit() {
    endShapeEdit(editing.it);
    mode = 'idle';
    clearHint();
    sheet.hidden = false; $('map-bar').hidden = true;
    previewDraft();
    if (editing.shapeChanged) saveEdit();            // a moved pin or reshaped bed saves right away
  }

  function saveEdit() {
    var it = editing.it, p = it.f.properties, d = editing.draft, kind = p.kind;
    var body = { notes: d.notes };
    if (kind !== 'asset') { body.name = d.name; body.category = d.category; body.color = d.color || null; }
    if (editing.isNew || editing.shapeChanged) body.geometry = it.layer.toGeoJSON().geometry;
    var btn = $('ed-save'); if (btn) btn.disabled = true;
    var req = editing.isNew
      ? api('POST', D.urls.features, Object.assign({ kind: kind }, body))
      : api('POST', D.urls.features + '/' + p.id, body);
    req.then(function (f) {
      var wasNew = editing.isNew;
      groups[kind].removeLayer(it.layer);
      editing = null;
      var fresh = addItem(f);
      selectedId = f.id;
      highlight(fresh, true);
      startEdit(fresh, false);
      toast(wasNew ? 'Added ' + titleOf(f.properties) + ' to the map.' : 'Saved.');
    }).catch(function (err) { if (btn) btn.disabled = false; showError(err.message); });
  }

  function cancelEdit(keepSheet) {
    if (!editing) return;
    var it = editing.it;
    if (mode === 'shape') { endShapeEdit(it); mode = 'idle'; clearHint(); }
    if (editing.isNew) groups[it.f.properties.kind].removeLayer(it.layer);
    else addItem(it.f);                  // redraw from the saved version (drops unsaved changes)
    editing = null;
    selectedId = null;
    if (!keepSheet) closeSheet();
  }

  function deleteItem() {
    var it = editing.it, p = it.f.properties;
    api('POST', D.urls.features + '/' + p.id + '/delete').then(function () {
      editing = null; selectedId = null;
      removeItem(p.id);
      closeSheet();
      var saved = it.f;
      toast((p.kind === 'asset' ? 'Unpinned ' : 'Removed ') + titleOf(p) + '.', function () {
        api('POST', D.urls.features + '/' + saved.id + '/restore').then(function (f) { addItem(f); toast('Back on the map.'); })
          .catch(function (err) { toast(err.message); });
      });
    }).catch(function (err) { showError(err.message); });
  }

  map.on('click', function () { if (mode === 'idle' && editing && !editing.isNew) { deselect(); closeSheet(); } });

  // ---------------------------------------------------------------- garden list
  var hidden = {};
  function openList() {
    deselect();
    var by = { area: [], path: [], point: [], asset: [] };
    Object.keys(items).forEach(function (id) { var it = items[id]; by[it.f.properties.kind].push(it); });
    var totArea = by.area.reduce(function (s, it) { return s + areaM2(flatLatLngs(it.layer)); }, 0);
    var totLen = by.path.reduce(function (s, it) { return s + lengthM(flatLatLngs(it.layer)); }, 0);
    var pinned = D.assets.filter(function (a) { return a.pinned; }).length;
    var rows = [
      ['area', 'area', 'Beds & areas', by.area.length, by.area.length ? fmtArea(totArea) : ''],
      ['path', 'path', 'Paths & lines', by.path.length, by.path.length ? fmtLen(totLen) : ''],
      ['point', 'pin', 'Points', by.point.length, ''],
      ['asset', 'sprout', 'Plants & bins', pinned, D.assets.length ? pinned + ' of ' + D.assets.length + ' pinned' : '']
    ];
    var h = '<h2 class="sheet-title">Garden map</h2>';
    if (!Object.keys(items).length) {
      h += '<div class="map-intro"><p><b>Map your garden in three steps:</b></p><ol>' +
           '<li>Find your garden: search above, or tap the location button.</li>' +
           '<li>Tap <b>Add to map</b> to draw beds, paths and points, and pin your plants.</li>' +
           (D.isAdmin ? '<li>Save the garden’s spot (below) so the map always opens there.</li>' : '<li>The admin can save the garden’s spot so the map always opens there.</li>') +
           '</ol></div>';
    }
    h += '<div class="kind-rows">' + rows.map(function (r) {
      return '<label class="kind-row"><input type="checkbox" data-kind="' + r[0] + '"' + (hidden[r[0]] ? '' : ' checked') + '>' +
             '<span class="kind-icon">' + svg(r[1]) + '</span><span class="kind-name">' + r[2] + '</span>' +
             '<span class="kind-n">' + r[3] + '</span><small class="kind-sub">' + r[4] + '</small></label>';
    }).join('') + '</div>';
    var all = by.area.concat(by.path, by.point, by.asset);
    if (all.length) {
      h += '<ul class="item-list">' + all.map(function (it) {
        var p = it.f.properties, cat = catOf(p.kind, p.category) || {};
        var meas = measureLayer(p.kind, it.layer);
        return '<li><button type="button" data-id="' + p.id + '"><span class="map-pin sm' + (p.kind === 'asset' ? ' is-asset' : '') + '" style="--c:' + esc(p.color || cat.color) + '">' +
               svg(kindIcon(p.kind, p.category)) + '</span><span class="il-text"><b>' + esc(titleOf(p)) + '</b><small>' +
               esc(p.name ? (p.category_label || '') : '') + (p.name && meas ? ' · ' : '') + meas + '</small></span></button></li>';
      }).join('') + '</ul>';
    }
    h += '<div class="list-foot">';
    if (D.isAdmin) h += '<button type="button" class="btn btn-ghost btn-sm" id="set-home">' + svg('tools') + ' Save this view as the garden’s spot</button>';
    h += '<a class="btn btn-ghost btn-sm" href="' + D.urls.export + '">Download map (.geojson)</a></div>';
    h += '<details class="removed" id="removed"><summary>Recently removed</summary><ul class="removed-list" id="removed-list"><li class="muted">Loading…</li></ul></details>';
    openSheet(h, 'is-list');

    sheetBody.querySelectorAll('.kind-row input').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var k = cb.dataset.kind;
        hidden[k] = !cb.checked;
        if (cb.checked) groups[k].addTo(map); else map.removeLayer(groups[k]);
      });
    });
    sheetBody.querySelectorAll('.item-list button').forEach(function (b) {
      b.addEventListener('click', function () {
        var it = items[+b.dataset.id];
        if (it && hidden[it.f.properties.kind]) { hidden[it.f.properties.kind] = false; groups[it.f.properties.kind].addTo(map); }
        select(+b.dataset.id, { show: true });
      });
    });
    if ($('set-home')) $('set-home').addEventListener('click', function () {
      var c = map.getCenter();
      api('POST', D.urls.home, { lat: c.lat, lng: c.lng, zoom: map.getZoom() })
        .then(function (r) { D.home = r.home; toast('Saved. The map now opens here for everyone.'); })
        .catch(function (err) { toast(err.message); });
    });
    $('removed').addEventListener('toggle', function () { if ($('removed').open) loadRemoved(); });
  }
  function loadRemoved() {
    var ul = $('removed-list');
    api('GET', D.urls.deleted).then(function (r) {
      if (!r.features.length) { ul.innerHTML = '<li class="muted">Nothing removed lately.</li>'; return; }
      ul.innerHTML = r.features.map(function (f) {
        var p = f.properties;
        return '<li><span>' + esc(titleOf(p)) + ' <small class="muted">' + esc(p.category_label || '') + ' · ' + fmtDate(f.properties.deleted_at || p.updated_at) + '</small></span>' +
               '<button type="button" class="btn btn-ghost btn-sm" data-restore="' + p.id + '">Restore</button></li>';
      }).join('');
      ul.querySelectorAll('[data-restore]').forEach(function (b) {
        b.addEventListener('click', function () {
          api('POST', D.urls.features + '/' + b.dataset.restore + '/restore').then(function (f) {
            addItem(f); b.closest('li').remove(); toast(titleOf(f.properties) + ' is back on the map.');
          }).catch(function (err) { toast(err.message); });
        });
      });
    }).catch(function (err) { ul.innerHTML = '<li class="muted">' + esc(err.message) + '</li>'; });
  }
  $('open-list').addEventListener('click', function () { if (mode === 'idle') openList(); });

  // ---------------------------------------------------------------- start
  goHome(false);
  if (D.focus) {                       // /map?asset=ID from a plant page
    var pin = pinForAsset(D.focus);
    if (pin) setTimeout(function () { select(pin.f.id, { show: true }); }, 50);
    else if (assets[D.focus]) setTimeout(function () { startPinAsset(assets[D.focus]); }, 50);
  } else if (!Object.keys(items).length && !D.home) {
    openList();                        // first visit: show how to start
  }
  window.NevetMap = { map: map, items: items };   // handy for debugging in the console
})();
