/**
 * Aurum Chess — minimax AI with alpha-beta pruning.
 * Three strengths: apprentice (easy), tactician (medium), grandmaster (hard).
 * Uses the global Chess object from chess.js.
 */
(function (root) {
  "use strict";

  var VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  // Piece-square tables, a8 → h1 (row-major, rank 8 first) for White.
  var PST = {
    p: [
      0,  0,  0,  0,  0,  0,  0,  0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0
    ],
    n: [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50
    ],
    b: [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -20,-10,-10,-10,-10,-10,-10,-20
    ],
    r: [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0
    ],
    q: [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5,  5,  5,  5,  0,-10,
       -5,  0,  5,  5,  5,  5,  0, -5,
        0,  0,  5,  5,  5,  5,  0, -5,
      -10,  5,  5,  5,  5,  5,  0,-10,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20
    ],
    k: [
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -10,-20,-20,-20,-20,-20,-20,-10,
       20, 20,  0,  0,  0,  0, 20, 20,
       20, 30, 10,  0,  0, 10, 30, 20
    ],
    kEnd: [
      -50,-40,-30,-20,-20,-30,-40,-50,
      -30,-20,-10,  0,  0,-10,-20,-30,
      -30,-10, 20, 30, 30, 20,-10,-30,
      -30,-10, 30, 40, 40, 30,-10,-30,
      -30,-10, 30, 40, 40, 30,-10,-30,
      -30,-10, 20, 30, 30, 20,-10,-30,
      -30,-30,  0,  0,  0,  0,-30,-30,
      -50,-30,-30,-30,-30,-30,-30,-50
    ]
  };

  // Compact opening book keyed by first-4 FEN fields.
  var BOOK = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": ["e4", "d4", "Nf3", "c4"],
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3": ["e5", "c5", "e6", "c6", "d5", "Nf6"],
    "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3": ["d5", "Nf6", "e6", "c5", "g6"],
    "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq -": ["d5", "Nf6", "c5", "g6"],
    "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq c3": ["e5", "Nf6", "c5", "e6", "g6"],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6": ["Nf3", "Nc3", "Bc4", "d4"],
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6": ["Nf3", "Nc3", "c3", "d4"],
    "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": ["d4", "Nf3", "Nc3"],
    "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": ["d4", "Nf3", "Nc3"],
    "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6": ["exd5", "e5", "Nc3", "d4"],
    "rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": ["e5", "Nc3", "d3", "Nf3"],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": ["Nc6", "Nf6", "d6"],
    "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -": ["Bb5", "Bc4", "d4", "Nc3"],
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": ["d6", "Nc6", "e6", "a6"],
    "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq d6": ["c4", "Nf3", "Bf4", "Nc3"],
    "rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w KQkq -": ["c4", "Nf3", "Bg5"],
    "rnbqkbnr/pppp1ppp/8/4p3/3P4/8/PPP1PPPP/RNBQKBNR w KQkq e6": ["dxe5", "Nf3", "d5"],
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq -": ["Nf6", "Nc6", "Bc5"],
    "rnbqkb1r/pppppppp/5n2/8/2P5/8/PP1PPPPP/RNBQKBNR w KQkq -": ["Nc3", "d4", "Nf3", "g3"]
  };

  var deadline = 0;
  var timedOut = false;
  var nodes = 0;
  var pvMove = null;

  function fenKey(game) {
    return game.fen().split(" ").slice(0, 4).join(" ");
  }

  function isEndgame(board) {
    var q = 0, minors = 0;
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var p = board[r][f];
        if (!p) continue;
        if (p.type === "q") q++;
        else if (p.type === "n" || p.type === "b" || p.type === "r") minors++;
      }
    }
    return q === 0 || (q <= 2 && minors <= 2);
  }

  function evaluateSideToMove(game) {
    var board = game.board();
    var end = isEndgame(board);
    var score = 0;
    var wB = 0, bB = 0;
    var wFiles = [0, 0, 0, 0, 0, 0, 0, 0];
    var bFiles = [0, 0, 0, 0, 0, 0, 0, 0];
    var wr = 0, br = 0, wq = 0, bq = 0;

    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var p = board[r][f];
        if (!p) continue;
        var idx = p.color === "w" ? r * 8 + f : (7 - r) * 8 + f;
        var pst = p.type === "k" && end ? PST.kEnd : PST[p.type];
        var s = VAL[p.type] + (pst ? pst[idx] : 0);
        if (p.color === "w") score += s;
        else score -= s;
        if (p.type === "b") {
          if (p.color === "w") wB++;
          else bB++;
        } else if (p.type === "p") {
          if (p.color === "w") wFiles[f]++;
          else bFiles[f]++;
        } else if (p.type === "r") {
          if (p.color === "w") wr++;
          else br++;
        } else if (p.type === "q") {
          if (p.color === "w") wq++;
          else bq++;
        }
      }
    }

    if (wB >= 2) score += 35;
    if (bB >= 2) score -= 35;

    for (var i = 0; i < 8; i++) {
      if (wFiles[i] > 1) score -= 14 * (wFiles[i] - 1);
      if (bFiles[i] > 1) score += 14 * (bFiles[i] - 1);
      var wIso =
        wFiles[i] &&
        (i === 0 || wFiles[i - 1] === 0) &&
        (i === 7 || wFiles[i + 1] === 0);
      var bIso =
        bFiles[i] &&
        (i === 0 || bFiles[i - 1] === 0) &&
        (i === 7 || bFiles[i + 1] === 0);
      if (wIso) score -= 10;
      if (bIso) score += 10;
    }

    if (game.in_check()) {
      score += game.turn() === "w" ? -18 : 18;
    }

    return game.turn() === "w" ? score : -score;
  }

  function mvvLva(m) {
    var s = 0;
    if (m.captured) s += 10 * VAL[m.captured] - VAL[m.piece];
    if (m.promotion) s += VAL[m.promotion];
    if (m.flags && m.flags.indexOf("k") !== -1) s += 40;
    if (m.flags && m.flags.indexOf("q") !== -1) s += 30;
    if (pvMove && m.from === pvMove.from && m.to === pvMove.to && m.promotion === pvMove.promotion) {
      s += 5000;
    }
    return s;
  }

  function orderMoves(moves) {
    moves.sort(function (a, b) {
      return mvvLva(b) - mvvLva(a);
    });
    return moves;
  }

  function qsearch(game, alpha, beta, qply) {
    if (Date.now() > deadline) {
      timedOut = true;
      return 0;
    }
    var stand = evaluateSideToMove(game);
    if (qply >= 4) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    var moves = game.moves({ verbose: true });
    var i, m, val;
    for (i = 0; i < moves.length; i++) {
      m = moves[i];
      if (!m.captured && !m.promotion) continue;
      game.move(m);
      val = -qsearch(game, -beta, -alpha, qply + 1);
      game.undo();
      if (timedOut) return 0;
      if (val >= beta) return beta;
      if (val > alpha) alpha = val;
    }
    return alpha;
  }

  function negamax(game, depth, alpha, beta, ply) {
    if (Date.now() > deadline) {
      timedOut = true;
      return 0;
    }
    nodes++;
    if (game.in_threefold_repetition && game.in_threefold_repetition()) return 0;
    if (game.insufficient_material && game.insufficient_material()) return 0;
    if (depth <= 0) return qsearch(game, alpha, beta, 0);

    var moves = game.moves({ verbose: true });
    if (moves.length === 0) {
      return game.in_check() ? -20000 + ply : 0;
    }
    orderMoves(moves);
    var best = -Infinity;
    var i, val;
    for (i = 0; i < moves.length; i++) {
      game.move(moves[i]);
      val = -negamax(game, depth - 1, -beta, -alpha, ply + 1);
      game.undo();
      if (timedOut) return 0;
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (alpha >= beta) break;
    }
    return best;
  }

  function searchRoot(game, depth) {
    var moves = orderMoves(game.moves({ verbose: true }).slice());
    var bestMove = moves[0];
    var bestVal = -Infinity;
    var alpha = -Infinity;
    var beta = Infinity;
    var i, val;
    for (i = 0; i < moves.length; i++) {
      game.move(moves[i]);
      val = -negamax(game, depth - 1, -beta, -alpha, 1);
      game.undo();
      if (timedOut) break;
      if (val > bestVal) {
        bestVal = val;
        bestMove = moves[i];
        pvMove = moves[i];
      }
      if (val > alpha) alpha = val;
    }
    return timedOut && depth > 1 ? null : bestMove;
  }

  function pickBook(game) {
    var list = BOOK[fenKey(game)];
    if (!list) return null;
    var legal = game.moves();
    var set = {};
    var i;
    for (i = 0; i < legal.length; i++) set[legal[i]] = true;
    var opts = [];
    for (i = 0; i < list.length; i++) if (set[list[i]]) opts.push(list[i]);
    if (!opts.length) return null;
    var san = opts[(Math.random() * opts.length) | 0];
    var verbose = game.moves({ verbose: true });
    for (i = 0; i < verbose.length; i++) if (verbose[i].san === san) return verbose[i];
    return null;
  }

  function chooseEasy(game, moves) {
    // 50% of the time: a half-reasonable capture or a random legal move.
    if (Math.random() < 0.5) {
      var caps = [];
      var i;
      for (i = 0; i < moves.length; i++) if (moves[i].captured) caps.push(moves[i]);
      if (caps.length && Math.random() < 0.45) {
        return caps[(Math.random() * caps.length) | 0];
      }
      return moves[(Math.random() * moves.length) | 0];
    }
    deadline = Date.now() + 90;
    timedOut = false;
    pvMove = null;
    var copy = new Chess(game.fen());
    return searchRoot(copy, 1) || moves[0];
  }

  function choose(game, level) {
    var moves = game.moves({ verbose: true });
    if (!moves.length) return null;

    if (level === "easy") return chooseEasy(game, moves);

    if (game.history().length < 12) {
      var book = pickBook(game);
      if (book) return book;
    }

    var copy = new Chess(game.fen());
    var maxD = level === "hard" ? 4 : 3;
    var time = level === "hard" ? 1200 : 420;
    deadline = Date.now() + time;
    timedOut = false;
    nodes = 0;
    pvMove = null;
    var best = moves[0];
    var d, found;
    for (d = 1; d <= maxD; d++) {
      found = searchRoot(copy, d);
      if (timedOut) break;
      if (found) best = found;
    }
    return best;
  }

  root.ChessAI = {
    choose: choose,
    evaluate: evaluateSideToMove,
    VAL: VAL
  };
})(typeof window !== "undefined" ? window : global);
