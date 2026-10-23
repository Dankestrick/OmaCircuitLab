.pragma library
.import "Catalog.js" as Catalog

// The workbench is a grid of 0.1 inch steps. A full-size breadboard (63
// columns, two power rails on each side) sits in the middle; batteries,
// meters and motors live around it and connect with wires.

var benchW = 82
var benchH = 44
var boardX = 10   // grid position of the first board's column 1, top rail
var boardY = 6
var columns = 63
var BOARD_STEP = 70   // extra boards sit to the right, this far apart
var MAX_BOARDS = 3

// How many breadboards the bench has. The bench's own `boards` field sets
// it (Overlay calls setBoards when the bench changes); 1 when missing.
var boardCount = 1
function setBoards(n) {
  boardCount = Math.max(1, Math.min(MAX_BOARDS, Math.round(Number(n) || 1)))
  benchW = 82 + BOARD_STEP * (boardCount - 1)
  return boardCount
}
function boardsOf(bench) { return bench && bench.boards ? Math.max(1, Math.min(MAX_BOARDS, bench.boards)) : 1 }

// Origin (column 1, top rail) of board k (0-based).
function boardOrigin(k) { return { x: boardX + k * BOARD_STEP, y: boardY } }

// Which board a bench x is over, or -1.
function boardIndexAt(x) {
  for (var k = 0; k < boardCount; k++) {
    var c = x - boardOrigin(k).x
    if (c >= -2 && c <= columns + 1) return k
  }
  return -1
}

// Board-relative rows. 0/1 and 16/17 are the power rails, 3..7 are rows a-e,
// 10..14 are rows f-j. The gap between e and f is the center channel, exactly
// wide enough for a chip to straddle it.
var railRows = { 0: { sign: "+", side: "top" }, 1: { sign: "−", side: "top" }, 16: { sign: "+", side: "bottom" }, 17: { sign: "−", side: "bottom" } }
var rowLetters = { 3: "a", 4: "b", 5: "c", 6: "d", 7: "e", 10: "f", 11: "g", 12: "h", 13: "i", 14: "j" }
var boardRows = 18

function boardRect(k) {
  var o = boardOrigin(k || 0)
  return { x: o.x - 1.5, y: o.y - 1.5, w: columns - 1 + 3, h: boardRows - 1 + 3 }
}

function boardRects() {
  var out = []
  for (var k = 0; k < boardCount; k++) out.push(boardRect(k))
  return out
}

// Rail holes come in groups of five with a gap, like a real board.
function isRailColumn(c) { return c >= 1 && c <= 61 && (c - 1) % 6 !== 5 }

// Describe the hole at bench grid point (x, y), or null when it is not a hole.
// Board 1's strips keep their old names; boards 2 and 3 add "b2:"/"b3:".
function holeAt(x, y) {
  var k = boardIndexAt(x)
  if (k < 0) return null
  var o = boardOrigin(k)
  var c = x - o.x, r = y - o.y
  if (c < 0 || c >= columns || r < 0 || r >= boardRows) return null
  var pre = k === 0 ? "" : "b" + (k + 1) + ":"
  var named = k === 0 ? "" : "Board " + (k + 1) + ", "
  if (railRows[r] !== undefined) {
    if (!isRailColumn(c)) return null
    var rail = railRows[r]
    return { strip: pre + "rail:" + rail.side + rail.sign, kind: "rail", sign: rail.sign, side: rail.side, column: c + 1, row: r, board: k,
             label: named + (rail.side === "top" ? "top " : "bottom ") + (rail.sign === "+" ? "+ (red) rail" : "− (blue) rail") }
  }
  var letter = rowLetters[r]
  if (!letter) return null
  var half = r <= 7 ? "top" : "bottom"
  return { strip: pre + "col:" + (c + 1) + ":" + half, kind: "strip", column: c + 1, row: r, letter: letter, half: half, board: k,
           label: named + "hole " + letter + (c + 1) }
}

function isOnBoard(x, y) {
  var k = boardIndexAt(x)
  if (k < 0) return false
  var c = x - boardOrigin(k).x, r = y - boardY
  return c >= -1 && c <= columns && r >= -1 && r <= boardRows
}

// Every hole sharing a metal strip with the hole at (x, y).
function stripHoles(x, y) {
  var h = holeAt(x, y)
  if (!h) return []
  var out = []
  var ox = boardOrigin(h.board).x
  if (h.kind === "rail") {
    for (var c = 0; c < columns; c++) if (isRailColumn(c)) out.push({ x: ox + c, y: boardY + h.row })
  } else {
    var r0 = h.half === "top" ? 3 : 10
    for (var r = r0; r < r0 + 5; r++) out.push({ x: x, y: boardY + r })
  }
  return out
}

// Holes of board k (all boards when k is missing).
function allHoles(k) {
  var out = []
  for (var b = 0; b < boardCount; b++) {
    if (k !== undefined && b !== k) continue
    var ox = boardOrigin(b).x
    for (var r = 0; r < boardRows; r++)
      for (var c = 0; c < columns; c++)
        if (holeAt(ox + c, boardY + r)) out.push({ x: ox + c, y: boardY + r })
  }
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
  setBoards(boardsOf(bench))
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
