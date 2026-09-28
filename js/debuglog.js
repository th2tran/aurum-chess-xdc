// Easter egg: tap/click 7 times on empty space outside the board to toggle a debug log panel.
(function (root) {
  "use strict";

  var MAX_ENTRIES = 1000;
  var TAPS_NEEDED = 7;
  var TAP_GAP_MS = 800;
  var TAP_MOVE_PX = 12;

  var entries = [];
  var panel = null;
  var listEl = null;
  var filterEl = null;
  var autoScroll = true;
  var isOpen = false;
  var t0 = Date.now();

  function pad(n, w) {
    n = String(n);
    while (n.length < w) n = "0" + n;
    return n;
  }

  function stamp(d) {
    return pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2) + ":" + pad(d.getSeconds(), 2) + "." + pad(d.getMilliseconds(), 3);
  }

  function fmt(a) {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.stack || a.name + ": " + a.message;
    if (a === undefined) return "undefined";
    if (typeof a === "function") return "[function " + (a.name || "anonymous") + "]";
    try {
      var seen = [];
      return JSON.stringify(a, function (k, v) {
        if (v && typeof v === "object") {
          if (seen.indexOf(v) !== -1) return "[circular]";
          seen.push(v);
        }
        return v;
      });
    } catch (e) {
      return String(a);
    }
  }

  function add(level, args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(fmt(args[i]));
    var e = { t: new Date(), level: level, msg: parts.join(" ") };
    entries.push(e);
    if (entries.length > MAX_ENTRIES) {
      entries.shift();
      if (listEl && listEl.firstChild && isOpen) listEl.removeChild(listEl.firstChild);
    }
    if (isOpen && passes(e)) {
      listEl.appendChild(row(e));
      if (autoScroll) listEl.scrollTop = listEl.scrollHeight;
    }
  }

  // Capture console output from the very start.
  var con = root.console || {};
  ["log", "info", "warn", "error", "debug"].forEach(function (lvl) {
    var orig = con[lvl];
    con[lvl] = function () {
      try {
        add(lvl === "log" ? "info" : lvl, arguments);
      } catch (e) {}
      if (typeof orig === "function") {
        try {
          return orig.apply(con, arguments);
        } catch (e2) {}
      }
    };
  });
  if (!root.console) root.console = con;

  root.addEventListener("error", function (ev) {
    var where = ev.filename ? " (" + ev.filename.split("/").pop() + ":" + ev.lineno + ":" + ev.colno + ")" : "";
    add("error", [(ev.error && ev.error.stack) || ev.message + where]);
  });
  root.addEventListener("unhandledrejection", function (ev) {
    add("error", ["Unhandled rejection:", ev.reason]);
  });

  function passes(e) {
    var f = filterEl ? filterEl.value : "all";
    if (f === "all") return true;
    if (f === "warn") return e.level === "warn" || e.level === "error";
    return e.level === f;
  }

  function row(e) {
    var d = document.createElement("div");
    d.className = "dbg-row dbg-" + e.level;
    var ts = document.createElement("span");
    ts.className = "dbg-ts";
    ts.textContent = stamp(e.t);
    var m = document.createElement("span");
    m.className = "dbg-msg";
    m.textContent = e.msg;
    d.appendChild(ts);
    d.appendChild(m);
    return d;
  }

  function envInfo() {
    var b = root.Board3D;
    var mode = "?";
    try {
      mode = b && b.mode ? b.mode() : "?";
    } catch (e) {}
    var name = "";
    try {
      name = root.webxdc && root.webxdc.selfName ? root.webxdc.selfName : "";
    } catch (e2) {}
    return [
      "v" + (root.APP_VERSION || "?"),
      "renderer: " + mode,
      "viewport: " + root.innerWidth + "×" + root.innerHeight + " @" + (root.devicePixelRatio || 1) + "x",
      "uptime: " + Math.round((Date.now() - t0) / 1000) + "s",
      name ? "user: " + name : "",
      navigator.userAgent
    ].filter(Boolean).join(" · ");
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < entries.length; i++) if (passes(entries[i])) frag.appendChild(row(entries[i]));
    listEl.appendChild(frag);
    listEl.scrollTop = listEl.scrollHeight;
    var env = panel.querySelector(".dbg-env");
    if (env) env.textContent = envInfo();
  }

  function asText() {
    return entries
      .map(function (e) {
        return stamp(e.t) + " [" + e.level.toUpperCase() + "] " + e.msg;
      })
      .join("\n");
  }

  function copy() {
    var text = envInfo() + "\n\n" + asText();
    var done = function () {
      add("info", ["[debug] Log copied to clipboard (" + entries.length + " entries)"]);
    };
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        done();
      } catch (e) {
        add("warn", ["[debug] Copy failed"]);
      }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  function build() {
    if (panel) return;
    panel = document.createElement("aside");
    panel.id = "debug-panel";
    panel.setAttribute("aria-label", "Debug log");
    panel.innerHTML =
      '<div class="dbg-head">' +
      '<span class="dbg-title">Debug log</span>' +
      '<select class="dbg-filter" aria-label="Filter">' +
      '<option value="all">All</option>' +
      '<option value="info">Info</option>' +
      '<option value="debug">Debug</option>' +
      '<option value="warn">Warn+</option>' +
      '<option value="error">Errors</option>' +
      "</select>" +
      '<button type="button" class="dbg-btn" data-act="copy">Copy</button>' +
      '<button type="button" class="dbg-btn" data-act="clear">Clear</button>' +
      '<button type="button" class="dbg-btn dbg-close" data-act="close" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="dbg-env"></div>' +
      '<div class="dbg-list"></div>';
    document.body.appendChild(panel);
    listEl = panel.querySelector(".dbg-list");
    filterEl = panel.querySelector(".dbg-filter");
    filterEl.onchange = render;
    listEl.addEventListener("scroll", function () {
      autoScroll = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 8;
    });
    panel.querySelector(".dbg-head").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "close") close();
      else if (act === "clear") {
        entries.length = 0;
        render();
      } else if (act === "copy") copy();
    });
  }

  function open() {
    build();
    isOpen = true;
    autoScroll = true;
    render();
    // Force layout so the slide-in transition runs.
    void panel.offsetWidth;
    panel.classList.add("open");
    add("debug", ["[debug] Panel opened"]);
  }

  function close() {
    if (!panel) return;
    isOpen = false;
    panel.classList.remove("open");
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function hint(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(hint._t);
    hint._t = setTimeout(function () {
      t.classList.remove("show");
    }, 900);
  }

  // ---- Secret tap detector ----
  var NON_EMPTY =
    "button, input, select, textarea, label, a, .card, .seat, .pill, .moves, .modal-card, .brand, .hint-foot, .panel-title, p, #debug-panel";

  function isEmptySpot(target, x, y) {
    if (!target || target.nodeType !== 1) return false;
    if (target.id === "scene") {
      var b = root.Board3D;
      return !(b && b.isBoardAt && b.isBoardAt(x, y));
    }
    if (target.closest && target.closest(NON_EMPTY)) return false;
    return true;
  }

  var taps = 0;
  var lastTap = 0;
  var down = null;
  var activePointers = 0;

  function onDown(x, y, target) {
    activePointers++;
    down = activePointers === 1 ? { x: x, y: y, target: target } : null;
  }

  function onUp(x, y) {
    activePointers = Math.max(0, activePointers - 1);
    var d = down;
    down = null;
    if (!d) return;
    if (Math.abs(x - d.x) > TAP_MOVE_PX || Math.abs(y - d.y) > TAP_MOVE_PX) return;
    if (d.target && d.target.closest && d.target.closest("#debug-panel")) return;
    var now = Date.now();
    if (!isEmptySpot(d.target, d.x, d.y)) {
      taps = 0;
      return;
    }
    taps = now - lastTap <= TAP_GAP_MS ? taps + 1 : 1;
    lastTap = now;
    if (taps >= TAPS_NEEDED) {
      taps = 0;
      toggle();
    } else if (taps >= 4 && !isOpen) {
      var left = TAPS_NEEDED - taps;
      hint(left + (left === 1 ? " more tap" : " more taps") + " to open the debug log");
    }
  }

  if (root.PointerEvent) {
    document.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      onDown(e.clientX, e.clientY, e.target);
    }, true);
    var up = function (e) {
      onUp(e.clientX, e.clientY);
    };
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", function () {
      activePointers = Math.max(0, activePointers - 1);
      down = null;
    }, true);
  } else {
    var lastTouch = 0;
    document.addEventListener("touchstart", function (e) {
      lastTouch = Date.now();
      var t = e.changedTouches[0];
      onDown(t.clientX, t.clientY, e.target);
    }, true);
    document.addEventListener("touchend", function (e) {
      lastTouch = Date.now();
      var t = e.changedTouches[0];
      onUp(t.clientX, t.clientY);
    }, true);
    document.addEventListener("mousedown", function (e) {
      if (e.button !== 0 || Date.now() - lastTouch < 1000) return;
      activePointers = 0;
      onDown(e.clientX, e.clientY, e.target);
    }, true);
    document.addEventListener("mouseup", function (e) {
      if (Date.now() - lastTouch < 1000) return;
      onUp(e.clientX, e.clientY);
    }, true);
  }

  root.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) close();
  });

  root.DebugLog = {
    open: open,
    close: close,
    toggle: toggle,
    clear: function () {
      entries.length = 0;
      render();
    },
    entries: function () {
      return entries.slice();
    }
  };

  add("debug", ["[debug] Logger ready"]);
})(window);
