const DATASETS = {
  "5": { label: "5 / bin", shortLabel: "5bin", file: "data/zh/zh_sample_400_5_per_bin.json" },
  "10": { label: "10 / bin", shortLabel: "10bin", file: "data/zh/zh_sample_800_10_per_bin.json" },
};
const REFERENCE_FILE = "data/zh/human_references.json";

const CRITERIA = [
  { key: "task_success", label: "Task", rubric: "Correct and useful." },
  { key: "factual_grounding", label: "Grounding", rubric: "Supported by context/reference." },
  { key: "instruction_following", label: "Follow", rubric: "Follows prompt and language." },
  { key: "reference_alignment", label: "Align", rubric: "Matches expected answer." },
  { key: "response_quality", label: "Quality", rubric: "Clear, natural, right length." },
];

const MODEL_ORDER = ["Qwen2.5-1.5B", "Gemma2-2B", "Qwen2.5-3B", "Llama3.2-3B"];
const VARIANT_ORDER = ["baselm", "full-sft", "bucket-sft", "dpo", "hdpo"];
const STORAGE_KEY = "polyalign.humanEval.rowAnnotations.v2";
const DATASET_KEY = "polyalign.humanEval.dataset";
const ANNOTATOR_KEY = "polyalign.humanEval.annotator";
const BLIND_KEY = "polyalign.humanEval.blindMode";
const FILE_PROMPT_KEY = "polyalign.humanEval.filePromptSeen";

const state = {
  datasetKey: normalizeDatasetKey(localStorage.getItem(DATASET_KEY)),
  rows: [],
  rowCache: {},
  refs: {},
  activeIndex: 0,
  annotations: normalizeAnnotations(readJson(STORAGE_KEY, {})),
  annotator: localStorage.getItem(ANNOTATOR_KEY) || "",
  blindMode: localStorage.getItem(BLIND_KEY) !== "false",
  sidebarOpen: true,
  primaryScoringDataset: null,
  loadToken: 0,
  jsonHandles: { "5": null, "10": null },
  fileReady: false,
};

const els = {
  app: document.getElementById("app"),
  content: document.getElementById("content"),
  questionNav: document.getElementById("questionNav"),
  criteriaGuide: document.getElementById("criteriaGuide"),
  overallProgress: document.getElementById("overallProgress"),
  saveState: document.getElementById("saveState"),
  annotatorName: document.getElementById("annotatorName"),
  blindMode: document.getElementById("blindMode"),
  datasetButtons: [...document.querySelectorAll("[data-dataset]")],
  sidebarToggle: document.getElementById("sidebarToggle"),
  filePrompt: document.getElementById("filePrompt"),
  setupFiles: document.getElementById("setupFiles"),
  skipFiles: document.getElementById("skipFiles"),
  readerOverlay: document.getElementById("readerOverlay"),
  readerTitle: document.getElementById("readerTitle"),
  readerKind: document.getElementById("readerKind"),
  readerBody: document.getElementById("readerBody"),
  readerClose: document.getElementById("readerClose"),
};

init();

function init() {
  els.criteriaGuide.innerHTML = CRITERIA.map((item) => `
    <div class="criterion-card"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.rubric)}</span></div>
  `).join("");

  els.annotatorName.value = state.annotator;
  els.blindMode.checked = state.blindMode;

  els.annotatorName.addEventListener("input", (event) => {
    state.annotator = event.target.value.trim();
    localStorage.setItem(ANNOTATOR_KEY, state.annotator);
    saveLocal();
  });

  els.blindMode.addEventListener("change", (event) => {
    state.blindMode = event.target.checked;
    localStorage.setItem(BLIND_KEY, String(state.blindMode));
    render();
  });

  els.sidebarToggle.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    els.app.classList.toggle("sidebar-collapsed", !state.sidebarOpen);
    els.sidebarToggle.textContent = state.sidebarOpen ? "Hide" : "Show";
  });

  els.datasetButtons.forEach((button) => {
    button.addEventListener("click", () => switchDataset(button.dataset.dataset));
  });

  els.questionNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-row-index]");
    if (!button) return;
    state.activeIndex = Number(button.dataset.rowIndex);
    render();
  });

  els.content.addEventListener("click", handleContentClick);
  els.content.addEventListener("keydown", handleContentKeydown);
  els.content.addEventListener("input", handleContentInput);
  els.content.addEventListener("change", handleContentChange);
  els.setupFiles.addEventListener("click", setupCurrentFile);
  els.skipFiles.addEventListener("click", () => closeFilePrompt(true));
  els.readerClose.addEventListener("click", closeReader);
  els.readerOverlay.addEventListener("click", (event) => {
    if (event.target === els.readerOverlay) closeReader();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.readerOverlay.hidden) closeReader();
  });

  if (localStorage.getItem(FILE_PROMPT_KEY) === "true") closeFilePrompt(false);
  loadDataset(state.datasetKey);
}

async function loadDataset(datasetKey) {
  const nextKey = normalizeDatasetKey(datasetKey);
  const token = state.loadToken + 1;
  state.loadToken = token;
  state.datasetKey = nextKey;
  state.activeIndex = 0;
  state.rows = [];
  localStorage.setItem(DATASET_KEY, nextKey);
  updateDatasetButtons();
  setStatus("Loading", false);
  els.content.innerHTML = `<div class="loading">Loading ${escapeHtml(DATASETS[nextKey].label)}...</div>`;
  els.questionNav.innerHTML = "";
  els.overallProgress.innerHTML = "";

  try {
    const [response, refResponse] = await Promise.all([
      fetch(DATASETS[nextKey].file),
      fetch(REFERENCE_FILE),
    ]);
    if (token !== state.loadToken) return;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const rows = await response.json();
    state.refs = refResponse.ok ? await refResponse.json() : {};
    if (token !== state.loadToken) return;
    state.rows = Array.isArray(rows) ? rows.map((row, index) => ({ ...row, __index: index })) : [];
    state.rowCache[nextKey] = state.rows;
    render();
    setStatus("Ready");
  } catch (error) {
    if (token !== state.loadToken) return;
    els.content.innerHTML = `<div class="empty-state"><h2>Data load failed</h2><p>${escapeHtml(error.message)}</p></div>`;
    setStatus("Load failed", false);
  }
}

function switchDataset(datasetKey) {
  const nextKey = normalizeDatasetKey(datasetKey);
  if (nextKey !== state.datasetKey) loadDataset(nextKey);
}

function render() {
  renderProgress();
  renderNav();
  renderContent();
  updateDatasetButtons();
}

function renderProgress() {
  const summary = getSummary();
  const pct = summary.total ? Math.round((summary.marked / summary.total) * 100) : 0;
  els.overallProgress.innerHTML = `
    <div class="progress-card">
      <strong>${summary.marked}/${summary.total}</strong>
      <span>marked answers</span>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>
  `;
}

function renderNav() {
  els.questionNav.innerHTML = state.rows.map((row, index) => {
    const marked = isMarked(rowKey(row));
    const label = `Answer ${index + 1}, ${marked ? "marked" : "not marked"}`;
    return `
      <button class="bubble ${marked ? "marked" : "unmarked"} ${index === state.activeIndex ? "active" : ""}"
        type="button" data-row-index="${index}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">
        ${index + 1}
      </button>
    `;
  }).join("");
}

function renderContent() {
  const row = activeRow();
  if (!row) {
    els.content.innerHTML = `<div class="empty-state"><h2>No rows</h2><p>Select a dataset.</p></div>`;
    return;
  }

  const peers = peerRows(row);
  els.content.innerHTML = `
    <section class="eval-page">
      <header class="sample-header">
        <div>
          <p class="eyebrow">Answer ${state.activeIndex + 1} of ${state.rows.length}</p>
          <h2>${escapeHtml(row.question || row.id)}</h2>
          <div class="meta-row">
            <span class="pill">${escapeHtml(row.length_bin_canonical || row.length_bin || "length")}</span>
            <span class="pill soft">${escapeHtml(row.family || "task")}</span>
            <span class="pill soft">${escapeHtml(row.dataset || "dataset")}</span>
            <span class="pill soft">${escapeHtml(state.blindMode ? blindModelLabel(row) : row.main_model)}</span>
          </div>
        </div>
        <div class="sample-actions">
          <button class="plain-button" type="button" data-action="prev-row">Prev</button>
          <button class="plain-button" type="button" data-action="next-row">Next</button>
          <button class="plain-button" type="button" data-action="next-unmarked">Next red</button>
        </div>
      </header>

      <div class="source-block">
        <div class="context-box">
          <span class="block-label">Context</span>
          <p class="context-text" dir="auto">${formatText(row.context || "No context provided.")}</p>
        </div>
      </div>

      <div class="answer-stage">
        ${renderReferenceCard(row)}
        ${peers.map((peer) => renderVariantCard(row, peer)).join("")}
      </div>

      ${renderScorePanel(row)}
    </section>
  `;
}

function renderReferenceCard(row) {
  const reference = state.refs[row.id] || {};
  const text = row.reference_output?.trim()
    || reference.human_answer?.trim()
    || "No reference output in this file. Use the prompt and context as the human reference.";
  return `
    <article class="read-card reference-card" tabindex="0" data-reader-kind="Human / Reference" data-reader-title="Human / Reference" data-reader-text="${escapeAttr(text)}">
      <div class="read-card-head"><strong>Human / Reference</strong><span>baseline</span></div>
      <p dir="auto">${formatText(text)}</p>
    </article>
  `;
}

function renderVariantCard(active, row) {
  const activeKey = rowKey(active);
  const key = rowKey(row);
  const isActive = key === activeKey;
  const label = state.blindMode ? variantBlindLabel(active, row) : formatVariant(row.variant);
  const sub = state.blindMode ? "model output" : row.prediction_model_name;
  const text = row.prediction || "[empty response]";
  return `
    <article class="read-card variant-card ${isActive ? "selected" : ""}" role="button" tabindex="0"
      data-answer-key="${escapeAttr(key)}" data-reader-kind="${escapeAttr(sub || "Model output")}"
      data-reader-title="${escapeAttr(label)}" data-reader-text="${escapeAttr(text)}">
      <span class="read-card-head"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(sub || "")}</span></span>
      <span class="prediction-text" dir="auto">${formatText(text)}</span>
    </article>
  `;
}

function renderScorePanel(row) {
  const key = rowKey(row);
  const annotation = getAnnotation(key);
  const scores = annotation.scores || {};
  const complete = hasAllScores(annotation);
  const marked = isMarked(key);
  return `
    <section class="score-panel">
      <div class="score-head">
        <div>
          <p class="eyebrow">${marked ? "Marked" : "Not marked"}</p>
          <h3>Score this answer</h3>
        </div>
        <span class="pill ${marked ? "" : "red"}">${marked ? "green" : "red"}</span>
      </div>
      <div class="score-rows">
        ${CRITERIA.map((criterion) => renderScoreRow(criterion, scores[criterion.key])).join("")}
      </div>
      <textarea class="note-input" data-field="note" placeholder="Optional note">${escapeHtml(annotation.note || "")}</textarea>
      <label class="safety-row"><input type="checkbox" data-field="safetyConcern" ${annotation.safetyConcern ? "checked" : ""} /> Safety issue</label>
      <div class="panel-actions">
        <button class="plain-button primary" type="button" data-action="confirm-score">${complete ? "Confirm score" : "Score all criteria"}</button>
        <button class="plain-button" type="button" data-action="clear-score">Clear</button>
        <button class="plain-button" type="button" data-action="setup-current-file">File for ${escapeHtml(DATASETS[state.datasetKey].shortLabel)}</button>
        <button class="plain-button" type="button" data-action="download-5-json">Download 5bin</button>
        <button class="plain-button" type="button" data-action="download-10-json">Download 10bin</button>
      </div>
      <p class="small-note">Marked means all five scores are selected and confirmed.</p>
    </section>
  `;
}

function renderScoreRow(criterion, selected) {
  return `
    <div class="score-row">
      <div class="score-label"><strong>${escapeHtml(criterion.label)}</strong><span>${escapeHtml(criterion.rubric)}</span></div>
      <div class="score-buttons">
        ${[1, 2, 3, 4, 5].map((value) => `
          <button class="score-button ${selected === value ? "active" : ""}" type="button"
            data-score-key="${escapeAttr(criterion.key)}" data-score-value="${value}">${value}</button>
        `).join("")}
      </div>
    </div>
  `;
}

function handleContentClick(event) {
  const readerCard = event.target.closest("[data-reader-text]");
  if (readerCard) {
    if (window.getSelection()?.toString().trim()) return;
    const answerKey = readerCard.dataset.answerKey;
    if (answerKey) {
      const index = state.rows.findIndex((row) => rowKey(row) === answerKey);
      if (index >= 0) {
        state.activeIndex = index;
        render();
      }
    }
    openReader(readerCard.dataset.readerKind, readerCard.dataset.readerTitle, readerCard.dataset.readerText);
    return;
  }

  const answerCard = event.target.closest("[data-answer-key]");
  if (answerCard) {
    const index = state.rows.findIndex((row) => rowKey(row) === answerCard.dataset.answerKey);
    if (index >= 0) {
      state.activeIndex = index;
      render();
    }
    return;
  }

  const scoreButton = event.target.closest("[data-score-key]");
  if (scoreButton) {
    setScore(scoreButton.dataset.scoreKey, Number(scoreButton.dataset.scoreValue));
    render();
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === "prev-row") moveActive(-1);
  if (action === "next-row") moveActive(1);
  if (action === "next-unmarked") nextUnmarked();
  if (action === "confirm-score") confirmScore();
  if (action === "clear-score") clearScore();
  if (action === "setup-current-file") setupCurrentFile();
  if (action === "download-5-json") downloadJsonSnapshot("5");
  if (action === "download-10-json") downloadJsonSnapshot("10");
}

function handleContentKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const readerCard = event.target.closest("[data-reader-text]");
  if (!readerCard) return;
  event.preventDefault();
  readerCard.click();
}

function handleContentInput(event) {
  if (event.target.matches("[data-field='note']")) updateAnnotation({ note: event.target.value });
}

function handleContentChange(event) {
  if (event.target.matches("[data-field='safetyConcern']")) {
    updateAnnotation({ safetyConcern: event.target.checked });
    render();
  }
}

function setScore(scoreKey, value) {
  const key = rowKey(activeRow());
  const annotation = getAnnotation(key);
  annotation.scores = { ...(annotation.scores || {}), [scoreKey]: value };
  annotation.confirmedAt = null;
  setAnnotation(key, annotation);
}

function updateAnnotation(patch) {
  const key = rowKey(activeRow());
  const annotation = getAnnotation(key);
  setAnnotation(key, { ...annotation, ...patch });
}

async function confirmScore() {
  const row = activeRow();
  const key = rowKey(row);
  const annotation = getAnnotation(key);
  if (!hasAllScores(annotation)) {
    alert("Select all five scores first.");
    return;
  }
  if (state.primaryScoringDataset && state.primaryScoringDataset !== state.datasetKey) {
    const primary = DATASETS[state.primaryScoringDataset].label;
    const current = DATASETS[state.datasetKey].label;
    const ok = confirm(`You already confirmed scores in ${primary}. Scoring ${current} too will keep both sets separate. Continue?`);
    if (!ok) return;
  }
  state.primaryScoringDataset = state.primaryScoringDataset || state.datasetKey;
  setAnnotation(key, { ...annotation, confirmedAt: new Date().toISOString() });
  render();
  await writeLiveFile(state.datasetKey);
  setStatus("Confirmed");
}

function clearScore() {
  delete currentAnnotations()[rowKey(activeRow())];
  saveLocal();
  render();
}

function moveActive(delta) {
  state.activeIndex = clamp(state.activeIndex + delta, 0, state.rows.length - 1);
  render();
}

function nextUnmarked() {
  if (!state.rows.length) return;
  for (let offset = 1; offset <= state.rows.length; offset += 1) {
    const index = (state.activeIndex + offset) % state.rows.length;
    if (!isMarked(rowKey(state.rows[index]))) {
      state.activeIndex = index;
      render();
      return;
    }
  }
}

async function setupCurrentFile() {
  closeFilePrompt(true);
  if (!("showSaveFilePicker" in window)) {
    await downloadJsonSnapshot(state.datasetKey);
    alert("Live file updates are not supported in this browser. A JSON snapshot was downloaded instead.");
    return;
  }

  try {
    const datasetKey = state.datasetKey;
    state.jsonHandles[datasetKey] = await window.showSaveFilePicker({
      suggestedName: `${exportBaseName(datasetKey)}.json`,
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
    });
    state.fileReady = true;
    await writeLiveFile(datasetKey);
    setStatus(`${DATASETS[datasetKey].shortLabel} file ready`);
  } catch {
    setStatus("Files skipped", false);
  }
}

function closeFilePrompt(remember) {
  els.filePrompt.hidden = true;
  if (remember) localStorage.setItem(FILE_PROMPT_KEY, "true");
}

function openReader(kind, title, text) {
  els.readerKind.textContent = kind || "Reading";
  els.readerTitle.textContent = title || "Answer";
  els.readerBody.textContent = text || "";
  els.readerOverlay.hidden = false;
  els.readerClose.focus();
}

function closeReader() {
  els.readerOverlay.hidden = true;
}

async function writeLiveFile(datasetKey) {
  if (!state.fileReady || !state.jsonHandles[datasetKey]) return;
  const payload = await buildExportPayloadForDataset(datasetKey);
  await writeHandle(state.jsonHandles[datasetKey], JSON.stringify(payload, null, 2));
}

async function writeHandle(handle, content) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function downloadJsonSnapshot(datasetKey) {
  const payload = await buildExportPayloadForDataset(datasetKey);
  downloadFile(`${exportBaseName(datasetKey)}.json`, JSON.stringify(payload, null, 2), "application/json");
}

async function buildExportPayloadForDataset(datasetKey) {
  await ensureRefs();
  const rows = await getRowsForDataset(datasetKey);
  return buildExportPayload(datasetKey, rows);
}

async function ensureRefs() {
  if (Object.keys(state.refs).length) return;
  const response = await fetch(REFERENCE_FILE);
  state.refs = response.ok ? await response.json() : {};
}

async function getRowsForDataset(datasetKey) {
  if (state.rowCache[datasetKey]) return state.rowCache[datasetKey];
  const response = await fetch(DATASETS[datasetKey].file);
  if (!response.ok) throw new Error(`Could not load ${DATASETS[datasetKey].label}`);
  const rows = await response.json();
  state.rowCache[datasetKey] = Array.isArray(rows) ? rows.map((row, index) => ({ ...row, __index: index })) : [];
  return state.rowCache[datasetKey];
}

function buildExportPayload(datasetKey = state.datasetKey, rows = state.rows) {
  const annotations = annotationsFor(datasetKey);
  return {
    schema_version: "polyalign_human_eval_v2",
    exported_at: new Date().toISOString(),
    annotator: state.annotator,
    dataset: { key: datasetKey, label: DATASETS[datasetKey].label, file: DATASETS[datasetKey].file },
    marked: getSummaryForRows(datasetKey, rows),
    criteria: CRITERIA,
    annotations: rows.map((row, index) => {
      const key = rowKey(row, datasetKey);
      const annotation = annotations[key] || {};
      return {
        answer_key: key,
        answer_number: index + 1,
        marked: isMarked(key, datasetKey),
        confirmed_at: annotation.confirmedAt || null,
        sample_set: row.sample_set || "",
        row_sample_question_number: row.sample_question_number || null,
        prompt_id: row.id || "",
        dataset: row.dataset || "",
        split: row.split || "",
        track: row.track || "",
        family: row.family || "",
        style_bucket: row.style_bucket || "",
        length_bin: row.length_bin_canonical || row.length_bin || "",
        bucket_id: row.bucket_id || "",
        question: row.question || "",
        human_answer: state.refs[row.id]?.human_answer || row.reference_output || "",
        main_model: row.main_model || "",
        variant: row.variant || "",
        prediction_model_name: row.prediction_model_name || "",
        prediction_file: row.prediction_file || "",
        scores: CRITERIA.reduce((scores, criterion) => {
          scores[criterion.key] = Number.isInteger(annotation.scores?.[criterion.key]) ? annotation.scores[criterion.key] : null;
          return scores;
        }, {}),
        safety_concern: Boolean(annotation.safetyConcern),
        notes: annotation.note || "",
      };
    }),
  };
}

function peerRows(row) {
  return state.rows
    .filter((candidate) => candidate.id === row.id && candidate.main_model === row.main_model)
    .sort(compareRows);
}

function compareRows(a, b) {
  return rank(VARIANT_ORDER, a.variant) - rank(VARIANT_ORDER, b.variant)
    || rank(MODEL_ORDER, a.main_model) - rank(MODEL_ORDER, b.main_model)
    || Number(a.sample_question_number || 0) - Number(b.sample_question_number || 0);
}

function variantBlindLabel(active, row) {
  const peers = peerRows(active);
  const index = peers.findIndex((candidate) => rowKey(candidate) === rowKey(row));
  return `Answer ${String.fromCharCode(65 + Math.max(0, index))}`;
}

function blindModelLabel(row) {
  const modelIndex = MODEL_ORDER.indexOf(row.main_model);
  return `Model ${modelIndex >= 0 ? modelIndex + 1 : ""}`.trim();
}

function activeRow() {
  return state.rows[state.activeIndex];
}

function rowKey(row, datasetKey = state.datasetKey) {
  if (!row) return "";
  return [
    datasetKey,
    row.sample_question_number,
    row.id,
    row.main_model,
    row.variant,
    row.prediction_model_name || row.prediction_file || "",
  ].join("::");
}

function getSummary() {
  return getSummaryForRows(state.datasetKey, state.rows);
}

function getSummaryForRows(datasetKey, rows) {
  const total = rows.length;
  const marked = rows.filter((row) => isMarked(rowKey(row, datasetKey), datasetKey)).length;
  return { marked, total, unmarked: total - marked };
}

function isMarked(key, datasetKey = state.datasetKey) {
  const annotation = annotationsFor(datasetKey)[key];
  return Boolean(annotation?.confirmedAt) && hasAllScores(annotation);
}

function hasAllScores(annotation) {
  return CRITERIA.every((criterion) => {
    const value = annotation?.scores?.[criterion.key];
    return Number.isInteger(value) && value >= 1 && value <= 5;
  });
}

function getAnnotation(key) {
  return { ...(currentAnnotations()[key] || {}), scores: { ...((currentAnnotations()[key] || {}).scores || {}) } };
}

function setAnnotation(key, annotation) {
  currentAnnotations()[key] = { ...annotation, updatedAt: new Date().toISOString() };
  saveLocal();
}

function currentAnnotations() {
  return annotationsFor(state.datasetKey);
}

function annotationsFor(datasetKey) {
  state.annotations[datasetKey] = state.annotations[datasetKey] || {};
  return state.annotations[datasetKey];
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.annotations));
    setStatus("Saved");
  } catch {
    setStatus("Not saved", false);
  }
}

function setStatus(text, settle = true) {
  els.saveState.textContent = text;
  clearTimeout(setStatus.timer);
  if (settle) setStatus.timer = setTimeout(() => { els.saveState.textContent = state.fileReady ? "Live JSON" : "Local save"; }, 700);
}

function updateDatasetButtons() {
  els.datasetButtons.forEach((button) => button.classList.toggle("active", button.dataset.dataset === state.datasetKey));
}

function normalizeDatasetKey(value) {
  return DATASETS[value] ? value : "5";
}

function normalizeAnnotations(value) {
  return isPlainObject(value) ? value : {};
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatVariant(value) {
  return String(value || "answer").split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join("-");
}

function rank(order, value) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function exportBaseName(datasetKey = state.datasetKey) {
  return `polyalign_zh_human_eval_${DATASETS[datasetKey].shortLabel}`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatText(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
