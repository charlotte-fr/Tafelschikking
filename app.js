const TOTAL_SEATS = 80;
const TABLE_SIZE = 40;
const SIDE_SIZE = 20;
const STORAGE_KEY = "wedding-seating-planner-v1";
const SHARE_PARAM_KEY = "plan";
const TEMPLATE_CSV_CONTENT = [
  "name,dietary requirements",
  "Alex Morgan,Vegetarian",
  "Jamie Chen,Gluten-free",
  "Taylor Singh,None",
].join("\n");

const state = {
  guestsById: new Map(),
  seats: Array(TOTAL_SEATS).fill(null),
  unassigned: [],
  tableNames: {
    a: "Table A",
    b: "Table B",
  },
};

let dragGuestId = null;
let pointerDrag = null;

const elements = {
  csvInput: document.getElementById("csvInput"),
  downloadTemplateBtn: document.getElementById("downloadTemplateBtn"),
  saveBtn: document.getElementById("saveBtn"),
  shareLinkBtn: document.getElementById("shareLinkBtn"),
  exportBtn: document.getElementById("exportBtn"),
  resetBtn: document.getElementById("resetBtn"),
  statusLine: document.getElementById("statusLine"),
  guestCountBadge: document.getElementById("guestCountBadge"),
  unassignedZone: document.getElementById("unassignedZone"),
  tableAName: document.getElementById("tableAName"),
  tableBName: document.getElementById("tableBName"),
  renameTableABtn: document.getElementById("renameTableABtn"),
  renameTableBBtn: document.getElementById("renameTableBBtn"),
  tableA: document.getElementById("tableA"),
  tableB: document.getElementById("tableB"),
};

initialize();

function initialize() {
  buildSeats();
  bindControls();
  const loadedFromShareLink = restoreSharedStateFromUrl();
  if (!loadedFromShareLink) {
    restoreSavedState();
  } else {
    saveState();
  }
  renderAll();
}

function bindControls() {
  elements.csvInput.addEventListener("change", handleCsvImport);
  elements.downloadTemplateBtn.addEventListener("click", downloadTemplateCsv);
  elements.shareLinkBtn.addEventListener("click", copyShareLink);
  elements.renameTableABtn.addEventListener("click", () => renameTable("a"));
  elements.renameTableBBtn.addEventListener("click", () => renameTable("b"));
  elements.saveBtn.addEventListener("click", () => {
    saveState();
    setStatus("Layout saved locally on this device.");
  });
  elements.exportBtn.addEventListener("click", exportArrangementCsv);
  elements.resetBtn.addEventListener("click", () => {
    if (window.confirm("Reset guest list and seating layout?")) {
      clearState();
      clearShareParamFromUrl();
      renderAll();
      saveState();
      setStatus("Planner reset.");
    }
  });

  elements.unassignedZone.addEventListener("dragover", (event) => event.preventDefault());
  elements.unassignedZone.addEventListener("dragenter", () => elements.unassignedZone.classList.add("over"));
  elements.unassignedZone.addEventListener("dragleave", () => elements.unassignedZone.classList.remove("over"));
  elements.unassignedZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.unassignedZone.classList.remove("over");
    const guestId = getDragGuestId(event);
    if (guestId) {
      moveGuestToPool(guestId);
    }
  });
}

function buildSeats() {
  const seatNodes = [];

  for (let seatIndex = 0; seatIndex < TOTAL_SEATS; seatIndex += 1) {
    const seat = document.createElement("div");
    seat.className = "seat";
    seat.dataset.dropZone = "seat";
    seat.dataset.seatIndex = String(seatIndex);

    const label = document.createElement("div");
    label.className = "seat-label";
    label.textContent = labelForSeat(seatIndex);

    seat.appendChild(label);

    seat.addEventListener("dragover", (event) => event.preventDefault());
    seat.addEventListener("dragenter", () => seat.classList.add("over"));
    seat.addEventListener("dragleave", () => seat.classList.remove("over"));
    seat.addEventListener("drop", (event) => {
      event.preventDefault();
      seat.classList.remove("over");
      const guestId = getDragGuestId(event);
      if (guestId) {
        moveGuestToSeat(guestId, seatIndex);
      }
    });

    seatNodes.push(seat);
  }

  seatNodes.slice(0, TABLE_SIZE).forEach((node) => elements.tableA.appendChild(node));
  seatNodes.slice(TABLE_SIZE).forEach((node) => elements.tableB.appendChild(node));
}

function labelForSeat(seatIndex) {
  const table = seatIndex < TABLE_SIZE ? "A" : "B";
  const withinTable = seatIndex % TABLE_SIZE;
  const side = withinTable < SIDE_SIZE ? "L" : "R";
  const position = withinTable < SIDE_SIZE ? withinTable + 1 : withinTable - SIDE_SIZE + 1;
  return `${table}-${side}${position}`;
}

async function handleCsvImport(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    const text = await file.text();
    const delimiter = detectDelimiter(text);
    const rows = parseCsv(text, delimiter);
    if (rows.length < 2) {
      setStatus("CSV appears empty. Add at least a header row and one guest.", true);
      return;
    }

    const headers = rows[0].map((value) => value.trim().toLowerCase());
    const nameIndex = findHeaderIndex(headers, ["name", "guest", "full name"]);
    const dietaryIndex = findHeaderIndex(headers, ["dietary", "diet", "requirements", "allergy"]);

    if (nameIndex === -1) {
      setStatus("Could not find a name column. Include a header like 'name'.", true);
      return;
    }

    const imported = [];
    for (const row of rows.slice(1)) {
      const name = (row[nameIndex] || "").trim();
      if (!name) continue;
      const dietaryRaw = dietaryIndex === -1 ? "" : (row[dietaryIndex] || "").trim();
      imported.push({ name, dietary: dietaryRaw });
    }

    if (!imported.length) {
      setStatus("No guest names found in CSV rows.", true);
      return;
    }

    loadGuests(imported);
    saveState();

    if (imported.length > TOTAL_SEATS) {
      setStatus(
        `Imported ${imported.length} guests. Only ${TOTAL_SEATS} seats are available; extra guests remain unassigned.`,
        true
      );
    } else {
      setStatus(`Imported ${imported.length} guests. Drag guests onto seats to arrange.`);
    }
  } catch (error) {
    setStatus(`Import failed: ${error.message}`, true);
  } finally {
    event.target.value = "";
  }
}

function loadGuests(guests) {
  state.guestsById.clear();
  state.seats = Array(TOTAL_SEATS).fill(null);
  state.unassigned = [];

  guests.forEach((guest, index) => {
    const id = `g${index + 1}`;
    state.guestsById.set(id, {
      id,
      name: guest.name,
      dietary: guest.dietary || "",
      order: index,
    });
    state.unassigned.push(id);
  });

  renderAll();
}

function moveGuestToSeat(guestId, seatIndex) {
  if (!state.guestsById.has(guestId)) return;

  const sourceSeatIndex = state.seats.findIndex((id) => id === guestId);
  const targetGuestId = state.seats[seatIndex];

  removeFromUnassigned(guestId);
  state.seats[seatIndex] = guestId;

  if (sourceSeatIndex !== -1) {
    state.seats[sourceSeatIndex] = targetGuestId || null;
  } else if (targetGuestId) {
    addToUnassigned(targetGuestId);
  }

  if (sourceSeatIndex === -1 && targetGuestId === guestId) {
    state.seats[seatIndex] = guestId;
  }

  renderAll();
  saveState();
}

function moveGuestToPool(guestId) {
  if (!state.guestsById.has(guestId)) return;
  const currentSeat = state.seats.findIndex((id) => id === guestId);
  if (currentSeat !== -1) {
    state.seats[currentSeat] = null;
  }
  addToUnassigned(guestId);
  renderAll();
  saveState();
}

function addToUnassigned(guestId) {
  if (!state.unassigned.includes(guestId)) {
    state.unassigned.push(guestId);
    state.unassigned.sort((a, b) => state.guestsById.get(a).order - state.guestsById.get(b).order);
  }
}

function removeFromUnassigned(guestId) {
  state.unassigned = state.unassigned.filter((id) => id !== guestId);
}

function renderAll() {
  renderTableNames();
  renderUnassigned();
  renderSeats();
  renderCounts();
}

function renderTableNames() {
  elements.tableAName.textContent = state.tableNames.a;
  elements.tableBName.textContent = state.tableNames.b;
}

function renderUnassigned() {
  elements.unassignedZone.innerHTML = "";
  state.unassigned.forEach((guestId) => {
    const guest = state.guestsById.get(guestId);
    if (!guest) return;
    elements.unassignedZone.appendChild(createGuestChip(guest));
  });
}

function renderSeats() {
  const seatNodes = document.querySelectorAll(".seat");
  seatNodes.forEach((seatNode) => {
    const seatIndex = Number(seatNode.dataset.seatIndex);
    const guestId = state.seats[seatIndex];
    const existingChip = seatNode.querySelector(".guest-chip");
    if (existingChip) existingChip.remove();
    if (!guestId) return;
    const guest = state.guestsById.get(guestId);
    if (guest) {
      seatNode.appendChild(createGuestChip(guest));
    }
  });
}

function renderCounts() {
  const assignedCount = state.seats.filter(Boolean).length;
  const totalGuests = state.guestsById.size;
  elements.guestCountBadge.textContent = `${state.unassigned.length} waiting`;
  if (totalGuests > 0) {
    setStatus(`${assignedCount}/${totalGuests} guests seated.`, totalGuests > TOTAL_SEATS);
  }
}

function createGuestChip(guest) {
  const chip = document.createElement("article");
  chip.className = "guest-chip";
  chip.dataset.guestId = guest.id;
  chip.draggable = true;

  const name = document.createElement("div");
  name.className = "guest-name";
  name.textContent = guest.name;
  chip.appendChild(name);

  const dietaryTags = splitDietaryTags(guest.dietary);
  if (dietaryTags.length) {
    chip.classList.add("has-diet");
    const badge = document.createElement("span");
    badge.className = "diet-tag";
    badge.textContent = dietaryTags.join(" | ");
    chip.appendChild(badge);
  }

  chip.addEventListener("dragstart", (event) => {
    dragGuestId = guest.id;
    chip.classList.add("drag-origin");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", guest.id);
  });

  chip.addEventListener("dragend", () => {
    dragGuestId = null;
    chip.classList.remove("drag-origin");
    clearOverHighlights();
  });

  chip.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    startPointerDrag(event, chip, guest.id);
  });

  return chip;
}

function splitDietaryTags(rawValue) {
  const raw = (rawValue || "").trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  if (["none", "n/a", "no", "-", "regular", "normal"].includes(lower)) return [];
  return raw
    .split(/[,/;|]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function startPointerDrag(event, chip, guestId) {
  event.preventDefault();
  const rect = chip.getBoundingClientRect();
  const ghost = chip.cloneNode(true);
  ghost.classList.add("drag-ghost");
  document.body.appendChild(ghost);

  pointerDrag = {
    guestId,
    ghost,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  };

  chip.classList.add("drag-origin");
  updateGhostPosition(event.clientX, event.clientY);
  highlightDropTarget(event.clientX, event.clientY);

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function onPointerMove(event) {
  if (!pointerDrag) return;
  updateGhostPosition(event.clientX, event.clientY);
  highlightDropTarget(event.clientX, event.clientY);
}

function onPointerUp(event) {
  if (!pointerDrag) return;
  const dropZone = findDropZone(event.clientX, event.clientY);
  if (dropZone) {
    dropGuestOnZone(pointerDrag.guestId, dropZone);
  }
  cleanupPointerDrag();
}

function updateGhostPosition(clientX, clientY) {
  if (!pointerDrag) return;
  pointerDrag.ghost.style.left = `${clientX}px`;
  pointerDrag.ghost.style.top = `${clientY}px`;
}

function highlightDropTarget(clientX, clientY) {
  clearOverHighlights();
  const dropZone = findDropZone(clientX, clientY);
  if (dropZone) {
    dropZone.classList.add("over");
  }
}

function findDropZone(clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY);
  if (!target) return null;
  return target.closest("[data-drop-zone]");
}

function cleanupPointerDrag() {
  if (!pointerDrag) return;
  const original = document.querySelector(`[data-guest-id="${pointerDrag.guestId}"]`);
  if (original) original.classList.remove("drag-origin");
  pointerDrag.ghost.remove();
  pointerDrag = null;
  clearOverHighlights();
  window.removeEventListener("pointermove", onPointerMove);
}

function dropGuestOnZone(guestId, zone) {
  if (!guestId || !zone) return;
  if (zone.dataset.dropZone === "pool") {
    moveGuestToPool(guestId);
    return;
  }
  const seatIndex = Number(zone.dataset.seatIndex);
  if (!Number.isNaN(seatIndex)) {
    moveGuestToSeat(guestId, seatIndex);
  }
}

function getDragGuestId(event) {
  const byTransfer = event.dataTransfer ? event.dataTransfer.getData("text/plain") : "";
  return byTransfer || dragGuestId;
}

function clearOverHighlights() {
  document.querySelectorAll(".over").forEach((node) => node.classList.remove("over"));
}

function setStatus(message, isAlert = false) {
  elements.statusLine.textContent = message;
  elements.statusLine.classList.toggle("alert", Boolean(isAlert));
}

function downloadTemplateCsv() {
  const downloaded = downloadFile("wedding-guests-template.csv", TEMPLATE_CSV_CONTENT);
  if (window.location.protocol === "file:") {
    openCsvPreview("wedding-guests-template.csv", TEMPLATE_CSV_CONTENT);
  }
  if (downloaded) {
    setStatus("Template CSV prepared. If download is blocked, use the newly opened tab and Save As.");
  } else {
    setStatus("Download was blocked. Template opened in a new tab so you can Save As.", true);
  }
}

function exportArrangementCsv() {
  if (!state.guestsById.size) {
    setStatus("Import guests before exporting seating.", true);
    return;
  }

  const rows = ["table,seat,label,name,dietary requirements"];
  state.seats.forEach((guestId, seatIndex) => {
    const guest = guestId ? state.guestsById.get(guestId) : null;
    rows.push(
      [
        seatIndex < TABLE_SIZE ? "A" : "B",
        (seatIndex % TABLE_SIZE) + 1,
        labelForSeat(seatIndex),
        csvEscape(guest ? guest.name : ""),
        csvEscape(guest ? guest.dietary : ""),
      ].join(",")
    );
  });

  rows.push("");
  rows.push("unassigned guests");
  state.unassigned.forEach((guestId) => {
    const guest = state.guestsById.get(guestId);
    rows.push(`${csvEscape(guest ? guest.name : "")},${csvEscape(guest ? guest.dietary : "")}`);
  });

  downloadFile("wedding-seating-arrangement.csv", rows.join("\n"));
  setStatus("Seating arrangement exported.");
}

function csvEscape(value) {
  const str = String(value || "");
  if (!/[",\n]/.test(str)) return str;
  return `"${str.replace(/"/g, "\"\"")}"`;
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch {
    URL.revokeObjectURL(url);
    return false;
  }
}

function openCsvPreview(filename, content) {
  const preview = [
    "<!doctype html>",
    "<html><head><meta charset='utf-8'><title>CSV Template</title>",
    "<style>body{font-family:Arial,sans-serif;padding:16px;background:#f7f7f7;}pre{white-space:pre-wrap;background:#fff;border:1px solid #ddd;padding:12px;border-radius:8px;}</style>",
    "</head><body>",
    `<h2>${filename}</h2>`,
    "<p>If your download is blocked, copy this CSV and save it as a <code>.csv</code> file.</p>",
    `<pre>${escapeHtml(content)}</pre>`,
    "</body></html>",
  ].join("");
  const previewWindow = window.open("about:blank", "_blank");
  if (previewWindow) {
    previewWindow.opener = null;
    previewWindow.document.write(preview);
    previewWindow.document.close();
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renameTable(tableKey) {
  const current = state.tableNames[tableKey];
  const next = window.prompt("Enter a table name:", current);
  if (next === null) return;
  const cleaned = next.trim();
  if (!cleaned) {
    setStatus("Table name cannot be empty.", true);
    return;
  }
  state.tableNames[tableKey] = cleaned.slice(0, 28);
  renderTableNames();
  saveState();
  setStatus(`Renamed ${tableKey === "a" ? "Table A" : "Table B"} to "${state.tableNames[tableKey]}".`);
}

function copyShareLink() {
  if (!state.guestsById.size) {
    setStatus("Add guests before creating a share link.", true);
    return;
  }

  const link = buildShareLink();
  if (!link) {
    setStatus("Could not build a share link for this layout.", true);
    return;
  }

  copyText(link)
    .then(() => {
      setStatus("Share link copied. Opening this link restores the full layout, including seat assignments.");
    })
    .catch(() => {
      window.prompt("Copy this share link:", link);
      setStatus("Clipboard access was blocked, so the link was shown in a copy dialog.", true);
    });
}

function buildShareLink() {
  const payload = serializeStateForShare();
  if (!payload) return "";

  const encoded = encodeSharePayload(payload);
  if (!encoded) return "";

  const url = new URL(window.location.href);
  url.searchParams.set(SHARE_PARAM_KEY, encoded);
  return url.toString();
}

function serializeStateForShare() {
  const guestsInOrder = Array.from(state.guestsById.values()).sort((a, b) => a.order - b.order);
  if (!guestsInOrder.length) return null;

  const guestIndexById = new Map();
  const compactGuests = guestsInOrder.map((guest, index) => {
    guestIndexById.set(guest.id, index);
    return [guest.name, guest.dietary || ""];
  });

  const compactSeats = state.seats.map((guestId) => {
    if (!guestId) return -1;
    const idx = guestIndexById.get(guestId);
    return Number.isInteger(idx) ? idx : -1;
  });

  const compactUnassigned = state.unassigned
    .map((guestId) => guestIndexById.get(guestId))
    .filter((idx) => Number.isInteger(idx));

  return {
    v: 1,
    t: [state.tableNames.a, state.tableNames.b],
    g: compactGuests,
    s: compactSeats,
    u: compactUnassigned,
  };
}

function restoreSharedStateFromUrl() {
  try {
    const url = new URL(window.location.href);
    const encoded = url.searchParams.get(SHARE_PARAM_KEY);
    if (!encoded) return false;

    const payload = decodeSharePayload(encoded);
    if (!payload || payload.v !== 1) return false;

    const applied = applySharedPayload(payload);
    if (!applied) return false;

    setStatus("Loaded layout from shared link.");
    return true;
  } catch {
    return false;
  }
}

function applySharedPayload(payload) {
  if (!Array.isArray(payload.g) || !Array.isArray(payload.s)) return false;

  state.guestsById.clear();
  state.seats = Array(TOTAL_SEATS).fill(null);
  state.unassigned = [];

  payload.g.forEach((entry, index) => {
    const name = Array.isArray(entry) ? String(entry[0] || "").trim() : "";
    const dietary = Array.isArray(entry) ? String(entry[1] || "").trim() : "";
    const id = `g${index + 1}`;
    state.guestsById.set(id, {
      id,
      name: name || `Guest ${index + 1}`,
      dietary,
      order: index,
    });
  });

  payload.s.slice(0, TOTAL_SEATS).forEach((entry, seatIndex) => {
    const guestIndex = Number(entry);
    if (!Number.isInteger(guestIndex)) return;
    if (guestIndex < 0 || guestIndex >= payload.g.length) return;
    state.seats[seatIndex] = `g${guestIndex + 1}`;
  });

  if (Array.isArray(payload.u)) {
    state.unassigned = payload.u
      .map((entry) => Number(entry))
      .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < payload.g.length)
      .map((idx) => `g${idx + 1}`);
  }

  if (Array.isArray(payload.t)) {
    const nextA = String(payload.t[0] || "").trim();
    const nextB = String(payload.t[1] || "").trim();
    state.tableNames.a = (nextA || "Table A").slice(0, 28);
    state.tableNames.b = (nextB || "Table B").slice(0, 28);
  } else {
    state.tableNames.a = "Table A";
    state.tableNames.b = "Table B";
  }

  normalizeAssignments();
  return true;
}

function encodeSharePayload(payload) {
  try {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch {
    return "";
  }
}

function decodeSharePayload(encoded) {
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  helper.style.pointerEvents = "none";
  document.body.appendChild(helper);
  helper.focus();
  helper.select();
  const copied = document.execCommand("copy");
  helper.remove();

  if (!copied) {
    throw new Error("Clipboard unavailable");
  }
}

function saveState() {
  const payload = {
    guests: Array.from(state.guestsById.values()),
    seats: state.seats,
    unassigned: state.unassigned,
    tableNames: state.tableNames,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreSavedState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.guests) || !Array.isArray(parsed.seats) || parsed.seats.length !== TOTAL_SEATS) {
      return;
    }

    if (parsed.tableNames && typeof parsed.tableNames === "object") {
      const nextA = String(parsed.tableNames.a || "").trim();
      const nextB = String(parsed.tableNames.b || "").trim();
      state.tableNames.a = nextA || "Table A";
      state.tableNames.b = nextB || "Table B";
    } else {
      state.tableNames.a = "Table A";
      state.tableNames.b = "Table B";
    }

    state.guestsById.clear();
    parsed.guests.forEach((guest, index) => {
      if (!guest || !guest.id || !guest.name) return;
      state.guestsById.set(guest.id, {
        id: guest.id,
        name: guest.name,
        dietary: guest.dietary || "",
        order: Number.isFinite(guest.order) ? guest.order : index,
      });
    });

    state.seats = parsed.seats.map((id) => (state.guestsById.has(id) ? id : null));
    state.unassigned = Array.isArray(parsed.unassigned)
      ? parsed.unassigned.filter((id) => state.guestsById.has(id))
      : [];
    normalizeAssignments();

    if (state.guestsById.size) {
      setStatus("Loaded saved seating layout.");
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function clearState() {
  state.guestsById.clear();
  state.seats = Array(TOTAL_SEATS).fill(null);
  state.unassigned = [];
  state.tableNames = { a: "Table A", b: "Table B" };
  localStorage.removeItem(STORAGE_KEY);
}

function clearShareParamFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SHARE_PARAM_KEY)) return;
  url.searchParams.delete(SHARE_PARAM_KEY);
  window.history.replaceState({}, "", url.toString());
}

function normalizeAssignments() {
  state.seats = state.seats.map((id) => (state.guestsById.has(id) ? id : null));
  state.unassigned = state.unassigned.filter((id) => state.guestsById.has(id));
  state.unassigned = [...new Set(state.unassigned)];

  state.guestsById.forEach((guest, guestId) => {
    const assigned = state.seats.includes(guestId);
    const waiting = state.unassigned.includes(guestId);
    if (!assigned && !waiting) {
      state.unassigned.push(guestId);
    }
    if (assigned && waiting) {
      state.unassigned = state.unassigned.filter((id) => id !== guestId);
    }
  });

  state.unassigned.sort((a, b) => state.guestsById.get(a).order - state.guestsById.get(b).order);
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || "";
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  return semicolons > commas ? ";" : ",";
}

function parseCsv(text, delimiter = ",") {
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentField += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      currentRow.push(currentField.trim());
      const hasValue = currentRow.some((value) => value !== "");
      if (hasValue) rows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }

    currentField += char;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    const hasValue = currentRow.some((value) => value !== "");
    if (hasValue) rows.push(currentRow);
  }

  return rows;
}

function findHeaderIndex(headers, candidates) {
  for (const candidate of candidates) {
    const exact = headers.findIndex((header) => header === candidate);
    if (exact !== -1) return exact;
  }
  for (const candidate of candidates) {
    const partial = headers.findIndex((header) => header.includes(candidate));
    if (partial !== -1) return partial;
  }
  return -1;
}
