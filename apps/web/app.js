const DEFAULT_CENTER = [25.36, 68.28];
const DEFAULT_ZOOM = 9;
const EMBEDDING_SOURCE = "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL";
const CLASS_PALETTE = ["#217a57", "#0d7080", "#b47712", "#b54040", "#315a96", "#6b5ca5", "#6a7d39"];
const { buildExportFilename } = window.EoExportUtils;

const state = {
  apiBase: "http://127.0.0.1:8080",
  apiOnline: false,
  eeReady: false,
  eeProject: null,
  projectId: null,
  projectNameSaveTimer: null,
  projectNameRevision: 0,
  year: 2024,
  startYear: 2017,
  mode: "label",
  activeTab: "overview",
  activeClassId: "crop",
  busy: false,
  map: null,
  baseLayer: null,
  satelliteTile: null,
  embeddingTile: null,
  resultTile: null,
  confidenceTile: null,
  satelliteLayer: null,
  embeddingLayer: null,
  resultLayer: null,
  confidenceLayer: null,
  sampleLayer: null,
  aoiLayer: null,
  hotspotLayer: null,
  inspectLayer: null,
  aoiBounds: null,
  aoiRectangle: null,
  aoiDrawing: false,
  aoiStart: null,
  aoiPreview: null,
  classes: [
    { id: "crop", name: "Cropland", color: "#217a57" },
    { id: "water", name: "Water", color: "#0d7080" },
    { id: "built", name: "Built-up", color: "#b47712" },
    { id: "bare", name: "Bare soil", color: "#b54040" },
  ],
  samples: [],
  lastRun: null,
  activeAnalysis: null,
  similaritySelection: null,
  classificationAnalysis: null,
  changeAnalysis: null,
  temporalProfile: null,
  resultLegend: null,
  hotspotFeatures: [],
  hotspotLayers: new Map(),
};

const els = {
  projectName: document.querySelector("#projectName"),
  workspaceProject: document.querySelector("#workspaceProject"),
  projectState: document.querySelector("#projectState"),
  yearSelect: document.querySelector("#yearSelect"),
  startYearSelect: document.querySelector("#startYearSelect"),
  modelSelect: document.querySelector("#modelSelect"),
  classList: document.querySelector("#classList"),
  sampleCount: document.querySelector("#sampleCount"),
  aoiState: document.querySelector("#aoiState"),
  aoiArea: document.querySelector("#aoiArea"),
  aoiPixels: document.querySelector("#aoiPixels"),
  changeThreshold: document.querySelector("#changeThreshold"),
  thresholdValue: document.querySelector("#thresholdValue"),
  mapWrap: document.querySelector(".map-wrap"),
  mapInstruction: document.querySelector("#mapInstruction"),
  activeResultLabel: document.querySelector("#activeResultLabel"),
  apiStatus: document.querySelector("#apiStatus"),
  apiChip: document.querySelector("#apiChip"),
  connectionDot: document.querySelector("#connectionDot"),
  yearChip: document.querySelector("#yearChip"),
  cursorReadout: document.querySelector("#cursorReadout"),
  zoomReadout: document.querySelector("#zoomReadout"),
  scaleReadout: document.querySelector("#scaleReadout"),
  legendMode: document.querySelector("#legendMode"),
  legendList: document.querySelector("#legendList"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSource: document.querySelector("#resultSource"),
  overviewMetrics: document.querySelector("#overviewMetrics"),
  distributionTitle: document.querySelector("#distributionTitle"),
  distributionMeta: document.querySelector("#distributionMeta"),
  distributionList: document.querySelector("#distributionList"),
  qualityState: document.querySelector("#qualityState"),
  qualityList: document.querySelector("#qualityList"),
  hotspotCount: document.querySelector("#hotspotCount"),
  hotspotSummary: document.querySelector("#hotspotSummary"),
  hotspotList: document.querySelector("#hotspotList"),
  profileSummary: document.querySelector("#profileSummary"),
  temporalChart: document.querySelector("#temporalChart"),
  profileValues: document.querySelector("#profileValues"),
  provenanceState: document.querySelector("#provenanceState"),
  footerApi: document.querySelector("#footerApi"),
  footerEe: document.querySelector("#footerEe"),
  projectIdReadout: document.querySelector("#projectIdReadout"),
  analysisLoader: document.querySelector("#analysisLoader"),
  loaderTitle: document.querySelector("#loaderTitle"),
  loaderDetail: document.querySelector("#loaderDetail"),
  toast: document.querySelector("#toast"),
  classDialog: document.querySelector("#classDialog"),
  classForm: document.querySelector("#classForm"),
  classNameInput: document.querySelector("#classNameInput"),
  classColorInput: document.querySelector("#classColorInput"),
};

async function init() {
  populateYearOptions();
  updateChangeYearOptions();
  initMap();
  bindEvents();
  setAoiBounds(state.map.getBounds(), { fit: false, silent: true });
  updateUi();
  renderResults();
  createIcons();

  await connectApi();
  await loadProjectSamples();
  await Promise.all([loadSatelliteLayer(), loadEmbeddingLayer()]);
  window.setTimeout(() => state.map.invalidateSize(), 100);
}

function populateYearOptions() {
  const options = [];
  for (let year = 2024; year >= 2017; year -= 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    options.push(option);
  }
  els.yearSelect.replaceChildren(...options);
  els.yearSelect.value = String(state.year);
}

function updateChangeYearOptions() {
  const years = [];
  for (let year = Math.min(2023, state.year - 1); year >= 2017; year -= 1) {
    years.push(year);
  }
  if (!years.length) years.push(2017);
  if (!years.includes(state.startYear)) state.startYear = years[years.length - 1];

  els.startYearSelect.replaceChildren(
    ...years.map((year) => {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      option.selected = year === state.startYear;
      return option;
    }),
  );
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: false,
    preferCanvas: true,
    minZoom: 3,
    maxZoom: 18,
  }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  createMapPanes();
  state.baseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(state.map);

  state.satelliteLayer = L.layerGroup().addTo(state.map);
  state.embeddingLayer = L.layerGroup().addTo(state.map);
  state.resultLayer = L.layerGroup().addTo(state.map);
  state.confidenceLayer = L.layerGroup();
  state.sampleLayer = L.layerGroup().addTo(state.map);
  state.aoiLayer = L.layerGroup().addTo(state.map);
  state.hotspotLayer = L.layerGroup().addTo(state.map);
  state.inspectLayer = L.layerGroup().addTo(state.map);

  state.map.on("click", handleMapClick);
  state.map.on("mousemove", handleMapMouseMove);
  state.map.on("zoomend moveend", () => updateMapStatus());
  updateMapStatus();
}

function createMapPanes() {
  const panes = [
    ["satellitePane", 210],
    ["embeddingPane", 220],
    ["resultPane", 230],
    ["confidencePane", 240],
    ["aoiPane", 430],
    ["hotspotPane", 440],
  ];
  panes.forEach(([name, zIndex]) => {
    const pane = state.map.createPane(name);
    pane.style.zIndex = String(zIndex);
  });
}

function bindEvents() {
  els.projectName.addEventListener("input", () => {
    els.workspaceProject.textContent = els.projectName.value || "Untitled project";
    scheduleProjectNameSave();
  });
  els.projectName.addEventListener("blur", () =>
    saveProjectName(state.projectNameRevision, state.projectId),
  );

  els.yearSelect.addEventListener("change", async (event) => {
    state.year = Number(event.target.value);
    if (state.startYear >= state.year) state.startYear = Math.max(2017, state.year - 1);
    updateChangeYearOptions();
    state.projectId = null;
    clearSessionAnalysis();
    await connectApi();
    await loadProjectSamples();
    await Promise.all([loadSatelliteLayer(), loadEmbeddingLayer()]);
    updateUi();
    showToast(`Target year ${state.year}`);
  });

  els.startYearSelect.addEventListener("change", (event) => {
    state.startYear = Number(event.target.value);
    state.changeAnalysis = null;
    if (state.activeAnalysis === "change") state.activeAnalysis = null;
    renderResults();
    updateUi();
  });

  document.querySelector("#drawAoiBtn").addEventListener("click", beginAoiDrawing);
  document.querySelector("#useViewBtn").addEventListener("click", () => {
    setAoiBounds(state.map.getBounds(), { fit: false });
    showToast("AOI set from current view");
  });
  document.querySelector("#clearAoiBtn").addEventListener("click", clearAoi);
  document.querySelector("#fitAoiBtn").addEventListener("click", fitAoi);

  document.querySelector("#sampleModeBtn").addEventListener("click", () => setMode("label"));
  document.querySelector("#similarModeBtn").addEventListener("click", () => setMode("similar"));
  document.querySelector("#inspectModeBtn").addEventListener("click", () => setMode("inspect"));
  document.querySelector("#undoSampleBtn").addEventListener("click", undoLastSample);
  document.querySelector("#clearSamplesBtn").addEventListener("click", clearSamples);
  document.querySelector("#addClassBtn").addEventListener("click", openClassDialog);
  document.querySelector("#closeClassDialogBtn").addEventListener("click", () => els.classDialog.close());
  els.classForm.addEventListener("submit", addClassFromDialog);

  document.querySelector("#trainBtn").addEventListener("click", trainMap);
  document.querySelector("#changeAnalysisBtn").addEventListener("click", runChangeAnalysis);
  els.changeThreshold.addEventListener("input", () => {
    els.thresholdValue.textContent = Number(els.changeThreshold.value).toFixed(2);
  });

  document.querySelector("#exportGeoJsonBtn").addEventListener("click", exportGeoJson);
  document.querySelector("#exportReportBtn").addEventListener("click", exportAnalysisPackage);
  document.querySelector("#zoomInBtn").addEventListener("click", () => state.map.zoomIn());
  document.querySelector("#zoomOutBtn").addEventListener("click", () => state.map.zoomOut());
  document.querySelector("#resetBtn").addEventListener("click", resetView);

  bindLayerControl("satellite", "#satelliteLayerBtn", "#satelliteOpacity");
  bindLayerControl("embedding", "#embeddingLayerBtn", "#embeddingOpacity");
  bindLayerControl("result", "#predictionLayerBtn", "#predictionOpacity");
  bindLayerControl("confidence", "#confidenceLayerBtn", "#confidenceOpacity");

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });
}

function scheduleProjectNameSave() {
  window.clearTimeout(state.projectNameSaveTimer);
  state.projectNameRevision += 1;
  if (!state.apiOnline || !state.projectId) {
    els.projectState.textContent = "Local";
    return;
  }
  els.projectState.textContent = els.projectName.value.trim() ? "Unsaved" : "Name required";
  const revision = state.projectNameRevision;
  const projectId = state.projectId;
  state.projectNameSaveTimer = window.setTimeout(
    () => saveProjectName(revision, projectId),
    600,
  );
}

async function saveProjectName(revision, projectId) {
  window.clearTimeout(state.projectNameSaveTimer);
  state.projectNameSaveTimer = null;
  const name = els.projectName.value.trim();
  if (!name || !state.apiOnline || !projectId || projectId !== state.projectId) return;

  els.projectState.textContent = "Saving";
  try {
    const project = await apiRequest(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    if (revision !== state.projectNameRevision || projectId !== state.projectId) return;
    els.projectName.value = project.name;
    els.workspaceProject.textContent = project.name;
    els.projectState.textContent = "Saved";
  } catch (error) {
    if (revision !== state.projectNameRevision || projectId !== state.projectId) return;
    els.projectState.textContent = "Unsaved";
    showToast(`Project name not saved: ${error.message}`);
  }
}

function bindLayerControl(layerName, buttonSelector, rangeSelector) {
  const button = document.querySelector(buttonSelector);
  const range = document.querySelector(rangeSelector);
  button.addEventListener("click", () => toggleLayer(layerName, button));
  range.addEventListener("input", () => setLayerOpacity(layerName, Number(range.value) / 100));
}

function layerForName(name) {
  return {
    satellite: state.satelliteLayer,
    embedding: state.embeddingLayer,
    result: state.resultLayer,
    confidence: state.confidenceLayer,
  }[name];
}

function tileForName(name) {
  return {
    satellite: state.satelliteTile,
    embedding: state.embeddingTile,
    result: state.resultTile,
    confidence: state.confidenceTile,
  }[name];
}

function toggleLayer(name, button) {
  const layer = layerForName(name);
  if (!layer) return;
  const visible = state.map.hasLayer(layer);
  if (visible) {
    state.map.removeLayer(layer);
  } else {
    layer.addTo(state.map);
  }
  button.classList.toggle("active", !visible);
  button.setAttribute("aria-pressed", String(!visible));
}

function setLayerVisible(name, visible) {
  const layer = layerForName(name);
  const button = {
    satellite: document.querySelector("#satelliteLayerBtn"),
    embedding: document.querySelector("#embeddingLayerBtn"),
    result: document.querySelector("#predictionLayerBtn"),
    confidence: document.querySelector("#confidenceLayerBtn"),
  }[name];
  if (!layer || !button) return;
  if (visible && !state.map.hasLayer(layer)) layer.addTo(state.map);
  if (!visible && state.map.hasLayer(layer)) state.map.removeLayer(layer);
  button.classList.toggle("active", visible);
  button.setAttribute("aria-pressed", String(visible));
}

function setLayerOpacity(name, opacity) {
  const tile = tileForName(name);
  if (tile) tile.setOpacity(opacity);
}

function handleMapClick(event) {
  if (state.aoiDrawing) {
    handleAoiClick(event.latlng);
    return;
  }
  if (state.busy) return;
  if (state.mode === "label") addSample(event.latlng);
  if (state.mode === "similar") addSimilarityTarget(event.latlng);
  if (state.mode === "inspect") inspectTemporalProfile(event.latlng);
}

function handleMapMouseMove(event) {
  updateMapStatus(event.latlng);
  if (!state.aoiDrawing || !state.aoiStart) return;
  if (state.aoiPreview) state.aoiLayer.removeLayer(state.aoiPreview);
  state.aoiPreview = L.rectangle(L.latLngBounds(state.aoiStart, event.latlng), {
    pane: "aoiPane",
    color: "#b47712",
    weight: 2,
    dashArray: "6 5",
    fillColor: "#f2bd5b",
    fillOpacity: 0.08,
    interactive: false,
  }).addTo(state.aoiLayer);
}

function beginAoiDrawing() {
  if (state.aoiDrawing) {
    cancelAoiDrawing();
    return;
  }
  state.aoiDrawing = true;
  state.aoiStart = null;
  els.mapWrap.dataset.aoiDrawing = "true";
  state.map.getContainer().style.cursor = "crosshair";
  updateMapInstruction();
  document.querySelector("#drawAoiBtn span").textContent = "Cancel";
}

function handleAoiClick(latlng) {
  if (!state.aoiStart) {
    state.aoiStart = latlng;
    updateMapInstruction();
    return;
  }
  const bounds = L.latLngBounds(state.aoiStart, latlng);
  if (Math.abs(bounds.getEast() - bounds.getWest()) < 0.0001 || Math.abs(bounds.getNorth() - bounds.getSouth()) < 0.0001) {
    showToast("AOI is too small");
    return;
  }
  cancelAoiDrawing({ keepPreview: true });
  setAoiBounds(bounds, { fit: false });
  showToast("AOI defined");
}

function cancelAoiDrawing(options = {}) {
  state.aoiDrawing = false;
  state.aoiStart = null;
  els.mapWrap.dataset.aoiDrawing = "false";
  state.map.getContainer().style.cursor = "";
  document.querySelector("#drawAoiBtn span").textContent = "Draw AOI";
  if (!options.keepPreview && state.aoiPreview) state.aoiLayer.removeLayer(state.aoiPreview);
  state.aoiPreview = null;
  updateMapInstruction();
}

function setAoiBounds(bounds, options = {}) {
  cancelAoiDrawing();
  state.aoiBounds = L.latLngBounds(bounds);
  state.aoiLayer.clearLayers();
  state.aoiRectangle = L.rectangle(state.aoiBounds, {
    pane: "aoiPane",
    color: "#b47712",
    weight: 2,
    fillColor: "#f2bd5b",
    fillOpacity: 0.035,
  }).addTo(state.aoiLayer);
  if (options.fit) state.map.fitBounds(state.aoiBounds, { padding: [36, 36] });
  clearSessionAnalysis();
  updateUi();
  renderResults();
  if (!options.silent) els.aoiState.textContent = "Custom AOI";
}

function clearAoi() {
  cancelAoiDrawing();
  state.aoiBounds = null;
  state.aoiRectangle = null;
  state.aoiLayer.clearLayers();
  clearSessionAnalysis();
  updateUi();
  renderResults();
  showToast("AOI cleared");
}

function fitAoi() {
  if (!state.aoiBounds) {
    showToast("No AOI selected");
    return;
  }
  state.map.fitBounds(state.aoiBounds, { padding: [30, 30] });
}

function ensureAoi() {
  if (!state.aoiBounds) setAoiBounds(state.map.getBounds(), { fit: false, silent: true });
  return boundsToBbox(state.aoiBounds);
}

function boundsToBbox(bounds) {
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

function boundsAreaKm2(bounds) {
  if (!bounds) return 0;
  const center = bounds.getCenter();
  const heightKm = Math.abs(bounds.getNorth() - bounds.getSouth()) * 111.32;
  const widthKm =
    Math.abs(bounds.getEast() - bounds.getWest()) *
    111.32 *
    Math.max(0.18, Math.cos((center.lat * Math.PI) / 180));
  return heightKm * widthKm;
}

function setMode(mode) {
  state.mode = mode;
  cancelAoiDrawing();
  updateUi();
}

function updateMapInstruction() {
  if (state.aoiDrawing) {
    els.mapInstruction.textContent = state.aoiStart ? "AOI second corner" : "AOI first corner";
    return;
  }
  const activeClass = state.classes.find((item) => item.id === state.activeClassId);
  const labels = {
    label: `Labeling ${activeClass ? activeClass.name : "class"}`,
    similar: "Similarity prototype",
    inspect: "Temporal point inspector",
  };
  els.mapInstruction.textContent = labels[state.mode];
}

function openClassDialog() {
  els.classNameInput.value = "";
  els.classColorInput.value = CLASS_PALETTE[state.classes.length % CLASS_PALETTE.length];
  els.classDialog.showModal();
  window.setTimeout(() => els.classNameInput.focus(), 0);
}

function addClassFromDialog(event) {
  event.preventDefault();
  const name = els.classNameInput.value.trim();
  if (!name) return;
  const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "class";
  let id = baseId;
  let suffix = 2;
  while (state.classes.some((item) => item.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  state.classes.push({ id, name, color: els.classColorInput.value });
  state.activeClassId = id;
  els.classDialog.close();
  updateUi();
  renderResults();
  showToast(`${name} added`);
}

function ensureClassExists(id, name) {
  if (state.classes.some((item) => item.id === id)) return;
  state.classes.push({
    id,
    name: name || titleCase(id),
    color: CLASS_PALETTE[state.classes.length % CLASS_PALETTE.length],
  });
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
  state.lastRun = null;
  state.classificationAnalysis = null;
  if (state.activeAnalysis === "classification") state.activeAnalysis = null;
  drawSample(sample);
  updateUi();
  renderResults();

  if (!state.apiOnline || !state.projectId) {
    showToast("Sample stored in this browser session");
    return;
  }

  const sampleClass = state.classes.find((item) => item.id === sample.classId);
  try {
    const savedSample = await apiRequest(`/projects/${state.projectId}/samples`, {
      method: "POST",
      body: JSON.stringify({
        class_id: sample.classId,
        class_name: sampleClass ? sampleClass.name : sample.classId,
        year: sample.year,
        geometry: { type: "Point", coordinates: [sample.lng, sample.lat] },
      }),
    });
    sample.id = savedSample.id;
    showToast("AlphaEarth sample saved");
  } catch (error) {
    showToast(`Sample kept locally: ${error.message}`);
  }
}

function drawSample(sample) {
  const sampleClass = state.classes.find((item) => item.id === sample.classId);
  const color = sampleClass ? sampleClass.color : "#17211d";
  const name = sampleClass ? sampleClass.name : sample.classId;
  L.circleMarker([sample.lat, sample.lng], {
    radius: 6,
    color: "#ffffff",
    weight: 2.5,
    fillColor: color,
    fillOpacity: 1,
  })
    .bindPopup(`<strong>${name}</strong><br>${sample.lat.toFixed(5)}, ${sample.lng.toFixed(5)}<br>${sample.year}`)
    .addTo(state.sampleLayer);
}

function redrawSamples() {
  state.sampleLayer.clearLayers();
  state.samples.forEach(drawSample);
}

async function undoLastSample() {
  const sample = state.samples.pop();
  if (!sample) {
    showToast("No samples to undo");
    return;
  }
  redrawSamples();
  state.lastRun = null;
  state.classificationAnalysis = null;
  if (state.activeAnalysis === "classification") state.activeAnalysis = null;
  updateUi();
  renderResults();

  if (state.apiOnline && state.projectId && sample.id) {
    try {
      await apiRequest(`/projects/${state.projectId}/samples/${sample.id}`, { method: "DELETE" });
    } catch (error) {
      showToast(`Removed locally: ${error.message}`);
      return;
    }
  }
  showToast("Last sample removed");
}

async function clearSamples() {
  if (!state.samples.length) {
    showToast("No samples to clear");
    return;
  }
  state.samples = [];
  state.lastRun = null;
  state.classificationAnalysis = null;
  state.sampleLayer.clearLayers();
  if (state.activeAnalysis === "classification") {
    state.activeAnalysis = null;
    clearResultLayers();
  }
  updateUi();
  renderResults();

  if (state.apiOnline && state.projectId) {
    try {
      await apiRequest(`/projects/${state.projectId}/samples`, { method: "DELETE" });
    } catch (error) {
      showToast(`Cleared locally: ${error.message}`);
      return;
    }
  }
  showToast("Samples cleared");
}

async function addSimilarityTarget(latlng) {
  if (!requireOnline("Similarity search")) return;
  const bbox = ensureAoi();
  setBusy(true, "Searching embedding space", "Rendering continuous similarity");
  clearResultLayers();
  state.inspectLayer.clearLayers();
  L.circleMarker(latlng, {
    radius: 8,
    color: "#ffffff",
    weight: 3,
    fillColor: "#315a96",
    fillOpacity: 1,
  }).addTo(state.inspectLayer);

  try {
    const payload = await apiRequest(`/projects/${state.projectId}/similarity-tiles`, {
      method: "POST",
      body: JSON.stringify({
        geometry: { type: "Point", coordinates: [latlng.lng, latlng.lat] },
        bbox,
        year: state.year,
      }),
    });
    state.resultTile = L.tileLayer(payload.tile_url, {
      pane: "resultPane",
      opacity: inputOpacity("predictionOpacity"),
      attribution: "AlphaEarth similarity via Google Earth Engine",
    }).addTo(state.resultLayer);
    setLayerVisible("result", true);
    state.similaritySelection = { lat: latlng.lat, lng: latlng.lng, year: state.year };
    state.activeAnalysis = "similarity";
    state.resultLegend = similarityLegend();
    state.activeTab = "overview";
    updateUi();
    renderResults();
    showToast("Continuous similarity map ready");
  } catch (error) {
    showToast(`Similarity failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function inspectTemporalProfile(latlng) {
  if (!requireOnline("Temporal inspector")) return;
  setBusy(true, "Building temporal signature", "Comparing annual AlphaEarth vectors");
  state.inspectLayer.clearLayers();
  const marker = L.marker(latlng, {
    icon: L.divIcon({ className: "inspect-marker", iconSize: [18, 18], iconAnchor: [9, 9] }),
  }).addTo(state.inspectLayer);

  try {
    const payload = await apiRequest(`/projects/${state.projectId}/temporal-profile`, {
      method: "POST",
      body: JSON.stringify({
        geometry: { type: "Point", coordinates: [latlng.lng, latlng.lat] },
        start_year: 2017,
        end_year: state.year,
      }),
    });
    state.temporalProfile = {
      lat: latlng.lat,
      lng: latlng.lng,
      referenceYear: payload.reference_year,
      series: payload.series || [],
    };
    marker.bindPopup(`<strong>Temporal profile</strong><br>${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`);
    setActiveTab("profile");
    updateUi();
    renderResults();
    showToast("Temporal signature ready");
  } catch (error) {
    state.inspectLayer.clearLayers();
    showToast(`Profile failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function trainMap() {
  const classIds = new Set(state.samples.map((sample) => sample.classId));
  if (state.samples.length < 2 || classIds.size < 2) {
    showToast("Add labels for at least two classes");
    return;
  }
  if (!requireOnline("Land-cover mapping")) return;

  const bbox = ensureAoi();
  setBusy(true, "Training land-cover model", "Mapping classes and confidence across the AOI");
  try {
    const run = await apiRequest(`/projects/${state.projectId}/train`, {
      method: "POST",
      body: JSON.stringify({ model_type: els.modelSelect.value, validation: "holdout" }),
    });
    if (run.status !== "complete") throw new Error(run.message || "Training did not complete");

    const classification = await apiRequest(`/projects/${state.projectId}/classification-tiles`, {
      method: "POST",
      body: JSON.stringify({ bbox, year: state.year, include_analysis: true }),
    });
    state.lastRun = run;
    state.classificationAnalysis = classification;
    state.activeAnalysis = "classification";
    state.activeTab = "overview";
    drawClassificationResult(classification);
    updateUi();
    renderResults();
    showToast("Land-cover intelligence ready");
  } catch (error) {
    showToast(`Mapping failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function drawClassificationResult(payload) {
  clearResultLayers();
  state.resultTile = L.tileLayer(payload.tile_url, {
    pane: "resultPane",
    opacity: inputOpacity("predictionOpacity"),
    attribution: "AlphaEarth classification via Google Earth Engine",
  }).addTo(state.resultLayer);
  if (payload.confidence_tile_url) {
    state.confidenceTile = L.tileLayer(payload.confidence_tile_url, {
      pane: "confidencePane",
      opacity: inputOpacity("confidenceOpacity"),
      attribution: "Model confidence via Google Earth Engine",
    }).addTo(state.confidenceLayer);
  }
  setLayerVisible("result", true);
  setLayerVisible("confidence", false);
  state.resultLegend = (payload.legend || []).map((item) => {
    const sampleClass = state.classes.find((entry) => entry.id === item.class_id);
    return {
      label: sampleClass ? sampleClass.name : item.class_id,
      color: item.color,
      value: classSampleCount(item.class_id),
    };
  });
}

async function runChangeAnalysis() {
  if (!requireOnline("Change analysis")) return;
  const bbox = ensureAoi();
  const threshold = Number(els.changeThreshold.value);
  setBusy(true, "Detecting landscape change", "Computing zonal statistics and ranked hotspots");
  try {
    const payload = await apiRequest(`/projects/${state.projectId}/change-analysis`, {
      method: "POST",
      body: JSON.stringify({
        bbox,
        start_year: state.startYear,
        end_year: state.year,
        threshold,
        hotspot_grid: 6,
        hotspot_limit: 8,
      }),
    });
    state.changeAnalysis = payload;
    state.activeAnalysis = "change";
    state.activeTab = "overview";
    drawChangeResult(payload);
    updateUi();
    renderResults();
    showToast("Change hotspots ranked");
  } catch (error) {
    showToast(`Change analysis failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function drawChangeResult(payload) {
  clearResultLayers();
  state.resultTile = L.tileLayer(payload.tile_url, {
    pane: "resultPane",
    opacity: inputOpacity("predictionOpacity"),
    attribution: "AlphaEarth change via Google Earth Engine",
  }).addTo(state.resultLayer);
  setLayerVisible("result", true);
  setLayerVisible("confidence", false);
  state.resultLegend = changeLegend();
  drawHotspots(payload.hotspots);
}

function drawHotspots(collection) {
  state.hotspotLayer.clearLayers();
  state.hotspotLayers.clear();
  state.hotspotFeatures = collection?.features || [];

  state.hotspotFeatures.forEach((feature) => {
    const severity = feature.properties?.severity || "watch";
    const color = severity === "critical" ? "#b54040" : severity === "high" ? "#b47712" : "#315a96";
    const geoLayer = L.geoJSON(feature, {
      pane: "hotspotPane",
      style: {
        color,
        weight: 2,
        dashArray: "5 4",
        fillColor: color,
        fillOpacity: 0.08,
      },
    }).addTo(state.hotspotLayer);
    const center = geoLayer.getBounds().getCenter();
    const rank = feature.properties.rank;
    L.marker(center, {
      pane: "markerPane",
      icon: L.divIcon({
        className: "hotspot-div-icon",
        html: String(rank),
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    })
      .bindTooltip(`Hotspot ${rank}: ${Number(feature.properties.score).toFixed(3)}`)
      .addTo(state.hotspotLayer);
    state.hotspotLayers.set(rank, geoLayer);
  });
}

function clearResultLayers() {
  state.resultLayer.clearLayers();
  state.confidenceLayer.clearLayers();
  state.hotspotLayer.clearLayers();
  state.resultTile = null;
  state.confidenceTile = null;
  state.hotspotFeatures = [];
  state.hotspotLayers.clear();
}

function clearSessionAnalysis() {
  clearResultLayers();
  state.inspectLayer?.clearLayers();
  state.lastRun = null;
  state.activeAnalysis = null;
  state.similaritySelection = null;
  state.classificationAnalysis = null;
  state.changeAnalysis = null;
  state.temporalProfile = null;
  state.resultLegend = null;
}

function resetView() {
  state.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  showToast("Home view restored");
}

function setActiveTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tab);
  });
}

function updateUi() {
  els.workspaceProject.textContent = els.projectName.value || "Untitled project";
  els.yearChip.textContent = String(state.year);
  els.sampleCount.textContent = String(state.samples.length);
  els.mapWrap.dataset.mode = state.mode;
  els.mapWrap.dataset.aoiDrawing = String(state.aoiDrawing);
  updateMapInstruction();

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });

  els.classList.replaceChildren(
    ...state.classes.map((item) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `class-item${state.activeClassId === item.id ? " active" : ""}`;
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = item.color;
      const name = document.createElement("span");
      name.className = "class-name";
      name.textContent = item.name;
      const count = document.createElement("span");
      count.className = "class-count";
      count.textContent = String(classSampleCount(item.id));
      row.append(swatch, name, count);
      row.addEventListener("click", () => {
        state.activeClassId = item.id;
        state.mode = "label";
        updateUi();
      });
      return row;
    }),
  );

  const aoiArea = boundsAreaKm2(state.aoiBounds);
  els.aoiArea.textContent = state.aoiBounds ? `${formatNumber(aoiArea, 1)} km2` : "-- km2";
  els.aoiPixels.textContent = state.aoiBounds ? compactNumber((aoiArea * 1_000_000) / 100) : "--";
  els.aoiState.textContent = state.aoiBounds ? "AOI ready" : "Not set";
  els.scaleReadout.textContent = state.aoiBounds ? `AOI ${formatNumber(aoiArea, 0)} km2` : "AOI -- km2";

  const resultLabels = {
    classification: "Land cover",
    change: "Change",
    similarity: "Similarity",
  };
  els.activeResultLabel.textContent = resultLabels[state.activeAnalysis] || "No result";
  drawLegend();
  setActiveTab(state.activeTab);
}

function updateConnectionUi() {
  els.apiStatus.textContent = state.apiOnline ? (state.eeReady ? "EE online" : "API online") : "Offline";
  els.apiChip.dataset.status = state.apiOnline ? "online" : "offline";
  els.connectionDot.dataset.state = state.apiOnline ? "online" : "offline";
  els.projectState.textContent = state.projectId ? "Saved" : "Local";
  els.footerApi.textContent = state.apiOnline ? "FastAPI online" : "API offline";
  els.footerEe.textContent = state.eeReady ? `${state.eeProject || "Earth Engine"} ready` : "Earth Engine unavailable";
  els.projectIdReadout.textContent = state.projectId ? `Project ${state.projectId}` : "Project --";
}

function renderResults() {
  renderOverview();
  renderHotspotsPanel();
  renderProfilePanel();
  els.hotspotCount.textContent = String(state.hotspotFeatures.length);
  setActiveTab(state.activeTab);
}

function renderOverview() {
  const aoiArea = boundsAreaKm2(state.aoiBounds);
  let metrics;
  let distributions;
  let quality;

  if (state.activeAnalysis === "classification" && state.classificationAnalysis?.analysis) {
    const analysis = state.classificationAnalysis.analysis;
    const validation = modelAccuracy();
    els.resultTitle.textContent = "Land-cover intelligence";
    els.resultSource.textContent = `${state.year} model`;
    els.provenanceState.textContent = "Earth Engine classifier complete";
    metrics = [
      ["Mapped area", formatNumber(analysis.mapped_area_km2, 1), "km2"],
      ["Mean confidence", formatPercent(analysis.mean_confidence), "pixel probability"],
      ["Low confidence", `${formatNumber(analysis.low_confidence_percent, 1)}%`, "below 0.60"],
      [validation.label, validation.value, validation.context],
    ];
    els.distributionTitle.textContent = "Class area";
    els.distributionMeta.textContent = "Zonal estimate";
    distributions = (analysis.class_areas || []).map((item) => {
      const sampleClass = state.classes.find((entry) => entry.id === item.class_id);
      const legendItem = state.classificationAnalysis.legend?.find((entry) => entry.class_id === item.class_id);
      return {
        label: sampleClass ? sampleClass.name : item.class_id,
        color: legendItem?.color || sampleClass?.color || "#315a96",
        percent: item.percent,
        value: `${formatNumber(item.area_km2, 1)} km2`,
      };
    });
    els.qualityState.textContent = state.lastRun?.status || "Complete";
    quality = [
      ["Training evidence", `${state.samples.length} points / ${new Set(state.samples.map((item) => item.classId)).size} classes`],
      ["Model", titleCase((state.lastRun?.model_type || "random_forest").replace("_", " "))],
      ["Analysis scale", `${formatNumber(analysis.analysis_scale_m, 0)} m`],
      ["P10 confidence", formatPercent(analysis.p10_confidence)],
    ];
  } else if (state.activeAnalysis === "change" && state.changeAnalysis) {
    const analysis = state.changeAnalysis;
    els.resultTitle.textContent = "Landscape change";
    els.resultSource.textContent = `${analysis.start_year}-${analysis.end_year}`;
    els.provenanceState.textContent = "AlphaEarth change evidence complete";
    metrics = [
      ["Changed area", formatNumber(analysis.changed_area_km2, 1), "km2 above threshold"],
      ["AOI share", `${formatNumber(analysis.changed_area_percent, 1)}%`, `threshold ${Number(analysis.threshold).toFixed(2)}`],
      ["Mean change", Number(analysis.mean_change).toFixed(3), "embedding drift"],
      ["P95 change", Number(analysis.p95_change).toFixed(3), "upper tail"],
    ];
    els.distributionTitle.textContent = "Change footprint";
    els.distributionMeta.textContent = "AOI share";
    distributions = [
      { label: "Changed", color: "#b54040", percent: analysis.changed_area_percent, value: `${formatNumber(analysis.changed_area_km2, 1)} km2` },
      { label: "Stable", color: "#176b4d", percent: Math.max(0, 100 - analysis.changed_area_percent), value: `${formatNumber(Math.max(0, analysis.aoi_area_km2 - analysis.changed_area_km2), 1)} km2` },
    ];
    els.qualityState.textContent = `${state.hotspotFeatures.length} ranked`;
    quality = [
      ["Method", "1 - cosine similarity"],
      ["Period", `${analysis.start_year} to ${analysis.end_year}`],
      ["Analysis scale", `${formatNumber(analysis.analysis_scale_m, 0)} m`],
      ["P90 / median", `${Number(analysis.p90_change).toFixed(3)} / ${Number(analysis.median_change).toFixed(3)}`],
    ];
  } else if (state.activeAnalysis === "similarity" && state.similaritySelection) {
    const item = state.similaritySelection;
    els.resultTitle.textContent = "Similarity search";
    els.resultSource.textContent = `${item.year} prototype`;
    els.provenanceState.textContent = "Continuous similarity surface ready";
    metrics = [
      ["Latitude", item.lat.toFixed(4), "prototype"],
      ["Longitude", item.lng.toFixed(4), "prototype"],
      ["Vector", "64D", "unit embedding"],
      ["Search AOI", formatNumber(aoiArea, 0), "km2"],
    ];
    els.distributionTitle.textContent = "Similarity scale";
    els.distributionMeta.textContent = "Cosine score";
    distributions = [
      { label: "High", color: "#dc4f4a", percent: 92, value: "> 0.75" },
      { label: "Medium", color: "#2d9b6a", percent: 65, value: "0.55-0.75" },
      { label: "Low", color: "#315a96", percent: 38, value: "< 0.55" },
    ];
    els.qualityState.textContent = "Live tile";
    quality = [
      ["Prototype year", String(item.year)],
      ["Embedding source", "AlphaEarth annual"],
      ["Metric", "Cosine similarity"],
      ["Coverage", `${formatNumber(aoiArea, 1)} km2`],
    ];
  } else {
    const classIds = new Set(state.samples.map((sample) => sample.classId));
    const counts = state.classes.map((item) => classSampleCount(item.id)).filter((count) => count > 0);
    const minPerClass = counts.length ? Math.min(...counts) : 0;
    els.resultTitle.textContent = "Scene overview";
    els.resultSource.textContent = "Live AOI";
    els.provenanceState.textContent = state.eeReady ? "Earth Engine ready" : "Awaiting analysis";
    metrics = [
      ["AOI area", state.aoiBounds ? formatNumber(aoiArea, 1) : "--", "km2"],
      ["10 m pixels", state.aoiBounds ? compactNumber((aoiArea * 1_000_000) / 100) : "--", "estimated"],
      ["Samples", String(state.samples.length), "saved evidence"],
      ["Labeled classes", String(classIds.size), `${minPerClass} minimum per class`],
    ];
    els.distributionTitle.textContent = "Label distribution";
    els.distributionMeta.textContent = "Evidence";
    const maxCount = Math.max(1, ...state.classes.map((item) => classSampleCount(item.id)));
    distributions = state.classes.map((item) => ({
      label: item.name,
      color: item.color,
      percent: (classSampleCount(item.id) / maxCount) * 100,
      value: `${classSampleCount(item.id)} pts`,
    }));
    els.qualityState.textContent = state.samples.length ? "Labels collected" : "Not trained";
    quality = [
      ["Target year", String(state.year)],
      ["Change baseline", String(state.startYear)],
      ["Embedding", "64 dimensions"],
      ["Native resolution", "10 m"],
    ];
  }

  renderMetricGrid(metrics);
  renderDistribution(distributions);
  renderQuality(quality);
}

function renderMetricGrid(metrics) {
  els.overviewMetrics.replaceChildren(
    ...metrics.map(([label, value, context]) => {
      const cell = document.createElement("div");
      cell.className = "metric-cell";
      const labelNode = document.createElement("span");
      labelNode.textContent = label;
      const valueNode = document.createElement("strong");
      valueNode.textContent = value;
      const contextNode = document.createElement("small");
      contextNode.textContent = context || "";
      cell.append(labelNode, valueNode, contextNode);
      return cell;
    }),
  );
}

function renderDistribution(items) {
  els.distributionList.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("div");
      row.className = "distribution-row";
      const label = document.createElement("div");
      label.className = "distribution-label";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = item.color;
      const labelText = document.createElement("span");
      labelText.textContent = item.label;
      label.append(swatch, labelText);
      const track = document.createElement("div");
      track.className = "bar-track";
      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.background = item.color;
      fill.style.width = `${Math.max(0, Math.min(100, Number(item.percent) || 0))}%`;
      track.append(fill);
      const value = document.createElement("span");
      value.className = "distribution-value";
      value.textContent = item.value;
      row.append(label, track, value);
      return row;
    }),
  );
}

function renderQuality(items) {
  els.qualityList.replaceChildren(
    ...items.map(([label, value]) => {
      const row = document.createElement("div");
      row.className = "quality-row";
      const labelNode = document.createElement("span");
      labelNode.textContent = label;
      const valueNode = document.createElement("strong");
      valueNode.textContent = value;
      row.append(labelNode, valueNode);
      return row;
    }),
  );
}

function renderHotspotsPanel() {
  if (!state.changeAnalysis || !state.hotspotFeatures.length) {
    els.hotspotSummary.textContent = "No ranked change hotspots in this session.";
    els.hotspotList.replaceChildren();
    return;
  }
  els.hotspotSummary.textContent = `${formatNumber(state.changeAnalysis.changed_area_km2, 1)} km2 exceeds the ${Number(state.changeAnalysis.threshold).toFixed(2)} change threshold. Hotspots are ranked by mean embedding drift.`;
  els.hotspotList.replaceChildren(
    ...state.hotspotFeatures.map((feature) => {
      const properties = feature.properties;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hotspot-item";
      const rank = document.createElement("span");
      rank.className = "hotspot-rank";
      rank.textContent = `#${properties.rank}`;
      const copy = document.createElement("span");
      copy.className = "hotspot-copy";
      const title = document.createElement("strong");
      title.textContent = `Change score ${Number(properties.score).toFixed(3)}`;
      const detail = document.createElement("span");
      detail.textContent = `${state.changeAnalysis.start_year}-${state.changeAnalysis.end_year} mean drift`;
      copy.append(title, detail);
      const severity = document.createElement("span");
      severity.className = "severity-badge";
      severity.dataset.severity = properties.severity;
      severity.textContent = properties.severity;
      button.append(rank, copy, severity);
      button.addEventListener("click", () => focusHotspot(properties.rank));
      return button;
    }),
  );
}

function focusHotspot(rank) {
  const layer = state.hotspotLayers.get(rank);
  if (!layer) return;
  state.map.fitBounds(layer.getBounds(), { padding: [80, 80], maxZoom: 14 });
}

function renderProfilePanel() {
  const profile = state.temporalProfile;
  if (!profile?.series?.length) {
    els.profileSummary.textContent = "No temporal point profile in this session.";
    els.temporalChart.replaceChildren();
    els.profileValues.replaceChildren();
    return;
  }
  els.profileSummary.textContent = `${profile.lat.toFixed(5)}, ${profile.lng.toFixed(5)} compared against the ${profile.referenceYear} AlphaEarth embedding.`;
  drawTemporalChart(profile.series);

  const nonReference = profile.series.filter((item) => item.year !== profile.referenceYear);
  const maxDrift = nonReference.reduce((best, item) => (item.embedding_drift > best.embedding_drift ? item : best), nonReference[0]);
  const mostStable = nonReference.reduce((best, item) => (item.embedding_drift < best.embedding_drift ? item : best), nonReference[0]);
  const values = [
    ["Highest drift", `${maxDrift.year} / ${maxDrift.embedding_drift.toFixed(3)}`],
    ["Closest historical year", `${mostStable.year} / ${mostStable.similarity_to_latest.toFixed(3)} similarity`],
    ["Reference", `${profile.referenceYear} / 1.000 similarity`],
  ];
  els.profileValues.replaceChildren(
    ...values.map(([label, value]) => {
      const row = document.createElement("div");
      row.className = "profile-value";
      const labelNode = document.createElement("span");
      labelNode.textContent = label;
      const valueNode = document.createElement("strong");
      valueNode.textContent = value;
      row.append(labelNode, valueNode);
      return row;
    }),
  );
}

function drawTemporalChart(series) {
  const svg = els.temporalChart;
  svg.replaceChildren();
  const width = 320;
  const height = 190;
  const left = 34;
  const right = 10;
  const top = 16;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(0.05, ...series.map((item) => item.embedding_drift)) * 1.12;
  const maxDrift = Math.max(...series.map((item) => item.embedding_drift));
  const x = (index) => left + (index / Math.max(1, series.length - 1)) * plotWidth;
  const y = (value) => top + plotHeight - (value / maxValue) * plotHeight;

  [0, 0.5, 1].forEach((fraction) => {
    const yPosition = top + plotHeight - fraction * plotHeight;
    const line = svgNode("line", { x1: left, x2: width - right, y1: yPosition, y2: yPosition, class: "chart-grid" });
    const label = svgNode("text", { x: left - 6, y: yPosition + 3, class: "chart-axis-label", "text-anchor": "end" });
    label.textContent = (maxValue * fraction).toFixed(2);
    svg.append(line, label);
  });

  const points = series.map((item, index) => [x(index), y(item.embedding_drift)]);
  const areaPoints = `${left},${top + plotHeight} ${points.map((point) => point.join(",")).join(" ")} ${width - right},${top + plotHeight}`;
  svg.append(svgNode("polygon", { points: areaPoints, class: "chart-area" }));
  svg.append(svgNode("polyline", { points: points.map((point) => point.join(",")).join(" "), class: "chart-line" }));

  series.forEach((item, index) => {
    const point = svgNode("circle", {
      cx: x(index),
      cy: y(item.embedding_drift),
      r: 4,
      class: `chart-point${item.embedding_drift === maxDrift && maxDrift > 0 ? " max-point" : ""}`,
    });
    const title = svgNode("title");
    title.textContent = `${item.year}: drift ${item.embedding_drift.toFixed(3)}`;
    point.append(title);
    svg.append(point);

    if (index === 0 || index === series.length - 1 || index % 2 === 0) {
      const year = svgNode("text", {
        x: x(index),
        y: height - 10,
        class: "chart-axis-label",
        "text-anchor": "middle",
      });
      year.textContent = String(item.year);
      svg.append(year);
    }
  });
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function drawLegend() {
  const items = state.resultLegend || state.classes.map((item) => ({
    label: item.name,
    color: item.color,
    value: classSampleCount(item.id),
  }));
  const modes = { classification: "Land cover", change: "Change", similarity: "Similarity" };
  els.legendMode.textContent = modes[state.activeAnalysis] || "Classes";
  els.legendList.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("div");
      row.className = "legend-item";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = item.color;
      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = item.label;
      const value = document.createElement("span");
      value.className = "legend-count";
      value.textContent = item.value ?? "";
      row.append(swatch, label, value);
      return row;
    }),
  );
}

function changeLegend() {
  return [
    { label: "Stable", color: "#176b4d", value: "< 0.10" },
    { label: "Moderate", color: "#f4d35e", value: "0.10-0.18" },
    { label: "High", color: "#f28c38", value: "0.18-0.27" },
    { label: "Critical", color: "#b54040", value: "> 0.27" },
  ];
}

function similarityLegend() {
  return [
    { label: "Low", color: "#315a96", value: "< 0.55" },
    { label: "Medium", color: "#2d9b6a", value: "0.55-0.75" },
    { label: "High", color: "#dc4f4a", value: "> 0.75" },
  ];
}

async function loadEmbeddingLayer() {
  state.embeddingLayer.clearLayers();
  state.embeddingTile = null;
  if (!state.apiOnline) return;
  try {
    const payload = await apiRequest(`/earth-engine/alphaearth-tiles?year=${state.year}`);
    state.embeddingTile = L.tileLayer(payload.tile_url, {
      pane: "embeddingPane",
      opacity: inputOpacity("embeddingOpacity"),
      attribution: "AlphaEarth Satellite Embeddings via Google Earth Engine",
    }).addTo(state.embeddingLayer);
  } catch (error) {
    showToast(`Embedding layer unavailable: ${error.message}`);
  }
}

async function loadSatelliteLayer() {
  state.satelliteLayer.clearLayers();
  state.satelliteTile = null;
  if (!state.apiOnline) return;
  try {
    const payload = await apiRequest(`/earth-engine/sentinel2-tiles?year=${state.year}`);
    state.satelliteTile = L.tileLayer(payload.tile_url, {
      pane: "satellitePane",
      opacity: inputOpacity("satelliteOpacity"),
      attribution: "Sentinel-2 via Google Earth Engine",
    }).addTo(state.satelliteLayer);
  } catch (error) {
    showToast(`Satellite layer unavailable: ${error.message}`);
  }
}

function inputOpacity(id) {
  return Number(document.querySelector(`#${id}`).value) / 100;
}

async function connectApi() {
  state.apiOnline = false;
  state.eeReady = false;
  state.eeProject = null;
  updateConnectionUi();
  try {
    const health = await apiRequest("/health", { method: "GET" });
    state.apiOnline = health.status === "ok";
    if (!state.apiOnline) throw new Error("Health check failed");

    const storageKey = getProjectStorageKey();
    const legacyStorageKey = `eo_mapper_project_id_${state.year}`;
    const savedProjectId =
      window.localStorage.getItem(legacyStorageKey) || window.localStorage.getItem(storageKey);
    let project = null;
    if (savedProjectId) {
      try {
        project = await apiRequest(`/projects/${savedProjectId}`, { method: "GET" });
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }
    if (!project) {
      const projects = await apiRequest("/projects", { method: "GET" });
      project = projects.find(
        (item) => item.year === state.year && item.name === els.projectName.value,
      );
    }
    if (!project) {
      project = await apiRequest("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: els.projectName.value,
          year: state.year,
          embedding_source: EMBEDDING_SOURCE,
        }),
      });
    }
    state.projectId = project.id;
    window.localStorage.setItem(storageKey, project.id);
    els.projectName.value = project.name;
    els.workspaceProject.textContent = project.name;

    try {
      const earthEngine = await apiRequest("/earth-engine/status", { method: "GET" });
      state.eeReady = Boolean(earthEngine.authenticated);
      state.eeProject = earthEngine.project;
    } catch {
      state.eeReady = false;
    }
  } catch {
    state.apiOnline = false;
    state.projectId = null;
  }
  updateConnectionUi();
  updateUi();
  renderResults();
}

async function loadProjectSamples() {
  state.samples = [];
  state.sampleLayer.clearLayers();
  if (!state.apiOnline || !state.projectId) {
    updateUi();
    renderResults();
    return;
  }
  try {
    const samples = await apiRequest(`/projects/${state.projectId}/samples`, { method: "GET" });
    samples.forEach((sample) => {
      if (sample.geometry?.type !== "Point") return;
      ensureClassExists(sample.class_id, sample.class_name);
      const [lng, lat] = sample.geometry.coordinates;
      const loaded = {
        id: sample.id,
        lat,
        lng,
        year: sample.year || state.year,
        classId: sample.class_id,
      };
      state.samples.push(loaded);
      drawSample(loaded);
    });
  } catch (error) {
    showToast(`Saved samples unavailable: ${error.message}`);
  }
  updateUi();
  renderResults();
}

function getProjectStorageKey() {
  return `alphaearth_workbench_project_v2_${state.year}`;
}

function updateMapStatus(latlng = null) {
  if (!state.map) return;
  const point = latlng || state.map.getCenter();
  els.cursorReadout.textContent = `${Math.abs(point.lat).toFixed(4)} ${point.lat >= 0 ? "N" : "S"}, ${Math.abs(point.lng).toFixed(4)} ${point.lng >= 0 ? "E" : "W"}`;
  els.zoomReadout.textContent = `Z${state.map.getZoom()}`;
}

function setBusy(busy, title = "Running Earth Engine", detail = "Computing AOI evidence") {
  state.busy = busy;
  els.analysisLoader.hidden = !busy;
  els.loaderTitle.textContent = title;
  els.loaderDetail.textContent = detail;
  document.querySelector("#trainBtn").disabled = busy;
  document.querySelector("#changeAnalysisBtn").disabled = busy;
}

function requireOnline(feature) {
  if (state.apiOnline && state.projectId && state.eeReady) return true;
  showToast(`${feature} requires the local API and Earth Engine`);
  return false;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${state.apiBase}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const detail = typeof payload === "object" ? payload?.detail : payload;
    throw new Error(detail || `API ${response.status}`);
  }
  return payload;
}

function exportGeoJson() {
  const generatedAt = new Date();
  const features = state.samples.map((sample) => {
    const sampleClass = state.classes.find((item) => item.id === sample.classId);
    return {
      type: "Feature",
      properties: {
        feature_type: "training_sample",
        class_id: sample.classId,
        class_name: sampleClass ? sampleClass.name : sample.classId,
        year: sample.year,
      },
      geometry: { type: "Point", coordinates: [Number(sample.lng.toFixed(6)), Number(sample.lat.toFixed(6))] },
    };
  });
  if (state.aoiBounds) features.unshift(aoiFeature());
  state.hotspotFeatures.forEach((feature) => {
    features.push({
      ...feature,
      properties: { ...feature.properties, feature_type: "change_hotspot" },
    });
  });
  const payload = {
    type: "FeatureCollection",
    metadata: {
      schema_version: "1.0",
      generated_at: generatedAt.toISOString(),
      project: {
        id: state.projectId,
        name: els.projectName.value.trim(),
        target_year: state.year,
        baseline_year: state.startYear,
      },
      source: {
        collection: EMBEDDING_SOURCE,
        dimensions: 64,
        native_resolution_m: 10,
        earth_engine_project: state.eeProject,
      },
    },
    features,
  };
  const filename = buildExportFilename({
    projectName: els.projectName.value,
    year: state.year,
    kind: "evidence",
    extension: "geojson",
    date: generatedAt,
  });
  downloadJson(filename, payload, "application/geo+json");
  showToast("GeoJSON evidence exported");
}

function exportAnalysisPackage() {
  const generatedAt = new Date();
  const report = {
    schema_version: "1.0",
    generated_at: generatedAt.toISOString(),
    project: {
      id: state.projectId,
      name: els.projectName.value,
      target_year: state.year,
      baseline_year: state.startYear,
    },
    source: {
      collection: EMBEDDING_SOURCE,
      dimensions: 64,
      native_resolution_m: 10,
      earth_engine_project: state.eeProject,
    },
    aoi: state.aoiBounds ? aoiFeature() : null,
    training_samples: JSON.parse(JSON.stringify(state.samples)),
    model_run: state.lastRun,
    classification: stripTileUrls(state.classificationAnalysis),
    change: stripTileUrls(state.changeAnalysis),
    temporal_profile: state.temporalProfile,
    reproducibility: {
      change_method: "1 - cosine_similarity(embedding_start, embedding_end)",
      change_threshold: Number(els.changeThreshold.value),
      classifier: els.modelSelect.value,
    },
  };
  const filename = buildExportFilename({
    projectName: els.projectName.value,
    year: state.year,
    kind: "analysis",
    extension: "json",
    date: generatedAt,
  });
  downloadJson(filename, report, "application/json");
  showToast("Analysis package exported");
}

function aoiFeature() {
  const [west, south, east, north] = boundsToBbox(state.aoiBounds);
  return {
    type: "Feature",
    properties: { feature_type: "area_of_interest", area_km2: Number(boundsAreaKm2(state.aoiBounds).toFixed(2)) },
    geometry: {
      type: "Polygon",
      coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    },
  };
}

function stripTileUrls(value) {
  if (!value) return null;
  return JSON.parse(JSON.stringify(value, (key, item) => (key.includes("tile_url") ? undefined : item)));
}

function downloadJson(filename, payload, mimeType) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function classSampleCount(classId) {
  return state.samples.filter((sample) => sample.classId === classId).length;
}

function modelAccuracy() {
  const metrics = state.lastRun?.metrics || {};
  if (metrics.holdout_accuracy != null) {
    return { label: "Holdout accuracy", value: formatPercent(metrics.holdout_accuracy), context: "validation" };
  }
  if (metrics.training_accuracy != null) {
    return { label: "Training fit", value: formatPercent(metrics.training_accuracy), context: "no holdout" };
  }
  if (metrics.estimated_accuracy != null) {
    return { label: "Estimated fit", value: formatPercent(metrics.estimated_accuracy), context: "fallback" };
  }
  return { label: "Validation", value: "--", context: "not available" };
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatNumber(value, decimals = 1) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function formatPercent(value) {
  return `${formatNumber(Number(value || 0) * 100, 1)}%`;
}

function compactNumber(value) {
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function createIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => els.toast.classList.remove("visible"), 2600);
}

init();
