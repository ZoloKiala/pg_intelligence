(function () {
  const skipLoader = document.documentElement.classList.contains("skip-loader");
  if (!skipLoader) {
    document.body.classList.add("is-loading");
  }

  const appLoader = document.getElementById("app-loader");
  const loaderShownAt = Date.now();
  const minLoaderMs = 1200;

  function hideLoader() {
    if (!appLoader) return;
    const elapsed = Date.now() - loaderShownAt;
    const wait = Math.max(0, minLoaderMs - elapsed);
    window.setTimeout(() => {
      appLoader.classList.add("is-hidden");
      document.body.classList.remove("is-loading");
    }, wait);
  }

  window.setTimeout(hideLoader, 7000);

  (function setupCountryDistrictLinkage() {
    const countrySelect = document.getElementById("country-select");
    const districtSelect = document.getElementById("district-select");
    if (!countrySelect || !districtSelect) return;

    // Snapshot every option in its original order so we can rebuild the
    // slotted child list deterministically. Material Web's md-outlined-select
    // doesn't reliably honor `display: none` on slotted options, so we
    // physically detach/re-append nodes instead.
    const allOptions = Array.from(districtSelect.querySelectorAll("md-select-option"));

    function applyCountryFilter() {
      const country = (countrySelect.value || "").trim();
      const currentValue = (districtSelect.value || "").trim();
      let selectedStillVisible = false;

      allOptions.forEach((option) => {
        if (option.parentNode === districtSelect) {
          districtSelect.removeChild(option);
        }
      });

      allOptions.forEach((option) => {
        const optionCountry = option.dataset.country || "";
        const isPlaceholder = option.value === "";
        const matches = !country || isPlaceholder || optionCountry === country;
        if (!matches) return;
        districtSelect.appendChild(option);
        if (option.value === currentValue) selectedStillVisible = true;
      });

      if (!selectedStillVisible && currentValue !== "") {
        districtSelect.value = "";
      }
    }

    // Material Web components are loaded via an ESM CDN module that resolves
    // asynchronously. If we run before the components are upgraded, the
    // initial filter runs against an inert host element and never takes.
    // Wait for both custom elements to be defined, then wire up the filter.
    const ready = window.customElements && customElements.whenDefined
      ? Promise.all([
          customElements.whenDefined("md-outlined-select"),
          customElements.whenDefined("md-select-option"),
        ])
      : Promise.resolve();

    ready.then(() => {
      countrySelect.addEventListener("change", applyCountryFilter);
      countrySelect.addEventListener("input", applyCountryFilter);
      // Re-filter when the user opens the district dropdown, as a safety
      // net in case the change event from md-outlined-select arrived before
      // the component finished updating its internal options list.
      districtSelect.addEventListener("opening", applyCountryFilter);
      applyCountryFilter();
    });
  })();

  (function setupSidebarToggle() {
    const layout = document.getElementById("dashboard-layout");
    const toggle = document.getElementById("sidebar-toggle");
    if (!layout || !toggle) return;

    const storageKey = "pgis_sidebar_collapsed";
    const icon = toggle.querySelector(".sidebar-toggle-icon");
    const label = toggle.querySelector(".sidebar-toggle-label");

    function applyState(collapsed) {
      layout.classList.toggle("is-sidebar-collapsed", collapsed);
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.setAttribute(
        "aria-label",
        collapsed ? "Show filters sidebar" : "Hide filters sidebar"
      );
      toggle.title = collapsed ? "Show filters" : "Hide filters";
      if (icon) icon.textContent = collapsed ? "menu" : "menu_open";
      if (label) label.textContent = collapsed ? "Show filters sidebar" : "Hide filters sidebar";
    }

    let initialCollapsed = false;
    try {
      initialCollapsed = window.localStorage.getItem(storageKey) === "1";
    } catch (e) {}
    applyState(initialCollapsed);

    toggle.addEventListener("click", () => {
      const collapsed = !layout.classList.contains("is-sidebar-collapsed");
      applyState(collapsed);
      try {
        window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
      } catch (e) {}
      window.dispatchEvent(new Event("resize"));
    });
  })();

  const state = {
    rows: [],
    districtFeatures: [],
    votes: [],
    activeIndicator: "",
    activeLocationId: "",
    tablePage: 1,
    indicatorColors: new Map(),
  };

  const tableRowsPerPage = 8;

  const chartIds = {
    geo: "geo-chart",
    district: "district-chart",
    indicator: "indicator-chart",
    severity: "severity-chart",
    category: "category-chart",
    votes: "votes-chart",
    afforestation: "afforestation-chart",
  };

  const categoryColors = {
    "Hydrological and Water Stress Hotspots": "#1d7b5f",
    "Soil Related Hotspots": "#ef7f45",
    "Crop and Productivity Hotspots": "#d9485f",
    "Land Use and Ecological Hotspots": "#7b5af0",
    "Socio-economic Hotspots": "#0f4c81",
    "Intervention Areas": "#b78b28",
  };

  const severityColors = {
    low: "#86c5a3",
    moderate: "#efb366",
    high: "#d9485f",
    none: "#9aa4a0",
  };

  const indicatorPalette = [
    "#1d4ed8",
    "#16a34a",
    "#b91c1c",
    "#f97316",
    "#7c3aed",
    "#0f766e",
    "#be185d",
    "#4338ca",
    "#15803d",
    "#c2410c",
    "#334155",
    "#a16207",
  ];

  const demographicCategoryOrder = [
    "Older men",
    "Older women",
    "Younger men",
    "Younger women",
  ];

  const demographicCategoryColors = {
    "Older men": "#0f4c81",
    "Older women": "#b45309",
    "Younger men": "#1d7b5f",
    "Younger women": "#b83280",
  };

  const demographicCategoryIcons = {
    "Older men":
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="7.5" r="2.7" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 19c.7-3 2.5-4.8 4.5-4.8s3.8 1.8 4.5 4.8M9.3 5.7c.6-.9 1.6-1.5 2.7-1.5 1 0 2 .5 2.6 1.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    "Older women":
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="7.2" r="2.6" stroke="currentColor" stroke-width="1.7"/><path d="M12 10.5 8.3 16h7.4L12 10.5ZM10.5 16v2.2M13.5 16v2.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Younger men":
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="10" r="2.6" stroke="currentColor" stroke-width="1.7"/><path d="M6.8 19c.75-2.7 2.45-4.3 4.2-4.3 1.8 0 3.5 1.6 4.2 4.3M14.5 5.5h4v4M18.5 5.5l-3.4 3.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Younger women":
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="7.4" r="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M8.8 12.2c.85-1.15 1.95-1.75 3.2-1.75 1.3 0 2.4.6 3.25 1.75M12 10.7V19M8.8 14.7H15.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };

  // Smart afforestation priority — adapted from El Garroussi et al. (2026),
  // "Optimized afforestation reduces flood risk and limits water loss in Europe".
  // Their genetic-algorithm fitness function F = Σ ωᵢ·Sᵢ ranks candidate planting
  // sites by hydrological + ecological + land-use criteria. We map those criterion
  // families onto this app's normalized hotspot indicators and scale by severity.
  const AFFORESTATION_WEIGHTS = {
    flood: 0.3, // peak discharge / runoff reduction — the paper's headline benefit
    reforestation: 0.3, // reforestation suitability + degraded/abandoned land
    erosion: 0.25, // soil-stabilization co-benefit
    waterStress: 0.15, // low-flow / groundwater retention (paper's water-loss caution)
  };

  // Substring tokens matched against the normalized indicator key (see
  // normalizeIssueLabel). A single hotspot can satisfy several criteria, which
  // correctly rewards multi-benefit sites.
  const AFFORESTATION_CRITERIA = {
    flood: ["flood", "run off", "river", "riverbank", "water logging", "stream"],
    reforestation: ["reforestation", "forest loss", "deforestation", "sacred forest", "riparian"],
    erosion: ["erosion", "gully", "sediment", "fertility", "nutrient"],
    waterStress: ["borehole", "shallow well", "seasonal wetland", "illegal abstraction"],
  };

  // Neutral grey at zero (not afforestation-relevant), then a light → dark green
  // ramp where darker = higher afforestation priority.
  const afforestationColorStops = [
    [0, "#d6ddd9"],
    [0.12, "#cfe8da"],
    [1, "#14543f"],
  ];

  // Per-hotspot afforestation priority in [0, 1]: severity-scaled sum of the
  // weights of every criterion the point's indicator satisfies.
  function afforestationScore(row) {
    const key = row.indicatorKey || normalizeIssueLabel(row.indicator);
    if (!key) return 0;
    let weightSum = 0;
    for (const [criterion, tokens] of Object.entries(AFFORESTATION_CRITERIA)) {
      if (tokens.some((token) => key.includes(token))) {
        weightSum += AFFORESTATION_WEIGHTS[criterion] || 0;
      }
    }
    if (!weightSum) return 0;
    const sev = typeof row.severity === "number" ? row.severity : null;
    // Unscored points keep a small baseline so they still rank; scored points
    // range 0.2–1.0 with severity, echoing "more benefit where the problem is larger".
    const severityFactor =
      sev === null ? 0.2 : 0.2 + 0.8 * (Math.max(0, Math.min(5, sev)) / 5);
    return weightSum * severityFactor;
  }

  function normalizeIssueLabel(value) {
    let normalized = (value || "")
      .toString()
      .toLowerCase()
      .replace("d+ (dam in good condition)", "d plus")
      .replace("d- (dam in bad condition)", "d minus")
      .replace("cb+ (contour bund in good condition)", "cb plus")
      .replace("cb- (contour bund in bad condition)", "cb minus")
      .replace(/[()]/g, "")
      .replace(/[^a-z0-9\s_-]+/g, " ")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace("wild life", "wildlife")
      .replace("river bank", "riverbank")
      .replace("land tenure issues", "land tenure")
      .replace("bore hole", "borehole")
      .replace("confict", "conflict")
      .replace("good condition contour bund", "cb plus")
      .replace("bad condition contour bund", "cb minus")
      .replace("good contour bund", "cb plus")
      .replace("bad contour bund", "cb minus")
      .replace("cb+", "cb plus")
      .replace("cb-", "cb minus")
      .replace("good condition dam", "d plus")
      .replace("bad condition dam", "d minus")
      .replace("priority dam", "dam")
      .replace("d+", "d plus")
      .replace("d-", "d minus")
      .replace("forest decline", "forest loss")
      .replace("pollinator habitats", "pollinators")
      .replace("pollinator habitat", "pollinators")
      .replace("pollinator habitat losses", "pollinators")
      .replace("pollinator habitat loss", "pollinators")
      .replace("fertilty", "fertility")
      .replace("nutrient loss areas", "nutrient loss")
      .replace("nutrient loss area", "nutrient loss")
      .replace("riverbank collapsed", "riverbank collapse")
      .replace("stream seasonal", "seasonal stream")
      .replace("stream permanent", "permanent stream")
      .replace("spring permanent", "permanent spring")
      .replace("gulley", "gully");

    if (
      normalized === "seasonal forest" ||
      normalized === "forest seasonal" ||
      normalized === "deforestation sacred forest" ||
      normalized === "sacred forest reduction"
    ) {
      normalized = "sacred forest";
    }

    if (
      normalized === "women barriers" ||
      normalized === "women barriers to accessing land water and grazing sites"
    ) {
      normalized = "women barriers to accessing land water and grazing sites";
    }

    if (
      normalized === "yield" ||
      normalized === "yields" ||
      normalized === "yield decline" ||
      normalized === "yield loss"
    ) {
      normalized = "yield loss";
    }

    if (
      normalized === "water conflict" ||
      normalized === "water conflicts" ||
      normalized === "water conflict area"
    ) {
      normalized = "water conflict area";
    }

    if (normalized === "flooding") {
      normalized = "flood";
    }

    if (normalized === "women barriers to accessing land water and grazing sites") {
      return normalized;
    }

    if (normalized.includes("grazing")) {
      return "grazing pressure high";
    }

    const parts = normalized.split(" ");
    const singularTail = {
      conflicts: "conflict",
      disputes: "dispute",
      corridors: "corridor",
      wetlands: "wetland",
      rivers: "river",
      yields: "yield",
    };

    if (parts.length) {
      const last = parts[parts.length - 1];
      parts[parts.length - 1] = singularTail[last] || last;
    }

    return parts.join(" ");
  }

  function indicatorLabel(value) {
    const normalized = normalizeIssueLabel(value);
    if (!normalized) return "Unspecified";
    if (normalized === "sacred forest") return "Sacred forest";
    if (normalized === "grazing pressure high") return "High Grazing Pressure";
    if (normalized === "contour bund") return "Contour Bund (CB)";
    if (normalized === "cb plus") return "CB+ (Contour Bund in Good Condition)";
    if (normalized === "cb minus") return "CB- (Contour Bund in Bad Condition)";
    if (normalized === "dam") return "High potential damming point";
    if (normalized === "d plus") return "D+ (Dam in Good Condition)";
    if (normalized === "d minus") return "D- (Dam in Bad Condition)";
    if (normalized === "land tenure") return "Land tenure issues";
    if (normalized === "pollinators") return "Pollinator habitat loss";
    if (normalized === "women barriers to accessing land water and grazing sites") {
      return "Women barriers to accessing land, water, and grazing sites";
    }
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  function severityLabel(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return "Not scored";
    if (numeric <= 1) return "Low";
    if (numeric <= 3) return "Moderate";
    return "High";
  }

  function severityBucket(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return "none";
    if (numeric <= 1) return "low";
    if (numeric <= 3) return "moderate";
    return "high";
  }

  function hotspotCategory(indicator) {
    const value = normalizeIssueLabel(indicator);
    if (!value) return "Intervention Areas";

    if (
      value.includes("priority") ||
      value.includes("women barriers") ||
      value.includes("land tenure")
    ) {
      return "Socio-economic Hotspots";
    }

    if (
      value.includes("contour bund") ||
      value.includes("terrace") ||
      value.includes("ridge") ||
      value.includes("dam") ||
      value === "cb plus" ||
      value === "cb minus" ||
      value === "d plus" ||
      value === "d minus"
    ) {
      return "Intervention Areas";
    }

    if (
      value.includes("borehole") ||
      value.includes("river") ||
      value.includes("wetland") ||
      value.includes("stream") ||
      value.includes("water") ||
      value.includes("lake") ||
      value.includes("run off") ||
      value.includes("flood") ||
      value.includes("irrigation") ||
      value.includes("spring") ||
      value.includes("shallow well") ||
      value.includes("illegal abstraction")
    ) {
      return "Hydrological and Water Stress Hotspots";
    }

    if (
      value.includes("erosion") ||
      value.includes("gully") ||
      value.includes("sedimentation")
    ) {
      return "Soil Related Hotspots";
    }

    if (
      value.includes("yield") ||
      value.includes("fertility") ||
      value.includes("nutrient") ||
      value.includes("grazing") ||
      value.includes("pasture")
    ) {
      return "Crop and Productivity Hotspots";
    }

    if (
      value.includes("forest") ||
      value.includes("reforestation") ||
      value.includes("wildlife") ||
      value.includes("pollinators") ||
      value.includes("riparian") ||
      value.includes("deforestation")
    ) {
      return "Land Use and Ecological Hotspots";
    }

    return "Intervention Areas";
  }

  function popupLabel(value) {
    return (value || "")
      .toString()
      .replace(/gulley/gi, "gully")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildIndicatorColorMap(rows) {
    const keys = Array.from(
      new Set(rows.map((row) => row.indicatorKey).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    const map = new Map();
    keys.forEach((key, index) => {
      map.set(key, indicatorPalette[index % indicatorPalette.length]);
    });
    return map;
  }

  function indicatorColor(indicatorKey) {
    return state.indicatorColors.get(indicatorKey) || "#334155";
  }

  function computeMapView(rows) {
    if (!rows.length) {
      return {
        center: { lat: -14.6, lon: 34.9 },
        zoom: 6,
      };
    }

    const latitudes = rows.map((row) => row.lat);
    const longitudes = rows.map((row) => row.lon);
    const latMin = Math.min.apply(null, latitudes);
    const latMax = Math.max.apply(null, latitudes);
    const lonMin = Math.min.apply(null, longitudes);
    const lonMax = Math.max.apply(null, longitudes);
    const latSpan = Math.max(0.01, latMax - latMin);
    const lonSpan = Math.max(0.01, lonMax - lonMin);
    const latZoom = Math.log2(170 / (latSpan * 1.25));
    const lonZoom = Math.log2(360 / (lonSpan * 1.25));
    const computedZoom = Math.min(latZoom, lonZoom);
    const zoom = Math.max(4, Math.min(13, computedZoom));

    return {
      center: {
        lat: (latMin + latMax) / 2,
        lon: (lonMin + lonMax) / 2,
      },
      zoom,
    };
  }

  function collectGeometryPoints(coordinates, points) {
    if (!Array.isArray(coordinates)) return;
    if (
      coordinates.length >= 2 &&
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number"
    ) {
      points.push({ lon: coordinates[0], lat: coordinates[1] });
      return;
    }
    coordinates.forEach((item) => collectGeometryPoints(item, points));
  }

  function computeFeatureMapView(features) {
    if (!features.length) {
      return {
        center: { lat: -14.6, lon: 34.9 },
        zoom: 6,
      };
    }

    const points = [];
    features.forEach((feature) => {
      collectGeometryPoints(feature.geometry?.coordinates, points);
    });

    if (!points.length) {
      return {
        center: { lat: -14.6, lon: 34.9 },
        zoom: 6,
      };
    }

    const latitudes = points.map((point) => point.lat);
    const longitudes = points.map((point) => point.lon);
    const latMin = Math.min.apply(null, latitudes);
    const latMax = Math.max.apply(null, latitudes);
    const lonMin = Math.min.apply(null, longitudes);
    const lonMax = Math.max.apply(null, longitudes);
    const latSpan = Math.max(0.02, latMax - latMin);
    const lonSpan = Math.max(0.02, lonMax - lonMin);
    const latZoom = Math.log2(170 / (latSpan * 1.4));
    const lonZoom = Math.log2(360 / (lonSpan * 1.4));
    const computedZoom = Math.min(latZoom, lonZoom);

    return {
      center: {
        lat: (latMin + latMax) / 2,
        lon: (lonMin + lonMax) / 2,
      },
      zoom: Math.max(5.5, Math.min(10.5, computedZoom)),
    };
  }

  function participantCategory(sourceFile) {
    const value = (sourceFile || "")
      .toString()
      .replace(/[-\s]+/g, "_")
      .toLowerCase();
    const hasToken = (token) =>
      new RegExp(`(^|[/_])${token}([/_.]|$)`).test(value);

    if (hasToken("older_men") || hasToken("men_older_than_40")) return "Older men";
    if (hasToken("older_women") || hasToken("women_older_than_40")) return "Older women";
    if (hasToken("younger_men") || hasToken("young_men") || hasToken("men_less_than_40")) {
      return "Younger men";
    }
    if (
      hasToken("younger_women") ||
      hasToken("young_women") ||
      hasToken("women_less_than_40")
    ) {
      return "Younger women";
    }
    return "Uncategorized";
  }

  function countBy(items, selector) {
    const counts = new Map();
    items.forEach((item) => {
      const key = selector(item);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  }

  function topRowsByCount(items, selector, limit) {
    return countBy(items, selector)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, limit);
  }

  function sumBy(items, selector, valueSelector, limit) {
    const counts = new Map();
    items.forEach((item) => {
      const key = selector(item);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + valueSelector(item));
    });
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, limit);
  }

  function getScopedRows() {
    if (!state.activeIndicator) return state.rows;
    return state.rows.filter((row) => row.indicatorKey === state.activeIndicator);
  }

  function getActiveLocation(rows) {
    return rows.find((row) => row.id === state.activeLocationId) || null;
  }

  function findLocationById(locationId) {
    return state.rows.find((row) => row.id === locationId) || null;
  }

  function selectLocation(locationId) {
    const row = findLocationById(locationId);
    if (!row) return;

    const isSameLocation = state.activeLocationId === locationId;
    if (isSameLocation) {
      state.activeLocationId = "";
      renderDashboard();
      return;
    }

    state.activeLocationId = `${locationId}`;
    renderDashboard();

    const mapCard = document.querySelector(".chart-card--map");
    if (mapCard) {
      mapCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function setTablePage(nextPage) {
    state.tablePage = Math.max(1, nextPage);
    renderDashboard();
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function renderEmptyChart(id, message) {
    Plotly.react(
      id,
      [],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { l: 16, r: 16, t: 16, b: 16 },
        xaxis: { visible: false },
        yaxis: { visible: false },
        annotations: [
          {
            text: message,
            showarrow: false,
            font: { size: 14, color: "#55615d" },
          },
        ],
      },
      { responsive: true, displayModeBar: false }
    );
  }

  function buildRows(geojson) {
    return (geojson.features || [])
      .map((feature) => {
        const properties = feature.properties || {};
        const coordinates = feature.geometry?.coordinates || [];
        const severity = Number(properties.severity);
        const indicatorKey = normalizeIssueLabel(properties.indicator);
        const lat = Number(coordinates[1]);
        const lon = Number(coordinates[0]);

        return {
          id: properties.id,
          label: popupLabel(properties.label || properties.name) || "Unlabeled point",
          district: properties.district || "Unknown district",
          indicator: indicatorLabel(properties.indicator),
          indicatorKey,
        category: hotspotCategory(properties.indicator),
        participantCategory: participantCategory(properties.source_file),
        severity: Number.isNaN(severity) ? null : severity,
        severityBand: severityLabel(severity),
        severityKey: severityBucket(severity),
          lat,
          lon,
        };
      })
      .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon));
  }

  function renderStats(rows) {
    const scopedRows = rows;
    const severityValues = scopedRows
      .map((row) => row.severity)
      .filter((value) => typeof value === "number");
    const averageSeverity = severityValues.length
      ? (severityValues.reduce((sum, value) => sum + value, 0) / severityValues.length).toFixed(1)
      : "Not available";
    const topCategory = topRowsByCount(scopedRows, (row) => row.category, 1)[0];

    setText("stat-total", scopedRows.length ? `${scopedRows.length}` : "Not available");
    const indicatorCount = new Set(scopedRows.map((row) => row.indicatorKey).filter(Boolean)).size;
    setText("stat-indicators", indicatorCount ? `${indicatorCount}` : "Not available");
    setText("stat-severity", averageSeverity);
    setText("stat-category", topCategory ? topCategory.label : "Not available");
    setText("sidebar-count", `Loaded locations: ${scopedRows.length}`);
  }

  function renderGeoChart(rows) {
    if (!rows.length) {
      renderEmptyChart(chartIds.geo, "No locations match the selected filters. Try adjusting your filters.");
      return;
    }

    const mapView = computeMapView(rows);
    const activeLocation = getActiveLocation(rows);

    Plotly.react(
      chartIds.geo,
      [
        {
          type: "scattermap",
          mode: "markers",
          lat: rows.map((row) => row.lat),
          lon: rows.map((row) => row.lon),
          customdata: rows.map((row) => [
            row.indicatorKey,
            row.district,
            row.indicator,
            row.severityBand,
            Math.round(afforestationScore(row) * 100),
          ]),
          text: rows.map((row) => row.label),
          hovertemplate:
            "<b>%{text}</b><br>" +
            "District: %{customdata[1]}<br>" +
            "Hotspot: %{customdata[2]}<br>" +
            "Severity: %{customdata[3]}<br>" +
            "Afforestation priority: %{customdata[4]}/100<extra></extra>",
          marker: {
            // Two encodings at once: COLOUR = severity (scattermap can't draw
            // borders, so fill carries it) and SIZE = afforestation priority
            // (bigger = stronger planting candidate). Active point turns amber.
            size: rows.map((row) => {
              const base = 10 + afforestationScore(row) * 30;
              return row.id === activeLocation?.id ? base + 10 : base;
            }),
            color: rows.map((row) =>
              row.id === activeLocation?.id
                ? "#facc15"
                : severityColors[row.severityKey] || severityColors.none
            ),
            opacity: 0.9,
          },
        },
      ],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { l: 0, r: 0, t: 0, b: 0 },
        map: {
          style: "satellite-streets",
          center: activeLocation
            ? { lat: activeLocation.lat, lon: activeLocation.lon }
            : mapView.center,
          zoom: activeLocation ? Math.max(mapView.zoom, 13) : mapView.zoom,
        },
      },
      { responsive: true, displayModeBar: false }
    );
  }

  function renderDistrictChart(rows) {
    if (!state.districtFeatures.length) {
      renderEmptyChart(chartIds.district, "No district boundaries are available.");
      return;
    }

    const activeLocation = getActiveLocation(rows);
    const districtSummary = new Map();
    rows.forEach((row) => {
      const key = (row.district || "").trim().toLowerCase();
      if (!key) return;
      const current = districtSummary.get(key) || {
        count: 0,
        severityTotal: 0,
        severityCount: 0,
      };
      current.count += 1;
      if (typeof row.severity === "number") {
        current.severityTotal += row.severity;
        current.severityCount += 1;
      }
      districtSummary.set(key, current);
    });

    const districtGeoJson = {
      type: "FeatureCollection",
      features: state.districtFeatures,
    };
    const matchedFeatures = state.districtFeatures.filter(
      (feature) =>
        districtSummary.has(
          (feature.properties?.district || feature.properties?.shapeName || "").trim().toLowerCase()
        )
    );
    const districtMapView = computeFeatureMapView(
      matchedFeatures.length ? matchedFeatures : state.districtFeatures
    );
    const locations = state.districtFeatures.map(
      (feature) => feature.properties?.district || feature.properties?.shapeName || "Unknown district"
    );
    const matchedLocations = matchedFeatures.map(
      (feature) => feature.properties?.district || feature.properties?.shapeName || "Unknown district"
    );
    const zValues = matchedLocations.map(
      (district) => districtSummary.get(district.trim().toLowerCase())?.count || 0
    );
    const maxCount = Math.max(...zValues, 0);

    Plotly.react(
      chartIds.district,
      [
        {
          type: "choroplethmap",
          geojson: districtGeoJson,
          featureidkey: "properties.district",
          locations,
          z: locations.map(() => 0),
          text: locations,
          colorscale: [
            [0, "rgba(94,106,103,0.03)"],
            [1, "rgba(94,106,103,0.03)"],
          ],
          zmin: 0,
          zmax: 1,
          marker: {
            line: {
              color: "rgba(76, 92, 87, 0.32)",
              width: 0.9,
            },
          },
          hoverinfo: "skip",
          showscale: false,
        },
        {
          type: "choroplethmap",
          geojson: districtGeoJson,
          featureidkey: "properties.district",
          locations: matchedLocations,
          z: zValues,
          text: matchedLocations,
          customdata: matchedLocations.map((district) => {
            const summary = districtSummary.get(district.trim().toLowerCase()) || {
              count: 0,
              severityTotal: 0,
              severityCount: 0,
            };
            const averageSeverity = summary.severityCount
              ? (summary.severityTotal / summary.severityCount).toFixed(1)
              : "Not scored";
            return [summary.count, averageSeverity];
          }),
          colorscale: [
            [0, "#edf1ea"],
            [0.2, "#c9dfd2"],
            [0.45, "#82c2a5"],
            [0.7, "#3e9a79"],
            [1, "#1d7b5f"],
          ],
          zmin: 0,
          zmax: maxCount || 1,
          marker: {
            line: {
              color: "rgba(255,255,255,0.95)",
              width: 1.6,
            },
          },
          hovertemplate:
            "<b>%{text}</b><br>" +
            "Locations: %{customdata[0]}<br>" +
            "Avg severity: %{customdata[1]}<extra></extra>",
          showscale: false,
        },
        {
          type: "scattermap",
          mode: "markers",
          lat: rows.map((row) => row.lat),
          lon: rows.map((row) => row.lon),
          text: rows.map((row) => row.label),
          customdata: rows.map((row) => [row.district, row.indicator, row.severityBand]),
          hovertemplate:
            "<b>%{text}</b><br>" +
            "District: %{customdata[0]}<br>" +
            "Hotspot: %{customdata[1]}<br>" +
            "Severity: %{customdata[2]}<extra></extra>",
          marker: {
            size: rows.map((row) => (row.id === activeLocation?.id ? 11 : 7)),
            color: rows.map((row) =>
              row.id === activeLocation?.id ? "#facc15" : indicatorColor(row.indicatorKey)
            ),
            line: {
              color: rows.map((row) =>
                row.id === activeLocation?.id
                  ? "#ffffff"
                  : severityColors[row.severityKey] || severityColors.none
              ),
              width: rows.map((row) => (row.id === activeLocation?.id ? 2.5 : 1.4)),
            },
            opacity: 0.95,
          },
          showlegend: false,
        },
      ],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { l: 0, r: 0, t: 0, b: 0 },
        map: {
          style: "carto-positron",
          center: districtMapView.center,
          zoom: districtMapView.zoom,
        },
      },
      { responsive: true, displayModeBar: false }
    );
  }

  function renderIndicatorChart(rows) {
    const summary = topRowsByCount(rows, (row) => row.indicatorKey, 12);
    if (!summary.length) {
      renderEmptyChart(chartIds.indicator, "No locations match the selected filters. Try adjusting your filters.");
      return;
    }

    const labels = summary.map((item) => indicatorLabel(item.label));
    const values = summary.map((item) => item.count);
    const colors = summary.map((item) => indicatorColor(item.label));

    Plotly.react(
      chartIds.indicator,
      [
        {
          type: "bar",
          orientation: "h",
          y: labels.slice().reverse(),
          x: values.slice().reverse(),
          customdata: summary.map((item) => item.label).reverse(),
          marker: { color: colors.slice().reverse(), line: { color: "#ffffff", width: 1 } },
          hovertemplate: "%{y}<br>Locations: %{x}<extra></extra>",
        },
      ],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { l: 160, r: 24, t: 10, b: 36 },
        xaxis: {
          title: "Locations",
          gridcolor: "rgba(29, 43, 40, 0.1)",
          zeroline: false,
        },
        yaxis: { automargin: true },
      },
      { responsive: true, displayModeBar: false }
    );
  }

  function renderAfforestationPriority(rows) {
    const benchmark = document.getElementById("afforestation-benchmark");

    const scored = rows
      .map((row) => ({ row, score: afforestationScore(row) }))
      .filter((item) => item.score > 0);

    if (!scored.length) {
      renderEmptyChart(
        chartIds.afforestation,
        "No afforestation-relevant hotspots match the selected filters."
      );
      if (benchmark) {
        benchmark.innerHTML =
          '<p class="afforestation-note">No flood, erosion or land-degradation hotspots in the current focus to prioritise.</p>';
      }
      return;
    }

    // Aggregate priority by district for the ranked chart.
    const byDistrict = sumBy(
      scored.map((item) => item.row),
      (row) => row.district,
      (row) => afforestationScore(row),
      12
    );
    const maxScore = byDistrict[0]?.count || 1;
    const labels = byDistrict.map((item) => item.label);
    const values = byDistrict.map((item) => Number(item.count.toFixed(2)));
    const colorValues = values.map((value) => value / maxScore);

    Plotly.react(
      chartIds.afforestation,
      [
        {
          type: "bar",
          orientation: "h",
          y: labels.slice().reverse(),
          x: values.slice().reverse(),
          marker: {
            color: colorValues.slice().reverse(),
            colorscale: afforestationColorStops,
            cmin: 0,
            cmax: 1,
            line: { color: "#ffffff", width: 1 },
          },
          hovertemplate: "%{y}<br>Priority score: %{x}<extra></extra>",
        },
      ],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { l: 160, r: 24, t: 10, b: 36 },
        xaxis: {
          title: "Afforestation priority score",
          gridcolor: "rgba(29, 43, 40, 0.1)",
          zeroline: false,
        },
        yaxis: { automargin: true },
      },
      { responsive: true, displayModeBar: false }
    );

    // Smart vs naive benchmark (the paper's signature comparison): how much of
    // the total priority benefit is captured by the top 10% of sites when chosen
    // smartly (highest score) versus naively (a deterministic, evenly-spread
    // sample standing in for random placement — same count, no Math.random so the
    // figure is stable across redraws).
    if (benchmark) {
      const total = scored.reduce((sum, item) => sum + item.score, 0);
      const n = Math.max(1, Math.round(scored.length * 0.1));
      const smartBenefit = scored
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, n)
        .reduce((sum, item) => sum + item.score, 0);
      const stride = scored.length / n;
      let naiveBenefit = 0;
      for (let i = 0; i < n; i += 1) {
        naiveBenefit += scored[Math.floor(i * stride)].score;
      }
      const smartShare = total ? (smartBenefit / total) * 100 : 0;
      const naiveShare = total ? (naiveBenefit / total) * 100 : 0;
      const uplift = naiveShare ? smartShare / naiveShare : 0;

      const benchRow = (label, share, accent) => `
        <div class="aff-bench-row">
          <span class="aff-bench-label">${label}</span>
          <span class="aff-bench-track"><span class="aff-bench-fill" style="width:${share.toFixed(0)}%;background:${accent}"></span></span>
          <strong class="aff-bench-value">${share.toFixed(0)}%</strong>
        </div>
      `;
      benchmark.innerHTML = `
        <p class="afforestation-note">Benefit captured by the top ${n} site${n === 1 ? "" : "s"} (10% of ${scored.length}) — smart targeting vs. random placement.</p>
        ${benchRow("Smart (optimised)", smartShare, "#14543f")}
        ${benchRow("Naive (random)", naiveShare, "#9aa4a0")}
        <p class="afforestation-cite">${uplift >= 1.1 ? `Smart targeting captures ${uplift.toFixed(1)}× the benefit. ` : ""}Method after El Garroussi et al. (2026), <em>Communications Sustainability</em>.</p>
      `;
    }
  }

  function renderSeverityChart(rows) {
    const order = ["Low", "Moderate", "High", "Not scored"];
    const colorMap = {
      Low: severityColors.low,
      Moderate: severityColors.moderate,
      High: severityColors.high,
      "Not scored": severityColors.none,
    };
    const summary = topRowsByCount(rows, (row) => row.severityBand, 10)
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));

    if (!summary.length) {
      renderEmptyChart(chartIds.severity, "No locations match the selected filters. Try adjusting your filters.");
      return;
    }

    Plotly.react(
      chartIds.severity,
      [
        {
          type: "pie",
          labels: summary.map((item) => item.label),
          values: summary.map((item) => item.count),
          hole: 0.58,
          sort: false,
          marker: { colors: summary.map((item) => colorMap[item.label]) },
          textinfo: "label+percent",
          textposition: "outside",
          automargin: true,
          insidetextorientation: "horizontal",
          hovertemplate: "%{label}: %{value} locations<extra></extra>",
        },
      ],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        margin: { l: 40, r: 40, t: 40, b: 40 },
        showlegend: false,
      },
      { responsive: true, displayModeBar: false }
    );
  }

  function renderCategoryChart(rows) {
    const summary = topRowsByCount(rows, (row) => row.category, 10);
    if (!summary.length) {
      renderEmptyChart(chartIds.category, "No locations match the selected filters. Try adjusting your filters.");
      return;
    }

    Plotly.react(
      chartIds.category,
      [
        {
          type: "treemap",
          labels: ["Hotspot families"].concat(summary.map((item) => item.label)),
          parents: [""].concat(summary.map(() => "Hotspot families")),
          values: [summary.reduce((sum, item) => sum + item.count, 0)].concat(
            summary.map((item) => item.count)
          ),
          marker: {
            colors: ["#e8dcc7"].concat(
              summary.map((item) => categoryColors[item.label] || "#1d7b5f")
            ),
            line: { color: "#ffffff", width: 2 },
          },
          branchvalues: "total",
          textinfo: "label+value",
          hovertemplate: "%{label}<br>Locations: %{value}<extra></extra>",
          tiling: { pad: 4 },
          pathbar: { visible: false },
        },
      ],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { l: 10, r: 10, t: 10, b: 10 },
      },
      { responsive: true, displayModeBar: false }
    );
  }

  function renderVotesChart() {
    const votesCard = document.getElementById("votes-card");
    const filteredVotes = state.activeIndicator
      ? state.votes.filter((row) => row.indicatorKey === state.activeIndicator)
      : state.votes;
    const summary = sumBy(filteredVotes, (row) => row.indicatorKey, (row) => row.votes, 10);

    if (!summary.length) {
      if (votesCard) {
        votesCard.hidden = true;
      }
      return;
    }

    if (votesCard) {
      votesCard.hidden = false;
    }

    Plotly.react(
      chartIds.votes,
      [
        {
          type: "bar",
          orientation: "h",
          y: summary.map((item) => indicatorLabel(item.label)).reverse(),
          x: summary.map((item) => item.count).reverse(),
          marker: {
            color: "#12352d",
            line: { color: "#ffffff", width: 1 },
          },
          hovertemplate: "%{y}<br>Votes: %{x}<extra></extra>",
        },
      ],
      {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { l: 170, r: 20, t: 10, b: 36 },
        xaxis: {
          title: "Votes",
          gridcolor: "rgba(29, 43, 40, 0.1)",
          zeroline: false,
        },
        yaxis: { automargin: true },
      },
      { responsive: true, displayModeBar: false }
    );
  }

  function renderTable(rows) {
    const tbody = document.getElementById("locations-table-body");
    const pagination = document.getElementById("locations-pagination");
    if (!tbody) return;

    const sortedRows = rows
      .slice()
      .sort((a, b) => {
        const severityA = typeof a.severity === "number" ? a.severity : -1;
        const severityB = typeof b.severity === "number" ? b.severity : -1;
        return severityB - severityA || a.label.localeCompare(b.label);
      });

    const totalPages = Math.max(1, Math.ceil(sortedRows.length / tableRowsPerPage));
    if (state.activeLocationId) {
      const selectedIndex = sortedRows.findIndex((row) => row.id === state.activeLocationId);
      if (selectedIndex >= 0) {
        state.tablePage = Math.floor(selectedIndex / tableRowsPerPage) + 1;
      }
    }
    state.tablePage = Math.min(Math.max(1, state.tablePage), totalPages);

    const startIndex = (state.tablePage - 1) * tableRowsPerPage;
    const pageRows = sortedRows.slice(startIndex, startIndex + tableRowsPerPage);

    if (!pageRows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No locations match the selected filters. Try adjusting your filters.</td></tr>';
      if (pagination) {
        pagination.innerHTML = "";
      }
      return;
    }

    tbody.innerHTML = pageRows
      .map(
        (row) => `
          <tr
            class="location-row ${row.id === state.activeLocationId ? "is-selected" : ""}"
          >
            <td>
              <button
                type="button"
                class="location-row-button"
                data-location-id="${row.id}"
                aria-pressed="${row.id === state.activeLocationId ? "true" : "false"}"
              >
                <div class="location-row-main">
                <strong>${row.label}</strong>
                </div>
              </button>
            </td>
            <td>${row.district}</td>
            <td>${row.indicator}</td>
            <td>${row.severityBand}</td>
            <td>${row.lat.toFixed(4)}, ${row.lon.toFixed(4)}</td>
          </tr>
        `
      )
      .join("");

    tbody.querySelectorAll(".location-row-button").forEach((button) => {
      const activate = () => {
        const locationId = button.dataset.locationId;
        if (!locationId) return;
        selectLocation(locationId);
      };

      button.addEventListener("click", activate);
      button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activate();
      });
    });

    if (pagination) {
      pagination.innerHTML = `
        <button type="button" class="pager-btn" data-page="${state.tablePage - 1}" ${state.tablePage <= 1 ? "disabled" : ""}>Previous</button>
        <span class="pager-status">Page ${state.tablePage} of ${totalPages}</span>
        <button type="button" class="pager-btn" data-page="${state.tablePage + 1}" ${state.tablePage >= totalPages ? "disabled" : ""}>Next</button>
      `;

      pagination.querySelectorAll(".pager-btn").forEach((button) => {
        button.addEventListener("click", () => {
          const nextPage = Number(button.dataset.page);
          if (Number.isNaN(nextPage)) return;
          setTablePage(nextPage);
        });
      });
    }
  }

  function renderCategoryStats(rows) {
    const container = document.getElementById("category-stats-grid");
    if (!container) return;

    if (!rows.length) {
      container.innerHTML = '<div class="category-stat-empty">No locations match the selected filters. Try adjusting your filters.</div>';
      return;
    }

    const counts = new Map(
      demographicCategoryOrder.map((label) => [label, 0])
    );
    let uncategorizedCount = 0;
    rows.forEach((row) => {
      if (!counts.has(row.participantCategory)) {
        uncategorizedCount += 1;
        return;
      }
      counts.set(row.participantCategory, counts.get(row.participantCategory) + 1);
    });
    const summary = demographicCategoryOrder.map((label) => ({
      label,
      count: counts.get(label) || 0,
    }));
    const total = summary.reduce((sum, item) => sum + item.count, 0);

    if (!total) {
      container.innerHTML = '<div class="category-stat-empty">No participant groups matched the selected filters.</div>';
      return;
    }

    const matrixRows = [
      {
        label: "Older",
        items: [
          summary.find((item) => item.label === "Older men"),
          summary.find((item) => item.label === "Older women"),
        ],
      },
      {
        label: "Younger",
        items: [
          summary.find((item) => item.label === "Younger men"),
          summary.find((item) => item.label === "Younger women"),
        ],
      },
    ];

    const renderCell = (item) => {
      const color = demographicCategoryColors[item.label] || "#1d7b5f";
      const share = total ? (item.count / total) * 100 : 0;
      return `
        <article class="participant-matrix-cell" style="--cell-accent:${color}">
          <span class="category-stat-icon">
            ${demographicCategoryIcons[item.label] || ""}
          </span>
          <div class="participant-matrix-copy">
            <strong>${item.count}</strong>
            <span>${item.label}</span>
            <span>${share.toFixed(0)}% of current focus</span>
            <span class="participant-matrix-bar" aria-hidden="true"><span style="width:${share}%"></span></span>
          </div>
        </article>
      `;
    };

    container.innerHTML = `
      <section class="category-breakdown" aria-label="Participant breakdown by age and gender">
        <div class="category-breakdown-summary">
          <div class="category-breakdown-total">
            <span>Total in current focus</span>
            <strong>${total}</strong>
          </div>
          <p>Age groups run top to bottom and gender runs left to right, so differences are easier to compare at a glance.</p>
        </div>
        ${uncategorizedCount ? `<p class="category-breakdown-note">${uncategorizedCount} record${uncategorizedCount === 1 ? "" : "s"} could not be assigned to one of the four participant groups.</p>` : ""}
        <div class="participant-matrix" role="presentation">
          <div class="participant-matrix-corner" aria-hidden="true"></div>
          <div class="participant-matrix-header">Men</div>
          <div class="participant-matrix-header">Women</div>
          ${matrixRows
            .map(
              (group) => `
                <div class="participant-matrix-label">${group.label}</div>
                ${group.items.map((item) => renderCell(item)).join("")}
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function updateFocusText(scopedRows) {
    const focusLabel = document.getElementById("focus-indicator");
    const focusCopy = document.getElementById("focus-copy");

    if (!focusLabel || !focusCopy) return;

    if (!state.activeIndicator) {
      focusLabel.textContent = "All hotspots";
      focusCopy.textContent =
        "Use the hotspot list or chart bars to focus the dashboard on a single indicator.";
      return;
    }

    focusLabel.textContent = indicatorLabel(state.activeIndicator);
    focusCopy.textContent = `${scopedRows.length} location${scopedRows.length === 1 ? "" : "s"} in the current view match this hotspot.`;
  }

  function syncHotspotButtons() {
    document.querySelectorAll(".hotspot-item").forEach((button) => {
      const indicatorKey = normalizeIssueLabel(button.dataset.indicator || button.textContent || "");
      const isActive = indicatorKey === state.activeIndicator;
      const color = indicatorColor(indicatorKey);
      button.style.setProperty("--hotspot-color", color);
      const row = button.closest(".top-indicator-row");
      if (row) {
        row.style.setProperty("--hotspot-color", color);
      }
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function renderDashboard() {
    const scopedRows = getScopedRows();
    if (state.activeLocationId && !getActiveLocation(scopedRows)) {
      state.activeLocationId = "";
    }
    renderStats(scopedRows);
    renderCategoryStats(scopedRows);
    renderGeoChart(scopedRows);
    renderDistrictChart(scopedRows);
    renderIndicatorChart(scopedRows);
    renderAfforestationPriority(scopedRows);
    renderSeverityChart(scopedRows);
    renderCategoryChart(scopedRows);
    renderVotesChart();
    renderTable(scopedRows);
    updateFocusText(scopedRows);
    syncHotspotButtons();
  }

  function setActiveIndicator(indicatorKey) {
    state.activeIndicator = state.activeIndicator === indicatorKey ? "" : indicatorKey;
    state.tablePage = 1;
    renderDashboard();
  }

  function bindChartEvents() {
    const indicatorChart = document.getElementById(chartIds.indicator);
    const geoChart = document.getElementById(chartIds.geo);
    const districtChart = document.getElementById(chartIds.district);
    if (indicatorChart && !indicatorChart.dataset.bound) {
      indicatorChart.on("plotly_click", (event) => {
        const point = event?.points?.[0];
        const indicatorKey = point?.customdata;
        if (indicatorKey) {
          setActiveIndicator(indicatorKey);
        }
      });
      indicatorChart.dataset.bound = "1";
    }
    if (geoChart && !geoChart.dataset.bound) {
      geoChart.on("plotly_click", (event) => {
        const point = event?.points?.[0];
        const row = getScopedRows()[point?.pointIndex];
        if (row?.id) {
          selectLocation(row.id);
          const tableRow = document.querySelector(`[data-location-id="${row.id}"]`);
          if (tableRow) {
            tableRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        }
      });
      geoChart.dataset.bound = "1";
    }
    if (districtChart && !districtChart.dataset.bound) {
      districtChart.on("plotly_click", (event) => {
        const point = event?.points?.[0];
        if (!point || point.data?.type !== "scattermap") return;
        const row = getScopedRows()[point.pointIndex];
        if (row?.id) {
          selectLocation(row.id);
          const tableRow = document.querySelector(`[data-location-id="${row.id}"]`);
          if (tableRow) {
            tableRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        }
      });
      districtChart.dataset.bound = "1";
    }
  }

  function setupFilterForm() {
    const filterForm = document.querySelector("form.filters");
    if (!filterForm) return;

    let submitting = false;
    filterForm.addEventListener("submit", (event) => {
      if (submitting) return;
      event.preventDefault();
      submitting = true;

      const applyBtn = filterForm.querySelector(".apply-btn");
      if (applyBtn) {
        applyBtn.classList.add("is-loading");
        applyBtn.disabled = true;
        const loadingLabel = applyBtn.dataset.loading;
        if (loadingLabel) {
          // MWC buttons render slotted text from their light-DOM textContent.
          // Walk the light-DOM children and replace the first text node.
          const textNode = Array.from(applyBtn.childNodes).find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length
          );
          if (textNode) {
            textNode.textContent = " " + loadingLabel + " ";
          } else {
            applyBtn.append(document.createTextNode(" " + loadingLabel + " "));
          }
        }
      }

      try {
        window.sessionStorage.setItem("pgis_skip_loader_once", "1");
      } catch (e) {}

      window.requestAnimationFrame(() => {
        window.setTimeout(() => filterForm.submit(), 250);
      });
    });
  }

  function setupIndicatorGroupsCollapsible() {
    const groups = Array.from(document.querySelectorAll("details.indicator-group"));
    if (!groups.length) return;

    groups.forEach((group) => {
      group.addEventListener("toggle", () => {
        if (!group.open) return;
        const hasSelectedIndicators = Array.from(
          document.querySelectorAll('md-checkbox[name="indicator"]')
        ).some((cb) => cb.checked);
        if (hasSelectedIndicators) return;
        groups.forEach((otherGroup) => {
          if (otherGroup !== group) {
            otherGroup.open = false;
          }
        });
      });
    });
  }

  function setupIndicatorSearch() {
    const search = document.getElementById("indicator-filter-search");
    const groups = Array.from(document.querySelectorAll("details.indicator-group"));
    if (!search || !groups.length) return;

    const applySearch = () => {
      const query = (search.value || "").toString().trim().toLowerCase();
      groups.forEach((group) => {
        let visibleCount = 0;
        group.querySelectorAll(".indicator-option").forEach((option) => {
          const label = (option.textContent || "").trim().toLowerCase();
          const isGroupToggle = option.classList.contains("indicator-option--all");
          const matches = !query || label.includes(query) || isGroupToggle;
          option.hidden = query && !matches;
          if (!isGroupToggle && matches) visibleCount += 1;
        });
        const groupMatches = !query || visibleCount > 0 || (group.dataset.indicatorGroup || "").toLowerCase().includes(query);
        group.hidden = !groupMatches;
        if (query && groupMatches) {
          group.open = true;
        }
      });
    };

    search.addEventListener("input", applySearch);
    applySearch();
  }

  function setupSelectedFilterChips() {
    const container = document.getElementById("selected-filter-chips");
    const filterForm = document.querySelector("form.filters");
    if (!container || !filterForm) return;

    const chipForCheckbox = (input) => {
      const option = input.closest("label");
      const label = option ? (option.textContent || "").trim().replace(/\s+/g, " ") : input.value;
      return { label, remove: () => { input.checked = false; input.dispatchEvent(new Event("change", { bubbles: true })); } };
    };

    const renderChips = () => {
      container.innerHTML = "";
      const chips = Array.from(filterForm.querySelectorAll('md-checkbox[name="indicator"], md-checkbox[name="category"]'))
        .filter((input) => input.checked)
        .map(chipForCheckbox);

      if (!chips.length) {
        container.hidden = true;
        return;
      }

      container.hidden = false;
      chips.forEach((chip) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "filter-chip";
        button.setAttribute("aria-label", `Remove ${chip.label}`);
        button.innerHTML = `<span></span><md-icon aria-hidden="true">close</md-icon>`;
        button.querySelector("span").textContent = chip.label;
        button.addEventListener("click", () => {
          chip.remove();
          renderChips();
        });
        container.append(button);
      });
    };

    filterForm.querySelectorAll('md-checkbox[name="indicator"], md-checkbox[name="category"]').forEach((input) => {
      input.addEventListener("change", renderChips);
    });
    renderChips();
  }

  function setupIndicatorGroupToggles() {
    const groups = Array.from(document.querySelectorAll("details.indicator-group"));
    if (!groups.length) return;

    groups.forEach((group) => {
      const toggle = group.querySelector("[data-indicator-group-toggle]");
      const inputs = Array.from(group.querySelectorAll('md-checkbox[name="indicator"]'));
      if (!toggle || !inputs.length) return;

      const syncToggleState = () => {
        const checkedCount = inputs.filter((input) => input.checked).length;
        toggle.checked = checkedCount === inputs.length;
        toggle.indeterminate = checkedCount > 0 && checkedCount < inputs.length;
      };

      toggle.addEventListener("change", () => {
        const shouldSelectAll = toggle.checked;
        inputs.forEach((input) => {
          input.checked = shouldSelectAll;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        syncToggleState();
      });

      inputs.forEach((input) => {
        input.addEventListener("change", syncToggleState);
      });

      syncToggleState();
    });
  }

  function setupSkipLoaderLinks() {
    document.querySelectorAll('[data-skip-loader="1"]').forEach((link) => {
      link.addEventListener("click", () => {
        try {
          window.sessionStorage.setItem("pgis_skip_loader_once", "1");
        } catch (e) {}
      });
    });
  }

  function setupHotspotFocusControls() {
    document.querySelectorAll(".hotspot-item").forEach((button) => {
      button.addEventListener("click", () => {
        const indicatorKey = normalizeIssueLabel(button.dataset.indicator || button.textContent || "");
        setActiveIndicator(indicatorKey);
      });
    });

    const clearButton = document.getElementById("clear-hotspot-focus");
    if (clearButton) {
      clearButton.addEventListener("click", () => {
        state.activeIndicator = "";
        renderDashboard();
      });
    }
  }

  function fetchJson(url, retries) {
    retries = retries == null ? 2 : retries;
    return fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }
        return response.json();
      })
      .catch((error) => {
        // Recover from transient failures (e.g. a server restart) instead of
        // showing "Not available" — wait briefly and try again.
        if (retries > 0) {
          return new Promise((resolve) => setTimeout(resolve, 500)).then(() =>
            fetchJson(url, retries - 1)
          );
        }
        throw error;
      });
  }

  setupFilterForm();
  setupIndicatorGroupsCollapsible();
  setupIndicatorSearch();
  setupIndicatorGroupToggles();
  setupSelectedFilterChips();
  setupSkipLoaderLinks();
  setupHotspotFocusControls();

  Promise.all([
    fetchJson(window.PGIS.locationsUrl),
    fetchJson(window.PGIS.districtsUrl).catch(() => ({ features: [] })),
    fetchJson(window.PGIS.indicatorApiUrl).catch(() => ({ results: [] })),
  ])
    .then(([geojson, districtPayload, votePayload]) => {
      state.rows = buildRows(geojson);
      state.districtFeatures = districtPayload.features || [];
      state.indicatorColors = buildIndicatorColorMap(state.rows);
      state.votes = (votePayload.results || []).map((row) => ({
        indicatorKey: normalizeIssueLabel(row.indicator),
        votes: Number(row.votes) || 0,
      }));

      renderDashboard();
      bindChartEvents();
      hideLoader();
    })
    .catch((error) => {
      console.error("Failed to load dashboard data", error);
      Object.values(chartIds).forEach((id) => {
        if (id === chartIds.votes) return;
        renderEmptyChart(id, "We couldn't load this section. Please refresh the page or try again later.");
      });
      renderStats([]);
      renderCategoryStats([]);
      const votesCard = document.getElementById("votes-card");
      if (votesCard) {
        votesCard.hidden = true;
      }
      renderTable([]);
      hideLoader();
    });
})();
