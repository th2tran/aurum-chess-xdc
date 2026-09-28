/**
 * Aurum Chess — 3D board with a 2D fallback for limited WebGL.
 * Solid checkerboard (no noisy textures). Wide zoom. Turn-locked grabbing.
 */
(function (root) {
  "use strict";

  var FILES = "abcdefgh";
  var PIECE_Y = 0;
  var MAX_R = 56;
  var MIN_R = 4.5;

  var mode = "3d";
  var scene, camera, renderer, clock;
  var boardGroup, piecesGroup, highlightGroup, labelsGroup;
  var ivoryMat, ebonyMat, lightSqMat, darkSqMat;
  var geos = {};
  var pieceMap = {};
  var squareMeshes = {};
  var selectedMesh = null;
  var anims = [];
  var orbit;
  var raycaster, pointer, plane, _v, _offset;
  var canvas;
  var quality = "high";
  var showCoords = true;
  var onTap = null;
  var canMove = null;
  var bobT = 0;
  var envReady = false;
  var ctx2d = null;
  var zoom2d = 1;
  var viewFlipped = false;
  var hi2d = {};
  var fen2d = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  var loopOn = false;

  function hypot(dx, dy) {
    return Math.sqrt(dx * dx + dy * dy);
  }

  function viewportSize() {
    var w = window.innerWidth || 0;
    var h = window.innerHeight || 0;
    if ((!w || !h) && window.visualViewport) {
      w = window.visualViewport.width || w;
      h = window.visualViewport.height || h;
    }
    if (!w) w = (document.documentElement && document.documentElement.clientWidth) || 320;
    if (!h) h = (document.documentElement && document.documentElement.clientHeight) || 480;
    return { w: Math.max(2, w), h: Math.max(2, h) };
  }

  function probeWebGL() {
    try {
      var c = document.createElement("canvas");
      var gl =
        c.getContext("webgl", { failIfMajorPerformanceCaveat: false }) ||
        c.getContext("experimental-webgl", { failIfMajorPerformanceCaveat: false });
      return !!gl;
    } catch (e) {
      return false;
    }
  }

  function lathe(pts, seg) {
    var v2 = [];
    for (var i = 0; i < pts.length; i++) v2.push(new THREE.Vector2(pts[i][0], pts[i][1]));
    var g = new THREE.LatheGeometry(v2, seg || 28);
    g.computeVertexNormals();
    return g;
  }

  function tag(obj, extra) {
    obj.traverse(function (c) {
      if (c.isMesh) {
        c.castShadow = quality === "high";
        c.receiveShadow = true;
        c.userData.root = extra || obj;
      }
    });
    return obj;
  }

  function makeGeos(seg) {
    geos.p = lathe(
      [
        [0, 0], [0.23, 0], [0.23, 0.045], [0.19, 0.07], [0.155, 0.1],
        [0.14, 0.28], [0.175, 0.32], [0.14, 0.355], [0.12, 0.38],
        [0.155, 0.42], [0.175, 0.5], [0.155, 0.58], [0.1, 0.64], [0.0, 0.66]
      ],
      seg
    );
    geos.rBody = lathe(
      [
        [0, 0], [0.255, 0], [0.255, 0.05], [0.21, 0.08], [0.175, 0.12],
        [0.16, 0.5], [0.2, 0.54], [0.2, 0.62], [0.175, 0.64], [0.175, 0.72], [0.0, 0.72]
      ],
      seg
    );
    geos.b = lathe(
      [
        [0, 0], [0.24, 0], [0.24, 0.048], [0.2, 0.075], [0.155, 0.11],
        [0.125, 0.42], [0.165, 0.47], [0.13, 0.51], [0.12, 0.58],
        [0.16, 0.68], [0.13, 0.78], [0.07, 0.84], [0.05, 0.88],
        [0.07, 0.92], [0.04, 0.95], [0.0, 0.96]
      ],
      seg
    );
    geos.q = lathe(
      [
        [0, 0], [0.26, 0], [0.26, 0.05], [0.215, 0.08], [0.165, 0.12],
        [0.135, 0.5], [0.185, 0.56], [0.145, 0.6], [0.125, 0.68],
        [0.17, 0.82], [0.15, 0.92], [0.12, 0.98], [0.16, 1.02], [0.0, 1.02]
      ],
      seg
    );
    geos.k = lathe(
      [
        [0, 0], [0.27, 0], [0.27, 0.052], [0.22, 0.085], [0.17, 0.125],
        [0.14, 0.55], [0.195, 0.61], [0.15, 0.65], [0.13, 0.74],
        [0.175, 0.9], [0.14, 1.0], [0.1, 1.05], [0.0, 1.05]
      ],
      seg
    );
    geos.nBase = lathe(
      [
        [0, 0], [0.25, 0], [0.25, 0.048], [0.205, 0.078], [0.16, 0.115],
        [0.145, 0.28], [0.185, 0.33], [0.15, 0.37], [0.13, 0.4], [0.0, 0.4]
      ],
      seg
    );
    geos.pearl = new THREE.SphereGeometry(0.032, 10, 8);
    geos.battlement = new THREE.BoxGeometry(0.09, 0.1, 0.18);
    geos.crossV = new THREE.BoxGeometry(0.048, 0.18, 0.048);
    geos.crossH = new THREE.BoxGeometry(0.14, 0.048, 0.048);
    geos.ear = new THREE.ConeGeometry(0.035, 0.12, 8);
    geos.sphere = new THREE.SphereGeometry(1, 14, 12);
    geos.cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
    geos.cone = new THREE.ConeGeometry(1, 1, 10);
  }

  function phong(color, shininess) {
    return new THREE.MeshPhongMaterial({
      color: color,
      shininess: shininess == null ? 36 : shininess,
      specular: 0x3a3a3a,
      flatShading: false
    });
  }

  function makeKnight(mat, color) {
    var g = new THREE.Group();
    g.add(new THREE.Mesh(geos.nBase, mat));
    var chest = new THREE.Mesh(geos.sphere, mat);
    chest.scale.set(0.15, 0.2, 0.13);
    chest.position.set(0, 0.52, 0.02);
    g.add(chest);
    var neck = new THREE.Mesh(geos.cyl, mat);
    neck.scale.set(0.075, 0.22, 0.09);
    neck.position.set(0, 0.64, -0.05);
    neck.rotation.x = 0.55;
    g.add(neck);
    var head = new THREE.Mesh(geos.sphere, mat);
    head.scale.set(0.1, 0.1, 0.13);
    head.position.set(0, 0.8, -0.14);
    g.add(head);
    var snout = new THREE.Mesh(geos.sphere, mat);
    snout.scale.set(0.07, 0.06, 0.11);
    snout.position.set(0, 0.74, -0.26);
    g.add(snout);
    var jaw = new THREE.Mesh(geos.sphere, mat);
    jaw.scale.set(0.055, 0.04, 0.08);
    jaw.position.set(0, 0.68, -0.22);
    g.add(jaw);
    var muzzle = new THREE.Mesh(geos.cone, mat);
    muzzle.scale.set(0.045, 0.08, 0.045);
    muzzle.position.set(0, 0.73, -0.34);
    muzzle.rotation.x = -Math.PI / 2;
    g.add(muzzle);
    var earL = new THREE.Mesh(geos.ear, mat);
    earL.position.set(-0.05, 0.92, -0.1);
    earL.rotation.x = -0.25;
    earL.rotation.z = -0.25;
    g.add(earL);
    var earR = new THREE.Mesh(geos.ear, mat);
    earR.position.set(0.05, 0.92, -0.1);
    earR.rotation.x = -0.25;
    earR.rotation.z = 0.25;
    g.add(earR);
    var mane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.12), mat);
    mane.position.set(0, 0.78, -0.02);
    mane.rotation.x = 0.4;
    g.add(mane);
    g.userData.kind = "n";
    g.userData.color = color;
    if (color === "b") g.rotation.y = Math.PI;
    return tag(g);
  }

  function makeRook(mat) {
    var g = new THREE.Group();
    g.add(new THREE.Mesh(geos.rBody, mat));
    for (var i = 0; i < 4; i++) {
      var m = new THREE.Mesh(geos.battlement, mat);
      var a = (i * Math.PI) / 2;
      m.position.set(Math.cos(a) * 0.13, 0.77, Math.sin(a) * 0.13);
      m.rotation.y = a;
      g.add(m);
    }
    return tag(g);
  }

  function makeQueen(mat) {
    var g = new THREE.Group();
    g.add(new THREE.Mesh(geos.q, mat));
    for (var i = 0; i < 8; i++) {
      var m = new THREE.Mesh(geos.pearl, mat);
      var a = (i * Math.PI) / 4 + Math.PI / 8;
      m.position.set(Math.cos(a) * 0.14, 1.05, Math.sin(a) * 0.14);
      g.add(m);
    }
    var top = new THREE.Mesh(geos.pearl, mat);
    top.scale.setScalar(1.2);
    top.position.y = 1.08;
    g.add(top);
    return tag(g);
  }

  function makeKing(mat) {
    var g = new THREE.Group();
    g.add(new THREE.Mesh(geos.k, mat));
    var v = new THREE.Mesh(geos.crossV, mat);
    v.position.y = 1.16;
    g.add(v);
    var h = new THREE.Mesh(geos.crossH, mat);
    h.position.y = 1.16;
    g.add(h);
    return tag(g);
  }

  function makeBishop(mat) {
    var g = new THREE.Group();
    g.add(new THREE.Mesh(geos.b, mat));
    return tag(g);
  }

  function makePawn(mat) {
    var m = new THREE.Mesh(geos.p, mat);
    return tag(m, m);
  }

  function makePiece(type, color) {
    var mat = color === "w" ? ivoryMat : ebonyMat;
    var obj;
    switch (type) {
      case "p": obj = makePawn(mat); break;
      case "r": obj = makeRook(mat); break;
      case "n": obj = makeKnight(mat, color); break;
      case "b": obj = makeBishop(mat); break;
      case "q": obj = makeQueen(mat); break;
      case "k": obj = makeKing(mat); break;
      default: obj = makePawn(mat);
    }
    obj.userData.type = type;
    obj.userData.color = color;
    obj.userData.root = obj;
    return obj;
  }

  function sqToWorld(square, y) {
    var file = square.charCodeAt(0) - 97;
    var rank = square.charCodeAt(1) - 49;
    return new THREE.Vector3(file - 3.5, y == null ? PIECE_Y : y, 3.5 - rank);
  }

  function worldToSq(x, z) {
    var file = Math.round(x + 3.5);
    var rank = Math.round(3.5 - z);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return FILES[file] + (rank + 1);
  }

  function allowedGrab(sq) {
    if (!sq || !canMove) return false;
    try {
      return !!canMove(sq);
    } catch (e) {
      return false;
    }
  }

  function makeLabel(text) {
    try {
      var c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      var ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillStyle = "#d7c07a";
      ctx.font = "600 36px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 32, 34);
      var tex = new THREE.CanvasTexture(c);
      tex.needsUpdate = true;
      var mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false
      });
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.skipRay = true;
      return mesh;
    } catch (e) {
      return null;
    }
  }

  function checkerTexture(aniso) {
    var size = 1024;
    var cell = size / 8;
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var ctx = c.getContext("2d");
    var x, y;
    ctx.imageSmoothingEnabled = false;
    for (y = 0; y < 8; y++) {
      for (x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 === 1 ? "#8e8e8a" : "#161616";
        ctx.fillRect(x * cell, (7 - y) * cell, cell, cell);
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = aniso || 8;
    tex.needsUpdate = true;
    return tex;
  }

  function buildBoard() {
    boardGroup = new THREE.Group();

    var frame = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.28, 9.2), phong(0x141414, 6));
    frame.position.y = -0.16;
    frame.receiveShadow = true;
    boardGroup.add(frame);

    var aniso = 8;
    try {
      if (renderer && renderer.capabilities) {
        aniso = renderer.capabilities.getMaxAnisotropy() || 8;
      }
    } catch (e) {}

    var boardMat = new THREE.MeshPhongMaterial({
      map: checkerTexture(aniso),
      shininess: 8,
      specular: 0x222222
    });
    var surface = new THREE.Mesh(new THREE.PlaneGeometry(8, 8, 1, 1), boardMat);
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = 0.002;
    surface.receiveShadow = true;
    surface.userData.board = true;
    boardGroup.add(surface);

    var file, rank, hit, sq;
    var hitGeo = new THREE.PlaneGeometry(1, 1);
    var hitMat = new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    for (rank = 0; rank < 8; rank++) {
      for (file = 0; file < 8; file++) {
        sq = FILES[file] + (rank + 1);
        hit = new THREE.Mesh(hitGeo, hitMat);
        hit.rotation.x = -Math.PI / 2;
        hit.position.set(file - 3.5, 0.004, 3.5 - rank);
        hit.userData.square = sq;
        squareMeshes[sq] = hit;
        boardGroup.add(hit);
      }
    }

    labelsGroup = new THREE.Group();
    for (file = 0; file < 8; file++) {
      var lf = makeLabel(FILES[file]);
      if (lf) {
        lf.position.set(file - 3.5, 0.02, 4.22);
        labelsGroup.add(lf);
      }
      var lf2 = makeLabel(FILES[file]);
      if (lf2) {
        lf2.position.set(file - 3.5, 0.02, -4.22);
        lf2.rotation.z = Math.PI;
        labelsGroup.add(lf2);
      }
    }
    for (rank = 0; rank < 8; rank++) {
      var lr = makeLabel(String(rank + 1));
      if (lr) {
        lr.position.set(-4.22, 0.02, 3.5 - rank);
        labelsGroup.add(lr);
      }
      var lr2 = makeLabel(String(rank + 1));
      if (lr2) {
        lr2.position.set(4.22, 0.02, 3.5 - rank);
        labelsGroup.add(lr2);
      }
    }
    boardGroup.add(labelsGroup);

    var felt = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 22, 0.12, 48),
      phong(0x0c3328, 2)
    );
    felt.position.y = -0.4;
    felt.receiveShadow = true;
    boardGroup.add(felt);

    var table = new THREE.Mesh(
      new THREE.CylinderGeometry(24, 24.4, 0.5, 48),
      phong(0x1a120c, 8)
    );
    table.position.y = -0.72;
    table.receiveShadow = true;
    boardGroup.add(table);

    scene.add(boardGroup);
  }

  function Orbit(cam, el) {
    this.camera = cam;
    this.el = el;
    this.target = new THREE.Vector3(0, 0.25, 0);
    this.spherical = new THREE.Spherical(13.5, 0.95, 0);
    this.enabled = true;
    this.autoRotate = true;
    this.autoSpeed = 0.16;
    this.pointers = {};
    this.pointerCount = 0;
    this.rotating = false;
    this.anim = null;
    this._blocked = false;
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    bindPointer(el, this.onDown, this.onMove, this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
  }

  Orbit.prototype.listPointers = function () {
    var a = [];
    for (var k in this.pointers) {
      if (this.pointers.hasOwnProperty(k)) a.push(this.pointers[k]);
    }
    return a;
  };

  Orbit.prototype.pinchDist = function () {
    var a = this.listPointers();
    if (a.length < 2) return 0;
    return hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  };

  Orbit.prototype.onDown = function (e) {
    if (!this.enabled) return;
    if (e.button === 2) e.preventDefault();
    var id = e.pointerId;
    if (this.pointers[id]) return;
    this.pointers[id] = { x: e.clientX, y: e.clientY };
    this.pointerCount++;
    this.autoRotate = false;
    if (this.pointerCount === 1 && !this._blocked) {
      this.rotating = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.startT = this.spherical.theta;
      this.startP = this.spherical.phi;
    }
    if (this.pointerCount === 2) {
      this.rotating = false;
      this.pStart = this.pinchDist();
      this.rStart = this.spherical.radius;
    }
  };

  Orbit.prototype.onMove = function (e) {
    if (!this.pointers[e.pointerId]) return;
    this.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (this.pointerCount === 2 && this.pStart) {
      var d = this.pinchDist();
      this.spherical.radius = this.rStart * (this.pStart / Math.max(40, d));
      this.clamp();
      return;
    }
    if (this.rotating && !this._blocked) {
      var dx = e.clientX - this.startX;
      var dy = e.clientY - this.startY;
      this.spherical.theta = this.startT - dx * 0.007;
      this.spherical.phi = this.startP - dy * 0.005;
      this.clamp();
    }
  };

  Orbit.prototype.onUp = function (e) {
    if (this.pointers[e.pointerId]) {
      delete this.pointers[e.pointerId];
      this.pointerCount = Math.max(0, this.pointerCount - 1);
    }
    if (this.pointerCount < 2) this.pStart = null;
    if (this.pointerCount === 0) this.rotating = false;
  };

  Orbit.prototype.onWheel = function (e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.autoRotate = false;
    this.spherical.radius *= Math.exp(e.deltaY * 0.0012);
    this.clamp();
  };

  Orbit.prototype.clamp = function () {
    this.spherical.phi = Math.max(0.08, Math.min(Math.PI / 2 - 0.04, this.spherical.phi));
    this.spherical.radius = Math.max(MIN_R, Math.min(MAX_R, this.spherical.radius));
  };

  Orbit.prototype.block = function (v) {
    this._blocked = v;
    if (v) this.rotating = false;
  };

  Orbit.prototype.zoomBy = function (f) {
    this.autoRotate = false;
    this.spherical.radius *= f;
    this.clamp();
  };

  Orbit.prototype.animateTo = function (theta, phi, radius, ms) {
    this.anim = {
      fromT: this.spherical.theta,
      fromP: this.spherical.phi,
      fromR: this.spherical.radius,
      toT: theta,
      toP: phi == null ? this.spherical.phi : phi,
      toR: radius == null ? this.spherical.radius : radius,
      t0: nowMs(),
      ms: ms || 700
    };
    this.autoRotate = false;
  };

  Orbit.prototype.update = function (dt) {
    if (this.anim) {
      var t = (nowMs() - this.anim.t0) / this.anim.ms;
      if (t >= 1) {
        this.spherical.theta = this.anim.toT;
        this.spherical.phi = this.anim.toP;
        this.spherical.radius = this.anim.toR;
        this.anim = null;
      } else {
        var e = 1 - Math.pow(1 - t, 3);
        this.spherical.theta = this.anim.fromT + (this.anim.toT - this.anim.fromT) * e;
        this.spherical.phi = this.anim.fromP + (this.anim.toP - this.anim.fromP) * e;
        this.spherical.radius = this.anim.fromR + (this.anim.toR - this.anim.fromR) * e;
      }
    } else if (this.autoRotate && this.enabled) {
      this.spherical.theta += this.autoSpeed * dt;
    }
    this.clamp();
    _offset.setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(_offset);
    this.camera.lookAt(this.target);
  };

  function nowMs() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateTo(obj, to, ms, arc, onDone) {
    var from = obj.position.clone();
    var t0 = nowMs();
    anims.push({
      tick: function (now) {
        var t = Math.min(1, (now - t0) / ms);
        var e = easeOutCubic(t);
        obj.position.lerpVectors(from, to, e);
        if (arc) obj.position.y += Math.sin(t * Math.PI) * arc;
        if (t >= 1) {
          obj.position.copy(to);
          if (onDone) onDone();
          return false;
        }
        return true;
      }
    });
  }

  function fadeOut(obj, ms, onDone) {
    var t0 = nowMs();
    var startY = obj.position.y;
    anims.push({
      tick: function (now) {
        var t = Math.min(1, (now - t0) / ms);
        obj.position.y = startY - t * 0.35;
        obj.scale.setScalar(1 - t * 0.4);
        if (t >= 1) {
          if (onDone) onDone();
          return false;
        }
        return true;
      }
    });
  }

  function clearHighlights() {
    if (!highlightGroup) return;
    while (highlightGroup.children.length) {
      highlightGroup.remove(highlightGroup.children[0]);
    }
  }

  function addOverlay(square, color, opacity, y) {
    var m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.98, 0.98),
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        depthWrite: false
      })
    );
    var p = sqToWorld(square, y == null ? 0.016 : y);
    m.position.copy(p);
    m.rotation.x = -Math.PI / 2;
    m.userData.skipRay = true;
    highlightGroup.add(m);
    return m;
  }

  function addDot(square, capture) {
    var m;
    if (capture) {
      m = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.42, 24),
        new THREE.MeshBasicMaterial({
          color: 0xe07050,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );
    } else {
      m = new THREE.Mesh(
        new THREE.CircleGeometry(0.14, 20),
        new THREE.MeshBasicMaterial({
          color: 0xe8d48a,
          transparent: true,
          opacity: 0.72,
          depthWrite: false
        })
      );
    }
    var p = sqToWorld(square, 0.02);
    m.position.copy(p);
    m.rotation.x = -Math.PI / 2;
    m.userData.skipRay = true;
    highlightGroup.add(m);
  }

  function syncFEN3D(fen) {
    while (piecesGroup.children.length) piecesGroup.remove(piecesGroup.children[0]);
    pieceMap = {};
    selectedMesh = null;
    var tmp = new Chess(fen);
    var board = tmp.board();
    var r, f, p, sq, mesh, pos;
    for (r = 0; r < 8; r++) {
      for (f = 0; f < 8; f++) {
        p = board[r][f];
        if (!p) continue;
        sq = FILES[f] + (8 - r);
        mesh = makePiece(p.type, p.color);
        pos = sqToWorld(sq, PIECE_Y);
        mesh.position.copy(pos);
        mesh.userData.square = sq;
        piecesGroup.add(mesh);
        pieceMap[sq] = mesh;
      }
    }
  }

  function castleRookSquares(move) {
    if (move.flags.indexOf("k") !== -1) {
      return move.color === "w" ? { from: "h1", to: "f1" } : { from: "h8", to: "f8" };
    }
    if (move.flags.indexOf("q") !== -1) {
      return move.color === "w" ? { from: "a1", to: "d1" } : { from: "a8", to: "d8" };
    }
    return null;
  }

  function epSquare(move) {
    if (move.flags.indexOf("e") === -1) return null;
    return move.to[0] + move.from[1];
  }

  function playMove3D(move) {
    return new Promise(function (resolve) {
      var fromMesh = pieceMap[move.from];
      if (!fromMesh) {
        syncFEN3D(new Chess().fen());
        resolve();
        return;
      }
      var dest = sqToWorld(move.to, PIECE_Y);
      var capturedSq = move.captured ? epSquare(move) || move.to : null;
      var cap = capturedSq ? pieceMap[capturedSq] : null;
      var isKnight = move.piece === "n";
      var remaining = 1;
      function done() {
        remaining--;
        if (remaining <= 0) resolve();
      }
      delete pieceMap[move.from];
      if (cap) {
        remaining++;
        fadeOut(cap, 280, function () {
          piecesGroup.remove(cap);
          done();
        });
        if (pieceMap[capturedSq] === cap) delete pieceMap[capturedSq];
      }
      var rook = castleRookSquares(move);
      if (rook && pieceMap[rook.from]) {
        remaining++;
        var rm = pieceMap[rook.from];
        delete pieceMap[rook.from];
        pieceMap[rook.to] = rm;
        rm.userData.square = rook.to;
        animateTo(rm, sqToWorld(rook.to, PIECE_Y), 380, 0, done);
      }
      pieceMap[move.to] = fromMesh;
      fromMesh.userData.square = move.to;
      animateTo(fromMesh, dest, 420, isKnight ? 0.55 : 0.12, function () {
        if (move.promotion) {
          piecesGroup.remove(fromMesh);
          var neu = makePiece(move.promotion, move.color);
          neu.position.copy(dest);
          neu.userData.square = move.to;
          piecesGroup.add(neu);
          pieceMap[move.to] = neu;
        }
        done();
      });
    });
  }

  function getHits(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || 1;
    var h = rect.height || 1;
    pointer.x = ((clientX - rect.left) / w) * 2 - 1;
    pointer.y = -((clientY - rect.top) / h) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    var hits = raycaster.intersectObjects(scene.children, true);
    var piece = null;
    var square = null;
    var i, hobj, root, sq;
    for (i = 0; i < hits.length; i++) {
      hobj = hits[i];
      if (hobj.object.userData.skipRay) continue;
      root = hobj.object.userData.root;
      if (root && root.userData && root.userData.type && !piece) piece = root;
      sq = hobj.object.userData.square;
      if (sq && !square) square = sq;
    }
    if (!square) {
      var pt = raycaster.ray.intersectPlane(plane, _v);
      if (pt) square = worldToSq(pt.x, pt.z);
    }
    return { piece: piece, square: square };
  }

  var ptr = {
    down: false, x: 0, y: 0, sx: 0, sy: 0, piece: null, dragging: false, id: null
  };

  function onPointerDown(e) {
    if (!onTap) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (mode === "2d") return onDown2D(e);
    var hit = getHits(e.clientX, e.clientY);
    var grab = hit.piece && allowedGrab(hit.piece.userData.square || hit.square);
    ptr.down = true;
    ptr.x = ptr.sx = e.clientX;
    ptr.y = ptr.sy = e.clientY;
    ptr.piece = grab ? hit.piece : null;
    ptr.dragging = false;
    ptr.id = e.pointerId;
    ptr.square = hit.square;
    if (ptr.piece) orbit.block(true);
  }

  function onPointerMove(e) {
    if (mode === "2d") return onMove2D(e);
    if (!ptr.down || e.pointerId !== ptr.id) return;
    var dx = e.clientX - ptr.sx;
    var dy = e.clientY - ptr.sy;
    if (!ptr.dragging && ptr.piece && hypot(dx, dy) > 10) {
      ptr.dragging = true;
      selectedMesh = ptr.piece;
    }
    if (ptr.dragging && ptr.piece) {
      var rect = canvas.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / (rect.width || 1)) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / (rect.height || 1)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var pt = raycaster.ray.intersectPlane(plane, _v);
      if (pt) {
        ptr.piece.position.x = pt.x;
        ptr.piece.position.z = pt.z;
        ptr.piece.position.y = 0.28;
      }
    }
  }

  function onPointerUp(e) {
    if (mode === "2d") return onUp2D(e);
    if (!ptr.down || (e.pointerId !== undefined && e.pointerId !== ptr.id)) return;
    if (orbit) orbit.block(false);
    var dist = hypot(e.clientX - ptr.sx, e.clientY - ptr.sy);
    var hit = getHits(e.clientX, e.clientY);
    if (ptr.dragging && ptr.piece) {
      var from = ptr.piece.userData.square;
      var to = hit.square;
      var home = sqToWorld(from, PIECE_Y);
      ptr.piece.position.copy(home);
      ptr.down = false;
      ptr.dragging = false;
      ptr.piece = null;
      if (to && to !== from && onTap && allowedGrab(from)) onTap(from, to, true);
      return;
    }
    ptr.down = false;
    ptr.dragging = false;
    ptr.piece = null;
    if (dist < 12 && onTap) onTap(hit.square, null, false);
  }

  function bindPointer(el, down, move, up) {
    if (window.PointerEvent) {
      el.addEventListener("pointerdown", down);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }
    el.addEventListener("mousedown", function (e) {
      e.pointerId = 1;
      down(e);
    });
    window.addEventListener("mousemove", function (e) {
      e.pointerId = 1;
      move(e);
    });
    window.addEventListener("mouseup", function (e) {
      e.pointerId = 1;
      up(e);
    });
    el.addEventListener(
      "touchstart",
      function (e) {
        var t = e.changedTouches[0];
        down({ pointerId: t.identifier, clientX: t.clientX, clientY: t.clientY, button: 0 });
        e.preventDefault();
      },
      { passive: false }
    );
    window.addEventListener(
      "touchmove",
      function (e) {
        var t = e.changedTouches[0];
        move({ pointerId: t.identifier, clientX: t.clientX, clientY: t.clientY });
        e.preventDefault();
      },
      { passive: false }
    );
    window.addEventListener("touchend", function (e) {
      var t = e.changedTouches[0];
      up({ pointerId: t.identifier, clientX: t.clientX, clientY: t.clientY });
    });
  }

  function setQuality(q) {
    quality = q;
    if (mode !== "3d" || !renderer) return;
    var high = q === "high";
    renderer.shadowMap.enabled = high;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
    var light = scene && scene.getObjectByName("keyLight");
    if (light) light.castShadow = high;
  }

  function init3D() {
    mode = "3d";
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    _v = new THREE.Vector3();
    _offset = new THREE.Vector3();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07110e);

    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 280);
    var rendererOpts = {
      canvas: canvas,
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: "default",
      preserveDrawingBuffer: true
    };
    try {
      renderer = new THREE.WebGLRenderer(rendererOpts);
    } catch (e) {
      rendererOpts.antialias = false;
      renderer = new THREE.WebGLRenderer(rendererOpts);
    }
    renderer.setClearColor(0x07110e, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    ivoryMat = phong(0xf4ecd8, 48);
    ebonyMat = phong(0x2c2c32, 42);

    makeGeos(28);
    buildBoard();

    piecesGroup = new THREE.Group();
    scene.add(piecesGroup);
    highlightGroup = new THREE.Group();
    scene.add(highlightGroup);

    scene.add(new THREE.AmbientLight(0xd8d4cc, 0.38));
    var hemi = new THREE.HemisphereLight(0xe8e2d4, 0x1a2a22, 0.26);
    scene.add(hemi);
    var key = new THREE.DirectionalLight(0xeeeae0, 0.48);
    key.name = "keyLight";
    key.position.set(6, 14, 8);
    key.castShadow = false;
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xb8c8d8, 0.18);
    fill.position.set(-8, 6, -5);
    scene.add(fill);

    orbit = new Orbit(camera, canvas);
    clock = new THREE.Clock();
    bindPointer(canvas, onPointerDown, onPointerMove, onPointerUp);
    resize();
    syncFEN3D("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    startLoop();
    envReady = true;
  }

  /* ---------------- 2D fallback ---------------- */

  var UNI2 = {
    w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
    b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" }
  };

  function boardRect() {
    var vs = viewportSize();
    var size = Math.min(vs.w, vs.h) * 0.84 * zoom2d;
    return {
      x: vs.w / 2 - size / 2,
      y: vs.h / 2 - size / 2,
      size: size,
      sq: size / 8
    };
  }

  function sqFromPx(cx, cy) {
    var r = boardRect();
    var rect = canvas.getBoundingClientRect();
    var scaleX = (canvas.width || rect.width) / (rect.width || 1);
    var scaleY = (canvas.height || rect.height) / (rect.height || 1);
    var x = (cx - rect.left) * scaleX;
    var y = (cy - rect.top) * scaleY;
    var fx = Math.floor((x - r.x) / r.sq);
    var ry = Math.floor((y - r.y) / r.sq);
    if (fx < 0 || fx > 7 || ry < 0 || ry > 7) return null;
    if (viewFlipped) {
      fx = 7 - fx;
      ry = 7 - ry;
    }
    var rank = 7 - ry;
    return FILES[fx] + (rank + 1);
  }

  function draw2D() {
    if (!ctx2d) return;
    var vs = viewportSize();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== (vs.w * dpr) | 0 || canvas.height !== (vs.h * dpr) | 0) {
      canvas.width = (vs.w * dpr) | 0;
      canvas.height = (vs.h * dpr) | 0;
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.fillStyle = "#07110e";
    ctx2d.fillRect(0, 0, vs.w, vs.h);
    var r = boardRect();
    var pad = r.sq * 0.38;
    var rad = Math.max(6, r.sq * 0.18);
    function roundRect(x, y, w, h, rr) {
      rr = Math.min(rr, w / 2, h / 2);
      ctx2d.beginPath();
      ctx2d.moveTo(x + rr, y);
      ctx2d.arcTo(x + w, y, x + w, y + h, rr);
      ctx2d.arcTo(x + w, y + h, x, y + h, rr);
      ctx2d.arcTo(x, y + h, x, y, rr);
      ctx2d.arcTo(x, y, x + w, y, rr);
      ctx2d.closePath();
    }
    ctx2d.fillStyle = "#141414";
    roundRect(r.x - pad, r.y - pad, r.size + pad * 2, r.size + pad * 2, rad);
    ctx2d.fill();
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.rect(r.x, r.y, r.size, r.size);
    ctx2d.clip();
    var file, rank, fx, ry, isLight, sq;
    for (rank = 0; rank < 8; rank++) {
      for (file = 0; file < 8; file++) {
        fx = viewFlipped ? 7 - file : file;
        ry = viewFlipped ? rank : 7 - rank;
        isLight = (file + rank) % 2 === 1;
        sq = FILES[file] + (rank + 1);
        ctx2d.fillStyle = isLight ? "#b8b8b4" : "#222222";
        ctx2d.fillRect(r.x + fx * r.sq, r.y + ry * r.sq, r.sq + 0.5, r.sq + 0.5);
        if (hi2d.lastFrom === sq || hi2d.lastTo === sq) {
          ctx2d.fillStyle = "rgba(201,162,39,0.38)";
          ctx2d.fillRect(r.x + fx * r.sq, r.y + ry * r.sq, r.sq, r.sq);
        }
        if (hi2d.check === sq) {
          ctx2d.fillStyle = "rgba(196,60,44,0.42)";
          ctx2d.fillRect(r.x + fx * r.sq, r.y + ry * r.sq, r.sq, r.sq);
        }
        if (hi2d.selected === sq) {
          ctx2d.fillStyle = "rgba(240,224,160,0.4)";
          ctx2d.fillRect(r.x + fx * r.sq, r.y + ry * r.sq, r.sq, r.sq);
        }
      }
    }
    ctx2d.restore();
    function mark(list, capture) {
      if (!list) return;
      var i;
      for (i = 0; i < list.length; i++) {
        sq = list[i];
        file = sq.charCodeAt(0) - 97;
        rank = sq.charCodeAt(1) - 49;
        fx = viewFlipped ? 7 - file : file;
        ry = viewFlipped ? rank : 7 - rank;
        var cx = r.x + (fx + 0.5) * r.sq;
        var cy = r.y + (ry + 0.5) * r.sq;
        ctx2d.beginPath();
        if (capture) {
          ctx2d.strokeStyle = "rgba(224,112,80,0.9)";
          ctx2d.lineWidth = Math.max(2, r.sq * 0.06);
          ctx2d.arc(cx, cy, r.sq * 0.38, 0, Math.PI * 2);
          ctx2d.stroke();
        } else {
          ctx2d.fillStyle = "rgba(232,212,138,0.8)";
          ctx2d.arc(cx, cy, r.sq * 0.12, 0, Math.PI * 2);
          ctx2d.fill();
        }
      }
    }
    mark(hi2d.quiet, false);
    mark(hi2d.captures, true);
    if (showCoords) {
      ctx2d.fillStyle = "#d7c07a";
      ctx2d.font = Math.max(10, r.sq * 0.22) + "px sans-serif";
      ctx2d.textAlign = "center";
      ctx2d.textBaseline = "middle";
      for (file = 0; file < 8; file++) {
        fx = viewFlipped ? 7 - file : file;
        ctx2d.fillText(FILES[file], r.x + (fx + 0.5) * r.sq, r.y + r.size + pad * 0.55);
      }
      ctx2d.textAlign = "right";
      for (rank = 0; rank < 8; rank++) {
        ry = viewFlipped ? rank : 7 - rank;
        ctx2d.fillText(String(rank + 1), r.x - pad * 0.25, r.y + (ry + 0.5) * r.sq);
      }
    }
    var tmp = new Chess(fen2d);
    var board = tmp.board();
    var p;
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";
    ctx2d.font = Math.floor(r.sq * 0.72) + "px serif";
    for (rank = 0; rank < 8; rank++) {
      for (file = 0; file < 8; file++) {
        p = board[rank][file];
        if (!p) continue;
        fx = viewFlipped ? 7 - file : file;
        ry = viewFlipped ? 7 - rank : rank;
        ctx2d.fillStyle = p.color === "w" ? "#fff8ea" : "#1a1a1a";
        ctx2d.fillText(
          UNI2[p.color][p.type],
          r.x + (fx + 0.5) * r.sq,
          r.y + (ry + 0.55) * r.sq
        );
      }
    }
  }

  function onDown2D(e) {
    ptr.down = true;
    ptr.sx = e.clientX;
    ptr.sy = e.clientY;
    ptr.id = e.pointerId;
    ptr.square = sqFromPx(e.clientX, e.clientY);
    ptr.piece = ptr.square && allowedGrab(ptr.square) ? ptr.square : null;
    ptr.dragging = false;
  }
  function onMove2D(e) {
    if (!ptr.down) return;
    if (hypot(e.clientX - ptr.sx, e.clientY - ptr.sy) > 12 && ptr.piece) ptr.dragging = true;
  }
  function onUp2D(e) {
    if (!ptr.down) return;
    var dist = hypot(e.clientX - ptr.sx, e.clientY - ptr.sy);
    var sq = sqFromPx(e.clientX, e.clientY);
    if (ptr.dragging && ptr.piece) {
      if (sq && sq !== ptr.piece && onTap && allowedGrab(ptr.piece)) onTap(ptr.piece, sq, true);
    } else if (dist < 14 && onTap) {
      onTap(sq, null, false);
    }
    ptr.down = false;
    ptr.dragging = false;
    ptr.piece = null;
  }

  function init2D() {
    mode = "2d";
    try {
      ctx2d = canvas.getContext("2d");
    } catch (e) {
      ctx2d = null;
    }
    if (!ctx2d) {
      var neu = document.createElement("canvas");
      neu.id = canvas.id || "scene";
      neu.style.cssText = canvas.style.cssText;
      if (canvas.parentNode) canvas.parentNode.replaceChild(neu, canvas);
      canvas = neu;
      ctx2d = canvas.getContext("2d");
    }
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    bindPointer(canvas, onPointerDown, onPointerMove, onPointerUp);
    canvas.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        zoom2d *= Math.exp(-e.deltaY * 0.0012);
        if (zoom2d < 0.45) zoom2d = 0.45;
        if (zoom2d > 2.4) zoom2d = 2.4;
      },
      { passive: false }
    );
    startLoop();
    envReady = true;
  }

  function startLoop() {
    if (loopOn) return;
    loopOn = true;
    function tick() {
      requestAnimationFrame(tick);
      if (mode === "3d" && renderer && scene && camera) {
        var dt = clock ? clock.getDelta() : 0.016;
        bobT += dt;
        var now = nowMs();
        anims = anims.filter(function (a) {
          return a.tick(now);
        });
        if (selectedMesh && selectedMesh.parent && !ptr.dragging) {
          var base = sqToWorld(selectedMesh.userData.square, PIECE_Y);
          selectedMesh.position.x = base.x;
          selectedMesh.position.z = base.z;
          selectedMesh.position.y = 0.16 + Math.sin(bobT * 3.2) * 0.03;
        }
        if (orbit) orbit.update(dt);
        renderer.render(scene, camera);
      } else if (mode === "2d") {
        draw2D();
      }
    }
    tick();
  }

  function resize() {
    var vs = viewportSize();
    if (mode === "3d" && renderer && camera) {
      camera.aspect = vs.w / vs.h;
      camera.updateProjectionMatrix();
      renderer.setSize(vs.w, vs.h, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "low" ? 1 : 2));
    }
  }

  function setHighlights(opts) {
    opts = opts || {};
    hi2d = opts;
    if (mode !== "3d") return;
    clearHighlights();
    if (opts.lastFrom) addOverlay(opts.lastFrom, 0xc9a227, 0.28);
    if (opts.lastTo) addOverlay(opts.lastTo, 0xc9a227, 0.4);
    if (opts.check) addOverlay(opts.check, 0xc43c2c, 0.42);
    if (opts.selected) addOverlay(opts.selected, 0xf0e0a0, 0.38);
    var i;
    if (opts.quiet) for (i = 0; i < opts.quiet.length; i++) addDot(opts.quiet[i], false);
    if (opts.captures) for (i = 0; i < opts.captures.length; i++) addDot(opts.captures[i], true);
  }

  function selectSquare(sq) {
    if (mode === "3d") {
      if (selectedMesh && !ptr.dragging && selectedMesh.userData.square) {
        selectedMesh.position.copy(sqToWorld(selectedMesh.userData.square, PIECE_Y));
      }
      selectedMesh = sq ? pieceMap[sq] : null;
    } else {
      hi2d.selected = sq;
    }
  }

  function init(el) {
    canvas = el;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.touchAction = "none";
    if (!root.THREE || !probeWebGL()) {
      init2D();
      return;
    }
    try {
      init3D();
    } catch (err) {
      try {
        init2D();
      } catch (err2) {}
    }
  }

  root.Board3D = {
    init: init,
    resize: resize,
    syncFEN: function (fen) {
      fen2d = fen;
      if (mode === "3d") syncFEN3D(fen);
    },
    playMove: function (move) {
      if (mode === "3d") return playMove3D(move);
      return new Promise(function (resolve) {
        setTimeout(resolve, 40);
      });
    },
    setHighlights: setHighlights,
    selectSquare: selectSquare,
    setOnTap: function (fn) {
      onTap = fn;
    },
    setCanMove: function (fn) {
      canMove = fn;
    },
    setAutoRotate: function (v) {
      if (orbit) orbit.autoRotate = v;
    },
    setEnabled: function (v) {
      if (orbit) orbit.enabled = v;
    },
    zoomBy: function (f) {
      if (mode === "3d" && orbit) orbit.zoomBy(f);
      else {
        zoom2d *= f < 1 ? 1.12 : 0.9;
        if (zoom2d < 0.45) zoom2d = 0.45;
        if (zoom2d > 2.4) zoom2d = 2.4;
      }
    },
    viewFor: function (color) {
      viewFlipped = color === "b";
      if (orbit) orbit.animateTo(color === "b" ? Math.PI : 0, 0.95, 13.5, 800);
    },
    topView: function () {
      if (orbit) orbit.animateTo(orbit.spherical.theta, 0.18, 22, 700);
    },
    resetView: function (color) {
      this.viewFor(color || "w");
    },
    setQuality: setQuality,
    setCoords: function (v) {
      showCoords = v;
      if (labelsGroup) labelsGroup.visible = v;
    },
    getPiece: function (sq) {
      return pieceMap[sq];
    },
    mode: function () {
      return mode;
    },
    // True if the given viewport point lands on the board (incl. frame) or a piece.
    isBoardAt: function (clientX, clientY) {
      try {
        if (mode === "2d") {
          var r = boardRect();
          var rect = canvas.getBoundingClientRect();
          var sx = (canvas.width || rect.width) / (rect.width || 1);
          var sy = (canvas.height || rect.height) / (rect.height || 1);
          var x = (clientX - rect.left) * sx;
          var y = (clientY - rect.top) * sy;
          var pad = r.sq * 0.3;
          return x >= r.x - pad && x <= r.x + r.size + pad && y >= r.y - pad && y <= r.y + r.size + pad;
        }
        if (!raycaster || !camera) return false;
        var hit = getHits(clientX, clientY);
        if (hit.piece) return true;
        var pt = raycaster.ray.intersectPlane(plane, _v);
        return !!pt && Math.abs(pt.x) <= 4.6 && Math.abs(pt.z) <= 4.6;
      } catch (e) {
        return false;
      }
    }
  };
})(window);
