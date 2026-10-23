.pragma library
.import "Catalog.js" as Catalog
.import "Bench.js" as Bench

// Clamp meter: reads the current through one wire or one part leg without
// being part of the circuit. Legs come straight from the engine. Wires are
// ideal, so the engine has no current for them; it is worked out here from
// the part currents meeting at that node, treating every wire in the node as
// the same small resistance (parallel wires share the current evenly).

// Current into each pin of a part (amps), or null when the engine doesn't
// say. Two-pin parts report `current` into pin 0.
function pinCurrents(type, live) {
  if (!live) return null
  if (live.pinCurrents && live.pinCurrents.length) return live.pinCurrents
  var n = Catalog.parts[type] ? Catalog.parts[type].pins.length : 0
  if (n === 2 && typeof live.current === "number" && isFinite(live.current)) return [live.current, -live.current]
  return null
}

// Where a bench point sits in the wire network of its node: a breadboard
// strip (all its holes are one piece of metal) or a loose point.
function vertexOf(p) {
  var h = Bench.holeAt(p.x, p.y)
  return h ? "s:" + h.strip : "p:" + p.x + "," + p.y
}

function solveDense(A, b) {
  var n = b.length
  for (var c = 0; c < n; c++) {
    var piv = c
    for (var r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (Math.abs(A[piv][c]) < 1e-12) return null
    var t = A[c]; A[c] = A[piv]; A[piv] = t
    var tb = b[c]; b[c] = b[piv]; b[piv] = tb
    for (var r2 = c + 1; r2 < n; r2++) {
      var f = A[r2][c] / A[c][c]
      if (f === 0) continue
      for (var k = c; k < n; k++) A[r2][k] -= f * A[c][k]
      b[r2] -= f * b[c]
    }
  }
  var x = new Array(n)
  for (var i = n - 1; i >= 0; i--) {
    var s = b[i]
    for (var j = i + 1; j < n; j++) s -= A[i][j] * x[j]
    x[i] = s / A[i][i]
  }
  return x
}

// Current through a wire, from its end a to its end b (amps).
// Returns { amps } or { why } when it can't be known.
function wireCurrent(bench, netlist, result, wireId) {
  var wire = null
  for (var i = 0; i < bench.wires.length; i++) if (bench.wires[i].id === wireId) wire = bench.wires[i]
  if (!wire) return { why: "The wire it was on is gone." }
  var node = Bench.nodeAt(netlist, wire.a.x, wire.a.y)
  if (node < 0) return { why: "Not connected." }
  var va = vertexOf(wire.a), vb = vertexOf(wire.b)
  if (va === vb) return { amps: 0 }   // both ends in one strip: the strip carries it

  // Vertices and wires of this node.
  var index = {}, names = []
  function vid(k) {
    if (index[k] === undefined) { index[k] = names.length; names.push(k) }
    return index[k]
  }
  var edges = []
  for (var w = 0; w < bench.wires.length; w++) {
    var wi = bench.wires[w]
    if (Bench.nodeAt(netlist, wi.a.x, wi.a.y) !== node) continue
    edges.push([vid(vertexOf(wi.a)), vid(vertexOf(wi.b))])
  }

  // Current each part pushes into the node at its legs.
  var inj = []
  for (var z = 0; z < names.length; z++) inj.push(0)
  for (var p = 0; p < bench.parts.length; p++) {
    var part = bench.parts[p]
    var pts = Catalog.pinPoints(part)
    var cur = null, needed = false
    for (var j = 0; j < pts.length; j++) {
      if (Bench.nodeAt(netlist, pts[j].x, pts[j].y) !== node) continue
      var k = vertexOf(pts[j])
      if (index[k] === undefined) continue   // touches the node away from any wire
      if (!needed) { cur = pinCurrents(part.type, result.parts ? result.parts[part.id] : null); needed = true }
      if (!cur) return { why: Catalog.parts[part.type].name + " doesn't report its leg currents yet." }
      inj[index[k]] -= Number(cur[j]) || 0
    }
  }

  // Kirchhoff: L * v = inj, one vertex held at 0. Wires have conductance 1.
  var n = names.length
  var A = [], b = []
  for (var r = 1; r < n; r++) {
    var row = []
    for (var c = 1; c < n; c++) row.push(0)
    A.push(row)
    b.push(inj[r])
  }
  for (var e = 0; e < edges.length; e++) {
    var u = edges[e][0] - 1, v = edges[e][1] - 1
    if (u === v) continue
    if (u >= 0) A[u][u] += 1
    if (v >= 0) A[v][v] += 1
    if (u >= 0 && v >= 0) { A[u][v] -= 1; A[v][u] -= 1 }
  }
  var x = n > 1 ? solveDense(A, b) : []
  if (!x) return { why: "Can't work it out here." }
  var volts = [0].concat(x)
  var amps = volts[index[va]] - volts[index[vb]]
  return { amps: Math.abs(amps) < 1e-12 ? 0 : amps }
}

// Current at a clip: { amps } or { why }.
function measure(bench, netlist, result, clip) {
  if (!clip) return { why: "Click it, then click a wire or a leg." }
  if (!result || !result.parts || !netlist) return { why: "" }
  if (clip.kind === "leg") {
    var part = null
    for (var i = 0; i < bench.parts.length; i++) if (bench.parts[i].id === clip.part) part = bench.parts[i]
    if (!part) return { why: "The part it was on is gone." }
    var cur = pinCurrents(part.type, result.parts[part.id])
    if (!cur) return { why: Catalog.parts[part.type].name + " doesn't report its leg currents yet." }
    return { amps: Number(cur[clip.pin]) || 0 }
  }
  return wireCurrent(bench, netlist, result, clip.id)
}

// Add a reading to result.parts for every clamp meter on the bench, so the
// meter face and Inspect show it like any other part.
function annotate(bench, netlist, result) {
  if (!result || !result.parts) return result
  for (var i = 0; i < bench.parts.length; i++) {
    var p = bench.parts[i]
    if (p.type !== "clampMeter") continue
    var m = measure(bench, netlist, result, p.props.clip)
    if (m.amps !== undefined) {
      var a = Math.abs(m.amps)
      result.parts[p.id] = { value: a, reading: a < 1e-6 ? "0 mA" : Catalog.si(a, "A") }
    } else {
      result.parts[p.id] = { value: NaN, reading: "– – –", note: m.why }
    }
  }
  return result
}

// Where the jaw sits: on the leg, or at the clip point pulled onto the wire.
function jawPoint(bench, routes, clip) {
  if (!clip) return null
  if (clip.kind === "leg") {
    for (var i = 0; i < bench.parts.length; i++) {
      if (bench.parts[i].id !== clip.part) continue
      var pts = Catalog.pinPoints(bench.parts[i])
      if (pts[clip.pin]) return { x: pts[clip.pin].x, y: pts[clip.pin].y }
    }
    return { x: clip.x, y: clip.y }
  }
  var path = routes ? routes[clip.id] : null
  if (!path || path.length < 2) return { x: clip.x, y: clip.y }
  var best = null, bestD = Infinity
  for (var j = 1; j < path.length; j++) {
    var a = path[j - 1], b = path[j]
    var dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy
    var t = l > 0 ? Math.max(0, Math.min(1, ((clip.x - a.x) * dx + (clip.y - a.y) * dy) / l)) : 0
    var q = { x: a.x + t * dx, y: a.y + t * dy, horiz: Math.abs(dx) >= Math.abs(dy) }
    var d = (q.x - clip.x) * (q.x - clip.x) + (q.y - clip.y) * (q.y - clip.y)
    if (d < bestD) { bestD = d; best = q }
  }
  return best
}
