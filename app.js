/**
 * Dancing with the SARs - NASA Space Apps Challenge 2026
 * Static Jamstack dashboard: Leaflet + NISAR overlays + NASA EONET fallback.
 *
 * Modules (all inside one IIFE, ready to split into files later):
 *   CONFIG   - constants
 *   Api      - ALL network access (swap these for a REST backend later)
 *   Dom      - safe element helpers (never inserts raw HTML)
 *   Report   - turns any report.json into readable sidebar content
 *   MapView  - Leaflet map, overlays, markers, controls
 *   App      - wiring
 *
 * Run through a local web server (e.g. `python -m http.server`);
 * browsers block fetch() of JSON files when opened via file://.
 */
(function () {
  'use strict';

  /* ===================== CONFIG ===================== */
 
const CONFIG = Object.freeze({
  locationsUrl: './locations.json',
  dataDir: './data/',
  eonetUrl: 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson',
  eonetBoxDegrees: 8,
  initialCenter: [20, 0],
  initialZoom: 2,
  defaultOpacity: 0.85,
  colors: {
    cod: '#38bdf8',
    flood: '#38bdf8',
    volcano: '#f97316',
    forest: '#22c55e',
    wildfire: '#ff4500',
    oil: '#d946ef',
    default: '#a78bfa'
  }
});

  /* ===================== DOM HELPERS ===================== */
  
const Dom = {
  $: (id) => document.getElementById(id),

  el(tag, className, text) {
    const node = document.createElement(tag);

    if (className) node.className = className;

    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }

    return node;
  },

  clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }
};


  /* ===================== API LAYER ===================== */
  const Api = {
    async getJson(url) {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response.json();
    },
    getLocations() { return Api.getJson(CONFIG.locationsUrl); },
    getReport(zone) { return Api.getJson(zone.reportUrl); },
    getEonetNear(latlng) {
      const d = CONFIG.eonetBoxDegrees;
      // EONET bbox order: minLon, maxLat, maxLon, minLat
      const bbox = [latlng.lng - d, latlng.lat + d, latlng.lng + d, latlng.lat - d]
        .map((n) => n.toFixed(3)).join(',');
      return Api.getJson(`${CONFIG.eonetUrl}?status=open&limit=20&bbox=${bbox}`);
    }
  };

  /* ===================== ZONE NORMALISING ===================== */
  function toLatLng(c) {
    if (Array.isArray(c) && c.length >= 2) return [Number(c[0]), Number(c[1])];
    if (c && typeof c === 'object') {
      const lat = c.lat ?? c.latitude, lng = c.lng ?? c.lon ?? c.longitude;
      if (lat != null && lng != null) return [Number(lat), Number(lng)];
    }
    return null;
  }

  // Accepts [[s,w],[n,e]] or {south,west,north,east}; returns [[s,w],[n,e]] or null.
  function parseBounds(b) {
    let pts = null;
    if (Array.isArray(b) && b.length >= 2) pts = [toLatLng(b[0]), toLatLng(b[1])];
    else if (b && typeof b === 'object') {
      const s = b.south ?? b.min_lat ?? b.minLat, w = b.west ?? b.min_lng ?? b.minLng ?? b.min_lon;
      const n = b.north ?? b.max_lat ?? b.maxLat, e = b.east ?? b.max_lng ?? b.maxLng ?? b.max_lon;
      if ([s, w, n, e].every((v) => v != null)) pts = [[Number(s), Number(w)], [Number(n), Number(e)]];
    }
    return pts && pts.every((p) => p && p.every(Number.isFinite)) ? pts : null;
  }

  function normaliseZone(raw, index) {
    const id = String(raw.id ?? raw.slug ?? raw.zone ?? raw.folder ?? `zone-${index}`);
    const folder = raw.folder ?? raw.zone ?? id;
    const base = `${CONFIG.dataDir}${folder}/`;
    const bounds = parseBounds(raw.bounds);
    const center = toLatLng(raw.center) ||
      (bounds ? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2] : null);
    const hint = `${raw.type ?? raw.category ?? ''} ${id} ${raw.name ?? ''}`.toLowerCase();
    const kind = /flood|water/.test(hint) ? 'flood'
      : /volcan/.test(hint) ? 'volcano'
      : /forest|deforest|tree/.test(hint) ? 'forest'
      : /wildfire|fire|burn/.test(hint) ? 'wildfire'
      : /oil|spill/.test(hint) ? 'oil' : 'default';
    const wanted = raw.marker_color ?? raw.markerColor ?? raw.color;
    const color = (typeof wanted === 'string' && window.CSS && CSS.supports('color', wanted.trim()))
      ? wanted.trim() : (CONFIG.colors[kind] || CONFIG.colors.default);
    if (!center) console.warn('[SAR Map] Zone has no usable center/bounds, no pin:', id);
    if (!bounds) console.warn('[SAR Map] Zone has no usable bounds, no overlay/fly:', id);
    return {
      id,
      name: raw.name ?? raw.title ?? raw.label ?? id,
      eventType: raw.event_type ?? raw.eventType ?? raw.category ?? '',
      kind,
      color,
      center,
      bounds,
      overlayUrl: raw.overlay ?? raw.overlayUrl ?? `${base}overlay.png`,
      beforeUrl:  raw.before  ?? raw.beforeUrl  ?? `${base}before.png`,
      afterUrl:   raw.after   ?? raw.afterUrl   ?? `${base}after.png`,
      reportUrl:  raw.report  ?? raw.reportUrl  ?? `${base}report.json`
    };
  }

  /* ===================== REPORT RENDERER ===================== */
  const Report = (function () {
    // Which top-level report keys belong in which friendly section.
    const SECTIONS = [
      { title: 'Acquisitions', test: /acqui|date|polari|orbit|pass|frequency|band|mode|sensor|satellite|mission|time/i },
      { title: 'Key metrics', test: /metric|stat|area|extent|change|loss|gain|count|percent|km|hectare|ha\b|depth|height|deform|backscatter|db\b|magnitude/i },
      { title: 'What caused it', test: /cause|physical|mechanism|driver|process|explan|why|summary|description|interpret/i },
      { title: 'SAR vs. optical', test: /optical|cloud|penetrat|advantage|compar|sar_vs|vs/i },
      { title: 'Community & ecosystem impact', test: /impact|communit|ecosystem|people|human|risk|societ|livelihood|wildlife|hazard/i },
      { title: 'Colour legend', test: /legend|color|colour|key|palette/i }
    ];
    const SKIP_KEYS = /^(id|name|title|zone|location|folder)$/i;

    function humanize(key) {
      const s = String(key).replace(/[_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function isEmpty(v) {
      if (v === null || v === undefined) return true;
      if (typeof v === 'string') return v.trim() === '' || /^(undefined|null)$/i.test(v.trim());
      if (Array.isArray(v)) return v.every(isEmpty);
      if (typeof v === 'object') return Object.values(v).every(isEmpty);
      return false;
    }

    function formatPrimitive(v) {
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 1000) / 1000);
      const s = String(v);
      return /^\d{4}-\d{2}-\d{2}T/.test(s) && !isNaN(Date.parse(s)) ? new Date(s).toUTCString() : s;
    }

    // Recursively turns ANY value into DOM nodes; skips empty values entirely.
    function renderValue(value, depth) {
      if (isEmpty(value)) return null;
      if (typeof value !== 'object') return document.createTextNode(formatPrimitive(value));

      if (Array.isArray(value)) {
        const items = value.filter((v) => !isEmpty(v));
        if (items.every((v) => typeof v !== 'object')) {
          if (items.length === 1) return document.createTextNode(formatPrimitive(items[0]));
          const ul = Dom.el('ul');
          items.forEach((v) => ul.appendChild(Dom.el('li', '', formatPrimitive(v))));
          return ul;
        }
        const ul = Dom.el('ul');
        items.forEach((v) => {
          const li = Dom.el('li');
          const node = renderValue(v, depth + 1);
          if (node) li.appendChild(node);
          ul.appendChild(li);
        });
        return ul;
      }

      const dl = Dom.el('dl', 'kv');
      Object.entries(value).forEach(([k, v]) => {
        const node = renderValue(v, depth + 1);
        if (!node) return;
        dl.appendChild(Dom.el('dt', '', humanize(k)));
        const dd = Dom.el('dd');
        dd.appendChild(node);
        dl.appendChild(dd);
      });
      return dl;
    }

    function isCssColor(s) {
      return typeof s === 'string' && window.CSS && CSS.supports('color', s.trim());
    }

    // Legend can be: [{color,label}], {colorOrLabel: labelOrColor}, or [strings].
    function legendItems(value) {
      const out = [];
      const pushPair = (a, b) => {
        let color = null, label = null;
        if (isCssColor(a) && !isCssColor(b)) { color = a; label = b; }
        else if (isCssColor(b)) { color = b; label = a; }
        else { label = [a, b].filter((x) => !isEmpty(x)).join(': '); }
        if (!isEmpty(label) || color) out.push({ color, label: isEmpty(label) ? '' : String(label) });
      };
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item && typeof item === 'object') {
            const color = item.color ?? item.colour ?? item.hex ?? item.swatch;
            const label = item.label ?? item.name ?? item.class ?? item.meaning ?? '';
            const desc = item.description ?? item.meaning ?? '';
            const text = [label, desc && desc !== label ? desc : ''].filter((x) => !isEmpty(x)).join(' - ');
            out.push({ color: isCssColor(color) ? color : null, label: text });
          } else if (typeof item === 'string') {
            const m = item.match(/^\s*([^:=\-–]+?)\s*[:=\-–]\s*(.+)$/);
            m ? pushPair(m[1], m[2]) : out.push({ color: null, label: item });
          }
        });
      } else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([k, v]) => {
          typeof v === 'object' && v !== null
            ? out.push({ color: isCssColor(v.color ?? v.hex) ? (v.color ?? v.hex) : (isCssColor(k) ? k : null),
                         label: [humanize(k), v.label ?? v.meaning ?? v.description].filter((x) => !isEmpty(x)).join(' - ') })
            : pushPair(k, v);
        });
      }
      return out.filter((i) => i.label || i.color);
    }

    function renderLegend(value) {
      const items = legendItems(value);
      if (!items.length) return renderValue(value, 0);
      const ul = Dom.el('ul', 'legend');
      items.forEach((i) => {
        const li = Dom.el('li');
        const sw = Dom.el('span', 'legend__swatch');
        if (i.color) sw.style.background = i.color; else sw.style.visibility = 'hidden';
        li.append(sw, Dom.el('span', '', i.label));
        ul.appendChild(li);
      });
      return ul;
    }

    function block(title, nodes) {
      const section = Dom.el('div', 'report__block');
      section.appendChild(Dom.el('h3', '', title));
      nodes.forEach((n) => section.appendChild(n));
      return section;
    }

    function render(zone, report) {
      const frag = document.createDocumentFragment();
      const data = report && typeof report === 'object' ? report : { summary: report };

      const title = data.title ?? data.name ?? zone.name;
      frag.appendChild(Dom.el('h2', 'report__title', isEmpty(title) ? zone.name : title));
      frag.appendChild(Dom.el('span', 'report__tag', `${humanize(zone.kind === 'default' ? 'zone' : zone.kind)} monitoring`));

      const buckets = SECTIONS.map(() => []);
      const other = [];
      Object.entries(data).forEach(([key, value]) => {
        if (SKIP_KEYS.test(key) || isEmpty(value)) return;
        const idx = SECTIONS.findIndex((s) => s.test.test(key));
        (idx >= 0 ? buckets[idx] : other).push([key, value]);
      });

      const entryNode = ([key, value], isLegend) => {
        const body = isLegend ? renderLegend(value) : renderValue(value, 0);
        if (!body) return null;
        const wrap = Dom.el('div');
        if (typeof value === 'string' && !isLegend) {
          const p = Dom.el('p');
          p.appendChild(Dom.el('strong', '', `${humanize(key)}: `));
          p.appendChild(body);
          return p;
        }
        const label = Dom.el('p');
        label.appendChild(Dom.el('strong', '', humanize(key)));
        wrap.append(label, body);
        return wrap;
      };

      SECTIONS.forEach((section, i) => {
        const nodes = buckets[i].map((e) => entryNode(e, section.title === 'Colour legend')).filter(Boolean);
        if (nodes.length) frag.appendChild(block(section.title, nodes));
      });
      const otherNodes = other.map((e) => entryNode(e, false)).filter(Boolean);
      if (otherNodes.length) frag.appendChild(block('More details', otherNodes));

      if (frag.children.length <= 2) {
        frag.appendChild(block('Report', [Dom.el('p', '', 'This report has no readable fields yet.')]));
      }
      return frag;
    }

    return { render };
  })();

  /* ===================== MAP VIEW ===================== */
  const MapView = {
    map: null,
    radarGroup: null,
    eonetGroup: null,
    zones: [],
    activeZone: null,
    radarVisible: true,
    opacity: CONFIG.defaultOpacity,

    init() {
      if (typeof L === 'undefined') throw new Error('Leaflet failed to load (check the CDN script tag / network).');
      const container = Dom.$('map');
      if (!container) throw new Error('Missing #map element.');

      const esri = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Maxar, Earthstar Geographics, GIS User Community' });
      const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });

      this.map = L.map(container, {
        center: CONFIG.initialCenter, zoom: CONFIG.initialZoom, minZoom: 2, maxZoom: 18,
        worldCopyJump: true, layers: [esri]
      });
      this.radarGroup = L.layerGroup().addTo(this.map);
      this.eonetGroup = L.layerGroup().addTo(this.map);

      L.control.layers({ 'Esri World Imagery (Optical)': esri, 'OpenStreetMap': osm },
        { 'NISAR radar overlays': this.radarGroup, 'Live NASA EONET events': this.eonetGroup },
        { position: 'topright', collapsed: true }).addTo(this.map);
      L.control.scale({ position: 'bottomleft' }).addTo(this.map);

      // Leaflet needs a size recalculation when the layout settles / changes.
      requestAnimationFrame(() => this.map.invalidateSize());
      window.addEventListener('load', () => this.map.invalidateSize());
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => this.map.invalidateSize({ animate: false })).observe(container);
      }
    },

    addZones(zones, onSelect) {
      this.zones = zones;
      zones.forEach((zone) => {
        // Pin first, so a zone with a center always gets its marker.
        if (zone.center) {
          const dot = document.createElement('div');
          dot.className = 'zone-marker';
          dot.style.setProperty('--c', zone.color);
          const icon = L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: dot });
          zone.marker = L.marker(zone.center, { icon, title: zone.name, keyboard: true })
            .bindTooltip(zone.name, { direction: 'top', offset: [0, -10] })
            .on('click', () => onSelect(zone))
            .addTo(this.map);
        }

        if (!zone.bounds) return;

        // --- COMBINED overlay (original, used in "combined" mode) ---
        zone.overlay = L.imageOverlay(zone.overlayUrl, zone.bounds,
          { opacity: this.opacity, interactive: false, alt: `${zone.name} NISAR radar overlay` });
        zone.overlay.on('error', () => console.warn('[SAR Map] Overlay failed to load:', zone.overlayUrl));
        zone.overlay.addTo(this.radarGroup);

        // --- BEFORE overlay (blue/cyan layer) ---
        zone.beforeOverlay = L.imageOverlay(zone.beforeUrl, zone.bounds,
          { opacity: this.opacity, interactive: false, alt: `${zone.name} SAR before` });
        zone.beforeOverlay.on('error', () => console.warn('[SAR Map] Before overlay failed:', zone.beforeUrl));
        // Not added to map yet — activated by setViewMode

        // --- AFTER overlay (orange layer, carries clip-path in swipe mode) ---
        zone.afterOverlay = L.imageOverlay(zone.afterUrl, zone.bounds,
          { opacity: this.opacity, interactive: false, alt: `${zone.name} SAR after` });
        zone.afterOverlay.on('error', () => console.warn('[SAR Map] After overlay failed:', zone.afterUrl));
        // Not added to map yet — activated by setViewMode
      });
    },

    fly(zone) {
      if (zone.bounds) this.map.flyToBounds(zone.bounds, { padding: [30, 30], duration: 1.6 });
      else if (zone.center) this.map.flyTo(zone.center, 8, { duration: 1.6 });
    },

    // Make sure the selected zone's radar layer is on the map for the current view mode.
    showZoneOverlay(zone) {
      if (!zone.bounds || !this.radarVisible) return;
      Swipe.applyMode(Swipe.mode, Swipe.percent);
    },

    insideAnyZone(latlng) {
      return this.zones.some((z) => z.bounds && L.latLngBounds(z.bounds).contains(latlng));
    },

    // ---- Opacity applies to whichever overlays are currently active ----
    setOpacity(value01) {
      this.opacity = value01;
      this.zones.forEach((z) => {
        if (z.overlay)        z.overlay.setOpacity(value01);
        if (z.beforeOverlay)  z.beforeOverlay.setOpacity(value01);
        if (z.afterOverlay)   z.afterOverlay.setOpacity(value01);
      });
    },

    setRadarVisible(visible) {
      this.radarVisible = visible;
      if (visible) this.map.addLayer(this.radarGroup); else this.map.removeLayer(this.radarGroup);
      // Also hide/show the before/after overlays if they are on the map
      if (!visible) {
        this.zones.forEach((z) => {
          if (z.beforeOverlay) this.map.removeLayer(z.beforeOverlay);
          if (z.afterOverlay)  this.map.removeLayer(z.afterOverlay);
        });
      } else {
        // Re-apply the current view mode to restore overlays
        Swipe.applyMode(Swipe.mode, Swipe.percent);
      }
    },

    // ----- View mode / swipe helpers called by the Swipe controller -----
    // mode: 'combined' | 'before' | 'after' | 'swipe'
    applyViewMode(mode, pct) {
      const op = this.opacity;
      this.zones.forEach((z) => {
        if (!z.bounds) return;
        const hasAll = z.overlay && z.beforeOverlay && z.afterOverlay;
        if (!hasAll) return;

        // Remove everything first to avoid stacking artefacts
        this.map.removeLayer(z.overlay);
        this.map.removeLayer(z.beforeOverlay);
        this.map.removeLayer(z.afterOverlay);

        // Clear any clip-path from a previous swipe session
        const afterEl = z.afterOverlay.getElement ? z.afterOverlay.getElement() : null;
        if (afterEl) afterEl.style.clipPath = '';
        const beforeEl = z.beforeOverlay.getElement ? z.beforeOverlay.getElement() : null;
        if (beforeEl) beforeEl.style.clipPath = '';

        if (!this.radarVisible) return; // respect the existing toggle-radar button

        switch (mode) {
          case 'combined':
            z.overlay.setOpacity(op);
            z.overlay.addTo(this.radarGroup);
            break;

          case 'before':
            z.beforeOverlay.setOpacity(op);
            z.beforeOverlay.addTo(this.radarGroup);
            break;

          case 'after':
            z.afterOverlay.setOpacity(op);
            z.afterOverlay.addTo(this.radarGroup);
            break;

          case 'swipe': {
            // Show BEFORE fully, clip AFTER to the right portion only
            z.beforeOverlay.setOpacity(op);
            z.beforeOverlay.addTo(this.radarGroup);
            z.afterOverlay.setOpacity(op);
            z.afterOverlay.addTo(this.radarGroup);

            // Apply clip once the image element exists (may need a tick)
            const applyClip = () => {
              const el = z.afterOverlay.getElement();
              if (el) {
                // Reveal AFTER only on the right of the divider
                el.style.clipPath = `polygon(${pct}% 0%, 100% 0%, 100% 100%, ${pct}% 100%)`;
              }
            };
            if (z.afterOverlay.getElement()) applyClip();
            else z.afterOverlay.once('load', applyClip);
            break;
          }
        }
      });
    },

    // Update clip-path only (called on every pointer-move during swipe drag)
    updateSwipeClip(pct) {
      this.zones.forEach((z) => {
        if (!z.afterOverlay) return;
        const el = z.afterOverlay.getElement ? z.afterOverlay.getElement() : null;
        if (el) el.style.clipPath = `polygon(${pct}% 0%, 100% 0%, 100% 100%, ${pct}% 100%)`;
      });
    }
  };

  /* ===================== SWIPE CONTROLLER ===================== */
  const Swipe = {
    mode: 'combined',
    percent: 50,

    // DOM references (set during init)
    handle: null,
    swipeRow: null,
    swipeSlider: null,
    swipeValue: null,
    viewBtns: null,

    init() {
      this.handle      = Dom.$('swipe-handle');
      this.swipeRow    = Dom.$('swipe-row');
      this.swipeSlider = Dom.$('swipe-slider');
      this.swipeValue  = Dom.$('swipe-value');
      this.viewBtns    = document.querySelectorAll('.view-btn');

      // Enable all view-mode buttons
      this.viewBtns.forEach((btn) => {
        btn.disabled = false;
        btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
      });

      // Swipe sidebar slider
      this.swipeSlider.addEventListener('input', () => {
        this.percent = Number(this.swipeSlider.value);
        this.swipeValue.textContent = `${this.percent}%`;
        this._updateHandlePosition();
        MapView.updateSwipeClip(this.percent);
      });

      // Drag on the map handle (mouse + touch)
      this._attachDrag();
    },

    setMode(mode) {
      this.mode = mode;

      // Update button states
      this.viewBtns.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.mode === mode));

      // Show/hide swipe-specific UI
      const isSwipe = mode === 'swipe';
      this.handle.hidden      = !isSwipe;
      this.swipeRow.hidden    = !isSwipe;

      if (isSwipe) this._updateHandlePosition();
      this.applyMode(mode, this.percent);
    },

    applyMode(mode, pct) {
      MapView.applyViewMode(mode, pct);
    },

    _updateHandlePosition() {
      if (!this.handle) return;
      this.handle.style.left = `${this.percent}%`;
    },

    _attachDrag() {
      const handle = this.handle;
      const mapWrapper = document.querySelector('.map-wrapper');
      let dragging = false;

      const getX = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const rect = mapWrapper.getBoundingClientRect();
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100;
      };

      const onMove = (e) => {
        if (!dragging) return;
        e.preventDefault();
        this.percent = Math.round(getX(e));
        this.swipeSlider.value = this.percent;
        this.swipeValue.textContent = `${this.percent}%`;
        this._updateHandlePosition();
        MapView.updateSwipeClip(this.percent);
      };

      const onUp = () => { dragging = false; };

      handle.addEventListener('mousedown',  (e) => { if (this.mode === 'swipe') { dragging = true; e.preventDefault(); } });
      handle.addEventListener('touchstart', (e) => { if (this.mode === 'swipe') { dragging = true; } }, { passive: true });

      window.addEventListener('mousemove',  onMove);
      window.addEventListener('mouseup',    onUp);
      window.addEventListener('touchmove',  onMove, { passive: false });
      window.addEventListener('touchend',   onUp);
    }
  };

  /* ===================== REPORT DOWNLOAD GENERATOR ===================== */
  const ReportGenerator = {
    sanitizeFilename(name) {
      return String(name || 'Zone')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    },

    escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },

    humanize(key) {
      const s = String(key).replace(/[_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      return s.charAt(0).toUpperCase() + s.slice(1);
    },

    formatValue(v) {
      if (v === null || v === undefined) return 'N/A';
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 1000) / 1000);
      const s = String(v);
      return /^\d{4}-\d{2}-\d{2}T/.test(s) && !isNaN(Date.parse(s)) ? new Date(s).toUTCString() : s;
    },

    getViewModeLabel() {
      const mode = (typeof Swipe !== 'undefined' && Swipe.mode) ? Swipe.mode : 'combined';
      switch (mode) {
        case 'combined': return 'Combined';
        case 'before':   return 'Before';
        case 'after':    return 'After';
        case 'swipe':    return `Swipe (${(typeof Swipe !== 'undefined' && Swipe.percent) ? Swipe.percent : 50}%)`;
        default:         return this.humanize(mode);
      }
    },

    getFilename(selection) {
      const dateStr = new Date().toISOString().slice(0, 10);
      let nameSlug = 'Zone';
      if (selection.type === 'zone') {
        const raw = selection.report?.title || selection.report?.region || selection.zone?.name || selection.zone?.title || 'Zone';
        const shortName = raw.split(/[,(]/)[0].trim();
        nameSlug = this.sanitizeFilename(shortName || raw);
      } else if (selection.type === 'eonet') {
        const lat = selection.latlng.lat.toFixed(2).replace('.', '_').replace('-', 'S');
        const lng = selection.latlng.lng.toFixed(2).replace('.', '_').replace('-', 'W');
        nameSlug = `NASA-EONET-${lat}-${lng}`;
      }
      return `NISAR-Report-${nameSlug}-${dateStr}.html`;
    },

    generate(selection) {
      const isZone = selection && selection.type === 'zone';
      const now = new Date();
      const generatedAtIso = now.toISOString();
      const generatedAtLocal = now.toLocaleString(undefined, {
        dateStyle: 'full',
        timeStyle: 'long'
      });

      const viewMode = this.getViewModeLabel();
      const opacityPct = `${Math.round((MapView.opacity || 0.85) * 100)}%`;
      const radarState = MapView.radarVisible ? 'Visible (Active)' : 'Hidden (Optical Only)';

      let reportTitle = '';
      let categoryTag = '';
      let sensorName = '';
      let coordinatesHtml = '';
      let scienceSectionsHtml = '';

      if (isZone) {
        const { zone, report } = selection;
        const data = report && typeof report === 'object' ? report : {};
        reportTitle = data.title || data.region || zone.name || 'NISAR Observation Zone';
        categoryTag = `${this.humanize(zone.kind === 'default' ? 'zone' : zone.kind)} Monitoring`;
        sensorName = 'NISAR L-Band SAR';

        // Coordinates & Extent
        const centerStr = zone.center ? `${zone.center[0].toFixed(4)}°, ${zone.center[1].toFixed(4)}°` : 'N/A';
        const boundsStr = zone.bounds
          ? `South: ${zone.bounds[0][0].toFixed(4)}°, West: ${zone.bounds[0][1].toFixed(4)}°, North: ${zone.bounds[1][0].toFixed(4)}°, East: ${zone.bounds[1][1].toFixed(4)}°`
          : 'N/A';

        coordinatesHtml = `
          <div class="meta-card">
            <span class="meta-label">Center Coordinates (Lat, Lng)</span>
            <span class="meta-value">${this.escapeHtml(centerStr)}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Geographic Bounding Box</span>
            <span class="meta-value">${this.escapeHtml(boundsStr)}</span>
          </div>
        `;

        // Acquisitions
        if (data.acquisitions && typeof data.acquisitions === 'object') {
          let rows = '';
          Object.entries(data.acquisitions).forEach(([k, v]) => {
            rows += `<tr><td>${this.escapeHtml(this.humanize(k))}</td><td>${this.escapeHtml(this.formatValue(v))}</td></tr>`;
          });
          if (rows) {
            scienceSectionsHtml += `
              <div class="report-section">
                <h3 class="section-heading">Acquisitions &amp; Sensor Timing</h3>
                <table class="data-table">
                  <thead><tr><th>Parameter / Pass</th><th>Observation Value</th></tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            `;
          }
        }

        // Metrics
        if (data.metrics && typeof data.metrics === 'object') {
          let metricCards = '';
          Object.entries(data.metrics).forEach(([k, v]) => {
            metricCards += `
              <div class="metric-card">
                <span class="metric-value">${this.escapeHtml(this.formatValue(v))}</span>
                <span class="metric-label">${this.escapeHtml(this.humanize(k))}</span>
              </div>
            `;
          });
          if (metricCards) {
            scienceSectionsHtml += `
              <div class="report-section">
                <h3 class="section-heading">Key Science Metrics</h3>
                <div class="metric-grid">${metricCards}</div>
              </div>
            `;
          }
        }

        // What caused it / Physical mechanism
        const causeText = data.cause || data.mechanism || data.description;
        if (causeText) {
          scienceSectionsHtml += `
            <div class="report-section">
              <h3 class="section-heading">What Caused It (Physical Mechanism)</h3>
              <p class="prose">${this.escapeHtml(causeText)}</p>
            </div>
          `;
        }

        // SAR vs Optical
        const sarVsOptical = data.sar_vs_optical_advantage || data.optical_comparison;
        if (sarVsOptical) {
          scienceSectionsHtml += `
            <div class="report-section">
              <h3 class="section-heading">SAR vs. Optical Advantage</h3>
              <p class="prose">${this.escapeHtml(sarVsOptical)}</p>
            </div>
          `;
        }

        // Community & Ecosystem Impact
        const impactText = data.community_impact || data.impact;
        if (impactText) {
          scienceSectionsHtml += `
            <div class="report-section">
              <h3 class="section-heading">Community &amp; Ecosystem Impact</h3>
              <p class="prose">${this.escapeHtml(impactText)}</p>
            </div>
          `;
        }

        // Colour Legend
        if (data.legend && typeof data.legend === 'object') {
          let legendItemsHtml = '';
          Object.entries(data.legend).forEach(([k, v]) => {
            let swatchColor = '#38bdf8';
            const kLower = k.toLowerCase();
            if (kLower.includes('orange') || kLower.includes('red')) swatchColor = '#f97316';
            else if (kLower.includes('cyan') || kLower.includes('blue')) swatchColor = '#38bdf8';
            else if (kLower.includes('green') || kLower.includes('yellow')) swatchColor = '#eab308';
            else if (kLower.includes('magenta') || kLower.includes('purple')) swatchColor = '#d946ef';

            legendItemsHtml += `
              <li class="legend-item">
                <span class="legend-swatch" style="background-color: ${swatchColor}"></span>
                <div class="legend-text">
                  <strong>${this.escapeHtml(this.humanize(k))}:</strong>
                  ${this.escapeHtml(String(v))}
                </div>
              </li>
            `;
          });
          if (legendItemsHtml) {
            scienceSectionsHtml += `
              <div class="report-section">
                <h3 class="section-heading">Colour Legend</h3>
                <ul class="legend-list">${legendItemsHtml}</ul>
              </div>
            `;
          }
        }

        // Any extra fields
        const knownKeys = /^(title|region|acquisitions|metrics|cause|mechanism|description|sar_vs_optical_advantage|optical_comparison|community_impact|impact|legend|bounds)$/i;
        let otherRows = '';
        Object.entries(data).forEach(([k, v]) => {
          if (!knownKeys.test(k) && v !== null && v !== undefined && typeof v !== 'object') {
            otherRows += `<tr><td>${this.escapeHtml(this.humanize(k))}</td><td>${this.escapeHtml(this.formatValue(v))}</td></tr>`;
          }
        });
        if (otherRows) {
          scienceSectionsHtml += `
            <div class="report-section">
              <h3 class="section-heading">More Details</h3>
              <table class="data-table"><tbody>${otherRows}</tbody></table>
            </div>
          `;
        }

      } else {
        // EONET Live Event
        const { latlng, data } = selection;
        reportTitle = `Live NASA EONET Events near ${latlng.lat.toFixed(2)}, ${latlng.lng.toFixed(2)}`;
        categoryTag = 'NASA EONET v3 Live Feed';
        sensorName = 'NASA EONET Live Feed';

        coordinatesHtml = `
          <div class="meta-card">
            <span class="meta-label">Query Coordinates</span>
            <span class="meta-value">${latlng.lat.toFixed(4)}°, ${latlng.lng.toFixed(4)}°</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Search Extent</span>
            <span class="meta-value">±${CONFIG.eonetBoxDegrees}° bounding search box</span>
          </div>
        `;

        const features = (data && Array.isArray(data.features)) ? data.features : [];
        if (!features.length) {
          scienceSectionsHtml += `
            <div class="report-section">
              <h3 class="section-heading">No Open Events</h3>
              <p class="prose">NASA EONET reports no open natural events within about ${CONFIG.eonetBoxDegrees} degrees of this point.</p>
            </div>
          `;
        } else {
          let eventCards = '';
          features.forEach((f, idx) => {
            const p = f.properties || {};
            const cats = Array.isArray(p.categories) ? p.categories.map((c) => c && c.title).filter(Boolean).join(', ') : 'Natural Event';
            const dateStr = p.date ? new Date(p.date).toUTCString() : 'N/A';
            const magStr = p.magnitudeValue != null ? `${p.magnitudeValue} ${p.magnitudeUnit || ''}`.trim() : null;
            let pt = null;
            if (f.geometry && f.geometry.coordinates) {
              let c = f.geometry.coordinates;
              while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
              if (Array.isArray(c) && c.length >= 2) pt = `${c[1].toFixed(3)}°, ${c[0].toFixed(3)}°`;
            }

            eventCards += `
              <div class="event-card">
                <div class="event-header">
                  <h4 class="event-title">${idx + 1}. ${this.escapeHtml(p.title || 'Natural Event')}</h4>
                  <span class="event-badge">${this.escapeHtml(cats)}</span>
                </div>
                <div class="event-details-grid">
                  <div><strong>Date:</strong> ${this.escapeHtml(dateStr)}</div>
                  ${pt ? `<div><strong>Coordinates:</strong> ${this.escapeHtml(pt)}</div>` : ''}
                  ${magStr ? `<div><strong>Magnitude:</strong> ${this.escapeHtml(magStr)}</div>` : ''}
                </div>
                ${p.link ? `<p><a class="external-link" href="${this.escapeHtml(p.link)}" target="_blank" rel="noopener noreferrer">View on EONET &rarr;</a></p>` : ''}
              </div>
            `;
          });

          scienceSectionsHtml += `
            <div class="report-section">
              <h3 class="section-heading">Active Open Events (${features.length})</h3>
              <div class="event-list">${eventCards}</div>
            </div>
          `;
        }
      }

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dancing with the SARs — NISAR L-Band Change Detection Report — ${this.escapeHtml(reportTitle)}</title>
  <style>
    :root {
      --bg: #0b1220;
      --card-bg: #111c2e;
      --card-alt: #162338;
      --border: #26364d;
      --text: #e8eef8;
      --muted: #9aabc2;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.25);
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      line-height: 1.6;
      padding: 32px 20px;
    }

    .report-wrapper {
      max-width: 900px;
      margin: 0 auto;
    }

    .action-bar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 20px;
      gap: 12px;
    }

    .print-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 16px;
      border: 1px solid var(--accent);
      border-radius: 8px;
      background: #0ea5e922;
      color: var(--accent);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .print-btn:hover {
      background: #0ea5e944;
      box-shadow: 0 0 12px var(--accent-glow);
    }

    .mission-header {
      background: linear-gradient(135deg, #111c2e 0%, #0d1728 100%);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      position: relative;
      overflow: hidden;
    }

    .mission-header::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #38bdf8, #0ea5e9, #6366f1);
    }

    .header-top {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 12px;
    }

    .mission-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      border-radius: 999px;
      background: #0ea5e91f;
      border: 1px solid #38bdf844;
      color: #7dd3fc;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .doc-title {
      font-size: 24px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.3px;
      margin-bottom: 8px;
    }

    .doc-subtitle {
      font-size: 14px;
      color: var(--muted);
      margin-bottom: 16px;
    }

    .target-title-block {
      border-top: 1px solid var(--border);
      padding-top: 16px;
      margin-top: 16px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: baseline;
      gap: 10px;
    }

    .target-title {
      font-size: 20px;
      font-weight: 700;
      color: #38bdf8;
    }

    .target-tag {
      font-size: 12px;
      font-weight: 600;
      color: #93c5fd;
      background: #1e3a8a33;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid #3b82f644;
    }

    .timestamp-line {
      font-size: 12px;
      color: var(--muted);
      margin-top: 8px;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }

    .meta-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
    }

    .meta-label {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--muted);
      margin-bottom: 4px;
    }

    .meta-value {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
    }

    .report-section {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 22px;
      margin-bottom: 20px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }

    .section-heading {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--accent);
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-heading::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    .prose {
      font-size: 14px;
      line-height: 1.7;
      color: #cbd5e1;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
    }

    .metric-card {
      background: var(--card-alt);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .metric-value {
      font-size: 18px;
      font-weight: 700;
      color: #38bdf8;
    }

    .metric-label {
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .data-table th, .data-table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    .data-table th {
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.6px;
      background: var(--card-alt);
    }

    .data-table td {
      color: var(--text);
    }

    .legend-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .legend-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: var(--card-alt);
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }

    .legend-swatch {
      flex: 0 0 16px;
      width: 16px;
      height: 16px;
      border-radius: 4px;
      margin-top: 3px;
      border: 1px solid rgba(255, 255, 255, 0.4);
    }

    .legend-text {
      font-size: 13px;
      line-height: 1.5;
    }

    .legend-text strong {
      color: #ffffff;
      margin-right: 6px;
    }

    .event-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .event-card {
      background: var(--card-alt);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }

    .event-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 8px;
      gap: 10px;
    }

    .event-title {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
    }

    .event-badge {
      font-size: 11px;
      font-weight: 600;
      color: #f43f5e;
      background: #f43f5e18;
      border: 1px solid #f43f5e44;
      padding: 3px 8px;
      border-radius: 999px;
    }

    .event-details-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 6px 14px;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 8px;
    }

    .event-details-grid strong {
      color: var(--text);
    }

    .external-link {
      color: var(--accent);
      text-decoration: none;
      font-size: 12px;
      font-weight: 600;
    }

    .external-link:hover {
      text-decoration: underline;
    }

    .report-footer {
      border-top: 1px solid var(--border);
      padding-top: 20px;
      margin-top: 32px;
      text-align: center;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.8;
    }

    .attribution-highlight {
      font-weight: 600;
      color: #cbd5e1;
    }

    @media print {
      body {
        background: #ffffff !important;
        color: #0f172a !important;
        padding: 0 !important;
      }
      .no-print {
        display: none !important;
      }
      .report-wrapper {
        max-width: 100% !important;
      }
      .mission-header {
        background: #f8fafc !important;
        border: 1px solid #cbd5e1 !important;
        box-shadow: none !important;
        color: #0f172a !important;
      }
      .doc-title {
        color: #0f172a !important;
      }
      .target-title {
        color: #0284c7 !important;
      }
      .meta-card, .report-section, .metric-card, .legend-item, .event-card {
        background: #f8fafc !important;
        border: 1px solid #cbd5e1 !important;
        box-shadow: none !important;
        break-inside: avoid;
      }
      .meta-value, .prose, .data-table td, .event-title, .legend-text strong {
        color: #0f172a !important;
      }
      .meta-label, .metric-label, .doc-subtitle, .timestamp-line, .event-details-grid {
        color: #64748b !important;
      }
      .metric-value, .section-heading {
        color: #0284c7 !important;
      }
      .legend-swatch {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      .report-footer {
        border-color: #cbd5e1 !important;
        color: #64748b !important;
      }
      .attribution-highlight {
        color: #0f172a !important;
      }
    }
  </style>
</head>
<body>
  <div class="report-wrapper">
    <div class="action-bar no-print">
      <button class="print-btn" type="button" onclick="window.print()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Print / Save as PDF
      </button>
    </div>

    <header class="mission-header">
      <div class="header-top">
        <span class="mission-badge">NASA Space Apps 2026 &middot; NISAR Mission Brief</span>
      </div>
      <h1 class="doc-title">Dancing with the SARs &mdash; NISAR L-Band Change Detection Report</h1>
      <p class="doc-subtitle">High-resolution dual-frequency synthetic aperture radar change detection analysis and observation summary.</p>
      
      <div class="target-title-block">
        <h2 class="target-title">${this.escapeHtml(reportTitle)}</h2>
        <span class="target-tag">${this.escapeHtml(categoryTag)}</span>
      </div>
      <p class="timestamp-line">Report Generated: <strong>${this.escapeHtml(generatedAtLocal)}</strong> (${this.escapeHtml(generatedAtIso)})</p>
    </header>

    <div class="meta-grid">
      <div class="meta-card">
        <span class="meta-label">Satellite / Sensor</span>
        <span class="meta-value">${this.escapeHtml(sensorName)}</span>
      </div>
      <div class="meta-card">
        <span class="meta-label">Active View Mode</span>
        <span class="meta-value">${this.escapeHtml(viewMode)}</span>
      </div>
      <div class="meta-card">
        <span class="meta-label">Overlay Opacity</span>
        <span class="meta-value">${this.escapeHtml(opacityPct)}</span>
      </div>
      <div class="meta-card">
        <span class="meta-label">Radar Layer State</span>
        <span class="meta-value">${this.escapeHtml(radarState)}</span>
      </div>
      ${coordinatesHtml}
    </div>

    <main>
      ${scienceSectionsHtml}
    </main>

    <footer class="report-footer">
      <p class="attribution-highlight">Data sources: NASA-ISRO SAR (NISAR) Mission Simulation / NASA EONET v3 / Esri World Imagery.</p>
      <p>Dancing with the SARs &middot; NASA Space Apps Challenge 2026 &middot; Earth Observation Dashboard</p>
    </footer>
  </div>
</body>
</html>`;
    }
  };

  /* ===================== SIDEBAR / EONET UI ===================== */
  const Sidebar = {
    panel: () => Dom.$('report-panel'),
    content: () => Dom.$('report-content'),
    downloadBtn: () => Dom.$('download-report-btn'),
    downloadText: () => Dom.$('download-report-text'),
    _confirmTimer: null,

    show(nodes) {
      const target = this.content() || this.panel();
      Dom.clear(target);
      target.appendChild(Dom.el('h2', 'sidebar__heading', 'Science report'));
      target.appendChild(nodes);
      target.scrollTop = 0;
      const rightSidebar = Dom.$('sidebar-right');
      if (rightSidebar) rightSidebar.scrollTop = 0;
      const leftSidebar = Dom.$('sidebar');
      if (leftSidebar) leftSidebar.scrollTop = 0;
    },

    message(text, isError) {
      const frag = document.createDocumentFragment();
      frag.appendChild(Dom.el(isError ? 'div' : 'p', isError ? 'error-box' : 'muted', text));
      this.show(frag);
      this.setDownloadVisible(false);
    },

    setDownloadVisible(visible, label = 'Download Report', tooltip) {
      const btn = this.downloadBtn();
      const textSpan = this.downloadText();
      if (!btn) return;

      if (this._confirmTimer) {
        clearTimeout(this._confirmTimer);
        this._confirmTimer = null;
        btn.classList.remove('is-success');
      }

      if (visible) {
        btn.disabled = false;
        btn.title = tooltip || 'Download NISAR Science Report';
        if (textSpan) {
          textSpan.textContent = label || 'Download Report';
        }
      } else {
        btn.disabled = true;
        btn.title = 'Select a study zone or click the map first';
        if (textSpan) {
          textSpan.textContent = 'Download Report';
        }
      }
    },

    showConfirmation(message = '✓ Downloaded') {
      const btn = this.downloadBtn();
      const textSpan = this.downloadText();
      if (!btn || !textSpan) return;

      if (this._confirmTimer) clearTimeout(this._confirmTimer);

      textSpan.textContent = message;
      btn.classList.add('is-success');

      this._confirmTimer = setTimeout(() => {
        textSpan.textContent = 'Download Report';
        btn.classList.remove('is-success');
        this._confirmTimer = null;
      }, 2000);
    }
  };

  function renderEonet(latlng, geojson) {
    const frag = document.createDocumentFragment();
    frag.appendChild(Dom.el('h2', 'report__title', 'Live NASA EONET events'));
    frag.appendChild(Dom.el('span', 'report__tag',
      `Near ${latlng.lat.toFixed(2)}, ${latlng.lng.toFixed(2)}`));

    const features = (geojson && Array.isArray(geojson.features)) ? geojson.features : [];
    MapView.eonetGroup.clearLayers();

    if (!features.length) {
      frag.appendChild(block('No open events', 'NASA EONET reports no open natural events within about '
        + `${CONFIG.eonetBoxDegrees} degrees of this point.`));
      return frag;
    }

    features.forEach((f) => {
      const p = f.properties || {};
      const point = eventPoint(f.geometry);
      if (point) {
        // GeoJSON is [lon, lat]; Leaflet wants [lat, lon].
        const latlngPoint = [point[1], point[0]];
        const icon = L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div class="eonet-marker"></div>' });
        const popup = Dom.el('div');
        popup.appendChild(Dom.el('strong', '', p.title || 'Natural event'));
        popup.appendChild(document.createElement('br'));
        popup.appendChild(document.createTextNode(categoryText(p) + (p.date ? ` \u00b7 ${formatDate(p.date)}` : '')));
        L.marker(latlngPoint, { icon }).bindPopup(popup).addTo(MapView.eonetGroup);
      }

      const card = Dom.el('div', 'report__block');
      card.appendChild(Dom.el('h3', '', p.title || 'Natural event'));
      const dl = Dom.el('dl', 'kv');
      const row = (k, v) => { if (v) { dl.appendChild(Dom.el('dt', '', k)); dl.appendChild(Dom.el('dd', '', v)); } };
      row('Category', categoryText(p));
      row('Date', p.date ? formatDate(p.date) : '');
      row('Location', point ? `${point[1].toFixed(3)}, ${point[0].toFixed(3)}` : '');
      if (p.magnitudeValue != null) row('Magnitude', `${p.magnitudeValue} ${p.magnitudeUnit || ''}`.trim());
      card.appendChild(dl);
      if (p.link) {
        const a = Dom.el('a', 'eonet-link', 'View on EONET');
        a.href = p.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
        const para = Dom.el('p'); para.appendChild(a); card.appendChild(para);
      }
      frag.appendChild(card);
    });
    return frag;
  }

  function block(title, text) {
    const b = Dom.el('div', 'report__block');
    b.appendChild(Dom.el('h3', '', title));
    b.appendChild(Dom.el('p', '', text));
    return b;
  }
  function categoryText(p) {
    const cats = Array.isArray(p.categories) ? p.categories.map((c) => c && c.title).filter(Boolean) : [];
    return cats.join(', ') || 'Uncategorised';
  }
  function formatDate(s) { const d = new Date(s); return isNaN(d) ? String(s) : d.toUTCString(); }
  // First coordinate pair of a Point / Polygon / LineString etc. -> [lon, lat]
  function eventPoint(geometry) {
    let c = geometry && geometry.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    return Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1]) ? [Number(c[0]), Number(c[1])] : null;
  }

  /* ===================== APP ===================== */
  const App = {
    activeZone: null,
    currentSelection: null,

    status(text, cls) {
      const pill = Dom.$('map-status');
      pill.textContent = text;
      pill.classList.remove('status-pill--ready', 'status-pill--error');
      if (cls) pill.classList.add(cls);
    },

    setupDrawer() {
      const body = document.body, toggle = Dom.$('sidebar-toggle'), backdrop = Dom.$('sidebar-backdrop');
      const set = (open) => {
        body.classList.toggle('sidebar-open', open);
        backdrop.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
      };
      this.setDrawer = set;
      toggle.addEventListener('click', () => set(!body.classList.contains('sidebar-open')));
      backdrop.addEventListener('click', () => set(false));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
    },

    setupControls() {
      const slider = Dom.$('opacity-slider'), out = Dom.$('opacity-value'), btn = Dom.$('toggle-radar');
      slider.disabled = false; btn.disabled = false;
      slider.addEventListener('input', () => {
        out.textContent = `${slider.value}%`;
        MapView.setOpacity(Number(slider.value) / 100);
      });
      btn.addEventListener('click', () => {
        MapView.setRadarVisible(!MapView.radarVisible);
        btn.setAttribute('aria-pressed', String(MapView.radarVisible));
        btn.textContent = MapView.radarVisible ? 'Toggle Radar / Optical' : 'Showing optical only \u2013 click for radar';
      });
      // Keep the button honest if the user uses the Leaflet layer menu.
      MapView.map.on('overlayadd overlayremove', () => {
        MapView.radarVisible = MapView.map.hasLayer(MapView.radarGroup);
        btn.setAttribute('aria-pressed', String(MapView.radarVisible));
      });

      // Science report download button
      const downloadBtn = Dom.$('download-report-btn');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', () => this.handleDownloadReport());
      }

      // Initialise the Swipe controller now that zones are wired
      Swipe.init();
    },

    handleDownloadReport() {
      if (!this.currentSelection) return;
      try {
        const html = ReportGenerator.generate(this.currentSelection);
        const filename = ReportGenerator.getFilename(this.currentSelection);

        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        Sidebar.showConfirmation('✓ Downloaded');
      } catch (err) {
        console.error('[SAR Map] Download failed:', err);
      }
    },

    buildZoneList(zones) {
      const nav = Dom.$('zone-list') || Dom.$('quick-jump');
      if (!nav) return;
      Dom.clear(nav);
      zones.forEach((zone) => {
        const b = Dom.el('button', 'zone-card jump-btn');
        b.type = 'button';
        b.style.setProperty('--accent', zone.color);
        b.dataset.zoneId = zone.id;

        const dot = Dom.el('span', 'zone-card__dot');
        dot.style.setProperty('background-color', zone.color);
        dot.setAttribute('aria-hidden', 'true');
        b.appendChild(dot);

        const info = Dom.el('div', 'zone-card__info');
        const title = Dom.el('div', 'zone-card__name', zone.name);
        info.appendChild(title);

        if (zone.eventType) {
          const type = Dom.el('div', 'zone-card__type', zone.eventType);
          info.appendChild(type);
        }
        b.appendChild(info);

        b.addEventListener('click', () => this.selectZone(zone));
        nav.appendChild(b);
      });
    },

    buildQuickJump(zones) {
      return this.buildZoneList(zones);
    },

    async selectZone(zone) {
      this.activeZone = zone;
      this.currentSelection = null;
      Sidebar.setDownloadVisible(false);

      document.querySelectorAll('.zone-card, .jump-btn').forEach((b) =>
        b.classList.toggle('is-active', b.dataset.zoneId === zone.id));
      MapView.eonetGroup.clearLayers();
      MapView.fly(zone);
      MapView.showZoneOverlay(zone);
      if (window.matchMedia('(max-width: 860px)').matches) this.setDrawer(true);

      Sidebar.message(`Loading ${zone.name} report\u2026`);
      try {
        const report = await Api.getReport(zone);
        if (this.activeZone !== zone) return; // user clicked something else meanwhile
        this.currentSelection = { type: 'zone', zone, report };
        Sidebar.show(Report.render(zone, report));
        Sidebar.setDownloadVisible(true, 'Download Report', `Download Report for ${zone.name}`);
      } catch (err) {
        console.error('[SAR Map] Report failed:', err);
        if (this.activeZone === zone) {
          this.currentSelection = null;
          Sidebar.setDownloadVisible(false);
          Sidebar.message(`Could not load the report for ${zone.name}. Check that ${zone.reportUrl} exists and the page is served over http(s).`, true);
        }
      }
    },

    async onMapClick(e) {
      if (MapView.insideAnyZone(e.latlng)) return; // curated zones use their own reports
      this.activeZone = null;
      this.currentSelection = null;
      Sidebar.setDownloadVisible(false);

      document.querySelectorAll('.zone-card, .jump-btn').forEach((b) => b.classList.remove('is-active'));
      Sidebar.message('Searching live NASA EONET events\u2026');
      if (window.matchMedia('(max-width: 860px)').matches) this.setDrawer(true);
      try {
        const data = await Api.getEonetNear(e.latlng);
        if (this.activeZone) return;
        this.currentSelection = { type: 'eonet', latlng: e.latlng, data };
        Sidebar.show(renderEonet(e.latlng, data));
        Sidebar.setDownloadVisible(true, 'Download Report', 'Download live NASA EONET events report');
      } catch (err) {
        console.error('[SAR Map] EONET failed:', err);
        this.currentSelection = null;
        Sidebar.setDownloadVisible(false);
        Sidebar.message('Could not reach NASA EONET right now. Please try again in a moment.', true);
      }
    },

    async start() {
      this.setupDrawer();
      try {
        MapView.init();
      } catch (err) {
        console.error('[SAR Map]', err);
        this.status('Map error', 'status-pill--error');
        Sidebar.message(err.message, true);
        return;
      }
      this.setupControls();
      MapView.map.on('click', (e) => this.onMapClick(e));

      try {
        const raw = await Api.getLocations();
        // Accept an array, {locations|zones|features: [...]}, or an object keyed by zone id.
        const list = Array.isArray(raw) ? raw
          : (raw.locations ?? raw.zones ?? raw.features
             ?? Object.entries(raw).map(([key, v]) => (v && typeof v === 'object' ? { id: key, folder: key, ...v } : v)));
        const zones = list.filter((r) => r && typeof r === 'object').map(normaliseZone);
        MapView.addZones(zones, (z) => this.selectZone(z));
        this.buildZoneList(zones);
        Swipe.init();
        console.info(`[SAR Map] ${zones.length} zones, ${zones.filter((z) => z.marker).length} pins:`, zones.map((z) => z.id));
        this.status(`Map ready · ${zones.length} zones`, 'status-pill--ready');
        setTimeout(() => {
          if (MapView.map) MapView.map.invalidateSize();
        }, 150);
      } catch (err) {
        console.error('[SAR Map] locations.json failed:', err);
        this.status('Map ready (no zones)', 'status-pill--error');
        Sidebar.message('The map works, but locations.json could not be loaded. Serve the folder with a local web server and check the file name.', true);
      }
    }
  };

  function ready(fn) {
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', fn, { once: true })
      : fn();
  }
  ready(() => App.start());
})();