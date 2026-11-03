/* Die echte Plugin-Oberflaeche (plugin/ui.html, von build.py aus ../ui.html kopiert)
   laeuft hier in einem Rahmen. Statt Figma antwortet dieses Skript mit einer
   erfundenen Datei, damit Besucher das Plugin bedienen koennen. Farben folgen der
   Darstellung der Seite. */
(function () {
  var frame = document.getElementById("plugin");
  if (!frame) return;
  var DE = document.documentElement.lang === "de";

  var FAMILIES = {
    "Inter": ["Light", "Regular", "Medium", "Semi Bold", "Bold"],
    "IBM Plex Sans": ["Light", "Regular", "Medium", "SemiBold", "Bold"],
    "Source Serif 4": ["Regular", "Semibold", "Bold"],
    "Helvetica Neue": ["Light", "Regular", "Medium", "Bold"],
    "Open Sans": ["Light", "Regular", "SemiBold", "Bold"],
    "Roboto": ["Light", "Regular", "Medium", "Bold"],
    "Georgia": ["Regular", "Bold"],
    "Arial": ["Regular", "Bold"]
  };
  var used = [
    { family: "Brand Sans", style: "Regular", nodes: 488, styles: 9, available: false },
    { family: "Brand Sans", style: "SemiBold", nodes: 131, styles: 4, available: false },
    { family: "Brand Sans", style: "Bold", nodes: 212, styles: 6, available: false },
    { family: "Inter", style: "Regular", nodes: 74, styles: 2, available: true },
    { family: "Inter", style: "Medium", nodes: 31, styles: 1, available: true }
  ];
  var VARS = [{ name: "Typography", vars: [
    { name: "font/heading", type: "STRING", value: "Inter" }, { name: "font/body", type: "STRING", value: "Inter" },
    { name: "display/font-size", type: "FLOAT", value: 56 }, { name: "display/line-height", type: "FLOAT", value: 64 },
    { name: "heading/font-size", type: "FLOAT", value: 32 }, { name: "heading/line-height", type: "FLOAT", value: 40 },
    { name: "body/font-size", type: "FLOAT", value: 16 }, { name: "body/line-height", type: "FLOAT", value: 24 },
    { name: "caption/font-size", type: "FLOAT", value: 12 }, { name: "caption/line-height", type: "FLOAT", value: 16 }
  ] }];
  var textStyles = [
    { name: "display", family: "Inter", style: "Bold", familyVariable: "font/heading" },
    { name: "heading", family: "Inter", style: "Semi Bold", familyVariable: "font/heading" },
    { name: "body", family: "Inter", style: "Regular", familyVariable: "font/body" }
  ];
  var config = null;
  var key = function (f) { return f.family + "\u0000" + f.style; };

  function replace(m, apply) {
    var map = {};
    m.mapping.forEach(function (r) { map[key(r.from)] = r.to; });
    var share = { selection: 0.04, page: 0.35, document: 1 }[m.scope];
    var res = { scope: m.scope, nodes: 0, segments: 0, inInstances: 0, styles: 0, viaStyle: 0, skipped: [] };
    used.forEach(function (u) {
      if (!map[key(u)]) return;
      var n = Math.max(1, Math.round(u.nodes * share));
      res.segments += n; res.nodes += Math.round(n * 0.85); res.inInstances += Math.round(n * 0.3);
      if (m.scope === "document") res.styles += u.styles; else res.viaStyle += Math.round(n * 0.4);
    });
    if (!apply || m.scope !== "document") return res;
    var next = {};
    used.forEach(function (u) {
      var to = map[key(u)] || u;
      var k = key(to);
      if (!next[k]) next[k] = { family: to.family, style: to.style, nodes: 0, styles: 0, available: !!FAMILIES[to.family] };
      next[k].nodes += u.nodes; next[k].styles += u.styles;
    });
    used = Object.keys(next).map(function (k) { return next[k]; }).sort(function (a, b) { return b.nodes - a.nodes; });
    return res;
  }

  var handlers = {
    scan: function () { return { used: used, families: FAMILIES }; },
    context: function () { return { page: DE ? "Startseite" : "Home", selected: 3 }; },
    loadConfig: function () { return config; },
    saveConfig: function (m) { config = m.config; return true; },
    variables: function () { return { collections: VARS, styles: textStyles }; },
    replacePreview: function (m) { return replace(m, false); },
    replaceApply: function (m) { return replace(m, true); },
    styles: function (m) {
      var done = m.config.styles.map(function (s) {
        var had = textStyles.some(function (t) { return t.name === s.name; });
        if (!had) textStyles.push({ name: s.name, family: "Inter", style: s.style, familyVariable: s.familyVariable });
        return (had ? "updated: " : "created: ") + s.name;
      });
      return { done: done, errors: [] };
    },
    assignPreview: function () { return { assigned: 46, unmatched: 9, ambiguous: ['"Price": caption / label'] }; },
    assignApply: function () { return { assigned: 46, unmatched: 9, ambiguous: ['"Price": caption / label'] }; }
  };

  window.addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow) return;
    var m = e.data && e.data.pluginMessage;
    if (!m || !handlers[m.type]) return;
    var result = handlers[m.type](m);
    setTimeout(function () { frame.contentWindow.postMessage({ pluginMessage: { type: m.type, ok: true, result: result } }, "*"); }, 180);
  });

  // Figma reicht dem Plugin seine Farben als Variablen herein; hier kommen sie aus der Seite.
  var THEMES = {
    light: { bg: "#FFFFFF", "bg-secondary": "#F2F0EC", "bg-hover": "#F2F0EC", "bg-brand": "#0d99ff", "bg-brand-hover": "#0a84e0", "bg-brand-tertiary": "#e5f4ff", "bg-menu": "#1e1e1e", "bg-menu-selected": "#0d99ff", "bg-danger-tertiary": "#FCE7E2",
      text: "#1C1A17", "text-secondary": "#78736A", "text-tertiary": "#A39E95", "text-onbrand": "#fff", "text-brand": "#007be5", "text-danger": "#A8412C", "text-menu": "#fff", "text-menu-secondary": "rgba(255,255,255,.5)", "text-menu-selected": "#fff",
      border: "#E2DFDA", "border-selected": "#0d99ff", icon: "#1C1A17", "icon-secondary": "#78736A", "icon-tertiary": "#A39E95", "icon-brand": "#0d99ff", "icon-warning": "#b86200", "icon-success": "#1D6B48", "icon-danger": "#A8412C" },
    dark: { bg: "#1F1E1B", "bg-secondary": "#2A2926", "bg-hover": "#2A2926", "bg-brand": "#0d99ff", "bg-brand-hover": "#0a84e0", "bg-brand-tertiary": "#1b3446", "bg-menu": "#111", "bg-menu-selected": "#0d99ff", "bg-danger-tertiary": "#3A221C",
      text: "#EDEAE4", "text-secondary": "#B6B1A8", "text-tertiary": "#858077", "text-onbrand": "#fff", "text-brand": "#7cc4f8", "text-danger": "#F0A391", "text-menu": "#fff", "text-menu-secondary": "rgba(255,255,255,.5)", "text-menu-selected": "#fff",
      border: "#33312D", "border-selected": "#0d99ff", icon: "#EDEAE4", "icon-secondary": "#B6B1A8", "icon-tertiary": "#858077", "icon-brand": "#0d99ff", "icon-warning": "#f7d15f", "icon-success": "#8FD3AE", "icon-danger": "#F0A391" }
  };
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    return t === "dark" || (t !== "light" && media.matches);
  }
  function paint() {
    var doc = frame.contentDocument;
    if (!doc || !doc.head) return;
    var st = doc.getElementById("site-theme");
    if (!st) { st = doc.createElement("style"); st.id = "site-theme"; doc.head.prepend(st); }
    var theme = THEMES[isDark() ? "dark" : "light"];
    st.textContent = ":root{" + Object.keys(theme).map(function (k) { return "--figma-color-" + k + ":" + theme[k]; }).join(";") + "}";
  }
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (media.addEventListener) media.addEventListener("change", paint);

  // Der Textblock unter dem Fenster folgt dem Reiter, der im Plugin offen ist.
  // Das Plugin fuellt immer die ganze Hoehe; hier bekommt jeder Reiter die Hoehe, die sein Inhalt braucht.
  var HEIGHT = { fonts: 600, styles: 660 };
  function sync(tab) {
    document.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== tab; });
    frame.style.height = HEIGHT[tab] + "px";
  }
  frame.addEventListener("load", function () {
    paint();
    var doc = frame.contentDocument;
    doc.querySelectorAll("nav button[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () { sync(b.getAttribute("data-tab")); });
    });
    sync("fonts");
  });
  // Das Fenster laesst sich an der Titelleiste ein Stueck ziehen. Je weiter, desto mehr Widerstand,
  // und beim Loslassen federt es zurueck (David, 03.11.2026).
  var win = frame.closest(".win"), bar = win && win.querySelector(".win-bar");
  if (bar) {
    // tanh folgt der Hand anfangs eins zu eins und bremst dann weich bis LIMIT Pixel.
    var LIMIT = 120, start = null, next = null, frameReq = 0;
    var rubber = function (d) { return LIMIT * Math.tanh(d / LIMIT); };
    var paintMove = function () {
      frameReq = 0;
      if (next) win.style.transform = "translate3d(" + rubber(next.x) + "px," + rubber(next.y) + "px,0)";
    };
    bar.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      bar.setPointerCapture(e.pointerId);
      win.classList.remove("settle"); win.classList.add("dragging");
    });
    bar.addEventListener("pointermove", function (e) {
      if (!start) return;
      next = { x: e.clientX - start.x, y: e.clientY - start.y };
      if (!frameReq) frameReq = requestAnimationFrame(paintMove);
    });
    var release = function () {
      if (!start) return;
      start = null; next = null;
      if (frameReq) { cancelAnimationFrame(frameReq); frameReq = 0; }
      win.classList.remove("dragging"); win.classList.add("settle");
      void win.offsetWidth; // die Uebergangsregel muss stehen, bevor das Ziel wechselt
      win.style.transform = "";
    };
    bar.addEventListener("pointerup", release);
    bar.addEventListener("pointercancel", release);
    bar.addEventListener("lostpointercapture", release);
  }

  // Erst jetzt laden, damit die ersten Nachrichten des Plugins schon eine Antwort finden.
  frame.src = frame.getAttribute("data-src");
})();
