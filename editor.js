/* =====================================================
   Editor Layout XML - Editor.js (v estable + Fuente UI)
   ===================================================== */

const MM_TO_PX = 3.78;
const GRID_MM = 1;
const GRID_PX = GRID_MM * MM_TO_PX;
const MAX_HISTORY = 20;

let xmlDoc = null;
let printPreview = false;

let sessionVariables = new Set();

let selectedIds = new Set();
let dragActive = false;
let dragOrigin = null;

let clipboard = []; // [{type:'node'|'block', data:...}]
let editingTextBlock = false;
let textBlocks = []; // solo UI, se exportan a txtOut al guardar

const undoStack = [];
const redoStack = [];

/* ===================== DOM ===================== */
const canvas = document.getElementById("canvas");
const canvasWrap = document.getElementById("canvasWrap");

const xmlInput = document.getElementById("xmlInput");
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");
const saveBtn = document.getElementById("save");
const togglePrintBtn = document.getElementById("toggle-print");

const addTextBtn = document.getElementById("add-text");
const addTextBlockBtn = document.getElementById("add-text-block");

const copyBtn = document.getElementById("copy");
const pasteBtn = document.getElementById("paste");
const lockBtn = document.getElementById("lock");
const unlockBtn = document.getElementById("unlock");
const frontBtn = document.getElementById("front");
const backBtn = document.getElementById("back");

const propX = document.getElementById("prop-x");
const propY = document.getElementById("prop-y");
const layoutWidthInput = document.getElementById("layout-width");
const layoutHeightInput = document.getElementById("layout-height");

const varGroup = document.getElementById("var-group");
const varSearch = document.getElementById("var-search");
const varList = document.getElementById("var-list");

const rulerTop = document.getElementById("ruler-top");
const rulerLeft = document.getElementById("ruler-left");

/* ===== Fuente (UI) ===== */
const fontFamily = document.getElementById("font-family");
const fontSize = document.getElementById("font-size");
const fontBold = document.getElementById("font-bold");
const fontItalic = document.getElementById("font-italic");
const fontUnderline = document.getElementById("font-underline");
const fontAlign = document.getElementById("font-align");

/* ===================== Helpers ===================== */
const mmToPx = (mm) => Number(mm) * MM_TO_PX;
const pxToMm = (px) => Math.round(parseFloat(px) / MM_TO_PX);

const ensureEid = (node) => {
  let id = node.getAttribute("eid");
  if (!id) {
    id = crypto?.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random();
    node.setAttribute("eid", id);
  }
  return id;
};

const isLockedNode = (node) => node.getAttribute("locked") === "1";
const isStaticText = (node) => node.getAttribute("type") === "1";

const isBlockId = (id) => typeof id === "string" && id.startsWith("block-");

function generateBlockId() {
  return (
    "block-" +
    (crypto?.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random())
  );
}

function getBlockById(id) {
  return textBlocks.find((b) => b.id === id) || null;
}

function getVariablesFromXml() {
  if (!xmlDoc) return [];

  const vars = new Set();

  xmlDoc.querySelectorAll("txtOut").forEach((n) => {
    const type = n.getAttribute("type");
    const name = n.getAttribute("fieldName");

    if (type !== "1" && name) {
      vars.add(name);
    }
  });

  return Array.from(vars).sort();
}

/* ===================== State (Undo/Redo) ===================== */
function serializeState() {
  return JSON.stringify({
    xml: xmlDoc ? new XMLSerializer().serializeToString(xmlDoc) : "",
    blocks: textBlocks,
  });
}

function restoreState(stateStr) {
  const st = JSON.parse(stateStr || "{}");
  xmlDoc = new DOMParser().parseFromString(st.xml || "", "text/xml");
  xmlDoc.querySelectorAll("txtOut").forEach((n) => ensureEid(n));
  textBlocks = Array.isArray(st.blocks) ? st.blocks : [];
}

function pushHistory() {
  if (!xmlDoc) return;
  const s = serializeState();
  if (undoStack.at(-1) === s) return;

  undoStack.push(s);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  updateUndoRedoUI();
}

function updateUndoRedoUI() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

/* ===================== UI Buttons enable/disable ===================== */
function updateButtons() {
  const hasSel = selectedIds.size > 0;

  copyBtn.disabled = !hasSel || printPreview;
  pasteBtn.disabled = clipboard.length === 0 || printPreview;

  lockBtn.disabled = !hasSel || printPreview;
  unlockBtn.disabled = !hasSel || printPreview;
  frontBtn.disabled = !hasSel || printPreview;
  backBtn.disabled = !hasSel || printPreview;

  addTextBtn.disabled = !xmlDoc || printPreview;
  if (addTextBlockBtn) addTextBlockBtn.disabled = !xmlDoc || printPreview;

  // Fuente: solo si hay 1 seleccionado
  const nodes = getSelectedNodes();
  const blocks = getSelectedBlocks();
  const one = nodes.length + blocks.length === 1;
  [
    fontFamily,
    fontSize,
    fontBold,
    fontItalic,
    fontUnderline,
    fontAlign,
  ].forEach((c) => {
    if (!c) return;
    c.disabled = !one || printPreview;
  });
}

/* ===================== Selection helpers ===================== */
function clearSelection() {
  selectedIds.clear();
  propX.value = "";
  propY.value = "";
  canvas
    .querySelectorAll(".element,.text-block")
    .forEach((el) => el.classList.remove("selected"));
  syncFontUIFromSelection(); // limpia fuente también
  updateButtons();
}

function getSelectedNodes() {
  const map = new Map();
  xmlDoc
    ?.querySelectorAll("txtOut")
    .forEach((n) => map.set(n.getAttribute("eid"), n));
  return Array.from(selectedIds)
    .filter((id) => !isBlockId(id))
    .map((id) => map.get(id))
    .filter(Boolean);
}

function getSelectedBlocks() {
  return Array.from(selectedIds)
    .filter((id) => isBlockId(id))
    .map((id) => getBlockById(id))
    .filter(Boolean);
}
/* ===================== Variables panel ===================== */
function initVariablesPanel() {
  // ya no hay grupos externos
  varGroup.innerHTML = "";
  varGroup.disabled = true; // queda visualmente deshabilitado

  varSearch.addEventListener("input", renderVarList);
}

function renderVarList() {
  varList.innerHTML = "";

  const filter = (varSearch.value || "").toLowerCase();
  const vars = Array.from(sessionVariables).sort();

  vars
    .filter((v) => v.toLowerCase().includes(filter))
    .forEach((v) => {
      const li = document.createElement("li");
      li.textContent = v;
      li.addEventListener("click", () => addVariableToLayout(v));
      varList.appendChild(li);
    });

  // sugerencia crear
  if (filter && !vars.some((v) => v.toLowerCase() === filter)) {
    const li = document.createElement("li");
    li.className = "create-var";
    li.textContent = `➕ Agregar variable "${filter}"`;
    li.addEventListener("click", () => {
      addVariableToSession(filter);
      varSearch.value = "";
    });
    varList.appendChild(li);
  }
}

function addVariableToLayout(name) {
  if (!xmlDoc || printPreview) return;

  // si no existe en sesión, la agregamos
  sessionVariables.add(name);

  pushHistory();

  const node = xmlDoc.createElement("txtOut");
  node.setAttribute("fieldName", name);
  node.setAttribute("type", "0");
  node.setAttribute("x", "10");
  node.setAttribute("y", "10");
  ensureEid(node);

  const font = xmlDoc.createElement("font");
  font.setAttribute("name", "Arial");
  font.setAttribute("size", "10");
  font.setAttribute("bold", "1");
  font.setAttribute("italic", "0");
  font.setAttribute("underline", "0");
  font.setAttribute("strikethrough", "0");
  font.setAttribute("align", "left");
  node.appendChild(font);

  xmlDoc.querySelector("data")?.appendChild(node);

  selectedIds.clear();
  selectedIds.add(node.getAttribute("eid"));
  render();
}

function syncSessionVariablesFromXml() {
  sessionVariables.clear();
  getVariablesFromXml().forEach((v) => sessionVariables.add(v));
}

function addVariableToSession(name) {
  const v = name.trim();
  if (!v) return;

  sessionVariables.add(v);
  renderVarList();
}

/* ===================== Load XML ===================== */
xmlInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const r = new FileReader();
  r.onload = () => {
    xmlDoc = new DOMParser().parseFromString(r.result, "text/xml");
    xmlDoc.querySelectorAll("txtOut").forEach((n) => ensureEid(n));

    syncSessionVariablesFromXml(); // 👈 NUEVO

    undoStack.length = 0;
    redoStack.length = 0;
    selectedIds.clear();
    textBlocks = [];
    clipboard = [];
    updateUndoRedoUI();

    loadLayoutSizeFromXml();
    render();
    renderVarList(); // 🔹 refresca variables desde el XML
  };
  r.readAsText(file);
});

/* ===================== Layout size ===================== */
function loadLayoutSizeFromXml() {
  const size = xmlDoc?.querySelector("size");
  if (!size) return;

  const w = parseInt(size.getAttribute("cx") || "210", 10);
  const h = parseInt(size.getAttribute("cy") || "297", 10);

  layoutWidthInput.value = w;
  layoutHeightInput.value = h;

  canvas.style.width = mmToPx(w) + "px";
  canvas.style.height = mmToPx(h) + "px";

  buildRulers(w, h);
}

function applyLayoutSizeToXml() {
  if (!xmlDoc || printPreview) return;
  const size = xmlDoc.querySelector("size");
  if (!size) return;

  const w = parseInt(layoutWidthInput.value || "210", 10);
  const h = parseInt(layoutHeightInput.value || "297", 10);

  pushHistory();
  size.setAttribute("cx", String(w));
  size.setAttribute("cy", String(h));

  canvas.style.width = mmToPx(w) + "px";
  canvas.style.height = mmToPx(h) + "px";

  buildRulers(w, h);
}

layoutWidthInput.addEventListener("change", applyLayoutSizeToXml);
layoutHeightInput.addEventListener("change", applyLayoutSizeToXml);

/* ===================== RULERS ===================== */
function buildRulers(wMm, hMm) {
  rulerTop.innerHTML = "";
  rulerLeft.innerHTML = "";

  rulerTop.style.width = mmToPx(wMm) + "px";
  rulerLeft.style.height = mmToPx(hMm) + "px";

  for (let mm = 0; mm <= wMm; mm++) {
    const x = mmToPx(mm);

    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = x + "px";
    tick.style.height = mm % 10 === 0 ? "12px" : mm % 5 === 0 ? "8px" : "5px";
    rulerTop.appendChild(tick);

    if (mm % 10 === 0) {
      const num = document.createElement("div");
      num.className = "num";
      num.style.left = x + 2 + "px";
      num.style.top = "2px";
      num.textContent = mm;
      rulerTop.appendChild(num);
    }
  }

  for (let mm = 0; mm <= hMm; mm++) {
    const y = mmToPx(mm);

    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.top = y + "px";
    tick.style.width = mm % 10 === 0 ? "12px" : mm % 5 === 0 ? "8px" : "5px";
    rulerLeft.appendChild(tick);

    if (mm % 10 === 0) {
      const num = document.createElement("div");
      num.className = "num";
      num.style.left = "2px";
      num.style.top = y + 2 + "px";
      num.textContent = mm;
      rulerLeft.appendChild(num);
    }
  }
}
/* ===================== GUIDES ===================== */
function createGuide(type, posPx) {
  const g = document.createElement("div");
  g.className = "guide " + (type === "h" ? "h" : "v");
  g.dataset.type = type;

  if (type === "h") g.style.top = posPx + "px";
  else g.style.left = posPx + "px";

  g.addEventListener("mousedown", (e) => {
    if (printPreview) return;
    e.stopPropagation();

    const startClient = type === "h" ? e.clientY : e.clientX;
    const startPos =
      type === "h" ? parseFloat(g.style.top) : parseFloat(g.style.left);

    const move = (ev) => {
      const delta = (type === "h" ? ev.clientY : ev.clientX) - startClient;
      const newPos = startPos + delta;
      if (type === "h") g.style.top = newPos + "px";
      else g.style.left = newPos + "px";
    };

    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });

  g.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (printPreview) return;
    g.remove();
  });

  canvas.appendChild(g);
}

rulerTop.addEventListener("mousedown", (e) => {
  if (printPreview) return;
  createGuide("v", e.offsetX);
});

rulerLeft.addEventListener("mousedown", (e) => {
  if (printPreview) return;
  createGuide("h", e.offsetY);
});

/* ===================== FONT (txtOut) ===================== */
function ensureFontNode(node) {
  let f = node.querySelector("font");
  if (!f) {
    f = xmlDoc.createElement("font");
    f.setAttribute("name", "Arial");
    f.setAttribute("size", "10");
    f.setAttribute("bold", "0");
    f.setAttribute("italic", "0");
    f.setAttribute("underline", "0");
    f.setAttribute("strikethrough", "0");
    f.setAttribute("align", "left");
    node.appendChild(f);
  }
  if (!f.getAttribute("align")) f.setAttribute("align", "left");
  return f;
}

function applyFont(el, node) {
  const f = ensureFontNode(node);

  el.style.fontFamily = f.getAttribute("name") || "Arial";
  el.style.fontSize = (f.getAttribute("size") || "10") + "pt";
  el.style.fontWeight = f.getAttribute("bold") === "1" ? "bold" : "normal";
  el.style.fontStyle = f.getAttribute("italic") === "1" ? "italic" : "normal";
  el.style.textDecoration =
    f.getAttribute("underline") === "1" ? "underline" : "none";
  el.style.textAlign = f.getAttribute("align") || "left";
}

/* ===================== Canvas click clears selection ===================== */
canvas.addEventListener("mousedown", (e) => {
  if (printPreview) return;
  if (e.target === canvas) clearSelection();
});

canvas.addEventListener("dblclick", (e) => {
  if (printPreview) return;

  const blockEl = e.target.closest(".text-block");
  if (!blockEl) return;

  const bid = blockEl.dataset.bid;
  const block = getBlockById(bid);
  if (!block || block.locked) return;

  const originalText = block.text || "";

  const textarea = document.createElement("textarea");
  textarea.className = "tb-editor";
  textarea.value = originalText;

  const elRect = blockEl.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();

  textarea.style.position = "absolute";
  textarea.style.left = elRect.left - canvasRect.left + "px";
  textarea.style.top = elRect.top - canvasRect.top + "px";
  textarea.style.width = elRect.width + "px";
  textarea.style.height = elRect.height + "px";
  textarea.style.fontFamily = blockEl.style.fontFamily;
  textarea.style.fontSize = blockEl.style.fontSize;
  textarea.style.zIndex = "1000";
  textarea.style.resize = "none";
  textarea.style.border = "1px solid #333";
  textarea.style.padding = "4px";
  textarea.style.boxSizing = "border-box";

  canvas.appendChild(textarea);
  textarea.focus();

  const finishEdit = (save) => {
    if (save) {
      block.text = textarea.value;
      pushHistory();
    }
    textarea.remove();
    render();
  };

  textarea.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      finishEdit(false);
    }
    if (ev.key === "Enter" && ev.ctrlKey) {
      ev.preventDefault();
      finishEdit(true);
    }
  });

  textarea.addEventListener("blur", () => {
    finishEdit(true);
  });
});

/* ===================== Snap helpers ===================== */
function collectGuideCandidates() {
  const xs = [];
  const ys = [];
  canvas.querySelectorAll(".guide").forEach((g) => {
    if (g.dataset.type === "v") xs.push(parseFloat(g.style.left || "0"));
    if (g.dataset.type === "h") ys.push(parseFloat(g.style.top || "0"));
  });
  return { xs, ys };
}

function snapToCandidates(value, candidates, thresholdPx = 6) {
  let best = value;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - value);
    if (d < bestDist && d <= thresholdPx) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/* ===================== RENDER ===================== */
function render() {
  if (!xmlDoc || editingTextBlock) return;

  const guides = Array.from(canvas.querySelectorAll(".guide"));
  canvas.innerHTML = "";
  guides.forEach((g) => canvas.appendChild(g));

  xmlDoc.querySelectorAll("txtOut").forEach((node) => {
    const id = ensureEid(node);

    const el = document.createElement("div");
    el.className = "element";
    el.dataset.eid = id;
    el.textContent = node.getAttribute("fieldName") || "";

    el.style.left = mmToPx(parseFloat(node.getAttribute("x") || "0")) + "px";
    el.style.top = mmToPx(parseFloat(node.getAttribute("y") || "0")) + "px";

    if (isLockedNode(node)) el.classList.add("locked");
    if (selectedIds.has(id)) el.classList.add("selected");

    applyFont(el, node);
    attachElementEvents(el, node);

    canvas.appendChild(el);
  });

  textBlocks.forEach((block) => {
    canvas.appendChild(renderTextBlock(block));
  });

  syncSelectionUI(); // esto también actualiza fuente y botones
}
/* ===================== ELEMENT EVENTS (txtOut) ===================== */
varSearch.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;

  const name = varSearch.value.trim();
  if (!name) return;

  addVariableToSession(name);
  addVariableToLayout(name);

  varSearch.value = "";
});

function attachElementEvents(el, node) {
  el.addEventListener("mousedown", (e) => {
    if (printPreview) return;

    e.stopPropagation();

    const id = el.dataset.eid;

    if (e.shiftKey) {
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
    } else {
      if (!selectedIds.has(id) || selectedIds.size > 1) {
        selectedIds.clear();
        selectedIds.add(id);
      }
    }

    syncSelectionUI();

    // Solo iniciar arrastre si no está bloqueado
    if (!isLockedNode(node)) {
      startDragGroup(e);
    }
  });

  el.addEventListener("contextmenu", (e) => {
    if (printPreview) return;
    if (isLockedNode(node)) return;
    e.preventDefault();

    const id = el.dataset.eid;
    if (!selectedIds.has(id)) {
      selectedIds.clear();
      selectedIds.add(id);
      syncSelectionUI();
    }

    const nodes = getSelectedNodes();
    const blocks = getSelectedBlocks();
    if (!confirm(`Eliminar ${nodes.length + blocks.length} elemento(s)?`))
      return;

    pushHistory();
    nodes.forEach((n) => n.remove());
    blocks.forEach((b) => {
      textBlocks = textBlocks.filter((x) => x.id !== b.id);
    });

    clearSelection();
    render();
  });

  el.addEventListener("dblclick", (e) => {
    if (printPreview) return;
    if (isLockedNode(node)) return;
    if (!isStaticText(node)) return;

    e.stopPropagation();

    el.contentEditable = "true";
    el.classList.add("editing");
    el.focus();

    const original = node.getAttribute("fieldName") || "";

    const finish = (save) => {
      el.contentEditable = "false";
      el.classList.remove("editing");

      if (save) {
        pushHistory();
        const txt = (el.textContent || "").trim();
        node.setAttribute("fieldName", txt);
      } else {
        el.textContent = original;
      }
      render();
    };

    el.onkeydown = (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        finish(true);
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    };
    el.onblur = () => finish(true);
  });
}

/* ===================== Selection UI sync ===================== */
function syncSelectionUI() {
  canvas
    .querySelectorAll(".element")
    .forEach((x) =>
      x.classList.toggle("selected", selectedIds.has(x.dataset.eid)),
    );
  canvas
    .querySelectorAll(".text-block")
    .forEach((x) =>
      x.classList.toggle("selected", selectedIds.has(x.dataset.bid)),
    );

  const nodes = getSelectedNodes();
  const blocks = getSelectedBlocks();
  const total = nodes.length + blocks.length;

  if (total === 1) {
    if (nodes.length === 1) {
      propX.value = nodes[0].getAttribute("x") || "";
      propY.value = nodes[0].getAttribute("y") || "";
    } else {
      propX.value = blocks[0].x;
      propY.value = blocks[0].y;
    }
  } else {
    propX.value = "";
    propY.value = "";
  }

  syncFontUIFromSelection();
  updateButtons();
}

/* ===================== Fuente UI sync/apply ===================== */
function syncFontUIFromSelection() {
  if (!fontFamily) return;

  const nodes = getSelectedNodes();
  const blocks = getSelectedBlocks();
  if (nodes.length + blocks.length !== 1) {
    // limpiar UI
    fontFamily.value = "Arial";
    fontSize.value = "";
    fontBold.checked = false;
    fontItalic.checked = false;
    fontUnderline.checked = false;
    fontAlign.value = "left";
    return;
  }

  if (nodes.length === 1) {
    const f = ensureFontNode(nodes[0]);
    fontFamily.value = f.getAttribute("name") || "Arial";
    fontSize.value = f.getAttribute("size") || "10";
    fontBold.checked = f.getAttribute("bold") === "1";
    fontItalic.checked = f.getAttribute("italic") === "1";
    fontUnderline.checked = f.getAttribute("underline") === "1";
    fontAlign.value = f.getAttribute("align") || "left";
  } else {
    const b = blocks[0];
    const bf = b.font || {
      name: "Arial",
      size: 9,
      bold: false,
      italic: false,
      underline: false,
    };
    fontFamily.value = bf.name || "Arial";
    fontSize.value = String(bf.size ?? 9);
    fontBold.checked = !!bf.bold;
    fontItalic.checked = !!bf.italic;
    fontUnderline.checked = !!bf.underline;
    fontAlign.value = b.align || "left";
  }
}

function applyFontFromUI() {
  if (!xmlDoc || printPreview) return;

  const nodes = getSelectedNodes();
  const blocks = getSelectedBlocks();
  if (nodes.length + blocks.length !== 1) return;

  pushHistory();

  const fam = fontFamily.value || "Arial";
  const size = parseInt(fontSize.value || "10", 10);
  const bold = !!fontBold.checked;
  const italic = !!fontItalic.checked;
  const underline = !!fontUnderline.checked;
  const align = fontAlign.value || "left";

  if (nodes.length === 1) {
    const f = ensureFontNode(nodes[0]);
    f.setAttribute("name", fam);
    f.setAttribute("size", String(size));
    f.setAttribute("bold", bold ? "1" : "0");
    f.setAttribute("italic", italic ? "1" : "0");
    f.setAttribute("underline", underline ? "1" : "0");
    f.setAttribute("align", align);
  } else {
    const b = blocks[0];
    b.font = b.font || {};
    b.font.name = fam;
    b.font.size = size;
    b.font.bold = bold;
    b.font.italic = italic;
    b.font.underline = underline;
    b.align = align;
  }

  render();
}

[fontFamily, fontSize, fontBold, fontItalic, fontUnderline, fontAlign].forEach(
  (inp) => {
    if (!inp) return;
    inp.addEventListener("change", applyFontFromUI);
  },
);

/* ===================== DRAG (nodes + blocks) ===================== */
function startDragGroup(e) {
  if (dragActive) return;
  if (printPreview) return;

  const items = [];

  getSelectedNodes().forEach((node) => {
    if (isLockedNode(node)) return;
    const id = node.getAttribute("eid");
    const el = canvas.querySelector(`.element[data-eid="${id}"]`);
    if (!el) return;
    items.push({
      kind: "node",
      node,
      el,
      startLeft: parseFloat(el.style.left || "0"),
      startTop: parseFloat(el.style.top || "0"),
    });
  });

  getSelectedBlocks().forEach((block) => {
    if (block.locked) return;
    const el = canvas.querySelector(`.text-block[data-bid="${block.id}"]`);
    if (!el) return;
    items.push({
      kind: "block",
      block,
      el,
      startLeft: parseFloat(el.style.left || "0"),
      startTop: parseFloat(el.style.top || "0"),
    });
  });

  if (!items.length) return;

  dragActive = true;
  dragOrigin = { mouseX: e.clientX, mouseY: e.clientY, items };

  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}

function onDragMove(ev) {
  if (!dragActive || !dragOrigin) return;

  const dx = ev.clientX - dragOrigin.mouseX;
  const dy = ev.clientY - dragOrigin.mouseY;

  const guideCand = collectGuideCandidates();
  const anchor = dragOrigin.items[0];

  let newLeft = anchor.startLeft + dx;
  let newTop = anchor.startTop + dy;

  newLeft = Math.round(newLeft / GRID_PX) * GRID_PX;
  newTop = Math.round(newTop / GRID_PX) * GRID_PX;

  newLeft = snapToCandidates(newLeft, guideCand.xs, 6);
  newTop = snapToCandidates(newTop, guideCand.ys, 6);

  const sdx = newLeft - anchor.startLeft;
  const sdy = newTop - anchor.startTop;

  dragOrigin.items.forEach((it) => {
    it.el.style.left = it.startLeft + sdx + "px";
    it.el.style.top = it.startTop + sdy + "px";
  });

  syncSelectionUI();
}

function onDragEnd() {
  if (!dragActive || !dragOrigin) return;

  pushHistory();

  dragOrigin.items.forEach((it) => {
    const leftPx = parseFloat(it.el.style.left || "0");
    const topPx = parseFloat(it.el.style.top || "0");
    const xMm = pxToMm(leftPx);
    const yMm = pxToMm(topPx);

    if (it.kind === "node") {
      it.node.setAttribute("x", String(xMm));
      it.node.setAttribute("y", String(yMm));
    } else {
      it.block.x = xMm;
      it.block.y = yMm;
    }
  });

  dragActive = false;
  dragOrigin = null;

  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);

  syncSelectionUI();
}

/* ===================== Props edit X/Y ===================== */
[propX, propY].forEach((inp) => {
  inp.addEventListener("change", () => {
    if (!xmlDoc || printPreview) return;

    const nodes = getSelectedNodes();
    const blocks = getSelectedBlocks();
    if (nodes.length + blocks.length !== 1) return;

    const x = parseInt(propX.value || "0", 10);
    const y = parseInt(propY.value || "0", 10);

    pushHistory();

    if (nodes.length === 1) {
      if (isLockedNode(nodes[0])) return;
      nodes[0].setAttribute("x", String(x));
      nodes[0].setAttribute("y", String(y));
    } else {
      if (blocks[0].locked) return;
      blocks[0].x = x;
      blocks[0].y = y;
    }

    render();
  });
});

/* ===================== TEXT BLOCKS (wrap + justify + resize handles) ===================== */
function measureCtxFont(block) {
  const ctx = document.createElement("canvas").getContext("2d");
  const bold = block.font?.bold ? "bold " : "";
  const italic = block.font?.italic ? "italic " : "";
  const size = (block.font?.size ?? 9) + "pt";
  const name = block.font?.name ?? "Arial";
  ctx.font = `${italic}${bold}${size} ${name}`;
  return ctx;
}

function wrapTextBlock(block) {
  const ctx = measureCtxFont(block);
  const maxWidthPx = mmToPx(block.width);

  const lines = [];
  const paragraphs = String(block.text || "").split("\n");

  paragraphs.forEach((p) => {
    const words = p.split(/\s+/).filter(Boolean);
    let current = [];
    let currentW = 0;

    words.forEach((w) => {
      const wpx = ctx.measureText(w + " ").width;
      if (currentW + wpx > maxWidthPx && current.length) {
        lines.push({
          words: current,
          widthPx: currentW,
          isLastInParagraph: false,
        });
        current = [w];
        currentW = ctx.measureText(w + " ").width;
      } else {
        current.push(w);
        currentW += wpx;
      }
    });

    if (current.length) {
      lines.push({
        words: current,
        widthPx: currentW,
        isLastInParagraph: true,
      });
    } else {
      lines.push({ words: [""], widthPx: 0, isLastInParagraph: true });
    }
  });

  return lines;
}

function renderTextBlock(block) {
  const el = document.createElement("div");
  el.className = "text-block";
  el.dataset.bid = block.id;

  el.style.left = mmToPx(block.x) + "px";
  el.style.top = mmToPx(block.y) + "px";
  el.style.width = mmToPx(block.width) + "px";
  el.style.height = mmToPx(block.height) + "px";

  el.style.fontFamily = block.font?.name ?? "Arial";
  el.style.fontSize = (block.font?.size ?? 9) + "pt";
  el.style.fontWeight = block.font?.bold ? "bold" : "normal";
  el.style.fontStyle = block.font?.italic ? "italic" : "normal";
  el.style.textDecoration = block.font?.underline ? "underline" : "none";

  if (block.locked) el.classList.add("locked");
  if (selectedIds.has(block.id)) el.classList.add("selected");

  const lines = wrapTextBlock(block);
  const maxLines = Math.max(
    1,
    Math.floor(block.height / (block.lineHeight || 4)),
  );

  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const line = lines[i];
    const div = document.createElement("div");
    div.className = "tb-line";

    if (
      block.align === "justify" &&
      !(line.isLastInParagraph ?? line.isLast) &&
      line.words.length > 1
    ) {
      div.style.display = "flex";
      div.style.justifyContent = "space-between";
      div.style.whiteSpace = "nowrap";

      line.words.forEach((w) => {
        const span = document.createElement("span");
        span.textContent = w;
        div.appendChild(span);
      });
    } else {
      div.style.display = "block";
      div.style.whiteSpace = "pre";
      div.style.textAlign = block.align || "left";
      div.textContent = line.words.join(" ");
    }

    // ✅ Doble clic para editar texto
    div.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (printPreview || block.locked) return;

      const originalText = block.text || "";

      const textarea = document.createElement("textarea");
      textarea.className = "tb-editor";
      textarea.value = originalText;

      const elRect = el.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();

      textarea.style.position = "absolute";
      textarea.style.left = elRect.left - canvasRect.left + "px";
      textarea.style.top = elRect.top - canvasRect.top + "px";
      textarea.style.width = elRect.width + "px";
      textarea.style.height = elRect.height + "px";
      textarea.style.fontFamily = el.style.fontFamily;
      textarea.style.fontSize = el.style.fontSize;
      textarea.style.zIndex = "1000";
      textarea.style.resize = "none";
      textarea.style.border = "1px solid #333";
      textarea.style.padding = "4px";
      textarea.style.boxSizing = "border-box";
      textarea.style.background = "#fff";

      canvas.appendChild(textarea);
      textarea.focus();

      const finishEdit = (save) => {
        if (save) {
          block.text = textarea.value;
          pushHistory();
        }
        textarea.remove();
        render();
      };

      textarea.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          finishEdit(false);
        }
        if (ev.key === "Enter" && ev.ctrlKey) {
          ev.preventDefault();
          finishEdit(true);
        }
      });

      textarea.addEventListener("blur", () => {
        finishEdit(true);
      });
    });

    el.appendChild(div);
  }

  // ================= Resize handles (solo para UI textBlocks) =================
  // (Si ya tenías handles globales, esto no rompe: solo agrega el del bloque)
  const h = document.createElement("div");
  h.className = "tb-handle tb-handle-br";
  h.title = "Resize";
  h.style.position = "absolute";
  h.style.right = "0px";
  h.style.bottom = "0px";
  h.style.width = "10px";
  h.style.height = "10px";
  h.style.background = "blue";
  h.style.cursor = "se-resize";

  // Nota: usamos pointer events para que ande bien con mouse/touch
  h.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    // seleccionar este bloque si no lo estaba
    if (!selectedIds.has(block.id)) {
      clearSelection();
      selectedIds.add(block.id);
      syncUIFromSelection();
      render();
    }

    const startX = ev.clientX;
    const startY = ev.clientY;

    const startW = block.width;
    const startH = block.height;

    const move = (e) => {
      const dx = pxToMm(e.clientX - startX);
      const dy = pxToMm(e.clientY - startY);

      block.width = Math.max(5, startW + dx);
      block.height = Math.max(5, startH + dy);

      render();
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      pushHistory();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  el.appendChild(h);

  // ================= Select + drag del bloque =================
  el.addEventListener("pointerdown", (ev) => {
    if (printPreview) return;
    if (block.locked) return;

    // si clickeaste el handle, ya lo maneja él
    if (ev.target && ev.target.classList?.contains("tb-handle")) return;

    ev.preventDefault();
    ev.stopPropagation();

    // selección (shift para multi)
    if (!ev.shiftKey) {
      if (!(selectedIds.size === 1 && selectedIds.has(block.id))) {
        clearSelection();
      }
    }
    selectedIds.add(block.id);
    syncSelectionUI();
    render();

    // drag
    const startX = ev.clientX;
    const startY = ev.clientY;
    const bx = block.x;
    const by = block.y;

    const move = (e) => {
      const dx = pxToMm(e.clientX - startX);
      const dy = pxToMm(e.clientY - startY);

      block.x = bx + dx;
      block.y = by + dy;

      propX.value = String(Math.round(block.x));
      propY.value = String(Math.round(block.y));

      render();
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      pushHistory();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  return el;
}

// Si tu render() ya estaba armando textBlocks en otro lado, no dupliques.
// Si NO, asegurate de que render() incluya esto en algún punto:
//
// textBlocks.forEach((b) => canvas.appendChild(renderTextBlock(b)));

// ===================== INIT =====================
(function boot() {
  // Panel Variables
  try {
    initVariablesPanel();
  } catch (e) {
    console.error("Fallo initVariablesPanel()", e);
  }

  // Estado inicial de botones
  updateButtons();
})();

// ===================== TOOLBAR LISTENERS =====================

// Vista impresión 1:1
togglePrintBtn?.addEventListener("click", () => {
  printPreview = !printPreview;
  document.body.classList.toggle("print-preview", printPreview);

  // al entrar/salir de preview limpiamos selección para evitar estados raros
  clearSelection();
  render();
});

// Agregar texto estático (type=1)
addTextBtn?.addEventListener("click", () => {
  if (!xmlDoc || printPreview) return;

  pushHistory();

  const node = xmlDoc.createElement("txtOut");
  node.setAttribute("fieldName", "Texto");
  node.setAttribute("type", "1");
  node.setAttribute("x", "10");
  node.setAttribute("y", "10");
  ensureEid(node);

  const font = xmlDoc.createElement("font");
  font.setAttribute("name", "Arial");
  font.setAttribute("size", "10");
  font.setAttribute("bold", "0");
  font.setAttribute("italic", "0");
  font.setAttribute("underline", "0");
  font.setAttribute("strikethrough", "0");
  font.setAttribute("align", "left");
  node.appendChild(font);

  xmlDoc.querySelector("data")?.appendChild(node);

  selectedIds.clear();
  selectedIds.add(node.getAttribute("eid"));
  render();
});

// Guardar XML (descarga)
saveBtn?.addEventListener("click", () => {
  if (!xmlDoc) return;
  const xml = new XMLSerializer().serializeToString(xmlDoc);

  const blob = new Blob([xml], { type: "application/xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "layout.xml";
  a.click();
  URL.revokeObjectURL(a.href);
});

undoBtn.addEventListener("click", () => {
  if (!undoStack.length) return;

  const cur = serializeState();
  redoStack.push(cur);

  const prev = undoStack.pop();
  restoreState(prev);

  render();
  updateUndoRedoUI();
});

redoBtn.addEventListener("click", () => {
  if (!redoStack.length) return;

  const cur = serializeState();
  undoStack.push(cur);

  const next = redoStack.pop();
  restoreState(next);

  render();
  updateUndoRedoUI();
});

copyBtn.addEventListener("click", () => {
  clipboard = [];

  getSelectedNodes().forEach((n) => {
    clipboard.push({
      type: "node",
      xml: n.cloneNode(true),
    });
  });

  getSelectedBlocks().forEach((b) => {
    clipboard.push({
      type: "block",
      data: JSON.parse(JSON.stringify(b)),
    });
  });

  updateButtons();
});

pasteBtn.addEventListener("click", () => {
  if (!clipboard.length || !xmlDoc) return;

  pushHistory();
  selectedIds.clear();

  clipboard.forEach((item) => {
    if (item.type === "node") {
      const n = item.xml.cloneNode(true);
      ensureEid(n);
      n.setAttribute("x", String(+n.getAttribute("x") + 5));
      n.setAttribute("y", String(+n.getAttribute("y") + 5));
      xmlDoc.querySelector("data")?.appendChild(n);
      selectedIds.add(n.getAttribute("eid"));
    }

    if (item.type === "block") {
      const b = JSON.parse(JSON.stringify(item.data));
      b.id = generateBlockId();
      b.x += 5;
      b.y += 5;
      textBlocks.push(b);
      selectedIds.add(b.id);
    }
  });

  render();
});

frontBtn.addEventListener("click", () => {
  pushHistory();
  getSelectedNodes().forEach((n) => n.parentNode.appendChild(n));
  render();
});

backBtn.addEventListener("click", () => {
  pushHistory();
  getSelectedNodes().forEach((n) => {
    const p = n.parentNode;
    p.insertBefore(n, p.firstChild);
  });
  render();
});

lockBtn.addEventListener("click", () => {
  pushHistory();
  getSelectedNodes().forEach((n) => n.setAttribute("locked", "1"));
  getSelectedBlocks().forEach((b) => (b.locked = true));
  render();
});

unlockBtn.addEventListener("click", () => {
  pushHistory();
  getSelectedNodes().forEach((n) => n.removeAttribute("locked"));
  getSelectedBlocks().forEach((b) => (b.locked = false));
  render();
});

addTextBlockBtn.addEventListener("click", () => {
  if (!xmlDoc || printPreview) return;

  pushHistory();

  const block = {
    id: generateBlockId(),
    x: 10,
    y: 10,
    width: 60,
    height: 20,
    text: "Bloque de texto",
    align: "left",
    font: { name: "Arial", size: 9 },
    locked: false,
  };

  textBlocks.push(block);
  selectedIds.clear();
  selectedIds.add(block.id);
  render();
});

const addVarBtn = document.getElementById("add-variable");

addVarBtn?.addEventListener("click", () => {
  const name = varSearch.value.trim();
  if (!name) return;

  // 1. crear en sesión
  addVariableToSession(name);

  // 2. insertarla directamente en el layout
  addVariableToLayout(name);

  varSearch.value = "";
});

document.addEventListener("keydown", (e) => {
  if (printPreview) return;

  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  // DELETE
  if (e.key === "Delete") {
    if (!selectedIds.size) return;

    pushHistory();

    getSelectedNodes().forEach((n) => n.remove());
    getSelectedBlocks().forEach((b) => {
      textBlocks = textBlocks.filter((x) => x.id !== b.id);
    });

    clearSelection();
    render();
    e.preventDefault();
  }

  // FLECHAS
  const step = e.shiftKey ? 5 : 1;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    if (!selectedIds.size) return;

    pushHistory();

    getSelectedNodes().forEach((n) => {
      if (isLockedNode(n)) return;
      let x = +n.getAttribute("x");
      let y = +n.getAttribute("y");

      if (e.key === "ArrowUp") y -= step;
      if (e.key === "ArrowDown") y += step;
      if (e.key === "ArrowLeft") x -= step;
      if (e.key === "ArrowRight") x += step;

      n.setAttribute("x", x);
      n.setAttribute("y", y);
    });

    getSelectedBlocks().forEach((b) => {
      if (b.locked) return;
      if (e.key === "ArrowUp") b.y -= step;
      if (e.key === "ArrowDown") b.y += step;
      if (e.key === "ArrowLeft") b.x -= step;
      if (e.key === "ArrowRight") b.x += step;
    });

    render();
    e.preventDefault();
  }

  // CTRL + Z / Y
  if (e.ctrlKey && e.key.toLowerCase() === "z") {
    undoBtn.click();
    e.preventDefault();
  }
  if (e.ctrlKey && e.key.toLowerCase() === "y") {
    redoBtn.click();
    e.preventDefault();
  }

  // CTRL + C / V
  if (e.ctrlKey && e.key.toLowerCase() === "c") {
    copyBtn.click();
    e.preventDefault();
  }
  if (e.ctrlKey && e.key.toLowerCase() === "v") {
    pasteBtn.click();
    e.preventDefault();
  }
});
