// Local Type Kit – work with locally installed fonts across a whole Figma file.
// Scan which fonts a file uses, replace fonts everywhere, build text styles from variables, assign styles to loose text.
// Runs only on your machine: no network access, no font upload. The last configuration is kept in the file itself.

const key = (f) => `${f.family}\u0000${f.style}`;
const round = (n) => Math.round(n * 100) / 100;
const lhKey = (lh) => (lh.unit === "AUTO" ? "auto" : `${lh.unit}:${round(lh.value)}`);

async function allTextNodes() {
  await figma.loadAllPagesAsync();
  return figma.root.findAllWithCriteria({ types: ["TEXT"] });
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
async function replaceFonts(mapping, apply) {
  const m = new Map(mapping.map((r) => [key(r.from), r.to]));
  const res = { nodes: 0, segments: 0, styles: 0, viaStyle: 0, skipped: [] };
  if (apply) for (const r of mapping) await figma.loadFontAsync(r.to);

  // Styles first: text that uses a style follows it and is not touched directly.
  for (const st of await figma.getLocalTextStylesAsync()) {
    const to = m.get(key(st.fontName));
    if (!to) continue;
    if (st.boundVariables && st.boundVariables.fontFamily) { res.skipped.push(`Style "${st.name}": family is bound to a variable`); continue; }
    res.styles++;
    if (apply) st.fontName = to;
  }

  // Main components and loose text first, instances after, so instances only keep real overrides.
  const nodes = await allTextNodes();
  const ordered = [...nodes.filter((n) => !inInstance(n)), ...nodes.filter(inInstance)];
  for (const n of ordered) {
    let hit = false;
    for (const s of segments(n, ["fontName", "textStyleId"])) {
      const to = m.get(key(s.fontName));
      if (!to) continue;
      if (s.textStyleId) { res.viaStyle++; continue; }
      if (n.boundVariables && n.boundVariables.fontFamily) { res.skipped.push(`"${n.name}": family is bound to a variable`); continue; }
      hit = true;
      res.segments++;
      if (!apply) continue;
      try {
        if (s.start === s.end) n.fontName = to;
        else n.setRangeFontName(s.start, s.end, to);
      } catch (e) {
        res.skipped.push(`"${n.name}": ${e.message}`);
      }
    }
    if (hit) res.nodes++;
  }
  if (apply) figma.commitUndo();
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
    if (!vSize || !vLh || (s.familyVariable && !vFam) || !family) { errors.push(`${s.name}: variable missing`); continue; }
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
  figma.commitUndo();
  return { done, errors };
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
  if (apply) figma.commitUndo();
  return res;
}

// ---- Plugin shell ----
const handlers = {
  scan: () => scan(),
  replacePreview: (msg) => replaceFonts(msg.mapping, false),
  replaceApply: (msg) => replaceFonts(msg.mapping, true),
  styles: (msg) => stylesFromVariables(msg.config),
  assignPreview: () => assignStyles(false),
  assignApply: () => assignStyles(true),
  saveConfig: (msg) => { figma.root.setPluginData("config", JSON.stringify(msg.config)); return true; },
  loadConfig: () => { const c = figma.root.getPluginData("config"); return c ? JSON.parse(c) : null; },
};

if (typeof figma !== "undefined" && !globalThis.__LOCAL_TYPE_TEST__) {
  figma.showUI(__html__, { width: 440, height: 600, themeColors: true });
  figma.ui.onmessage = async (msg) => {
    try {
      const result = await handlers[msg.type](msg);
      figma.ui.postMessage({ type: msg.type, ok: true, result });
    } catch (e) {
      figma.ui.postMessage({ type: msg.type, ok: false, error: e.message });
    }
  };
}
