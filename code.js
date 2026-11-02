// Local Type Kit – work with locally installed fonts across a whole Figma file.
// Scan which fonts a file uses, replace fonts everywhere, build text styles from variables, assign styles to loose text.
// Runs only on your machine: no network access, no font upload. The last configuration is kept in the file itself.

const key = (f) => `${f.family}\u0000${f.style}`;
const round = (n) => Math.round(n * 100) / 100;
const lhKey = (lh) => (lh.unit === "AUTO" ? "auto" : `${lh.unit}:${round(lh.value)}`);

// Outside the plugin (scripts run through the Plugin API) some calls are missing; they are optional there.
async function allTextNodes() {
  try { await figma.loadAllPagesAsync(); } catch (e) { /* pages are already loaded */ }
  return figma.root.findAllWithCriteria({ types: ["TEXT"] });
}

// scope: "document" | "page" | "selection"
async function textNodesIn(scope) {
  if (scope === "page") return figma.currentPage.findAllWithCriteria({ types: ["TEXT"] });
  if (scope === "selection") {
    const out = new Set();
    for (const n of figma.currentPage.selection) {
      if (n.type === "TEXT") out.add(n);
      if ("findAllWithCriteria" in n) for (const t of n.findAllWithCriteria({ types: ["TEXT"] })) out.add(t);
    }
    return [...out];
  }
  return allTextNodes();
}

function commit() {
  try { figma.commitUndo(); } catch (e) { /* no undo step outside the plugin */ }
}

async function loadFontsOf(n) {
  const fonts = n.characters.length ? n.getRangeAllFontNames(0, n.characters.length) : [n.fontName];
  for (const f of fonts) { try { await figma.loadFontAsync(f); } catch (e) { /* missing on this machine */ } }
}

function inInstance(n) {
  for (let p = n.parent; p && p.type !== "PAGE"; p = p.parent) if (p.type === "INSTANCE") return true;
  return false;
}

function segments(n, fields) {
  if (n.characters.length === 0) return [{ start: 0, end: 0, fontName: n.fontName, textStyleId: n.textStyleId }];
  return n.getStyledTextSegments(fields);
}

// ---- Scan ----
async function scan() {
  const used = new Map();
  const add = (f, field) => {
    if (!f || f === figma.mixed) return;
    const k = key(f);
    if (!used.has(k)) used.set(k, { family: f.family, style: f.style, nodes: 0, styles: 0 });
    used.get(k)[field]++;
  };
  for (const n of await allTextNodes()) {
    const seen = new Set();
    for (const s of segments(n, ["fontName"])) if (!seen.has(key(s.fontName))) { seen.add(key(s.fontName)); add(s.fontName, "nodes"); }
  }
  for (const s of await figma.getLocalTextStylesAsync()) add(s.fontName, "styles");
  const avail = await figma.listAvailableFontsAsync();
  const have = new Set(avail.map((a) => key(a.fontName)));
  const families = {};
  for (const a of avail) (families[a.fontName.family] = families[a.fontName.family] || []).push(a.fontName.style);
  const list = [...used.values()].map((u) => ({ ...u, available: have.has(key(u)) }));
  list.sort((a, b) => b.nodes + b.styles - (a.nodes + a.styles));
  return { used: list, families };
}

// ---- Replace fonts across the file ----
// mapping: [{ from: {family, style}, to: {family, style} }]
// Local styles belong to the whole file and only change when the scope is the document.
async function replaceFonts(mapping, apply, scope = "document") {
  const m = new Map(mapping.map((r) => [key(r.from), r.to]));
  const res = { scope, nodes: 0, segments: 0, inInstances: 0, styles: 0, viaStyle: 0, skipped: [] };
  if (scope === "selection" && figma.currentPage.selection.length === 0) throw new Error("Nothing is selected.");
  if (apply) for (const r of mapping) await figma.loadFontAsync(r.to);

  // Styles first: text that uses a style follows it and is not touched directly.
  for (const st of scope === "document" ? await figma.getLocalTextStylesAsync() : []) {
    const to = m.get(key(st.fontName));
    if (!to) continue;
    if (st.boundVariables && st.boundVariables.fontFamily) { res.skipped.push(`Style "${st.name}": family is bound to a variable`); continue; }
    res.styles++;
    if (apply) st.fontName = to;
  }

  // Main components and loose text first, instances after, so instances only keep real overrides.
  const nodes = await textNodesIn(scope);
  const ordered = [...nodes.filter((n) => !inInstance(n)), ...nodes.filter(inInstance)];
  for (const n of ordered) {
    let hit = false;
    let loaded = false;
    for (const s of segments(n, ["fontName", "textStyleId"])) {
      const to = m.get(key(s.fontName));
      if (!to) continue;
      if (s.textStyleId) { res.viaStyle++; continue; }
      if (n.boundVariables && n.boundVariables.fontFamily) { res.skipped.push(`"${n.name}": family is bound to a variable`); continue; }
      hit = true;
      res.segments++;
      if (inInstance(n)) res.inInstances++;
      if (!apply) continue;
      // Figma only edits a text layer once every font already in it is loaded; a missing font cannot be loaded and is left to the edit itself.
      if (!loaded) { loaded = true; await loadFontsOf(n); }
      try {
        if (s.start === s.end) n.fontName = to;
        else n.setRangeFontName(s.start, s.end, to);
      } catch (e) {
        res.skipped.push(`"${n.name}": ${e.message}`);
      }
    }
    if (hit) res.nodes++;
  }
  if (apply) commit();
  return res;
}

// ---- Text styles from variables ----
// config: { collection, sizeSuffix, lineHeightSuffix, styles: [{ name, group, familyVariable | family, style, description? }] }
async function stylesFromVariables(config) {
  const sizeSuffix = config.sizeSuffix || "/font-size";
  const lhSuffix = config.lineHeightSuffix || "/line-height";
  const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === config.collection);
  if (!col) throw new Error(`Collection "${config.collection}" not found`);
  const modeId = col.defaultModeId;
  const vars = {};
  for (const id of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v) vars[v.name] = v;
  }
  const existing = await figma.getLocalTextStylesAsync();
  const avail = new Set((await figma.listAvailableFontsAsync()).map((a) => key(a.fontName)));
  const done = [];
  const errors = [];

  for (const s of config.styles) {
    const group = s.group || s.name;
    const vSize = vars[group + sizeSuffix];
    const vLh = vars[group + lhSuffix];
    const vFam = s.familyVariable ? vars[s.familyVariable] : null;
    const family = vFam ? vFam.valuesByMode[modeId] : s.family;
    const missing = [!vSize && group + sizeSuffix, !vLh && group + lhSuffix, s.familyVariable && !vFam && s.familyVariable].filter(Boolean);
    if (missing.length) { errors.push(`${s.name}: variable ${missing.join(", ")} not found in "${config.collection}"`); continue; }
    if (!family) { errors.push(`${s.name}: no family given`); continue; }
    const fontName = { family, style: s.style || "Regular" };
    if (!avail.has(key(fontName))) { errors.push(`${s.name}: "${family} ${fontName.style}" is not installed on this machine`); continue; }
    await figma.loadFontAsync(fontName);

    const size = vSize.valuesByMode[modeId];
    const lh = vLh.valuesByMode[modeId];
    let style = existing.find((t) => t.name === s.name);
    const created = !style;
    if (created) { style = figma.createTextStyle(); style.name = s.name; }
    style.fontName = fontName;
    style.fontSize = size;
    style.lineHeight = { unit: "PIXELS", value: lh };
    if (vFam) style.setBoundVariable("fontFamily", vFam);
    style.setBoundVariable("fontSize", vSize);
    style.setBoundVariable("lineHeight", vLh);
    if (s.description) style.description = s.description;
    done.push(`${created ? "created" : "updated"}: ${s.name} (${family} ${fontName.style} ${size}/${round(lh)})`);
  }
  commit();
  return { done, errors };
}

// ---- Variables for the styles form ----
// Number and string variables per local collection, with their value in the default mode.
async function listVariables() {
  const out = [];
  for (const col of await figma.variables.getLocalVariableCollectionsAsync()) {
    const vars = [];
    for (const id of col.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (v && (v.resolvedType === "FLOAT" || v.resolvedType === "STRING")) vars.push({ name: v.name, type: v.resolvedType, value: v.valuesByMode[col.defaultModeId] });
    }
    out.push({ name: col.name, vars });
  }
  return out;
}

// Local text styles as the styles form shows them: font, and the variable the family is bound to, if any.
async function listTextStyles() {
  const out = [];
  for (const s of await figma.getLocalTextStylesAsync()) {
    const b = s.boundVariables && s.boundVariables.fontFamily;
    const v = b ? await figma.variables.getVariableByIdAsync(b.id) : null;
    out.push({ name: s.name, family: s.fontName.family, style: s.fontName.style, familyVariable: v ? v.name : null });
  }
  return out;
}

// ---- Assign styles to loose text ----
// A text node without a style gets the one local style that matches its family, weight, size and line height exactly.
async function assignStyles(apply) {
  const idx = new Map();
  for (const s of await figma.getLocalTextStylesAsync()) {
    const k = `${key(s.fontName)}|${s.fontSize}|${lhKey(s.lineHeight)}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(s);
  }
  const res = { assigned: 0, ambiguous: [], unmatched: 0 };
  for (const n of await allTextNodes()) {
    if (inInstance(n) || n.textStyleId !== "") continue;
    if (n.fontName === figma.mixed || n.fontSize === figma.mixed || n.lineHeight === figma.mixed) { res.unmatched++; continue; }
    const hits = idx.get(`${key(n.fontName)}|${n.fontSize}|${lhKey(n.lineHeight)}`) || [];
    if (hits.length === 0) { res.unmatched++; continue; }
    if (hits.length > 1) { res.ambiguous.push(`"${n.name}": ${hits.map((h) => h.name).join(" / ")}`); continue; }
    res.assigned++;
    if (apply) {
      await figma.loadFontAsync(n.fontName);
      await n.setTextStyleIdAsync(hits[0].id);
    }
  }
  if (apply) commit();
  return res;
}

// ---- Plugin shell ----
const handlers = {
  scan: () => scan(),
  replacePreview: (msg) => replaceFonts(msg.mapping, false, msg.scope),
  replaceApply: (msg) => replaceFonts(msg.mapping, true, msg.scope),
  styles: (msg) => stylesFromVariables(msg.config),
  variables: async () => ({ collections: await listVariables(), styles: await listTextStyles() }),
  context: () => context(),
  assignPreview: () => assignStyles(false),
  assignApply: () => assignStyles(true),
  saveConfig: (msg) => { figma.root.setPluginData("config", JSON.stringify(msg.config)); return true; },
  loadConfig: () => { const c = figma.root.getPluginData("config"); return c ? JSON.parse(c) : null; },
};

// What the window needs to describe the scope: the current page and how much is selected.
function context() {
  return { page: figma.currentPage.name, selected: figma.currentPage.selection.length };
}

// Set globalThis.LOCAL_TYPE_KIT_NO_UI = true before this file to use the functions above without the window.
if (typeof figma !== "undefined" && !globalThis.LOCAL_TYPE_KIT_NO_UI) {
  figma.showUI(__html__, { width: 440, height: 680, themeColors: true });
  const post = (type, result) => figma.ui.postMessage({ type, ok: true, result });
  figma.ui.onmessage = async (msg) => {
    try {
      const result = await handlers[msg.type](msg);
      post(msg.type, result);
      const de = msg.lang === "de";
      if (msg.type === "replaceApply") figma.notify(de ? `${result.segments} Textläufe ersetzt. Ein Rückgängig nimmt den ganzen Lauf zurück.` : `Replaced ${result.segments} text runs. One undo reverts the whole run.`);
      if (msg.type === "assignApply") figma.notify(de ? `Stile für ${result.assigned} Ebenen zugewiesen.` : `Assigned styles to ${result.assigned} layers.`);
    } catch (e) {
      figma.ui.postMessage({ type: msg.type, ok: false, error: e.message });
    }
  };
  // A full scan reads every page, so edits only mark the list as out of date; the window rescans when it is used next.
  const changed = () => post("changed");
  const watch = () => figma.currentPage.on("nodechange", changed);
  watch();
  figma.on("selectionchange", () => post("context", context()));
  figma.on("currentpagechange", () => { watch(); post("context", context()); });
  try { figma.on("stylechange", changed); } catch (e) { /* not available in every editor */ }
}
