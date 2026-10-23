const load = require("./load"), assert = require("assert")
const B = load("Bench.js"), C = load("Catalog.js"), E = load("Engine.js"), K = load("Clamp.js")
const bx = B.boardX, by = B.boardY
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) < tol, what + ": " + a + " vs " + b)

function solve(bench) {
  const nl = B.buildNetlist(bench)
  const r = E.solve({ nodeCount: nl.nodeCount, ground: nl.ground, elements: nl.elements.filter(e => e.type !== "clampMeter") }, E.createState(), 0)
  assert.ok(r.ok)
  return { nl, r }
}
const amps = (bench, s, clip) => K.measure(bench, s.nl, s.r, clip).amps

// Series loop: battery -> + rail -> resistor -> LED -> − rail. The same
// current everywhere, on wires and legs alike.
const series = {
  parts: [
    { id: "bat", type: "battery9v", x: 2, y: 10, rot: 0, props: C.defaults("battery9v") },
    { id: "r1", type: "resistor", x: bx + 2, y: by + 3, rot: 0, props: { ohms: 470, span: 4 } },
    { id: "d1", type: "led", x: bx + 6, y: by + 4, rot: 0, props: C.defaults("led") },
    { id: "cm", type: "clampMeter", x: 30, y: 30, rot: 0, props: { clip: { kind: "wire", id: "w3", x: bx + 2, y: by + 2 } } }
  ],
  wires: [
    { id: "w1", a: { x: 2, y: 10 }, b: { x: bx + 1, y: by + 0 } },
    { id: "w2", a: { x: 4, y: 10 }, b: { x: bx + 1, y: by + 1 } },
    { id: "w3", a: { x: bx + 3, y: by + 0 }, b: { x: bx + 2, y: by + 5 } },
    { id: "w4", a: { x: bx + 7, y: by + 5 }, b: { x: bx + 8, y: by + 1 } }
  ]
}
let s = solve(series)
const i = Math.abs(s.r.parts.r1.current)
assert.ok(i > 0.01 && i < 0.02, "LED loop current " + i)
for (const w of ["w1", "w2", "w3", "w4"]) near(Math.abs(amps(series, s, { kind: "wire", id: w })), i, 1e-6, "series wire " + w)
near(Math.abs(amps(series, s, { kind: "leg", part: "r1", pin: 0 })), i, 1e-9, "resistor leg")
near(Math.abs(amps(series, s, { kind: "leg", part: "d1", pin: 1 })), i, 1e-6, "LED cathode")
// Direction: out of the battery's + along w1, then back into − along w2.
assert.ok(amps(series, s, { kind: "wire", id: "w1" }) > 0)
assert.ok(amps(series, s, { kind: "wire", id: "w2" }) < 0)
// The meter face gets a reading.
K.annotate(series, s.nl, s.r)
assert.ok(/mA$/.test(s.r.parts.cm.reading), s.r.parts.cm.reading)
console.log("series ok:", s.r.parts.cm.reading)

// Two LED branches off the + rail: the supply wire carries the sum, each
// branch wire its own share.
const par = JSON.parse(JSON.stringify(series))
par.parts.push({ id: "r2", type: "resistor", x: bx + 12, y: by + 3, rot: 0, props: { ohms: 1000, span: 4 } })
par.parts.push({ id: "d2", type: "led", x: bx + 16, y: by + 4, rot: 0, props: C.defaults("led") })
par.wires.push({ id: "w5", a: { x: bx + 13, y: by + 0 }, b: { x: bx + 12, y: by + 5 } })
par.wires.push({ id: "w6", a: { x: bx + 17, y: by + 5 }, b: { x: bx + 19, y: by + 1 } })
s = solve(par)
const i1 = Math.abs(s.r.parts.r1.current), i2 = Math.abs(s.r.parts.r2.current)
assert.ok(i1 > i2 * 1.5, "470 branch carries more than 1k branch")
near(Math.abs(amps(par, s, { kind: "wire", id: "w1" })), i1 + i2, 1e-6, "supply wire = sum")
near(Math.abs(amps(par, s, { kind: "wire", id: "w3" })), i1, 1e-6, "branch 1")
near(Math.abs(amps(par, s, { kind: "wire", id: "w5" })), i2, 1e-6, "branch 2")
console.log("parallel ok:", (i1 * 1000).toFixed(2), "+", (i2 * 1000).toFixed(2), "mA")

// Two wires side by side from the battery to the rail split the current.
const dbl = JSON.parse(JSON.stringify(series))
dbl.wires.push({ id: "w7", a: { x: 2, y: 10 }, b: { x: bx + 2, y: by + 0 } })
s = solve(dbl)
near(Math.abs(amps(dbl, s, { kind: "wire", id: "w1" })), i / 2, 1e-6, "half on w1")
near(Math.abs(amps(dbl, s, { kind: "wire", id: "w7" })), i / 2, 1e-6, "half on w7")

// Unclipped, gone, and not running.
assert.ok(K.measure(series, s.nl, s.r, null).why)
assert.ok(K.measure(series, s.nl, s.r, { kind: "wire", id: "nope" }).why)
assert.ok(K.measure(series, s.nl, s.r, { kind: "leg", part: "nope", pin: 0 }).why)
// A three-legged part without leg currents says so instead of guessing.
const pot = { parts: [{ id: "k", type: "potentiometer", x: bx + 30, y: by + 3, rot: 0, props: C.defaults("potentiometer") }], wires: [] }
assert.ok(/leg currents/.test(K.measure(pot, B.buildNetlist(pot), { parts: { k: { current: 0.001 } } }, { kind: "leg", part: "k", pin: 1 }).why))
// Jaw follows a wire's route and a part's leg.
const lp = K.jawPoint(series, {}, { kind: "leg", part: "r1", pin: 1, x: 0, y: 0 })
assert.strictEqual(lp.x, bx + 6); assert.strictEqual(lp.y, by + 3)
const jp = K.jawPoint(series, { w3: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, { kind: "wire", id: "w3", x: 4, y: 2 })
assert.strictEqual(jp.x, 4); assert.strictEqual(jp.y, 0)
console.log("clamp ok")

// The clamp lesson: on the battery wire it reads the total and asks for a
// branch; on a branch it is done.
const L = load("Lessons.js")
const lesson = L.lessons.find(l => l.id === "clamp")
const lb = lesson.build()
function check(bench) {
  const r = solve(bench)
  K.annotate(bench, r.nl, r.r)
  return lesson.check({ bench, result: r.r, running: true, netlist: r.nl })
}
let c = check(lb)
assert.strictEqual(c.done, false, c.hint)
assert.ok(/all of the battery/.test(c.hint), c.hint)
lb.parts.find(p => p.id === "cm").props.clip = { kind: "wire", id: "w1", x: 0, y: 0 }
c = check(lb)
assert.strictEqual(c.done, true, c.hint)
console.log("lesson ok:", c.hint)
