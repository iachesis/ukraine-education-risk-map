import { shortName } from "./atlas-domain.js";

const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export class AtlasMap {
  constructor(records, topology, onSelect) {
    this.records = new Map(records.map((r) => [r.id, r]));
    this.layers = new Map();
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.selected = null;
    this.visible = new Set(records.map((r) => r.id));
    this.map = L.map("map", {
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.1,
      zoomDelta: 0.75,
      minZoom: 3,
      maxZoom: 12,
      scrollWheelZoom: false,
      keyboard: true,
      zoomAnimation: !this.reduced,
      fadeAnimation: !this.reduced,
      inertia: !this.reduced,
      preferCanvas: false,
    });
    this.map.createPane("regionLabels");
    this.map.getPane("regionLabels").style.zIndex = 450;
    this.map.getPane("regionLabels").style.pointerEvents = "none";
    this.map.createPane("selection");
    this.map.getPane("selection").style.zIndex = 440;
    this.map.getPane("selection").style.pointerEvents = "none";
    const communities = topojson.feature(topology, topology.objects.adm3),
      regions = topojson.feature(topology, topology.objects.adm1);
    this.communityLayer = L.geoJSON(communities, {
      smoothFactor: 0.5,
      style: (f) => this.style(f.properties.id),
      onEachFeature: (feature, layer) => {
        const id = feature.properties.id,
          r = this.records.get(id);
        this.layers.set(id, layer);
        if (!r) return;
        const content = `<strong>${escape(shortName(r.name))}</strong><span>${escape(r.region)}</span><span><i class="suggestion-dot" style="--risk:${r.classification.color}"></i>${escape(r.classification.label)}</span>`;
        layer.bindTooltip(content, {
          className: "atlas-tooltip",
          sticky: true,
          direction: "top",
          opacity: 1,
        });
        layer.on("click", () => onSelect(id));
        layer.on("mouseover", () => {
          layer.setStyle({ weight: 1.7, color: "#9b6415", opacity: 1 });
        });
        layer.on("mouseout", () => layer.setStyle(this.style(id)));
        layer.on("add", () => {
          const el = layer.getElement();
          if (el) {
            el.dataset.community = id;
            el.setAttribute("aria-hidden", "true");
          }
        });
      },
    }).addTo(this.map);
    this.regionLayer = L.geoJSON(regions, {
      style: {
        fill: false,
        color: "#688481",
        weight: 0.8,
        opacity: 0.65,
        interactive: false,
      },
      interactive: false,
    }).addTo(this.map);
    this.bounds = this.communityLayer.getBounds();
    this.map.setMaxBounds(this.bounds.pad(0.6));
    this.addLabels(records);
    this.fit();
    // Leaflet creates its SVG only after the first view is established.
    this.addPatterns();
    L.control
      .scale({ position: "bottomleft", imperial: false, maxWidth: 80 })
      .addTo(this.map);
    this.map.on("zoomend", () => this.updateLabelVisibility());
    document
      .querySelectorAll("#map .leaflet-overlay-pane svg")
      .forEach((svg) => svg.setAttribute("aria-hidden", "true"));
    document.querySelector("#map").dataset.ready = "true";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => performance.mark("atlas-map-useful")),
    );
  }
  style(id) {
    const r = this.records.get(id),
      c = r?.classification,
      active = this.visible.has(id) || this.selected === id;
    return {
      fill: true,
      fillColor:
        c?.kind === "special"
          ? "url(#zone-hatch)"
          : c?.kind !== "valid"
            ? "url(#unknown-hatch)"
            : c.color,
      fillOpacity: active ? 1 : 0.12,
      color: active ? "#f3f4ec" : "#becbc4",
      weight: active ? 0.42 : 0.25,
      opacity: active ? 0.9 : 0.3,
    };
  }
  addPatterns() {
    const svg = document.querySelector("#map .leaflet-overlay-pane svg");
    if (!svg) return;
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML =
      '<pattern id="zone-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="#d7d9cc"/><path d="M0 0v6" stroke="#737f70" stroke-width="2"/></pattern><pattern id="unknown-hatch" patternUnits="userSpaceOnUse" width="7" height="7"><rect width="7" height="7" fill="#e7e5de"/><circle cx="3" cy="3" r="1" fill="#747e78"/></pattern>';
    svg.prepend(defs);
  }
  addLabels(records) {
    this.labelGroup = L.layerGroup().addTo(this.map);
    // Context labels are placed at aggregate community bounds; they are region names, not city coordinates.
    const shown = [
      "Волинська область",
      "Львівська область",
      "Київська область",
      "Сумська область",
      "Харківська область",
      "Дніпропетровська область",
      "Донецька область",
      "Одеська область",
      "Херсонська область",
      "Автономна Республіка Крим",
    ];
    for (const name of shown) {
      const bounds = L.latLngBounds([]);
      records
        .filter((r) => r.region === name)
        .forEach((r) => {
          const l = this.layers.get(r.id);
          if (l) bounds.extend(l.getBounds());
        });
      if (bounds.isValid())
        L.marker(bounds.getCenter(), {
          pane: "regionLabels",
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: "region-label",
            html: `<span>${escape(name === "Автономна Республіка Крим" ? "АР Крим" : name.replace(" область", ""))}</span>`,
            iconSize: [0, 0],
          }),
        }).addTo(this.labelGroup);
    }
  }
  updateLabelVisibility() {
    this.map.getPane("regionLabels").style.opacity =
      this.selected || this.map.getZoom() > 7.5 ? "0" : "1";
  }
  fit() {
    this.map.invalidateSize();
    this.map.fitBounds(this.bounds, {
      paddingTopLeft: [18, 63],
      paddingBottomRight: [18, 51],
      animate: false,
    });
  }
  focus(id) {
    this.selected = id;
    if (this.halo) this.map.removeLayer(this.halo);
    const layer = this.layers.get(id);
    if (layer) {
      this.halo = L.layerGroup([
        L.geoJSON(layer.feature, {
          pane: "selection",
          interactive: false,
          style: { fill: false, color: "#fffefa", weight: 6, opacity: 1 },
        }),
        L.geoJSON(layer.feature, {
          pane: "selection",
          interactive: false,
          style: { fill: false, color: "#aa7214", weight: 3, opacity: 1 },
        }),
      ]).addTo(this.map);
      this.map.fitBounds(layer.getBounds(), {
        paddingTopLeft: [52, 83],
        paddingBottomRight: [64, 61],
        maxZoom: 10,
        animate: !this.reduced,
        duration: 0.35,
      });
    }
    if (!layer) this.fit();
    document.querySelector("#map-instructions").textContent = layer
      ? `Обрана територія: ${shortName(this.records.get(id).name)}`
      : "Межі цього запису відсутні. На мапі — загальний контекст України.";
    this.refresh();
    this.updateLabelVisibility();
  }
  resetSelection() {
    this.selected = null;
    if (this.halo) this.map.removeLayer(this.halo);
    this.refresh();
    this.updateLabelVisibility();
    document.querySelector("#map-instructions").textContent =
      "Оберіть громаду на мапі або знайдіть за назвою";
  }
  refresh() {
    this.layers.forEach((layer, id) => layer.setStyle(this.style(id)));
  }
  filter(records, fit = false) {
    this.visible = new Set(records.map((r) => r.id));
    this.refresh();
    if (fit) {
      const bounds = L.latLngBounds([]);
      records.forEach((r) => {
        const l = this.layers.get(r.id);
        if (l) bounds.extend(l.getBounds());
      });
      if (bounds.isValid())
        this.map.fitBounds(bounds, {
          paddingTopLeft: [24, 68],
          paddingBottomRight: [24, 51],
          maxZoom: 8,
          animate: !this.reduced,
          duration: 0.3,
        });
    }
  }
  resize() {
    this.map.invalidateSize();
    if (this.selected) this.focus(this.selected);
    else this.fit();
  }
  zoom(delta) {
    this.map.setZoom(this.map.getZoom() + delta, { animate: !this.reduced });
  }
}
