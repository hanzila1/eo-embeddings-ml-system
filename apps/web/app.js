const state = {
  apiBase: "http://127.0.0.1:8080",
  apiOnline: false,
  projectId: null,
  year: 2024,
  mode: "label",
  activeClassId: "crop",
  trained: false,
  lastRun: null,
  map: null,
  baseLayer: null,
  satelliteLayer: null,
  embeddingLayer: null,
  sampleLayer: null,
  predictionLayer: null,
  similarityLayer: null,
  changeLayer: null,
  classes: [
    { id: "crop", name: "Cropland", color: "#217a57" },
    { id: "water", name: "Water", color: "#0d6f7b" },
    { id: "built", name: "Built-up", color: "#b77b1f" },
    { id: "bare", name: "Bare soil", color: "#b54b43" },
  ],
  samples: [],
  recommendations: [],
};

const els = {
  yearSelect: document.querySelector("#yearSelect"),
  modelSelect: document.querySelector("#modelSelect"),
  classList: document.querySelector("#classList"),
  sampleCount: document.querySelector("#sampleCount"),
  modeLabel: document.querySelector("#modeLabel"),
  apiStatus: document.querySelector("#apiStatus"),
  runSummary: document.querySelector("#runSummary"),
  activeLearningList: document.querySelector("#activeLearningList"),
  toast: document.querySelector("#toast"),
};

async function init() {
  for (let year = 2024; year >= 2017; year -= 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    els.yearSelect.appendChild(option);
  }

  initMap();
  bindEvents();
  updateUi();
  await connectApi();
  await loadSatelliteLayer();
  await loadEmbeddingLayer();
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: false,
    preferCanvas: true,
  }).setView([27.35, 68.25], 9);

  state.baseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(state.map);

  state.satelliteLayer = L.layerGroup().addTo(state.map);
  state.embeddingLayer = L.layerGroup().addTo(state.map);
  state.predictionLayer = L.geoJSON(null).addTo(state.map);
  state.sampleLayer = L.layerGroup().addTo(state.map);
  state.similarityLayer = L.layerGroup().addTo(state.map);
  state.changeLayer = L.layerGroup().addTo(state.map);

  state.map.on("click", (event) => {
    if (state.mode === "label") addSample(event.latlng);
    if (state.mode === "similar") addSimilarityTarget(event.latlng);
    if (state.mode === "change") addChangeTarget(event.latlng);
  });
}

function bindEvents() {
  els.yearSelect.addEventListener("change", async (event) => {
    state.year = Number(event.target.value);
    state.projectId = null;
    state.trained = false;
    state.predictionLayer.clearLayers();
    await connectApi();
    await loadSatelliteLayer();
    await loadEmbeddingLayer();
    showToast(`Year set to ${state.year}`);
  });

  document.querySelector("#sampleModeBtn").addEventListener("click", () => setMode("label"));
  document.querySelector("#similarModeBtn").addEventListener("click", () => setMode("similar"));
  document.querySelector("#changeModeBtn").addEventListener("click", () => setMode("change"));
  document.querySelector("#trainBtn").addEventListener("click", trainMap);
  document.querySelector("#exportBtn").addEventListener("click", exportGeoJson);
  document.querySelector("#addClassBtn").addEventListener("click", addClass);
  document.querySelector("#zoomInBtn").addEventListener("click", () => state.map.zoomIn());
  document.querySelector("#zoomOutBtn").addEventListener("click", () => state.map.zoomOut());
  document.querySelector("#resetBtn").addEventListener("click", resetView);
  document.querySelector("#satelliteLayerBtn").addEventListener("click", () => toggleLayer("satellite"));
  document.querySelector("#embeddingLayerBtn").addEventListener("click", () => toggleLayer("embedding"));
  document.querySelector("#predictionLayerBtn").addEventListener("click", () => toggleLayer("prediction"));
}

function toggleLayer(layerName) {
  const controls = {
    satellite: [state.satelliteLayer, document.querySelector("#satelliteLayerBtn")],
    embedding: [state.embeddingLayer, document.querySelector("#embeddingLayerBtn")],
    prediction: [state.predictionLayer, document.querySelector("#predictionLayerBtn")],
  };
  const [layer, button] = controls[layerName];
  if (state.map.hasLayer(layer)) {
    state.map.removeLayer(layer);
    button.classList.remove("active");
    return;
  }
  layer.addTo(state.map);
  button.classList.add("active");
}

function setMode(mode) {
  state.mode = mode;
  updateUi();
  showToast(`${titleCase(mode)} mode`);
}

function resetView() {
  state.map.setView([27.35, 68.25], 9);
  state.similarityLayer.clearLayers();
  state.changeLayer.clearLayers();
  showToast("View reset to Sindh demo area");
}

function addClass() {
  const names = ["Mangrove", "Orchard", "Wetland", "Rangeland", "Settlement"];
  const colors = ["#315c9f", "#6a7d39", "#0d6f7b", "#7f5d38", "#8b4f8f"];
  const index = state.classes.length % names.length;
  const id = `${names[index].toLowerCase()}-${state.classes.length + 1}`;
  state.classes.push({ id, name: names[index], color: colors[index] });
  state.activeClassId = id;
  updateUi();
  showToast(`${names[index]} added`);
}

async function addSample(latlng) {
  const sample = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    lat: latlng.lat,
    lng: latlng.lng,
    year: state.year,
    classId: state.activeClassId,
  };
  state.samples.push(sample);
  state.trained = false;
  state.predictionLayer.clearLayers();
  drawSample(sample);
  updateUi();

  if (state.apiOnline && state.projectId) {
    const sampleClass = state.classes.find((item) => item.id === sample.classId);
    try {
      await apiRequest(`/projects/${state.projectId}/samples`, {
        method: "POST",
        body: JSON.stringify({
          class_id: sample.classId,
          class_name: sampleClass ? sampleClass.name : sample.classId,
          year: sample.year,
          geometry: {
            type: "Point",
            coordinates: [sample.lng, sample.lat],
          },
        }),
      });
      showToast("Real coordinate sample saved");
    } catch (error) {
      state.apiOnline = false;
      updateUi();
      showToast("Sample kept locally; API save failed");
    }
  }
}

function drawSample(sample) {
  const sampleClass = state.classes.find((item) => item.id === sample.classId);
  const color = sampleClass ? sampleClass.color : "#17201c";
  L.circleMarker([sample.lat, sample.lng], {
    radius: 7,
    color: "#ffffff",
    weight: 3,
    fillColor: color,
    fillOpacity: 1,
  })
    .bindPopup(`${sampleClass ? sampleClass.name : sample.classId}<br>${sample.lat.toFixed(5)}, ${sample.lng.toFixed(5)}`)
    .addTo(state.sampleLayer);
}

async function addSimilarityTarget(latlng) {
  state.similarityLayer.clearLayers();
  L.circle(latlng, {
    radius: 3500,
    color: "#315c9f",
    weight: 2,
    fillColor: "#315c9f",
    fillOpacity: 0.18,
  }).addTo(state.similarityLayer);
  if (!state.apiOnline || !state.projectId) {
    showToast("Similarity prototype selected");
    return;
  }
  try {
    const bounds = state.map.getBounds();
    const payload = await apiRequest(`/projects/${state.projectId}/similarity-grid`, {
      method: "POST",
      body: JSON.stringify({
        geometry: {
          type: "Point",
          coordinates: [latlng.lng, latlng.lat],
        },
        bbox: [
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ],
        rows: 10,
        cols: 10,
        year: state.year,
      }),
    });
    drawSimilarityGrid(payload.features || []);
    showToast("Similarity map updated");
  } catch (error) {
    showToast("Similarity search failed");
  }
}

function drawSimilarityGrid(features) {
  L.geoJSON(features, {
    style: (feature) => {
      const score = Number(feature.properties.similarity || 0);
      return {
        color: "#315c9f",
        weight: 1,
        fillColor: score > 0.75 ? "#217a57" : score > 0.55 ? "#315c9f" : "#b77b1f",
        fillOpacity: Math.max(0.08, Math.min(0.5, score * 0.45)),
      };
    },
    onEachFeature: (feature, layer) => {
      layer.bindPopup(`Embedding similarity: ${feature.properties.similarity}`);
    },
  }).addTo(state.similarityLayer);
}

function addChangeTarget(latlng) {
  state.changeLayer.clearLayers();
  L.circle(latlng, {
    radius: 3000,
    color: "#b54b43",
    weight: 2,
    fillColor: "#b54b43",
    fillOpacity: 0.18,
  }).addTo(state.changeLayer);
  showToast(`Change target: 2017 to ${state.year}`);
}

async function trainMap() {
  const classIds = new Set(state.samples.map((sample) => sample.classId));
  if (state.samples.length < 2 || classIds.size < 2) {
    showToast("Add samples for at least two classes");
    return;
  }

  if (state.apiOnline && state.projectId) {
    try {
      state.lastRun = await apiRequest(`/projects/${state.projectId}/train`, {
        method: "POST",
        body: JSON.stringify({
          model_type: els.modelSelect.value,
          validation: "holdout",
        }),
      });
      const bounds = state.map.getBounds();
      const grid = await apiRequest(`/projects/${state.projectId}/predict-grid`, {
        method: "POST",
        body: JSON.stringify({
          bbox: [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
          ],
          rows: 10,
          cols: 10,
          year: state.year,
          model_type: els.modelSelect.value,
        }),
      });
      drawPredictionGrid(grid.features || []);
    } catch (error) {
      state.apiOnline = false;
      state.lastRun = null;
      updateUi();
      showToast("API prediction failed");
      return;
    }
  }

  state.trained = true;
  state.recommendations = buildRecommendations();
  updateUi();
  showToast("Prediction layer updated");
}

function drawPredictionGrid(features) {
  state.predictionLayer.clearLayers();
  state.predictionLayer = L.geoJSON(features, {
    style: (feature) => {
      const classId = feature.properties.class_id;
      const sampleClass = state.classes.find((item) => item.id === classId);
      return {
        color: sampleClass ? sampleClass.color : "#315c9f",
        weight: 1,
        fillOpacity: Math.max(0.22, Number(feature.properties.confidence || 0.4) * 0.42),
        fillColor: sampleClass ? sampleClass.color : "#315c9f",
      };
    },
    onEachFeature: (feature, layer) => {
      layer.bindPopup(
        `${feature.properties.class_name}<br>Confidence: ${feature.properties.confidence}`,
      );
    },
  }).addTo(state.map);
}

function exportGeoJson() {
  const features = state.samples.map((sample) => {
    const sampleClass = state.classes.find((item) => item.id === sample.classId);
    return {
      type: "Feature",
      properties: {
        class_id: sample.classId,
        class_name: sampleClass ? sampleClass.name : sample.classId,
        year: sample.year,
      },
      geometry: {
        type: "Point",
        coordinates: [Number(sample.lng.toFixed(6)), Number(sample.lat.toFixed(6))],
      },
    };
  });

  const blob = new Blob([JSON.stringify({ type: "FeatureCollection", features }, null, 2)], {
    type: "application/geo+json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "eo-embedding-samples.geojson";
  a.click();
  URL.revokeObjectURL(url);
}

function buildRecommendations() {
  return [
    { label: "Low confidence", score: Math.max(35, 88 - state.samples.length * 3) },
    { label: "Class boundary", score: 72 },
    { label: "Sparse coverage", score: 65 },
  ];
}

function updateUi() {
  els.modeLabel.textContent = titleCase(state.mode);
  els.apiStatus.textContent = state.apiOnline ? "Online" : "Local";
  els.sampleCount.textContent = String(state.samples.length);

  document.querySelector("#sampleModeBtn").classList.toggle("primary-button", state.mode === "label");
  document.querySelector("#similarModeBtn").classList.toggle("primary-button", state.mode === "similar");
  document.querySelector("#changeModeBtn").classList.toggle("primary-button", state.mode === "change");

  els.classList.replaceChildren(
    ...state.classes.map((item) => {
      const count = state.samples.filter((sample) => sample.classId === item.id).length;
      const row = document.createElement("button");
      row.className = `class-item ${state.activeClassId === item.id ? "active" : ""}`;
      row.type = "button";
      row.innerHTML = `
        <span class="swatch" style="background:${item.color}"></span>
        <span class="class-name">${item.name}</span>
        <span class="class-count">${count}</span>
      `;
      row.addEventListener("click", () => {
        state.activeClassId = item.id;
        updateUi();
      });
      return row;
    }),
  );

  const classIds = new Set(state.samples.map((sample) => sample.classId));
  const apiAccuracyValue =
    state.lastRun?.metrics?.holdout_accuracy ??
    state.lastRun?.metrics?.training_accuracy ??
    state.lastRun?.metrics?.estimated_accuracy ??
    null;
  const apiAccuracy = apiAccuracyValue ? Math.round(apiAccuracyValue * 100) : null;
  const apiUncertainty = state.lastRun?.metrics?.mean_uncertainty
    ? Math.round(state.lastRun.metrics.mean_uncertainty * 100)
    : null;
  const accuracy = state.trained ? apiAccuracy || 0 : 0;
  const uncertainty = state.trained ? apiUncertainty || "-" : "-";
  const coverage = Math.min(100, Math.round((state.samples.length / 18) * 100));
  const tiles = [
    ["Samples", state.samples.length],
    ["Classes", classIds.size],
    ["Accuracy", state.trained ? `${accuracy}%` : "-"],
    ["Uncertainty", state.trained ? `${uncertainty}${typeof uncertainty === "number" ? "%" : ""}` : "-"],
  ];
  els.runSummary.replaceChildren(
    ...tiles.map(([label, value]) => {
      const tile = document.createElement("div");
      tile.className = "summary-tile";
      tile.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      return tile;
    }),
  );

  const recommendations =
    state.recommendations.length > 0
      ? state.recommendations
      : [
          { label: "Coverage", score: coverage },
          { label: "Boundary", score: 68 },
          { label: "Minority class", score: 61 },
        ];

  els.activeLearningList.replaceChildren(
    ...recommendations.map((item) => {
      const node = document.createElement("div");
      node.className = "recommendation";
      node.innerHTML = `<strong>${item.label}</strong><span>Priority ${item.score}</span>`;
      return node;
    }),
  );
}

async function loadEmbeddingLayer() {
  state.embeddingLayer.clearLayers();
  if (!state.apiOnline) return;
  try {
    const payload = await apiRequest(`/earth-engine/alphaearth-tiles?year=${state.year}`);
    const layer = L.tileLayer(payload.tile_url, {
      opacity: 0.55,
      attribution: "AlphaEarth Satellite Embeddings via Google Earth Engine",
    });
    layer.addTo(state.embeddingLayer);
    showToast("AlphaEarth embedding layer loaded");
  } catch (error) {
    showToast("Embedding tiles unavailable");
  }
}

async function loadSatelliteLayer() {
  state.satelliteLayer.clearLayers();
  if (!state.apiOnline) return;
  try {
    const payload = await apiRequest(`/earth-engine/sentinel2-tiles?year=${state.year}`);
    const layer = L.tileLayer(payload.tile_url, {
      opacity: 0.92,
      attribution: "Sentinel-2 via Google Earth Engine",
    });
    layer.addTo(state.satelliteLayer);
  } catch (error) {
    showToast("Satellite tiles unavailable");
  }
}

async function connectApi() {
  try {
    const health = await apiRequest("/health", { method: "GET" });
    state.apiOnline = health.status === "ok";
    if (state.apiOnline) {
      const project = await apiRequest("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: document.querySelector("#projectName").value,
          year: state.year,
          embedding_source: "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL",
        }),
      });
      state.projectId = project.id;
    }
  } catch (error) {
    state.apiOnline = false;
    state.projectId = null;
  }
  updateUi();
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${state.apiBase}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }
  return response.json();
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    els.toast.classList.remove("visible");
  }, 1800);
}

init();
