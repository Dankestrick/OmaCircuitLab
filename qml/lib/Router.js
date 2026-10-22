.pragma library

// Square wire routing. Wires run on a half-step grid so long runs sit in the
// lanes between holes, turn as little as possible, and slide over a lane when
// another wire already uses one. Points come back in bench grid units (x.5
// values are lane centers).

var TURN = 2.5        // cost of each bend
var OVER_HOLES = 0.7  // running along a row of holes instead of a lane
var SHARE = 30        // running on top of another wire
var CROSS = 0.8       // crossing another wire
var OVER_PART = 3     // running over a part body

function Heap() { this.a = [] }
Heap.prototype.push = function (n) {
  var a = this.a; a.push(n)
  var i = a.length - 1
  while (i > 0) {
    var p = (i - 1) >> 1
    if (a[p].f <= a[i].f) break
    var t = a[p]; a[p] = a[i]; a[i] = t; i = p
  }
}
Heap.prototype.pop = function () {
  var a = this.a, top = a[0], last = a.pop()
  if (a.length > 0) {
    a[0] = last
    var i = 0
    for (;;) {
      var l = 2 * i + 1, r = l + 1, m = i
      if (l < a.length && a[l].f < a[m].f) m = l
      if (r < a.length && a[r].f < a[m].f) m = r
      if (m === i) break
      var t = a[m]; a[m] = a[i]; a[i] = t; i = m
    }
  }
  return top
}

// occupancy: { "u,v": { h: n, v: n } } on the doubled grid.
function Occupancy() { this.cells = {} }
Occupancy.prototype.get = function (u, v) { return this.cells[u + "," + v] }
Occupancy.prototype.mark = function (u, v, dir) {
  var k = u + "," + v
  var c = this.cells[k] || (this.cells[k] = { h: 0, v: 0 })
  c[dir] += 1
}
Occupancy.prototype.addPath = function (pts) {
  for (var i = 1; i < pts.length; i++) {
    var u0 = Math.round(pts[i - 1].x * 2), v0 = Math.round(pts[i - 1].y * 2)
    var u1 = Math.round(pts[i].x * 2), v1 = Math.round(pts[i].y * 2)
    var du = Math.sign(u1 - u0), dv = Math.sign(v1 - v0)
    var dir = du !== 0 ? "h" : "v"
    var u = u0, v = v0
    while (true) {
      this.mark(u, v, dir)
      if (u === u1 && v === v1) break
      u += du; v += dv
    }
  }
}

// Route from bench point a to b (integer grid points). `blocked(u, v)` returns
// true over part bodies (doubled grid). `bounds` = { w, h } in bench units.
function route(a, b, occ, overPart, bounds) {
  var W = bounds.w * 2, H = bounds.h * 2
  var su = a.x * 2, sv = a.y * 2, tu = b.x * 2, tv = b.y * 2
  if (su === tu && sv === tv) return [a, b]
  var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  var best = {}
  var heap = new Heap()
  function key(u, v, d) { return (v * (W + 1) + u) * 4 + d }
  function h(u, v) { return Math.abs(u - tu) + Math.abs(v - tv) }
  var budget = 60000
  for (var d0 = 0; d0 < 4; d0++) {
    var n0 = { u: su, v: sv, d: d0, g: 0, f: h(su, sv), prev: null, first: true }
    heap.push(n0)
  }
  var found = null
  while (heap.a.length > 0 && budget-- > 0) {
    var n = heap.pop()
    if (n.u === tu && n.v === tv) { found = n; break }
    var k0 = key(n.u, n.v, n.d)
    if (best[k0] !== undefined && best[k0] < n.g) continue
    for (var d = 0; d < 4; d++) {
      var nu = n.u + dirs[d][0], nv = n.v + dirs[d][1]
      if (nu < 0 || nv < 0 || nu > W || nv > H) continue
      // Never pass through another hole: only the two ends sit in holes.
      var atHole = (nu % 2 === 0 && nv % 2 === 0)
      var isEnd = (nu === tu && nv === tv)
      if (atHole && !isEnd) continue
      var g = n.g + 1
      if (!n.first && d !== n.d) g += TURN
      var horizontal = dirs[d][1] === 0
      // A run on an even line passes right over a row/column of holes.
      if (horizontal ? nv % 2 === 0 : nu % 2 === 0) g += OVER_HOLES
      var c = occ.get(nu, nv)
      if (c) {
        var same = horizontal ? c.h : c.v
        var other = horizontal ? c.v : c.h
        g += same * SHARE + other * CROSS
      }
      if (overPart(nu, nv)) g += OVER_PART
      var k = key(nu, nv, d)
      if (best[k] !== undefined && best[k] <= g) continue
      best[k] = g
      heap.push({ u: nu, v: nv, d: d, g: g, f: g + h(nu, nv), prev: n, first: false })
    }
  }
  if (!found) return [a, { x: b.x, y: a.y }, b]

  var cells = []
  for (var p = found; p; p = p.prev) cells.push({ x: p.u / 2, y: p.v / 2 })
  cells.reverse()
  // Keep only the corners.
  var out = [cells[0]]
  for (var i = 1; i < cells.length - 1; i++) {
    var A = out[out.length - 1], B = cells[i], C = cells[i + 1]
    var colinear = (A.x === B.x && B.x === C.x) || (A.y === B.y && B.y === C.y)
    if (!colinear) out.push(B)
  }
  out.push(cells[cells.length - 1])
  return out
}

// A hand-shaped path is kept when it still starts and ends at the wire's
// ends and every segment is square.
function validPath(w) {
  var p = w.path
  if (!p || p.length < 2) return false
  if (p[0].x !== w.a.x || p[0].y !== w.a.y || p[p.length - 1].x !== w.b.x || p[p.length - 1].y !== w.b.y) return false
  for (var i = 1; i < p.length; i++) if (p[i].x !== p[i - 1].x && p[i].y !== p[i - 1].y) return false
  return true
}

// Route every wire in order so earlier wires keep their lanes and later ones
// move over. Hand-shaped wires are laid down first so the rest go around them.
// Returns { wireId: [points] }.
function routeAll(wires, overPart, bounds) {
  var occ = new Occupancy()
  var out = {}
  for (var m = 0; m < wires.length; m++) {
    if (!validPath(wires[m])) continue
    occ.addPath(wires[m].path)
    out[wires[m].id] = wires[m].path
  }
  for (var i = 0; i < wires.length; i++) {
    if (out[wires[i].id]) continue
    var pts = route(wires[i].a, wires[i].b, occ, overPart, bounds)
    occ.addPath(pts)
    out[wires[i].id] = pts
  }
  return out
}

function copyPath(pts) {
  var out = []
  for (var i = 0; i < pts.length; i++) out.push({ x: pts[i].x, y: pts[i].y })
  return out
}

// Drop repeated points and points in the middle of a straight run.
function tidy(pts) {
  var out = []
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i]
    if (out.length && out[out.length - 1].x === p.x && out[out.length - 1].y === p.y) continue
    out.push(p)
  }
  var res = [out[0]]
  for (var j = 1; j < out.length - 1; j++) {
    var a = res[res.length - 1], b = out[j], c = out[j + 1]
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) continue
    res.push(b)
  }
  if (out.length > 1) res.push(out[out.length - 1])
  return res
}

// Slide segment i (pts[i] to pts[i+1]) sideways to `value` (a y for a
// horizontal segment, an x for a vertical one). The wire's two ends stay in
// their holes: a segment that touches an end gets a small dog-leg instead.
function moveSegment(pts, i, value) {
  var p = copyPath(pts)
  if (i < 0 || i >= p.length - 1) return p
  var horizontal = p[i].y === p[i + 1].y
  var key = horizontal ? "y" : "x"
  var last = p.length - 1
  if (i + 1 === last) {
    var endCopy = { x: p[last].x, y: p[last].y }
    p[last][key] = value
    p.push(endCopy)
  } else p[i + 1][key] = value
  if (i === 0) {
    var startCopy = { x: p[0].x, y: p[0].y }
    p[0][key] = value
    p.unshift(startCopy)
  } else p[i][key] = value
  return tidy(p)
}

// Move bend k (an inner corner) to (x, y) by sliding both segments that meet there.
function moveCorner(pts, k, x, y) {
  if (k <= 0 || k >= pts.length - 1) return copyPath(pts)
  var nextHorizontal = pts[k].y === pts[k + 1].y
  var p = moveSegment(pts, k, nextHorizontal ? y : x)
  // Find the same corner again (its index may have shifted) and slide the other side.
  var best = -1, bestD = Infinity
  for (var i = 1; i < p.length - 1; i++) {
    var d = Math.abs(p[i].x - (nextHorizontal ? pts[k].x : x)) + Math.abs(p[i].y - (nextHorizontal ? y : pts[k].y))
    if (d < bestD) { bestD = d; best = i }
  }
  if (best <= 0) return p
  var prevHorizontal = p[best - 1].y === p[best].y
  return moveSegment(p, best - 1, prevHorizontal ? y : x)
}
