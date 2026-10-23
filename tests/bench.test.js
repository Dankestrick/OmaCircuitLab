const load = require("./load"), assert = require("assert")
const B = load("Bench.js"), R = load("Router.js"), C = load("Catalog.js")
const bx = B.boardX, by = B.boardY
// hole a1 and e1 share a strip; f1 does not
assert.strictEqual(B.holeAt(bx, by + 3).strip, B.holeAt(bx, by + 7).strip)
assert.notStrictEqual(B.holeAt(bx, by + 7).strip, B.holeAt(bx, by + 10).strip)
assert.strictEqual(B.holeAt(bx + 6, by), null) // rail gap
// battery off board, wires to rails, resistor + LED on board
const bench = {
  parts: [
    { id: "bat", type: "battery9v", x: 2, y: 10, rot: 0, props: C.defaults("battery9v") },
    { id: "r1", type: "resistor", x: bx + 2, y: by + 3, rot: 0, props: C.defaults("resistor") },
    { id: "d1", type: "led", x: bx + 6, y: by + 4, rot: 0, props: C.defaults("led") }
  ],
  wires: [
    { id: "w1", a: { x: 2, y: 10 }, b: { x: bx + 1, y: by + 0 } },
    { id: "w2", a: { x: 4, y: 10 }, b: { x: bx + 1, y: by + 1 } },
    { id: "w3", a: { x: bx + 3, y: by + 0 }, b: { x: bx + 2, y: by + 5 } },
    { id: "w4", a: { x: bx + 7, y: by + 5 }, b: { x: bx + 8, y: by + 1 } }
  ]
}
const nl = B.buildNetlist(bench)
const el = Object.fromEntries(nl.elements.map(e => [e.id, e]))
assert.strictEqual(el.bat.nodes[1], 0)
assert.strictEqual(el.r1.nodes[0], el.bat.nodes[0])   // r1 left leg on + via w3
assert.strictEqual(el.r1.nodes[1], el.d1.nodes[0])    // r1 right leg column 7 = LED anode column 7
assert.strictEqual(el.d1.nodes[1], 0)                 // LED cathode -> − rail
assert.strictEqual(nl.issues.length, 0)
console.log("netlist ok, nodes:", nl.nodeCount)
// routing: square, no shared segments
const t0 = Date.now()
const paths = R.routeAll(bench.wires, () => false, { w: B.benchW, h: B.benchH })
for (const id in paths) {
  const p = paths[id]
  for (let i = 1; i < p.length; i++) assert(p[i].x === p[i-1].x || p[i].y === p[i-1].y, "square " + id)
  console.log(id, JSON.stringify(p))
}
console.log("routed in", Date.now() - t0, "ms")
assert.strictEqual(JSON.stringify(C.resistorBands(220).slice(0,3)), JSON.stringify([C.bandColors[2], C.bandColors[2], C.bandColors[1]]))
assert.strictEqual(C.si(4700, "Ω"), "4.7 kΩ")
console.log("all ok")
// Extra breadboards: separate metal, named "board 2", and the netlist sizes
// itself from bench.boards.
{
  B.setBoards(2)
  const o2 = B.boardOrigin(1)
  const h = B.holeAt(o2.x, o2.y + 3)
  assert.strictEqual(h.board, 1); assert.ok(/^b2:col:1:/.test(h.strip)); assert.ok(/Board 2/.test(h.label))
  assert.notStrictEqual(h.strip, B.holeAt(B.boardX, B.boardY + 3).strip)
  assert.strictEqual(B.allHoles().length, 2 * B.allHoles(0).length)
  const two = { boards: 2, parts: [
      { id: "bat", type: "battery9v", x: 2, y: 10, rot: 0, props: C.defaults("battery9v") },
      { id: "r", type: "resistor", x: o2.x + 2, y: o2.y + 3, rot: 0, props: C.defaults("resistor") } ],
    wires: [{ id: "w", a: { x: 2, y: 10 }, b: { x: o2.x + 2, y: o2.y + 4 } }] }
  const nl2 = B.buildNetlist(two)
  const r = nl2.elements.find(e => e.id === "r")
  assert.strictEqual(r.nodes[0], nl2.elements.find(e => e.id === "bat").nodes[0])
  assert.strictEqual(nl2.issues.length, 0)
  B.buildNetlist({ parts: [], wires: [] })
  assert.strictEqual(B.holeAt(o2.x, o2.y + 3), null, "board 2 gone with boards = 1")
  console.log("boards ok")
}
