.pragma library
.import "Catalog.js" as Catalog

// The workbench is a grid of 0.1 inch steps. A full-size breadboard (63
// columns, two power rails on each side) sits in the middle; batteries,
// meters and motors live around it and connect with wires.

var benchW = 82
var benchH = 44
var boardX = 10   // grid position of the board's column 1, top rail
var boardY = 6
var columns = 63

// Board-relative rows. 0/1 and 16/17 are the power rails, 3..7 are rows a-e,
// 10..14 are rows f-j. The gap between e and f is the center channel, exactly
// wide enough for a chip to straddle it.
var railRows = { 0: { sign: "+", side: "top" }, 1: { sign: "−", side: "top" }, 16: { sign: "+", side: "bottom" }, 17: { sign: "−", side: "bottom" } }
var rowLetters = { 3: "a", 4: "b", 5: "c", 6: "d", 7: "e", 10: "f", 11: "g", 12: "h", 13: "i", 14: "j" }
var boardRows = 18

function boardRect() {
  return { x: boardX - 1.5, y: boardY - 1.5, w: columns - 1 + 3, h: boardRows - 1 + 3 }
}

// Rail holes come in groups of five with a gap, like a real board.
function isRailColumn(c) { return c >= 1 && c <= 61 && (c - 1) % 6 !== 5 }

// Describe the hole at bench grid point (x, y), or null when it is not a hole.
function holeAt(x, y) {
  var c = x - boardX, r = y - boardY
  if (c < 0 || c >= columns || r < 0 || r >= boardRows) return null
  if (railRows[r] !== undefined) {
    if (!isRailColumn(c)) return null
    var rail = railRows[r]
    return { strip: "rail:" + rail.side + rail.sign, kind: "rail", sign: rail.sign, side: rail.side, column: c + 1, row: r,
             label: (rail.side === "top" ? "Top " : "Bottom ") + (rail.sign === "+" ? "+ (red) rail" : "− (blue) rail") }
  }
  var letter = rowLetters[r]
  if (!letter) return null
  var half = r <= 7 ? "top" : "bottom"
  return { strip: "col:" + (c + 1) + ":" + half, kind: "strip", column: c + 1, row: r, letter: letter, half: half,
           label: "Hole " + letter + (c + 1) }
}

function isOnBoard(x, y) {
  var c = x - boardX, r = y - boardY
  return c >= -1 && c <= columns && r >= -1 && r <= boardRows
}

// Every hole sharing a metal strip with the hole at (x, y).
function stripHoles(x, y) {
  var h = holeAt(x, y)
  if (!h) return []
  var out = []
  if (h.kind === "rail") {
    for (var c = 0; c < columns; c++) if (isRailColumn(c)) out.push({ x: boardX + c, y: boardY + h.row })
  } else {
    var r0 = h.half === "top" ? 3 : 10
    for (var r = r0; r < r0 + 5; r++) out.push({ x: x, y: boardY + r })
  }
  return out
}

function allHoles() {
  var out = []
  for (var r = 0; r < boardRows; r++)
    for (var c = 0; c < columns; c++)
      if (holeAt(boardX + c, boardY + r)) out.push({ x: boardX + c, y: boardY + r })
  return out
}

// ------------------------------------------------------------------ netlist

function UnionFind() { this.parent = {} }
UnionFind.prototype.find = function (k) {
  if (this.parent[k] === undefined) this.parent[k] = k
  while (this.parent[k] !== k) { this.parent[k] = this.parent[this.parent[k]]; k = this.parent[k] }
  return k
}
UnionFind.prototype.union = function (a, b) {
  var ra = this.find(a), rb = this.find(b)
  if (ra !== rb) this.parent[ra] = rb
}

function pointKey(p) { return "p:" + p.x + "," + p.y }

// Turn the bench (parts + wires) into a netlist the engine can solve:
//   { nodeCount, elements: [{ id, type, nodes: [n...], props }], ground,
//     pointNode: { "x,y": n }, issues: [...] }
// Node 0 is ground: the − terminal of the first power source, if any.
function buildNetlist(bench) {
  var uf = new UnionFind()
  var issues = []
  var occupied = {}

  function touch(p) {
    var k = pointKey(p)
    uf.find(k)
    var h = holeAt(p.x, p.y)
    if (h) uf.union(k, "s:" + h.strip)
    return k
  }

  var partPins = []
  for (var i = 0; i < bench.parts.length; i++) {
    var part = bench.parts[i]
    var pts = Catalog.pinPoints(part)
    var keys = []
    for (var j = 0; j < pts.length; j++) {
      keys.push(touch(pts[j]))
      var ok = pts[j].x + "," + pts[j].y
      if (holeAt(pts[j].x, pts[j].y)) {
        if (occupied[ok]) issues.push({ kind: "doubleHole", part: part.id, message: "Two legs are pushed into the same hole (" + holeAt(pts[j].x, pts[j].y).label + "). Move one over." })
        occupied[ok] = part.id
      } else if (isOnBoard(pts[j].x, pts[j].y)) {
        issues.push({ kind: "noHole", part: part.id, message: Catalog.parts[part.type].name + ": a leg sits between holes and is not connected." })
      }
    }
    partPins.push(keys)
  }
  for (var w = 0; w < bench.wires.length; w++) {
    var wire = bench.wires[w]
    uf.union(touch(wire.a), touch(wire.b))
  }

  // Number the nets. Ground first so the engine can use node 0.
  var netIndex = {}
  var count = 0
  var groundRoot = null
  for (var g = 0; g < bench.parts.length && groundRoot === null; g++) {
    var gp = Catalog.groundPin(bench.parts[g].type)
    if (gp >= 0) groundRoot = uf.find(partPins[g][gp])
  }
  if (groundRoot !== null) netIndex[groundRoot] = count++
  function nodeOf(key) {
    var r = uf.find(key)
    if (netIndex[r] === undefined) netIndex[r] = count++
    return netIndex[r]
  }

  var elements = []
  for (var e = 0; e < bench.parts.length; e++) {
    var nodes = []
    for (var n = 0; n < partPins[e].length; n++) nodes.push(nodeOf(partPins[e][n]))
    var props = {}
    for (var pk in bench.parts[e].props) props[pk] = bench.parts[e].props[pk]
    elements.push({ id: bench.parts[e].id, type: bench.parts[e].type, nodes: nodes, props: props })
  }

  // Map every touched point and every hole to its node, for hover readouts.
  var pointNode = {}
  for (var key in uf.parent) {
    if (key.indexOf("p:") === 0) pointNode[key.substring(2)] = nodeOf(key)
  }
  var stripNode = {}
  for (var sk in uf.parent) {
    if (sk.indexOf("s:") === 0) stripNode[sk.substring(2)] = nodeOf(sk)
  }

  return { nodeCount: count, ground: groundRoot !== null ? 0 : -1, elements: elements, pointNode: pointNode, stripNode: stripNode, issues: issues }
}

// Node under a bench point (a hole or a loose wire end), or -1.
function nodeAt(netlist, x, y) {
  if (!netlist) return -1
  var k = x + "," + y
  if (netlist.pointNode[k] !== undefined) return netlist.pointNode[k]
  var h = holeAt(x, y)
  if (h && netlist.stripNode[h.strip] !== undefined) return netlist.stripNode[h.strip]
  return -1
}

// Which part legs share each node, for the "How it's connected" list.
// Returns [{ node, legs: ["Resistor: 2", "LED: anode (+)"] }] with ground first.
function describeNets(bench, netlist) {
  if (!netlist) return []
  var byNode = {}
  for (var i = 0; i < netlist.elements.length; i++) {
    var e = netlist.elements[i]
    var def = Catalog.parts[e.type]
    for (var j = 0; j < e.nodes.length; j++) {
      var n = e.nodes[j]
      if (!byNode[n]) byNode[n] = []
      byNode[n].push(def.name + ": " + def.pins[j].name)
    }
  }
  var out = []
  for (var k in byNode) out.push({ node: Number(k), legs: byNode[k] })
  out.sort(function (a, b) { return a.node - b.node })
  return out
}
