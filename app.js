const CONFIG = {
  hierarchyPath: './data/CZ_AdministrativeHierarchy.json',
  geoPaths: {
    kraje: './data/Kraje_NUTS_3_multi_20260101.geojson',
    okresy: './data/Okresy_LAU_1_multi_20260101.geojson',
    orp: './data/CZ_ORP_Enriched.geojson'
  },
  maxAttempts: 3
};

const ui = {
  levelSelect: document.getElementById('levelSelect'),
  scopeSelect: document.getElementById('scopeSelect'),
  krajRow: document.getElementById('krajRow'),
  okresRow: document.getElementById('okresRow'),
  krajSelect: document.getElementById('krajSelect'),
  okresSelect: document.getElementById('okresSelect'),
  newGameButton: document.getElementById('newGameButton'),
  nextButton: document.getElementById('nextButton'),
  resetButton: document.getElementById('resetButton'),
  targetText: document.getElementById('targetText'),
  progressText: document.getElementById('progressText'),
  attemptsText: document.getElementById('attemptsText'),
  feedbackText: document.getElementById('feedbackText')
};

const state = {
  hierarchy: null,
  geoFeatures: {
    kraje: {},
    okresy: {},
    orp: {}
  },
  targets: {
    kraje: [],
    okresy: [],
    orp: []
  },
  currentLevel: 'kraje',
  currentScope: 'czech',
  selectedKraj: '',
  selectedOkres: '',
  pool: [],
  completedIds: new Set(),
  currentTarget: null,
  attemptsLeft: CONFIG.maxAttempts,
  map: null,
  activeLayerGroup: null,
  contextLayerGroup: null,
  answered: false
};

const scopeRules = {
  czech: { label: 'Celá ČR', levels: ['kraje', 'okresy', 'orp'] },
  oneKraj: { label: 'Jeden kraj', levels: ['okresy', 'orp'] },
  oneOkres: { label: 'Jeden okres', levels: ['orp'] }
};

const styles = {
  kraje: { color: '#1d4ed8', weight: 3, fillColor: '#bfdbfe', fillOpacity: 0.35 },
  okresy: { color: '#2563eb', weight: 2, fillColor: '#dbeafe', fillOpacity: 0.28 },
  orp: { color: '#2563eb', weight: 1.5, fillColor: '#e0f2fe', fillOpacity: 0.26 },
  highlight: { color: '#16a34a', weight: 3, fillColor: '#bbf7d0', fillOpacity: 0.5 },
  error: { color: '#dc2626', weight: 3, fillColor: '#fecaca', fillOpacity: 0.55 },
  context: { color: '#0f172a', weight: 2, fillOpacity: 0, dashArray: '6 6', opacity: 0.65 }
};

function normalizeCode(value) {
  return String(value || '').trim();
}

function createFeatureKey(type, code) {
  return `${type}:${normalizeCode(code)}`;
}

function showFeedback(message, type = 'default') {
  if (!ui.feedbackText) return;
  ui.feedbackText.textContent = message;
  ui.feedbackText.style.color = type === 'error' ? '#b91c1c' : type === 'success' ? '#047857' : '';
}

function updateInfo() {
  const total = state.pool.length;
  const done = state.completedIds.size;
  ui.progressText.textContent = `Progres: ${done} / ${total}`;
  if (state.currentTarget) {
    ui.targetText.textContent = `Cíl: ${state.currentTarget.name}`;
    ui.attemptsText.textContent = `Pokusy: ${state.attemptsLeft} / ${CONFIG.maxAttempts}`;
  } else {
    ui.targetText.textContent = 'Cíl: –';
    ui.attemptsText.textContent = 'Pokusy: –';
  }
}

function safeFetchJson(path) {
  return fetch(path).then((response) => {
    if (!response.ok) {
      throw new Error(`${path} - ${response.status} ${response.statusText}`);
    }
    return response.json();
  });
}

function getArrayField(source, keys) {
  for (const key of keys) {
    if (Array.isArray(source?.[key])) {
      return source[key];
    }
  }
  return [];
}

function loadHierarchy(hierarchyJson) {
  const kraje = getArrayField(hierarchyJson, ['kraje', 'Kraje', 'state']) || [];

  const normalizedKraje = Array.isArray(hierarchyJson.kraje)
    ? hierarchyJson.kraje
    : Array.isArray(hierarchyJson.state)
      ? getArrayField(hierarchyJson.state[0], ['kraje', 'Kraje'])
      : [];

  if (!normalizedKraje.length) {
    throw new Error('Soubor hierarchie neobsahuje očekávanou strukturu kraje -> okresy -> ORP.');
  }

  state.hierarchy = normalizedKraje.map((kraj) => {
    const okresy = getArrayField(kraj, ['okresy', 'Okresy']);
    const normalizedOkresy = okresy.map((okres) => ({
      ...okres,
      okresy: undefined,
      orp: getArrayField(okres, ['orp', 'ORP', 'orpList'])
    }));
    return {
      ...kraj,
      okresy: normalizedOkresy
    };
  });
}

function buildTargetLists() {
  state.targets.kraje = state.hierarchy.map((kraj) => ({
    id: createFeatureKey('kraje', kraj.kod_kraj),
    type: 'kraje',
    code: normalizeCode(kraj.kod_kraj),
    name: kraj.naz_kraj || kraj.nazev || 'Neznámý kraj',
    kod_kraj: normalizeCode(kraj.kod_kraj)
  }));

  state.targets.okresy = [];
  state.targets.orp = [];

  state.hierarchy.forEach((kraj) => {
    const krajCode = normalizeCode(kraj.kod_kraj);
    const krajName = kraj.naz_kraj || kraj.nazev || '';
    const okresy = getArrayField(kraj, ['okresy']);

    okresy.forEach((okres) => {
      const okresCode = normalizeCode(okres.kod_okres || okres.lau1);
      const okresName = okres.naz_okres || okres.nazev || 'Neznámý okres';
      state.targets.okresy.push({
        id: createFeatureKey('okresy', okresCode),
        type: 'okresy',
        code: okresCode,
        name: okresName,
        kod_kraj: krajCode,
        naz_kraj: krajName,
        kod_okres: okresCode,
        lau1: normalizeCode(okres.lau1 || okres.kod_okres)
      });

      const orpCandidates = getArrayField(okres, ['orp', 'ORP', 'orpList']);
      orpCandidates.forEach((orp) => {
        const orpCode = normalizeCode(orp.kod_orp || orp.kod_ORP);
        const orpName = orp.naz_orp || orp.nazev || 'Neznámý ORP';
        state.targets.orp.push({
          id: createFeatureKey('orp', orpCode),
          type: 'orp',
          code: orpCode,
          name: orpName,
          kod_kraj: krajCode,
          naz_kraj: krajName,
          kod_okres: normalizeCode(orp.kod_okres || okresCode),
          lau1: normalizeCode(orp.lau1 || okres.lau1 || okresCode)
        });
      });
    });
  });
}

function loadGeoJsonFeatures(type, featureCollection) {
  const features = Array.isArray(featureCollection.features) ? featureCollection.features : [];
  features.forEach((feature) => {
    const props = feature.properties || {};
    let code = '';
    if (type === 'kraje') {
      code = normalizeCode(props.kod_kraj || props.kod || props.NUTS3_KRAJ || props.nuts3_kraj);
    } else if (type === 'okresy') {
      code = normalizeCode(props.kod_okres || props.lau1 || props.okres);
    } else if (type === 'orp') {
      code = normalizeCode(props.kod_orp || props.kod_ORP || props.orp);
    }
    if (code) {
      state.geoFeatures[type][code] = feature;
    }
  });
}

function getTargetFeature(type, target) {
  if (!target || !target.code) {
    return null;
  }
  return state.geoFeatures[type]?.[target.code] || null;
}

function updateScopeAndLevelOptions() {
  const scope = ui.scopeSelect.value;
  state.currentScope = scope;
  const allowed = scopeRules[scope]?.levels || [];
  ui.levelSelect.querySelectorAll('option').forEach((option) => {
    option.disabled = !allowed.includes(option.value);
  });

  if (!allowed.includes(ui.levelSelect.value)) {
    ui.levelSelect.value = allowed[0] || 'kraje';
  }

  state.currentLevel = ui.levelSelect.value;
  ui.krajRow.style.display = scope === 'oneKraj' || scope === 'oneOkres' ? 'grid' : 'none';
  ui.okresRow.style.display = scope === 'oneOkres' ? 'grid' : 'none';
  if (scope !== 'oneOkres') {
    state.selectedOkres = '';
    ui.okresSelect.value = '';
  }

  if (scope === 'czech') {
    state.selectedKraj = '';
    ui.krajSelect.value = '';
  }

  updateKrajOptions();
  updateOkresOptions();
}

function updateKrajOptions() {
  if (!ui.krajSelect) return;
  const options = ['<option value="">Vyberte kraj</option>'];
  state.targets.kraje.forEach((kraj) => {
    const selected = kraj.code === state.selectedKraj ? ' selected' : '';
    options.push(`<option value="${kraj.code}"${selected}>${kraj.name}</option>`);
  });
  ui.krajSelect.innerHTML = options.join('');
}

function updateOkresOptions() {
  if (!ui.okresSelect) return;
  const krajCode = ui.krajSelect.value;
  const okresy = state.targets.okresy.filter((okres) => okres.kod_kraj === krajCode);
  const options = ['<option value="">Vyberte okres</option>'];
  okresy.forEach((okres) => {
    const selected = okres.code === state.selectedOkres ? ' selected' : '';
    options.push(`<option value="${okres.code}"${selected}>${okres.name}</option>`);
  });
  ui.okresSelect.innerHTML = options.join('');
}

function getFilteredTargets() {
  const level = state.currentLevel;
  const scope = state.currentScope;
  if (level === 'kraje' && scope === 'czech') {
    return [...state.targets.kraje];
  }

  if (level === 'okresy') {
    if (scope === 'czech') {
      return [...state.targets.okresy];
    }
    if (scope === 'oneKraj' && state.selectedKraj) {
      return state.targets.okresy.filter((item) => item.kod_kraj === state.selectedKraj);
    }
  }

  if (level === 'orp') {
    if (scope === 'czech') {
      return [...state.targets.orp];
    }
    if (scope === 'oneKraj' && state.selectedKraj) {
      return state.targets.orp.filter((item) => item.kod_kraj === state.selectedKraj);
    }
    if (scope === 'oneOkres' && state.selectedOkres) {
      return state.targets.orp.filter((item) => item.kod_okres === state.selectedOkres);
    }
  }

  return [];
}

function clearMapLayers() {
  if (state.activeLayerGroup) {
    state.activeLayerGroup.remove();
    state.activeLayerGroup = null;
  }
  if (state.contextLayerGroup) {
    state.contextLayerGroup.remove();
    state.contextLayerGroup = null;
  }
}

function clearSelectionStyles(layer) {
  if (!layer || !layer.feature) return;
  const type = state.currentLevel;
  layer.setStyle(styles[type]);
}

function createFeatureLayer(target) {
  const feature = getTargetFeature(target.type, target);
  if (!feature) {
    return null;
  }

  return L.geoJSON(feature, {
    style: () => styles[target.type],
    onEachFeature: (feature, layer) => {
      layer.targetId = target.id;
      layer.on('click', () => handleMapClick(target, layer));
    }
  });
}

function renderContextLayers() {
  const type = state.currentLevel;
  if (type === 'orp' || type === 'okresy') {
    const group = L.layerGroup();
    Object.values(state.geoFeatures.kraje).forEach((feature) => {
      L.geoJSON(feature, {
        style: styles.context,
        interactive: false
      }).addTo(group);
    });
    group.addTo(state.map);
    state.contextLayerGroup = group;
  }
}

function renderMap() {
  clearMapLayers();
  const pool = getFilteredTargets();
  if (!pool.length) {
    showFeedback('Vyberte platnou kombinaci rozsahu a úrovně.', 'error');
    if (state.map) {
      state.map.setView([49.8, 15.5], 7);
    }
    return;
  }

  const group = L.layerGroup();
  pool.forEach((target) => {
    const layer = createFeatureLayer(target);
    if (layer) {
      layer.addTo(group);
    }
  });

  group.addTo(state.map);
  state.activeLayerGroup = group;
  renderContextLayers();

  if (group.getBounds().isValid()) {
    state.map.fitBounds(group.getBounds(), { padding: [20, 20] });
  }
}

function setTargetStatus(message, type = 'default') {
  showFeedback(message, type);
  updateInfo();
}

function chooseNextTarget() {
  const remaining = state.pool.filter((item) => !state.completedIds.has(item.id));
  if (!remaining.length) {
    state.currentTarget = null;
    ui.nextButton.disabled = true;
    setTargetStatus('Gratulace! Cílvevšny dokončeny.', 'success');
    return;
  }
  const index = Math.floor(Math.random() * remaining.length);
  state.currentTarget = remaining[index];
  state.attemptsLeft = CONFIG.maxAttempts;
  state.answered = false;
  ui.nextButton.disabled = true;
  setTargetStatus('Klikněte na správný polygon na mapě.');
}

function startNewGame() {
  const filtered = getFilteredTargets();
  if (!filtered.length) {
    setTargetStatus('Pro tuto kombinaci nelze spustit novou hru.', 'error');
    return;
  }
  state.pool = filtered;
  state.completedIds.clear();
  state.currentTarget = null;
  state.answered = false;
  renderMap();
  chooseNextTarget();
  updateInfo();
}

function resetGame() {
  state.pool = [];
  state.completedIds.clear();
  state.currentTarget = null;
  state.answered = false;
  state.attemptsLeft = CONFIG.maxAttempts;
  ui.nextButton.disabled = true;
  renderMap();
  showFeedback('Hra byla resetována. Zvolte nové nastavení a spusťte hru.');
  updateInfo();
}

function markTargetCompleted(correct) {
  state.completedIds.add(state.currentTarget.id);
  state.answered = true;
  ui.nextButton.disabled = false;
  if (correct) {
    setTargetStatus(`Správně! ${state.currentTarget.name} je hotový.`, 'success');
  } else {
    setTargetStatus(`Bohužel. Správná odpověď byla ${state.currentTarget.name}.`, 'error');
  }
}

function styleLayer(layer, styleObject) {
  if (!layer || !layer.setStyle) return;
  layer.setStyle(styleObject);
}

function handleMapClick(target, layer) {
  if (!state.currentTarget || state.answered) {
    return;
  }

  if (target.id === state.currentTarget.id) {
    styleLayer(layer, styles.highlight);
    markTargetCompleted(true);
    updateInfo();
    return;
  }

  state.attemptsLeft -= 1;
  updateInfo();
  styleLayer(layer, styles.error);
  setTargetStatus(`Špatně. Zbývá ${state.attemptsLeft} pokusů.`, 'error');

  setTimeout(() => {
    if (!state.answered) {
      clearSelectionStyles(layer);
    }
  }, 650);

  if (state.attemptsLeft <= 0) {
    const correctLayer = findLayerByTargetId(state.currentTarget.id);
    if (correctLayer) {
      blinkLayer(correctLayer, 4);
    }
    markTargetCompleted(false);
    updateInfo();
  }
}

function findLayerByTargetId(targetId) {
  if (!state.activeLayerGroup) return null;
  let found = null;
  state.activeLayerGroup.eachLayer((layer) => {
    if (layer.targetId === targetId) {
      found = layer;
    }
  });
  return found;
}

function blinkLayer(layer, count) {
  if (!layer) return;
  let step = 0;
  const interval = setInterval(() => {
    layer.setStyle(step % 2 === 0 ? styles.error : styles[state.currentLevel]);
    step += 1;
    if (step >= count * 2) {
      clearInterval(interval);
      layer.setStyle(styles.error);
    }
  }, 280);
}

function attachUiEvents() {
  ui.scopeSelect.addEventListener('change', () => {
    updateScopeAndLevelOptions();
    renderMap();
  });

  ui.levelSelect.addEventListener('change', () => {
    state.currentLevel = ui.levelSelect.value;
    updateScopeAndLevelOptions();
    renderMap();
  });

  ui.krajSelect.addEventListener('change', () => {
    state.selectedKraj = ui.krajSelect.value;
    updateOkresOptions();
    renderMap();
  });

  ui.okresSelect.addEventListener('change', () => {
    state.selectedOkres = ui.okresSelect.value;
    renderMap();
  });

  ui.newGameButton.addEventListener('click', startNewGame);
  ui.nextButton.addEventListener('click', () => {
    chooseNextTarget();
    updateInfo();
  });
  ui.resetButton.addEventListener('click', resetGame);
}

function initializeMap() {
  state.map = L.map('map', {
    center: [49.8, 15.5],
    zoom: 7,
    zoomControl: true,
    attributionControl: false
  });

  state.map.on('click', () => {
    if (!state.currentTarget) {
      showFeedback('Spusťte novou hru a klikněte na polygon.', 'default');
    }
  });
}

function setInitialText() {
  showFeedback('Načítání dat…');
  updateInfo();
}

function initializeApp() {
  setInitialText();
  initializeMap();
  attachUiEvents();

  Promise.all([
    safeFetchJson(CONFIG.hierarchyPath),
    safeFetchJson(CONFIG.geoPaths.kraje),
    safeFetchJson(CONFIG.geoPaths.okresy),
    safeFetchJson(CONFIG.geoPaths.orp)
  ])
    .then(([hierarchyJson, krajeGeo, okresyGeo, orpGeo]) => {
      loadHierarchy(hierarchyJson);
      buildTargetLists();
      loadGeoJsonFeatures('kraje', krajeGeo);
      loadGeoJsonFeatures('okresy', okresyGeo);
      loadGeoJsonFeatures('orp', orpGeo);
      updateKrajOptions();
      updateOkresOptions();
      updateScopeAndLevelOptions();
      renderMap();
      showFeedback('Data načtena. Zvolte nastavení a spusťte hru.');
    })
    .catch((error) => {
      showFeedback(`Chyba: ${error.message}`, 'error');
      console.error(error);
    });
}

window.addEventListener('DOMContentLoaded', initializeApp);
