/**
 * Aurum Chess — game flow, HUD, webxdc multiplayer, AI turns.
 */
(function () {
  "use strict";

  function installMock() {
    if (window.webxdc) return;
    var addr =
      sessionStorage.getItem("aurum-addr") ||
      "local-" + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem("aurum-addr", addr);
    var name = sessionStorage.getItem("aurum-name") || "You";
    var channel = null;
    try {
      channel = new BroadcastChannel("aurum-chess-xdc");
    } catch (e) {
      console.debug("[mock] BroadcastChannel unavailable", e);
    }
    var listeners = [];
    var serial = 0;
    window.webxdc = {
      selfAddr: addr,
      selfName: name,
      sendUpdateInterval: 1000,
      sendUpdateMaxSize: 128000,
      sendUpdate: function (update) {
        serial += 1;
        var msg = {
          payload: update.payload,
          serial: serial,
          max_serial: serial,
          info: update.info,
          summary: update.summary
        };
        listeners.forEach(function (fn) {
          fn(msg);
        });
        if (channel) channel.postMessage(msg);
      },
      setUpdateListener: function (cb) {
        listeners.push(cb);
        return Promise.resolve();
      }
    };
    if (channel) {
      channel.onmessage = function (ev) {
        serial = Math.max(serial, ev.data.serial || 0);
        listeners.forEach(function (fn) {
          fn(ev.data);
        });
      };
    }
  }

  var $ = function (id) {
    return document.getElementById(id);
  };

  var listenerReady = false;
  var pendingSends = [];

  function xdcSend(update) {
    if (!listenerReady) {
      pendingSends.push(update);
      return;
    }
    if (!window.webxdc) return;
    console.debug("[xdc] send", update.payload);
    rtSend({ k: "u", p: update.payload });
    if (!webxdc.sendUpdate) return;
    var res;
    try {
      res = webxdc.sendUpdate(update, "");
    } catch (e1) {
      try {
        res = webxdc.sendUpdate(update);
      } catch (e2) {
        console.debug("[xdc] sendUpdate failed", e2);
      }
    }
    if (res && typeof res.catch === "function") {
      res.catch(function (err) {
        console.debug("[xdc] sendUpdate rejected", err);
      });
    }
  }

  /* ---------- realtime channel ----------
   * Some hosts (e.g. Vector) accept sendUpdate() but never deliver it to peers.
   * Every update is therefore mirrored over webxdc.joinRealtimeChannel(), and
   * peers exchange full snapshots ("hello"/"state") so late joiners catch up.
   * Duplicates arriving via both paths are harmless: handlePayload is idempotent.
   */
  var RT_APP = "aurum-chess";
  var rt = null;
  var rtPeers = {};
  var rtEnc = window.TextEncoder ? new TextEncoder() : null;
  var rtDec = window.TextDecoder ? new TextDecoder() : null;

  function rtSend(msg) {
    if (!rt || !rtEnc) return;
    msg.app = RT_APP;
    msg.v = 1;
    msg.from = selfAddr();
    try {
      rt.send(rtEnc.encode(JSON.stringify(msg)));
    } catch (e) {
      console.debug("[rt] send failed", e);
    }
  }

  function snapshot() {
    return {
      game: state.gameId,
      seats: { w: state.seats.w, b: state.seats.b },
      moves: netChess.history({ verbose: true }).map(function (m) {
        return { from: m.from, to: m.to, promo: m.promotion || null };
      }),
      resigned: state.resigned || null
    };
  }

  function sendHello() {
    rtSend({ k: "hello", s: snapshot() });
  }

  // Merge a peer's snapshot; returns true if the peer is behind us.
  function mergeSnapshot(snap) {
    if (!snap || !snap.game) return false;
    if (snap.game < state.gameId) return true;
    if (snap.game > state.gameId) handlePayload({ t: "rematch", game: snap.game });
    ["w", "b"].forEach(function (c) {
      var seat = snap.seats && snap.seats[c];
      if (seat && seat.addr) {
        handlePayload({ t: "sit", game: snap.game, color: c, addr: seat.addr, name: seat.name });
      }
    });
    var mine = netChess.history({ verbose: true });
    var theirs = snap.moves || [];
    var n = Math.min(mine.length, theirs.length);
    for (var i = 0; i < n; i++) {
      if (mine[i].from !== theirs[i].from || mine[i].to !== theirs[i].to) {
        console.warn("[rt] move history diverges at ply " + i + "; ignoring peer snapshot");
        return false;
      }
    }
    for (i = mine.length; i < theirs.length; i++) {
      handlePayload({ t: "move", game: snap.game, n: i, from: theirs[i].from, to: theirs[i].to, promo: theirs[i].promo });
    }
    if (snap.resigned && !state.resigned) {
      handlePayload({ t: "resign", game: snap.game, color: snap.resigned });
    }
    var seatsBehind = ["w", "b"].some(function (c) {
      return state.seats[c] && !(snap.seats && snap.seats[c]);
    });
    return mine.length > theirs.length || seatsBehind || (!!state.resigned && !snap.resigned);
  }

  function onRealtime(data) {
    if (!rtDec) return;
    var msg;
    try {
      msg = JSON.parse(rtDec.decode(data));
    } catch (e) {
      console.debug("[rt] undecodable message", e);
      return;
    }
    if (!msg || msg.app !== RT_APP || msg.from === selfAddr()) return;
    console.debug("[rt] recv " + msg.k + " from " + msg.from);
    var isNew = !rtPeers[msg.from];
    rtPeers[msg.from] = Date.now();
    if (msg.k === "u") {
      handlePayload(msg.p);
      if (isNew) sendHello();
    } else if (msg.k === "hello") {
      mergeSnapshot(msg.s);
      rtSend({ k: "state", s: snapshot() });
    } else if (msg.k === "state") {
      if (mergeSnapshot(msg.s)) rtSend({ k: "state", s: snapshot() });
    }
  }

  function joinRealtime() {
    if (rt || !window.webxdc || typeof webxdc.joinRealtimeChannel !== "function" || !rtEnc) return;
    try {
      rt = webxdc.joinRealtimeChannel();
      rt.setListener(onRealtime);
      console.info("[rt] joined realtime channel");
    } catch (e) {
      rt = null;
      console.debug("[rt] joinRealtimeChannel failed", e);
      return;
    }
    // Peers connect gradually, so announce a few times.
    [500, 2000, 5000, 10000, 20000].forEach(function (ms) {
      setTimeout(sendHello, ms);
    });
    window.addEventListener("pagehide", function () {
      if (!rt) return;
      try {
        rt.leave();
      } catch (e) {
        console.debug("[rt] leave failed", e);
      }
      rt = null;
    });
  }

  var UNI = {
    w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
    b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" }
  };
  var START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

  var chess = new Chess();
  var netChess = new Chess();
  var hydrating = true;
  var animQueue = [];
  var state = {
    screen: "menu",
    mode: null, // ai | chat | local
    aiLevel: "easy",
    playerColor: "w",
    viewColor: "w",
    seats: { w: null, b: null },
    gameId: 1,
    selected: null,
    lastMove: null,
    thinking: false,
    animating: false,
    gameOver: false,
    sound: true,
    hints: true,
    coords: true,
    autoFlip: false,
    quality: "auto",
    camMode: 0,
    promo: null,
    appliedPly: 0,
    seenSerial: 0,
    resigned: null
  };

  var audioCtx = null;
  function audio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function playNoise(freq, dur, gain) {
    if (!state.sound) return;
    var ctx = audio();
    if (!ctx) return;
    var n = ctx.sampleRate * dur;
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = 1.2;
    var g = ctx.createGain();
    g.gain.value = gain || 0.28;
    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start();
  }

  function playTone(freq, dur, type, gain) {
    if (!state.sound) return;
    var ctx = audio();
    if (!ctx) return;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  function sfx(kind) {
    if (kind === "move") playNoise(900, 0.045, 0.3);
    else if (kind === "capture") {
      playNoise(220, 0.08, 0.4);
      playTone(140, 0.12, "triangle", 0.06);
    } else if (kind === "check") {
      playTone(520, 0.12, "sine", 0.07);
      setTimeout(function () {
        playTone(780, 0.16, "sine", 0.06);
      }, 90);
    } else if (kind === "end") {
      playTone(392, 0.18, "sine", 0.08);
      setTimeout(function () {
        playTone(524, 0.22, "sine", 0.08);
      }, 140);
      setTimeout(function () {
        playTone(660, 0.35, "sine", 0.08);
      }, 280);
    } else if (kind === "illegal") playTone(120, 0.1, "square", 0.04);
    else if (kind === "select") playTone(740, 0.05, "sine", 0.03);
  }

  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.remove("show");
    }, 2200);
  }

  function hideAllScreens() {
    ["menu", "ai-setup", "lobby", "hud", "promo", "over", "settings", "confirm"].forEach(
      function (id) {
        $(id).classList.add("hidden");
      }
    );
  }

  function show(id) {
    $(id).classList.remove("hidden");
  }

  function goMenu() {
    state.screen = "menu";
    state.mode = null;
    state.thinking = false;
    state.animating = false;
    animQueue.length = 0;
    hideAllScreens();
    show("menu");
    Board3D.setAutoRotate(true);
    Board3D.setOnTap(null);
    Board3D.setCanMove(null);
    Board3D.syncFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    Board3D.setHighlights({});
    Board3D.selectSquare(null);
  }

  function selfName() {
    var n = window.webxdc && webxdc.selfName;
    if (typeof n === "function") {
      try {
        n = n();
      } catch (e) {
        n = null;
      }
    }
    return n || "You";
  }
  function selfAddr() {
    var a = window.webxdc && webxdc.selfAddr;
    if (typeof a === "function") {
      try {
        a = a();
      } catch (e) {
        a = null;
      }
    }
    if (a != null && String(a) !== "") return String(a);
    return "local";
  }

  function seatName(color) {
    if (state.mode === "ai") {
      if (color === state.playerColor) return selfName();
      var labels = { easy: "Apprentice", medium: "Tactician", hard: "Grandmaster" };
      return labels[state.aiLevel] + " AI";
    }
    if (state.mode === "local") {
      return color === "w" ? "White" : "Black";
    }
    var s = state.seats[color];
    return s ? s.name : color === "w" ? "White" : "Black";
  }

  function iControl(color) {
    if (state.gameOver || state.thinking || state.animating) return false;
    if (state.mode === "local") return true;
    if (state.mode === "ai") return color === state.playerColor;
    if (state.mode === "chat") {
      if (!isSeated()) return false;
      if (chess.turn() !== color) return false;
      var s = state.seats[color];
      return !!(s && s.addr === selfAddr());
    }
    return false;
  }

  function isSeated() {
    if (state.mode !== "chat") return true;
    var a = selfAddr();
    return (
      (state.seats.w && state.seats.w.addr === a) ||
      (state.seats.b && state.seats.b.addr === a)
    );
  }

  function capturedBy(winnerColor) {
    var loser = winnerColor === "w" ? "b" : "w";
    var rank = { q: 0, r: 1, b: 2, n: 3, p: 4 };
    var caps = [];
    var h = chess.history({ verbose: true });
    var i;
    for (i = 0; i < h.length; i++) {
      if (h[i].captured && h[i].color === winnerColor) caps.push(h[i].captured);
    }
    caps.sort(function (a, b) {
      return (rank[a] || 9) - (rank[b] || 9);
    });
    var out = "";
    for (i = 0; i < caps.length; i++) out += UNI[loser][caps[i]] || "";
    return out;
  }

  function findKing(color) {
    var board = chess.board();
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var p = board[r][f];
        if (p && p.type === "k" && p.color === color) {
          return "abcdefgh"[f] + (8 - r);
        }
      }
    }
    return null;
  }

  function statusText() {
    if (chess.in_checkmate()) {
      return chess.turn() === "w" ? "Black wins" : "White wins";
    }
    if (chess.in_stalemate()) return "Stalemate";
    if (chess.in_draw()) return "Draw";
    if (state.thinking) return "Thinking…";
    if (chess.in_check()) return (chess.turn() === "w" ? "White" : "Black") + " in check";
    return (chess.turn() === "w" ? "White" : "Black") + " to move";
  }

  function resultSub() {
    if (chess.in_checkmate()) return "Checkmate · " + (chess.turn() === "w" ? "Black" : "White") + " is victorious";
    if (chess.in_stalemate()) return "No legal moves — stalemate";
    if (chess.insufficient_material()) return "Insufficient material";
    if (chess.in_threefold_repetition()) return "Threefold repetition";
    if (chess.in_draw()) return "Drawn game";
    return "";
  }

  function renderMoves() {
    var h = chess.history();
    var parts = [];
    for (var i = 0; i < h.length; i += 2) {
      parts.push(i / 2 + 1 + ". " + h[i] + (h[i + 1] ? " " + h[i + 1] : ""));
    }
    $("moves").textContent = parts.join("   ") || "No moves yet.";
  }

  function updateHUD() {
    var leftIsBlack = state.viewColor === "w";
    var leftC = leftIsBlack ? "b" : "w";
    var rightC = leftIsBlack ? "w" : "b";
    $("p-left-name").textContent = seatName(leftC);
    $("p-right-name").textContent = seatName(rightC);
    $("p-left-meta").textContent = leftC === "w" ? "White" : "Black";
    $("p-right-meta").textContent = rightC === "w" ? "White" : "Black";
    $("p-left-cap").textContent = capturedBy(leftC);
    $("p-right-cap").textContent = capturedBy(rightC);
    $("p-left").classList.toggle("active", !state.gameOver && chess.turn() === leftC);
    $("p-right").classList.toggle("active", !state.gameOver && chess.turn() === rightC);
    $("status").textContent = statusText();
    $("status-sub").textContent = state.mode === "chat"
      ? !isSeated()
        ? "Spectating"
        : iControl(chess.turn())
          ? "Your move"
          : "Waiting"
      : state.mode === "ai"
        ? chess.turn() === state.playerColor
          ? "Your move"
          : "Computer"
        : "Pass the device";
    renderMoves();
    $("btn-undo").style.display = state.mode === "chat" ? "none" : "";
    $("btn-resign").style.display = isSeated() ? "" : "none";
    paintHighlights();
  }

  function paintHighlights() {
    var opts = {};
    if (state.lastMove) {
      opts.lastFrom = state.lastMove.from;
      opts.lastTo = state.lastMove.to;
    }
    if (chess.in_check()) opts.check = findKing(chess.turn());
    if (state.selected) {
      opts.selected = state.selected;
      if (state.hints) {
        var ms = chess.moves({ square: state.selected, verbose: true });
        opts.quiet = [];
        opts.captures = [];
        for (var i = 0; i < ms.length; i++) {
          if (ms[i].captured) opts.captures.push(ms[i].to);
          else opts.quiet.push(ms[i].to);
        }
      }
    }
    Board3D.setHighlights(opts);
  }

  function deselect() {
    state.selected = null;
    Board3D.selectSquare(null);
    paintHighlights();
  }

  function isPromotion(from, to) {
    var piece = chess.get(from);
    if (!piece || piece.type !== "p") return false;
    var rank = to[1];
    return (piece.color === "w" && rank === "8") || (piece.color === "b" && rank === "1");
  }

  function legalDest(from, to) {
    var ms = chess.moves({ square: from, verbose: true });
    for (var i = 0; i < ms.length; i++) if (ms[i].to === to) return true;
    return false;
  }

  function afterSettled() {
    if (animQueue.length) {
      var next = animQueue.shift();
      state.animating = true;
      Board3D.playMove(next).then(afterSettled);
      return;
    }
    state.animating = false;
    updateHUD();
    if (chess.game_over()) {
      endGame(null, null, true);
      return;
    }
    if (state.mode === "local" && state.autoFlip) {
      state.viewColor = chess.turn();
      Board3D.viewFor(state.viewColor);
    }
    maybeAI();
  }

  function sendChatMove(move) {
    if (state.mode !== "chat" || !window.webxdc) return;
    var opp = state.seats[move.color === "w" ? "b" : "w"];
    var notify = {};
    if (opp) notify[opp.addr] = selfName() + " played " + move.san;
    else notify["*"] = selfName() + " played " + move.san;
    xdcSend({
      payload: {
        t: "move",
        game: state.gameId,
        n: chess.history().length - 1,
        from: move.from,
        to: move.to,
        promo: move.promotion || null,
        san: move.san,
        addr: selfAddr()
      },
      summary: seatName("w") + " vs " + seatName("b") + " · " + statusText(),
      notify: notify
    });
  }

  function applyAndAnimate(move, fromNet) {
    console.info("[game] " + (fromNet ? "remote " : "") + "move " + move.san, chess.fen());
    state.lastMove = { from: move.from, to: move.to };
    state.appliedPly = chess.history().length;
    deselect();
    state.animating = true;
    if (move.captured) sfx("capture");
    else sfx("move");
    if (chess.in_check() && !chess.in_checkmate()) sfx("check");
    updateHUD();
    Board3D.playMove(move).then(afterSettled);
    try {
      if (Board3D.mode() === "2d") Board3D.syncFEN(chess.fen());
    } catch (e) {
      console.debug("[board] 2D syncFEN failed", e);
    }
    if (!fromNet) sendChatMove(move);
  }

  function commitMove(from, to, promo) {
    var move = chess.move({ from: from, to: to, promotion: promo || "q" });
    if (!move) {
      console.debug("[game] illegal move", from + "-" + to);
      sfx("illegal");
      return false;
    }
    applyAndAnimate(move, false);
    return true;
  }

  function askPromo(from, to) {
    state.promo = { from: from, to: to };
    var color = chess.get(from).color;
    var row = $("promo-row");
    var buttons = row.querySelectorAll("button");
    buttons[0].textContent = UNI[color].q;
    buttons[1].textContent = UNI[color].r;
    buttons[2].textContent = UNI[color].b;
    buttons[3].textContent = UNI[color].n;
    $("promo").classList.remove("hidden");
  }

  function attemptMove(from, to) {
    if (!from || !to || from === to) return;
    if (!iControl(chess.turn())) return;
    if (!legalDest(from, to)) {
      sfx("illegal");
      deselect();
      return;
    }
    if (isPromotion(from, to)) {
      askPromo(from, to);
      return;
    }
    commitMove(from, to, "q");
  }

  function onTap(square, dest, isDrag) {
    if (state.animating || state.thinking || state.gameOver) return;
    if (!square && !dest) return;
    if (isDrag) {
      attemptMove(square, dest);
      return;
    }
    var piece = square ? chess.get(square) : null;
    if (state.selected) {
      if (square === state.selected) {
        deselect();
        return;
      }
      if (legalDest(state.selected, square)) {
        attemptMove(state.selected, square);
        return;
      }
      if (piece && piece.color === chess.turn() && iControl(piece.color)) {
        state.selected = square;
        Board3D.selectSquare(square);
        sfx("select");
        paintHighlights();
        return;
      }
      deselect();
      return;
    }
    if (piece && piece.color === chess.turn() && iControl(piece.color)) {
      state.selected = square;
      Board3D.selectSquare(square);
      sfx("select");
      paintHighlights();
    }
  }

  function maybeAI() {
    if (state.mode !== "ai") return;
    if (state.gameOver || chess.game_over()) return;
    if (chess.turn() === state.playerColor) return;
    if (state.thinking || state.animating) return;
    state.thinking = true;
    updateHUD();
    setTimeout(function () {
      var mv = ChessAI.choose(chess, state.aiLevel);
      state.thinking = false;
      if (!mv || state.mode !== "ai") {
        updateHUD();
        return;
      }
      var done = chess.move(mv);
      if (done) applyAndAnimate(done, true);
      else updateHUD();
    }, 80);
  }

  function endGame(customTitle, customSub, fromBoard) {
    if (state.gameOver) return;
    console.info("[game] over:", customTitle || "", customSub || "");
    state.gameOver = true;
    deselect();
    sfx("end");
    updateHUD();
    $("over-title").textContent = customTitle || (chess.in_checkmate() ? "Checkmate" : chess.in_draw() ? "Draw" : "Game over");
    $("over-sub").textContent = customSub || resultSub();
    $("over").classList.remove("hidden");
    if (fromBoard && state.mode === "chat" && window.webxdc) {
      xdcSend({
        payload: { t: "over", game: state.gameId, fen: chess.fen() },
        summary: $("over-title").textContent
      });
    }
  }

  function startGameBoard() {
    console.info("[game] start mode=" + state.mode + " color=" + state.playerColor + (state.mode === "ai" ? " level=" + state.aiLevel : ""));
    hideAllScreens();
    show("hud");
    state.screen = "play";
    state.selected = null;
    state.thinking = false;
    state.animating = false;
    animQueue.length = 0;
    var hist = chess.history({ verbose: true });
    state.lastMove = hist.length
      ? { from: hist[hist.length - 1].from, to: hist[hist.length - 1].to }
      : null;
    state.gameOver = chess.game_over() || (state.mode === "chat" && !!state.resigned);
    Board3D.setAutoRotate(false);
    Board3D.setOnTap(onTap);
    Board3D.setCanMove(function (sq) {
      var piece = chess.get(sq);
      if (!piece) return false;
      return iControl(piece.color);
    });
    Board3D.syncFEN(chess.fen());
    Board3D.selectSquare(null);
    Board3D.viewFor(state.viewColor);
    updateHUD();
    toast("Drag to orbit · pinch / scroll to zoom");
    if (state.gameOver) {
      if (state.mode === "chat" && state.resigned && !chess.game_over()) {
        $("over-title").textContent = "Resignation";
        $("over-sub").textContent =
          seatName(state.resigned) + " resigned · " + (state.resigned === "w" ? "Black" : "White") + " wins";
      } else {
        $("over-title").textContent = chess.in_checkmate() ? "Checkmate" : chess.in_draw() ? "Draw" : "Game over";
        $("over-sub").textContent = resultSub();
      }
      $("over").classList.remove("hidden");
      return;
    }
    if (state.mode === "ai" && chess.turn() !== state.playerColor) maybeAI();
  }

  function newAiGame(color) {
    chess = new Chess();
    state.mode = "ai";
    state.playerColor = color;
    state.viewColor = color;
    startGameBoard();
  }

  function newLocalGame() {
    chess = new Chess();
    state.mode = "local";
    state.playerColor = "w";
    state.viewColor = "w";
    startGameBoard();
  }

  function resetPositionKeepMode() {
    chess.reset();
    state.gameOver = false;
    state.selected = null;
    state.lastMove = null;
    state.appliedPly = 0;
    $("over").classList.add("hidden");
    Board3D.syncFEN(chess.fen());
    Board3D.setHighlights({});
    if (state.mode === "ai") state.viewColor = state.playerColor;
    if (state.mode === "local") state.viewColor = "w";
    Board3D.viewFor(state.viewColor);
    updateHUD();
    maybeAI();
  }

  /* ---------- webxdc multiplayer ---------- */

  function refreshLobby() {
    var w = state.seats.w;
    var b = state.seats.b;
    $("seat-w-name").textContent = w ? w.name : "Empty seat";
    $("seat-b-name").textContent = b ? b.name : "Empty seat";
    $("sit-w").disabled = !!(w && w.addr !== selfAddr());
    $("sit-b").disabled = !!(b && b.addr !== selfAddr());
    $("sit-w").textContent = w && w.addr === selfAddr() ? "Seated" : "Sit";
    $("sit-b").textContent = b && b.addr === selfAddr() ? "Seated" : "Sit";
    if (w && b) $("lobby-status").textContent = "Both seats filled — the game is live.";
    else if (w || b) $("lobby-status").textContent = "Waiting for an opponent…";
    else $("lobby-status").textContent = "Sit as White or Black to begin.";
  }

  function sit(color) {
    var other = color === "w" ? "b" : "w";
    if (state.seats[color] && state.seats[color].addr === selfAddr()) return;
    if (state.seats[color] && state.seats[color].addr !== selfAddr()) {
      toast("That seat is taken");
      return;
    }
    if (state.seats[other] && state.seats[other].addr === selfAddr()) {
      toast("You already sat down");
      return;
    }
    if (!window.webxdc) installMock();
    var payload = {
      t: "sit",
      game: state.gameId,
      color: color,
      addr: selfAddr(),
      name: selfName()
    };
    handlePayload(payload);
    xdcSend({
      payload: payload,
      info: selfName() + " sat as " + (color === "w" ? "White" : "Black"),
      summary: "Chess"
    });
  }

  function playingChat() {
    return state.mode === "chat" && state.screen === "play" && chess === netChess;
  }

  function enterChatGame() {
    if (state.screen === "play" && state.mode === "chat") {
      updateHUD();
      return;
    }
    chess = netChess;
    state.mode = "chat";
    var me =
      (state.seats.w && state.seats.w.addr === selfAddr() && "w") ||
      (state.seats.b && state.seats.b.addr === selfAddr() && "b") ||
      null;
    state.playerColor = me || "w";
    state.viewColor = me || "w";
    startGameBoard();
  }

  function handlePayload(p) {
    if (!p || !p.t) return;
    console.debug("[xdc] recv" + (hydrating ? " (hydrating)" : ""), p);
    var newGame = !!(p.game && p.game > state.gameId);
    if (newGame) {
      state.gameId = p.game;
      netChess.reset();
      state.lastMove = null;
      state.appliedPly = 0;
      state.gameOver = false;
      state.resigned = null;
      animQueue.length = 0;
      if (playingChat()) {
        Board3D.syncFEN(netChess.fen());
        Board3D.setHighlights({});
        $("over").classList.add("hidden");
        updateHUD();
      }
    }
    if (p.game && p.game < state.gameId) return;

    if (p.t === "sit") {
      if (!state.seats[p.color]) {
        state.seats[p.color] = { addr: p.addr, name: p.name };
      }
      if (state.screen === "lobby") refreshLobby();
      if (!hydrating && state.seats.w && state.seats.b && state.screen === "lobby") {
        enterChatGame();
      } else if (playingChat()) updateHUD();
    }

    if (p.t === "move") {
      if (p.n !== netChess.history().length) return;
      var mv = netChess.move({
        from: p.from,
        to: p.to,
        promotion: p.promo || undefined
      });
      if (!mv) return;
      if (hydrating) {
        state.lastMove = { from: mv.from, to: mv.to };
        state.appliedPly = netChess.history().length;
        return;
      }
      if (!playingChat()) return;
      if (p.addr === selfAddr()) return;
      if (state.animating) animQueue.push(mv);
      else applyAndAnimate(mv, true);
    }

    if (p.t === "resign") {
      if (p.game && p.game !== state.gameId) return;
      if (p.color !== "w" && p.color !== "b") return;
      state.resigned = p.color;
      if (hydrating) {
        state.gameOver = true;
        return;
      }
      if (!playingChat()) return;
      var winner = p.color === "w" ? "Black" : "White";
      endGame("Resignation", seatName(p.color) + " resigned · " + winner + " wins");
    }

    // The reset itself happens in the newGame block above; repeats are ignored.
    if (p.t === "rematch" && newGame && playingChat()) toast("New game");
  }

  function startChat() {
    state.mode = "chat";
    state.screen = "lobby";
    hideAllScreens();
    show("lobby");
    Board3D.setAutoRotate(true);
    refreshLobby();
    sendHello();
    if (state.seats.w && state.seats.b) enterChatGame();
  }

  function undo() {
    if (state.mode === "chat" || state.animating || state.thinking) return;
    if (!chess.history().length) return;
    chess.undo();
    if (state.mode === "ai" && chess.turn() !== state.playerColor && chess.history().length) {
      chess.undo();
    }
    state.lastMove = null;
    var h = chess.history({ verbose: true });
    if (h.length) state.lastMove = { from: h[h.length - 1].from, to: h[h.length - 1].to };
    state.gameOver = false;
    $("over").classList.add("hidden");
    deselect();
    Board3D.syncFEN(chess.fen());
    updateHUD();
  }

  function resign() {
    if (state.gameOver) return;
    var color = chess.turn();
    if (state.mode === "ai") color = state.playerColor;
    if (state.mode === "chat") {
      if (state.seats.w && state.seats.w.addr === selfAddr()) color = "w";
      else if (state.seats.b && state.seats.b.addr === selfAddr()) color = "b";
      else return;
      state.resigned = color;
      xdcSend({
        payload: { t: "resign", game: state.gameId, color: color, addr: selfAddr() },
        info: selfName() + " resigned",
        summary: "Resignation"
      });
    }
    var winner = color === "w" ? "Black" : "White";
    endGame("Resignation", seatName(color) + " resigned · " + winner + " wins");
  }

  function rematch() {
    if (state.mode === "chat") {
      var payload = { t: "rematch", game: state.gameId + 1, addr: selfAddr() };
      handlePayload(payload);
      xdcSend({
        payload: payload,
        info: selfName() + " started a new game",
        summary: "New game"
      });
      return;
    }
    resetPositionKeepMode();
  }

  function applyQuality() {
    var q = state.quality;
    if (q === "auto") {
      var mobile = window.innerWidth < 700 || /Mobi|Android/i.test(navigator.userAgent);
      q = mobile ? "low" : "high";
    }
    Board3D.setQuality(q);
  }

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem("aurum-settings") || "{}");
      if (typeof s.sound === "boolean") state.sound = s.sound;
      if (typeof s.hints === "boolean") state.hints = s.hints;
      if (typeof s.coords === "boolean") state.coords = s.coords;
      if (typeof s.autoFlip === "boolean") state.autoFlip = s.autoFlip;
      if (s.quality) state.quality = s.quality;
    } catch (e) {
      console.debug("[settings] load failed", e);
    }
    $("opt-sound").checked = state.sound;
    $("opt-hints").checked = state.hints;
    $("opt-coords").checked = state.coords;
    $("opt-autoflip").checked = state.autoFlip;
    $("opt-quality").value = state.quality;
  }

  function saveSettings() {
    localStorage.setItem(
      "aurum-settings",
      JSON.stringify({
        sound: state.sound,
        hints: state.hints,
        coords: state.coords,
        autoFlip: state.autoFlip,
        quality: state.quality
      })
    );
  }

  var confirmCb = null;
  function askConfirm(title, sub, cb) {
    $("confirm-title").textContent = title;
    $("confirm-sub").textContent = sub;
    confirmCb = cb;
    $("confirm").classList.remove("hidden");
  }

  function bind() {
    $("btn-ai").onclick = function () {
      hideAllScreens();
      show("ai-setup");
    };
    $("btn-chat").onclick = startChat;
    $("btn-local").onclick = newLocalGame;
    $("ai-back").onclick = goMenu;
    $("lobby-back").onclick = goMenu;
    $("lobby-watch").onclick = function () {
      enterChatGame();
    };

    $("levels").onclick = function (e) {
      var card = e.target.closest("[data-level]");
      if (!card) return;
      state.aiLevel = card.getAttribute("data-level");
      [].forEach.call($("levels").querySelectorAll(".card"), function (c) {
        c.classList.toggle("active", c === card);
      });
    };
    $("ai-white").onclick = function () {
      newAiGame("w");
    };
    $("ai-black").onclick = function () {
      newAiGame("b");
    };
    function bindTap(el, fn) {
      if (!el) return;
      el.addEventListener("click", function (e) {
        e.preventDefault();
        fn();
      });
    }
    bindTap($("sit-w"), function () {
      sit("w");
    });
    bindTap($("sit-b"), function () {
      sit("b");
    });

    $("btn-menu").onclick = function () {
      askConfirm("Leave game?", "Return to the main menu.", goMenu);
    };
    $("btn-moves").onclick = function () {
      $("moves").classList.toggle("open");
    };
    $("btn-zoom-in").onclick = function () {
      Board3D.zoomBy(0.82);
    };
    $("btn-zoom-out").onclick = function () {
      Board3D.zoomBy(1.22);
    };
    $("btn-flip").onclick = function () {
      state.viewColor = state.viewColor === "w" ? "b" : "w";
      Board3D.viewFor(state.viewColor);
      updateHUD();
    };
    $("btn-cam").onclick = function () {
      state.camMode = (state.camMode + 1) % 3;
      if (state.camMode === 0) Board3D.viewFor(state.viewColor);
      else if (state.camMode === 1) Board3D.viewFor(state.viewColor === "w" ? "b" : "w");
      else Board3D.topView();
    };
    $("btn-undo").onclick = undo;
    $("btn-resign").onclick = function () {
      askConfirm("Resign?", "This will end the game.", resign);
    };
    $("btn-settings").onclick = function () {
      $("settings").classList.remove("hidden");
    };
    $("settings-close").onclick = function () {
      $("settings").classList.add("hidden");
    };
    $("opt-sound").onchange = function () {
      state.sound = this.checked;
      saveSettings();
    };
    $("opt-hints").onchange = function () {
      state.hints = this.checked;
      saveSettings();
      paintHighlights();
    };
    $("opt-coords").onchange = function () {
      state.coords = this.checked;
      Board3D.setCoords(this.checked);
      saveSettings();
    };
    $("opt-autoflip").onchange = function () {
      state.autoFlip = this.checked;
      saveSettings();
    };
    $("opt-quality").onchange = function () {
      state.quality = this.value;
      applyQuality();
      saveSettings();
    };

    $("promo-row").onclick = function (e) {
      var b = e.target.closest("[data-p]");
      if (!b || !state.promo) return;
      var p = b.getAttribute("data-p");
      var from = state.promo.from;
      var to = state.promo.to;
      state.promo = null;
      $("promo").classList.add("hidden");
      commitMove(from, to, p);
    };
    $("promo-cancel").onclick = function () {
      state.promo = null;
      $("promo").classList.add("hidden");
      deselect();
    };

    $("over-again").onclick = rematch;
    $("over-menu").onclick = goMenu;
    $("confirm-yes").onclick = function () {
      $("confirm").classList.add("hidden");
      var fn = confirmCb;
      confirmCb = null;
      if (fn) fn();
    };
    $("confirm-no").onclick = function () {
      $("confirm").classList.add("hidden");
      confirmCb = null;
    };

    window.addEventListener("resize", function () {
      Board3D.resize();
    });
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        deselect();
        $("settings").classList.add("hidden");
        $("promo").classList.add("hidden");
      } else if (e.key === "f" || e.key === "F") {
        $("btn-flip").click();
      } else if (e.key === "u" || e.key === "U") undo();
      else if (e.key === "+" || e.key === "=") Board3D.zoomBy(0.82);
      else if (e.key === "-" || e.key === "_") Board3D.zoomBy(1.22);
    });

    document.body.addEventListener(
      "touchmove",
      function (e) {
        if (e.target.closest && e.target.closest(".moves.open, #debug-panel .dbg-list")) return;
        e.preventDefault();
      },
      { passive: false }
    );
  }

  function finishHydrate() {
    if (!hydrating && listenerReady) return;
    hydrating = false;
    listenerReady = true;
    joinRealtime();
    while (pendingSends.length) xdcSend(pendingSends.shift());
    if (state.screen === "lobby") {
      refreshLobby();
      if (state.seats.w && state.seats.b) enterChatGame();
    }
  }

  function connectXdc() {
    if (!window.webxdc) installMock();
    if (!window.webxdc || !webxdc.setUpdateListener) {
      finishHydrate();
      return;
    }
    try {
      var ready = webxdc.setUpdateListener(function (update) {
        if (!update) return;
        if (update.serial) state.seenSerial = update.serial;
        handlePayload(update.payload);
      }, 0);
      if (ready && typeof ready.then === "function") {
        ready.then(finishHydrate, finishHydrate);
      } else {
        finishHydrate();
      }
    } catch (e) {
      finishHydrate();
    }
    setTimeout(finishHydrate, 2000);
  }

  function boot() {
    loadSettings();
    bind();
    connectXdc();
    try {
      Board3D.init($("scene"));
      Board3D.setCoords(state.coords);
      applyQuality();
      console.info("[app] Board ready, renderer=" + Board3D.mode());
    } catch (e) {
      try {
        console.warn("Board init failed", e);
      } catch (e2) {
        console.debug("[app] console.warn failed", e2);
      }
    }
    $("loader").classList.add("hidden");
    show("menu");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
