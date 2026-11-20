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

// ---- Styles on marked text, also inside instances ----
// A script marks text layers with setSharedPluginData("localtype", "style", "<style name>"), also inside instances.
// Local fonts only load on this machine, so the assignment runs here: font variables bound to the layer are released, then the style is set.
const MARK_NS = "localtype";
const STYLE_PROPS = ["textCase", "letterSpacing", "textDecoration", "paragraphSpacing"];
const FONT_FIELDS = ["fontFamily", "fontStyle", "fontWeight", "fontSize", "lineHeight", "letterSpacing", "paragraphSpacing", "paragraphIndent"];
async function applyMarkedStyles(apply, scope = "document") {
  const byName = new Map((await figma.getLocalTextStylesAsync()).map((s) => [s.name, s]));
  const res = { marked: 0, assigned: 0, unbound: 0, styleProps: 0, missing: [], failed: [] };
  // Styles can carry properties to set here, as JSON in setSharedPluginData("localtype", "props", ...): textCase, letterSpacing, textDecoration, paragraphSpacing.
  for (const st of byName.values()) {
    const raw = st.getSharedPluginData(MARK_NS, "props");
    if (!raw) continue;
    let props;
    try { props = JSON.parse(raw); } catch (e) { res.failed.push(`Style "${st.name}": props are not JSON`); continue; }
    res.styleProps++;
    if (!apply) continue;
    try {
      await figma.loadFontAsync(st.fontName);
      for (const k of STYLE_PROPS) if (k in props) st[k] = props[k];
    } catch (e) {
      res.failed.push(`Style "${st.name}": ${e.message}`);
    }
  }
  for (const n of await textNodesIn(scope)) {
    const want = n.getSharedPluginData(MARK_NS, "style");
    if (!want) continue;
    res.marked++;
    const st = byName.get(want);
    if (!st) { res.missing.push(`"${n.name}": ${want}`); continue; }
    if (!apply) continue;
    try {
      await loadFontsOf(n);
      await figma.loadFontAsync(st.fontName);
      const bv = n.boundVariables || {};
      for (const f of FONT_FIELDS) if (bv[f]) { n.setBoundVariable(f, null); res.unbound++; }
      await n.setTextStyleIdAsync(st.id);
      res.assigned++;
    } catch (e) {
      res.failed.push(`"${n.name}": ${e.message}`);
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
  markedPreview: (msg) => applyMarkedStyles(false, msg.scope),
  markedApply: (msg) => applyMarkedStyles(true, msg.scope),
  saveConfig: (msg) => { figma.root.setPluginData("config", JSON.stringify(msg.config)); return true; },
  loadConfig: () => { const c = figma.root.getPluginData("config"); return c ? JSON.parse(c) : null; },
};

// What the window needs to describe the scope: the current page and how much is selected.
function context() {
  return { page: figma.currentPage.name, selected: figma.currentPage.selection.length };
}

// Set globalThis.LOCAL_TYPE_KIT_NO_UI = true before this file to use the functions above without the window.
if (typeof figma !== "undefined" && !globalThis.LOCAL_TYPE_KIT_NO_UI && figma.command === "replace-marked") {
  // Menu command without the window: swaps fonts across the file by the mapping a script stored on the document,
  // figma.root.setSharedPluginData("localtype", "replace", JSON.stringify([{ from: {family, style}, to: {family, style} }])).
  const raw = figma.root.getSharedPluginData("localtype", "replace");
  let mapping = null;
  try { mapping = raw ? JSON.parse(raw) : null; } catch (e) { mapping = null; }
  if (!Array.isArray(mapping) || !mapping.length) figma.closePlugin("Local Type: no font mapping stored on the document.");
  else replaceFonts(mapping, true, "document").then(
    (r) => { figma.root.setSharedPluginData("localtype", "replaceResult", JSON.stringify(r)); figma.closePlugin(`Local Type: ${r.styles} styles and ${r.nodes} layers changed` + (r.skipped.length ? `, ${r.skipped.length} skipped` : "") + "."); },
    (e) => figma.closePlugin(`Local Type: ${e.message}`)
  );
} else if (typeof figma !== "undefined" && !globalThis.LOCAL_TYPE_KIT_NO_UI && figma.command === "apply-marked") {
  // Menu command without the window: assigns the styles named on marked text layers across the file.
  applyMarkedStyles(true, "document").then(
    (r) => figma.closePlugin(`Local Type: ${r.styleProps} styles updated, ${r.assigned} of ${r.marked} marked layers styled` + (r.missing.length + r.failed.length ? `, ${r.missing.length} without style, ${r.failed.length} failed` : "") + "."),
    (e) => figma.closePlugin(`Local Type: ${e.message}`)
  );
} else if (typeof figma !== "undefined" && !globalThis.LOCAL_TYPE_KIT_NO_UI) {
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
