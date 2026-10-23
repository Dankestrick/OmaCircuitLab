// Engine checks. Run from the repo: node tests/engine.test.js
const fs = require("fs")
const path = require("path")
const vm = require("vm")
const assert = require("assert")
const load = require("./load")

const E = load("Engine.js")
const B = load("Bench.js")
const L = load("Lessons.js")

function net(elements, nodeCount, ground) {
  return { nodeCount: nodeCount, ground: ground === undefined ? 0 : ground, elements: elements }
}
function solve(elements, nodeCount, state, dt, ground) {
  return E.solve(net(elements, nodeCount, ground), state || E.createState(), dt || 0)
}
function part(result, id) {
  assert.ok(result.parts && result.parts[id], "missing part " + id + " " + JSON.stringify(result.warnings))
  return result.parts[id]
}
function warnLevel(result, level, id) {
  return (result.warnings || []).some(function (w) {
    return w.level === level && (id === undefined || w.part === id)
  })
}

// --- 9 V, 470 ohm, red LED: about 15 mA and lit ---
var led = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 470 } },
  { id: "d", type: "led", nodes: [2, 0], props: { color: "red" } }
], 3)
assert.strictEqual(led.ok, true)
assert.strictEqual(led.converged, true)
var d = part(led, "d")
console.log("led 470", d.current.toFixed(4), "A", "bright", d.brightness.toFixed(2), "Vf", (d.pinVolts[0] - d.pinVolts[1]).toFixed(3))
assert.ok(d.current > 0.012 && d.current < 0.018, "led current " + d.current)
assert.ok(d.brightness > 0.15)
assert.strictEqual(d.burnt, false)
assert.ok(Math.abs(part(led, "r").current - d.current) < 1e-4)

// --- same circuit, 10 ohm: the LED burns out ---
var burnt = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 10 } },
  { id: "d", type: "led", nodes: [2, 0], props: { color: "red" } }
], 3)
assert.strictEqual(burnt.ok, true)
assert.strictEqual(burnt.converged, true)
var db = part(burnt, "d")
console.log("led 10", db.current.toFixed(4), "A", "burnt", db.burnt)
assert.ok(db.current > 0.04, "burn current " + db.current)
assert.strictEqual(db.burnt, true)
assert.ok(warnLevel(burnt, "warn", "d"))

// A second solve on the same state treats the burnt LED as open.
var burnState = E.createState()
var burn1 = E.solve(net([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 10 } },
  { id: "d", type: "led", nodes: [2, 0], props: { color: "red" } }
], 3), burnState, 0)
assert.strictEqual(part(burn1, "d").burnt, true)
var burn2 = E.solve(net([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 10 } },
  { id: "d", type: "led", nodes: [2, 0], props: { color: "red" } }
], 3), burnState, 0)
assert.strictEqual(part(burn2, "d").burnt, true)
assert.ok(Math.abs(part(burn2, "d").current) < 0.001)

// --- voltage divider, meter in V ---
var div = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r1", type: "resistor", nodes: [1, 2], props: { ohms: 10000 } },
  { id: "r2", type: "resistor", nodes: [2, 0], props: { ohms: 10000 } },
  { id: "m", type: "multimeter", nodes: [2, 0], props: { mode: "V" } }
], 3)
assert.strictEqual(div.ok, true)
assert.strictEqual(div.converged, true)
var meter = part(div, "m")
console.log("divider", meter.reading, meter.value)
assert.ok(Math.abs(meter.value - 4.5) < 0.05, "divider " + meter.value)
assert.ok(/V$/.test(meter.reading))

// --- NPN switch: collector current only while the button is pressed ---
function npn(pressed) {
  return solve([
    { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
    { id: "b", type: "pushButton", nodes: [1, 2], props: { pressed: pressed } },
    { id: "rb", type: "resistor", nodes: [2, 3], props: { ohms: 10000 } },
    { id: "q", type: "npn", nodes: [0, 3, 4], props: { beta: 150 } },
    { id: "rc", type: "resistor", nodes: [1, 4], props: { ohms: 470 } }
  ], 5)
}
var npnOff = npn(false)
var npnOn = npn(true)
assert.strictEqual(npnOff.converged, true)
assert.strictEqual(npnOn.converged, true)
var icOff = Math.abs(part(npnOff, "q").collectorCurrent || 0)
var icOn = part(npnOn, "q").collectorCurrent
console.log("npn off", icOff.toExponential(2), "on", icOn && icOn.toFixed(4), part(npnOn, "q").state)
assert.ok(icOff < 0.0002, "off Ic " + icOff)
assert.ok(icOn > 0.002, "on Ic " + icOn)

// --- RC charges, then discharges ---
var rcState = E.createState()
rcState.capV.c = 0
var rcNet = net([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 1000 } },
  { id: "c", type: "capacitor", nodes: [2, 0], props: { farads: 100e-6 } }
], 3)
var prev = 0
var mid = 0
for (var step = 0; step < 50; step++) {
  var rc = E.solve(rcNet, rcState, 0.01)
  assert.strictEqual(rc.ok, true, "rc charge step " + step)
  var vc = part(rc, "c").pinVolts[0] - part(rc, "c").pinVolts[1]
  assert.ok(vc >= prev - 1e-3, "charge dipped " + prev + " -> " + vc)
  prev = vc
  if (step === 0) mid = vc
}
console.log("rc charge first", mid.toFixed(3), "after 0.5s", prev.toFixed(3))
assert.ok(mid > 0.3 && mid < 2, "first step " + mid)
assert.ok(prev > 8, "not charged " + prev)

var disState = E.createState()
disState.capV.c = 9
var disNet = net([
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 1000 } },
  { id: "c", type: "capacitor", nodes: [1, 0], props: { farads: 100e-6 } }
], 2)
var startV = 9
var endV = 9
for (var dstep = 0; dstep < 30; dstep++) {
  var dis = E.solve(disNet, disState, 0.01)
  assert.strictEqual(dis.ok, true, "rc discharge step " + dstep)
  endV = part(dis, "c").pinVolts[0] - part(dis, "c").pinVolts[1]
  assert.ok(endV <= startV + 1e-3)
  startV = endV
}
console.log("rc discharge after 0.3s", endV.toFixed(3))
assert.ok(endV < 1.5 && endV > 0.02, "discharge " + endV)

// --- supply short is a danger warning, and the current stays finite ---
var shorted = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "w", type: "resistor", nodes: [1, 0], props: { ohms: 0.05 } }
], 2)
assert.strictEqual(shorted.ok, true)
assert.strictEqual(shorted.converged, true)
var iShort = Math.abs(part(shorted, "bat").current)
console.log("short", iShort.toFixed(3), "A", JSON.stringify(shorted.warnings))
assert.ok(iShort < 20, "current not capped " + iShort)
assert.ok(iShort > 1, "short current " + iShort)
assert.ok(warnLevel(shorted, "danger", "bat"))

var dead = solve([
  { id: "bat", type: "battery9v", nodes: [0, 0], props: {} }
], 1)
assert.strictEqual(dead.ok, true)
assert.ok(warnLevel(dead, "danger", "bat"))
assert.ok(Math.abs(part(dead, "bat").current) < 20)

// --- no supply: info, zeros, no throw ---
var dark = E.solve(net([
  { id: "r", type: "resistor", nodes: [0, 1], props: { ohms: 470 } }
], 2, -1), E.createState(), 0)
assert.strictEqual(dark.ok, true)
assert.ok(warnLevel(dark, "info"))
assert.strictEqual(dark.nodeVolts[0], 0)
assert.strictEqual(dark.nodeVolts[1], 0)

// garbage never throws
assert.strictEqual(E.solve(null, E.createState(), 0).ok, false)
assert.strictEqual(typeof E.solve({}, E.createState(), 0).ok, "boolean")
assert.strictEqual(E.solve({ nodeCount: 2, ground: 0, elements: [{ id: "x", type: "nope", nodes: [0, 1], props: {} }] }, E.createState(), 0).ok, true)
assert.strictEqual(E.isTimeDependent(net([{ id: "c", type: "capacitor", nodes: [1, 0], props: {} }], 2)), true)
assert.strictEqual(E.isTimeDependent(net([{ id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 100 } }], 2)), false)
assert.strictEqual(E.isTimeDependent(null), false)

// --- bench supply current limit ---
var limited = solve([
  { id: "ps", type: "benchSupply", nodes: [1, 0], props: { volts: 5, currentLimit: 0.1 } },
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 1 } }
], 2)
assert.strictEqual(limited.converged, true)
var ps = part(limited, "ps")
console.log("limited supply", ps.volts.toFixed(3), "V", ps.current.toFixed(3), "A", "limited", ps.limited)
assert.strictEqual(ps.limited, true)
assert.ok(Math.abs(Math.abs(ps.current) - 0.1) < 0.02, "limit current " + ps.current)
assert.ok(ps.volts < 1, "limit voltage " + ps.volts)

var openSup = solve([
  { id: "ps", type: "benchSupply", nodes: [1, 0], props: { volts: 5, currentLimit: 0.1 } },
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 10000 } }
], 2)
var ps2 = part(openSup, "ps")
console.log("open supply", ps2.volts.toFixed(3), "V", ps2.current.toExponential(2), "limited", ps2.limited)
assert.strictEqual(openSup.converged, true)
assert.strictEqual(ps2.limited, false)
assert.ok(Math.abs(ps2.volts - 5) < 0.05)

// --- ohm meter, powered and not ---
var ohms = solve([
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 470 } },
  { id: "m", type: "multimeter", nodes: [1, 0], props: { mode: "Ω" } }
], 2, null, 0, -1)
console.log("ohms", part(ohms, "m").reading, part(ohms, "m").value)
assert.strictEqual(ohms.converged, true)
assert.ok(Math.abs(part(ohms, "m").value - 470) / 470 < 0.05, "ohm reading " + part(ohms, "m").value)

var ohmsHot = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 470 } },
  { id: "m", type: "multimeter", nodes: [1, 0], props: { mode: "Ω" } }
], 2)
assert.strictEqual(part(ohmsHot, "m").reading, "Power on!")
assert.ok(warnLevel(ohmsHot, "warn", "m"))

// --- pot at mid point is half the supply ---
var pot = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "k", type: "potentiometer", nodes: [1, 2, 0], props: { ohms: 10000, turn: 0.5 } }
], 3)
var vw = part(pot, "k").pinVolts[1]
console.log("pot mid", vw.toFixed(3))
assert.ok(Math.abs(vw - 4.5) < 0.05, "pot " + vw)

// --- TMP36 at 25 C is about 0.75 V ---
var tmp = solve([
  { id: "ps", type: "benchSupply", nodes: [1, 0], props: { volts: 5, currentLimit: 0.1 } },
  { id: "t", type: "tmp36", nodes: [1, 2, 0], props: { celsius: 25 } },
  { id: "m", type: "multimeter", nodes: [2, 0], props: { mode: "V" } }
], 3)
console.log("tmp36", part(tmp, "m").reading, "converged", tmp.converged)
assert.strictEqual(tmp.converged, true)
assert.ok(Math.abs(part(tmp, "m").value - 0.75) < 0.05, "tmp " + part(tmp, "m").value)

// --- zener holds near its voltage ---
var zen = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 1000 } },
  { id: "z", type: "zener", nodes: [0, 2], props: { zenerVolts: 5.1 } }
], 3)
var vz = part(zen, "z").pinVolts[1] - part(zen, "z").pinVolts[0]
console.log("zener", vz.toFixed(3), "converged", zen.converged)
assert.strictEqual(zen.converged, true)
assert.ok(vz > 4.8 && vz < 5.6, "zener " + vz)

// --- electrolytic reversed burns; over rating burns ---
var rev = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "c", type: "electrolytic", nodes: [0, 1], props: { farads: 1e-4, ratedVolts: 16 } }
], 2)
assert.strictEqual(part(rev, "c").burnt, true)
assert.ok(warnLevel(rev, "warn", "c"))

var over = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "c", type: "electrolytic", nodes: [1, 0], props: { farads: 1e-4, ratedVolts: 5 } }
], 2)
assert.strictEqual(part(over, "c").burnt, true)

// --- MOSFET switches a load ---
var mosOn = solve([
  { id: "ps", type: "benchSupply", nodes: [1, 0], props: { volts: 5, currentLimit: 1 } },
  { id: "q", type: "nmos", nodes: [0, 1, 2], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 100 } }
], 3)
var mosOff = solve([
  { id: "ps", type: "benchSupply", nodes: [1, 0], props: { volts: 5, currentLimit: 1 } },
  { id: "q", type: "nmos", nodes: [0, 0, 2], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 100 } }
], 3)
console.log("mos on", part(mosOn, "q").collectorCurrent.toFixed(4), part(mosOn, "q").state, "off", part(mosOff, "q").state)
assert.strictEqual(mosOn.converged, true)
assert.ok(part(mosOn, "q").collectorCurrent > 0.01)
assert.ok(Math.abs(part(mosOff, "q").collectorCurrent) < 0.001)

// --- PNP sources collector current when the base is pulled down ---
var pnp = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "q", type: "pnp", nodes: [1, 2, 3], props: { beta: 150 } },
  { id: "rb", type: "resistor", nodes: [2, 0], props: { ohms: 10000 } },
  { id: "rc", type: "resistor", nodes: [3, 0], props: { ohms: 470 } }
], 4)
console.log("pnp", part(pnp, "q").collectorCurrent.toFixed(4), part(pnp, "q").state, "converged", pnp.converged, JSON.stringify(pnp.warnings))
assert.strictEqual(pnp.converged, true)
assert.ok(Math.abs(part(pnp, "q").collectorCurrent) > 0.002)

// --- motor spin follows current ---
var motor = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "m", type: "motor", nodes: [1, 0], props: {} }
], 2)
console.log("motor", part(motor, "m").spin, part(motor, "m").current.toFixed(3))
assert.strictEqual(part(motor, "m").spin, 1)

var buzz = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "z", type: "buzzer", nodes: [1, 0], props: {} }
], 2)
assert.strictEqual(part(buzz, "z").on, true)

// --- every lesson circuit solves, including a few transient steps ---
L.lessons.forEach(function (lesson) {
  var bench = lesson.build()
  var nl = B.buildNetlist(bench)
  var st = E.createState()
  var bare = { nodeCount: nl.nodeCount, ground: nl.ground, elements: nl.elements }
  var result = E.solve(bare, st, 0)
  assert.strictEqual(result.ok, true, lesson.id + " " + JSON.stringify(result.warnings))
  assert.strictEqual(result.converged, true, lesson.id + " did not converge " + JSON.stringify(result.warnings))
  if (E.isTimeDependent(bare)) {
    var stepped = E.solve(bare, st, 0.001)
    assert.strictEqual(stepped.ok, true, lesson.id + " step")
    assert.strictEqual(stepped.converged, true, lesson.id + " step converge")
  }
  var bits = []
  nl.elements.forEach(function (el) {
    var live = result.parts[el.id]
    if (!live) return
    if (el.type === "led" || el.type === "motor" || el.type === "npn" || el.type === "multimeter" || el.type === "electrolytic" || el.type === "capacitor") {
      bits.push(el.id + ":" + JSON.stringify({
        i: live.current && +live.current.toFixed(4),
        b: live.brightness,
        spin: live.spin,
        ic: live.collectorCurrent && +live.collectorCurrent.toFixed(4),
        v: live.value && +Number(live.value).toFixed(3),
        reading: live.reading,
        burnt: live.burnt || undefined,
        pins: live.pinVolts && live.pinVolts.map(function (x) { return +x.toFixed(2) })
      }))
    }
  })
  console.log("lesson", lesson.id, "nodes", nl.nodeCount, bits.join(" "))
})

// Button pressed on the transistor, RC and motor lessons.
function press(lessonId) {
  var lesson = L.lessons.filter(function (x) { return x.id === lessonId })[0]
  var bench = lesson.build()
  bench.parts.forEach(function (p) { if (p.type === "pushButton") p.props.pressed = true })
  var nl = B.buildNetlist(bench)
  var bare = { nodeCount: nl.nodeCount, ground: nl.ground, elements: nl.elements }
  var result = E.solve(bare, E.createState(), 0)
  assert.strictEqual(result.ok, true, lessonId + " pressed")
  assert.strictEqual(result.converged, true, lessonId + " pressed converge " + JSON.stringify(result.warnings))
  return { nl: nl, result: result }
}
var npnLesson = press("npn")
var icLesson = 0
npnLesson.nl.elements.forEach(function (el) {
  if (el.type === "npn") icLesson = Math.abs(npnLesson.result.parts[el.id].collectorCurrent || 0)
})
console.log("lesson npn pressed Ic", icLesson.toFixed(4))
assert.ok(icLesson > 0.002, "lesson npn Ic " + icLesson)

var motorLesson = press("motor")
var spinLesson = 0
motorLesson.nl.elements.forEach(function (el) {
  if (el.type === "motor") spinLesson = Math.abs(motorLesson.result.parts[el.id].spin || 0)
})
console.log("lesson motor pressed spin", spinLesson.toFixed(3))
assert.ok(spinLesson > 0.1, "lesson motor spin " + spinLesson)

// --- worker: load, keep a burnt LED, reset, and stop a long step run ---
function loadWorker() {
  var src = fs.readFileSync(path.join(__dirname, "..", "qml", "lib", "EngineWorker.js"), "utf8")
  src = src.replace(/^\.import\s+"([^"]+)"\s+as\s+(\w+)\s*$/m, "")
  var messages = []
  var calls = 0
  var engine = load("Engine.js")
  var realSolve = engine.solve
  engine.solve = function () {
    calls++
    return realSolve.apply(engine, arguments)
  }
  var ctx = {
    Engine: engine,
    WorkerScript: {
      onMessage: null,
      sendMessage: function (m) { messages.push(m) }
    },
    Date: Date,
    Math: Math,
    isFinite: isFinite,
    Number: Number,
    String: String
  }
  vm.createContext(ctx)
  vm.runInContext(src, ctx, { filename: "EngineWorker.js" })
  return {
    messages: messages,
    calls: function () { return calls },
    send: function (m) { messages.length = 0; ctx.WorkerScript.onMessage(m); return messages.slice() }
  }
}

var worker = loadWorker()
var burned = worker.send({
  cmd: "load",
  netlist: net([
    { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
    { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 10 } },
    { id: "d", type: "led", nodes: [2, 0], props: { color: "red" } }
  ], 3)
})
assert.strictEqual(burned.length, 1)
assert.strictEqual(burned[0].kind, "result")
assert.strictEqual(burned[0].result.parts.d.burnt, true)

var still = worker.send({
  cmd: "load",
  netlist: net([
    { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
    { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 10 } },
    { id: "d", type: "led", nodes: [2, 0], props: { color: "red" } }
  ], 3)
})
assert.strictEqual(still[0].result.parts.d.burnt, true)
assert.ok(Math.abs(still[0].result.parts.d.current) < 0.001)

var resetMsgs = worker.send({ cmd: "reset" })
assert.strictEqual(resetMsgs.length, 0)

var relit = worker.send({
  cmd: "load",
  netlist: net([
    { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
    { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 470 } },
    { id: "d", type: "led", nodes: [2, 0], props: { color: "red" } }
  ], 3)
})
assert.strictEqual(relit[0].result.parts.d.burnt, false)
assert.ok(relit[0].result.parts.d.brightness > 0.15)

var t0 = Date.now()
var stepped = worker.send({
  cmd: "step",
  dt: 0.001,
  steps: 1000000,
  netlist: null
})
var elapsed = Date.now() - t0
console.log("worker steps", worker.calls(), "in", elapsed, "ms")
assert.strictEqual(stepped.length, 1)
assert.strictEqual(stepped[0].kind, "result")
assert.ok(elapsed < 1000, "step budget ran " + elapsed + "ms")
assert.ok(worker.calls() < 1000000, "step budget did not stop")

// --- 7-segment: eight red LEDs, common cathode on the last pin ---
var segLit = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "ra", type: "resistor", nodes: [1, 2], props: { ohms: 470 } },
  { id: "rb", type: "resistor", nodes: [1, 3], props: { ohms: 470 } },
  { id: "disp", type: "sevenSeg", nodes: [2, 3, 4, 4, 4, 4, 4, 4, 0], props: {} }
], 5)
assert.strictEqual(segLit.ok, true)
assert.strictEqual(segLit.converged, true)
var segs = part(segLit, "disp").segments
console.log("seven a", segs.a.toFixed(2), "b", segs.b.toFixed(2), "c", segs.c.toFixed(3))
assert.ok(segs.a > 0.5 && segs.b > 0.5, "lit segments " + segs.a + " " + segs.b)
assert.ok(segs.c < 0.05 && segs.dp < 0.05, "dark segments")
assert.ok(!warnLevel(segLit, "info", "disp"), "sevenSeg is in the simulator")

var segState = E.createState()
var segBurn = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "disp", type: "sevenSeg", nodes: [1, 2, 2, 2, 2, 2, 2, 2, 0], props: {} }
], 3, segState)
assert.strictEqual(segBurn.parts.disp.segments.a, 0)
assert.strictEqual(segBurn.parts.disp.burnt, true)
assert.ok(warnLevel(segBurn, "warn", "disp"))
var segDead = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "disp", type: "sevenSeg", nodes: [1, 2, 2, 2, 2, 2, 2, 2, 0], props: {} }
], 3, segState)
assert.strictEqual(segDead.parts.disp.segments.a, 0)
assert.ok(Math.abs(segDead.parts.disp.current) < 0.001, "burnt segment stays open")

// --- OmaDuino pins: rails, cache, pull-up, a shorted HIGH pin ---
function duinoElement(code, pinNodes) {
  var nodes = []
  for (var i = 0; i < 22; i++) nodes.push(20 + i)
  nodes[0] = 0
  nodes[21] = 0
  nodes[1] = 1
  nodes[2] = 2
  if (pinNodes) for (var k in pinNodes) nodes[k] = pinNodes[k]
  return { id: "mcu", type: "omaduino", nodes: nodes, props: { code: code || "" } }
}
var STUB = "void setup() {}\nvoid loop() {}\n"
var rails = solve([
  duinoElement(""),
  { id: "r5", type: "resistor", nodes: [1, 0], props: { ohms: 100 } },
  { id: "r3", type: "resistor", nodes: [2, 0], props: { ohms: 100 } }
], 50)
assert.strictEqual(rails.ok, true)
assert.strictEqual(rails.converged, true)
console.log("board 5V", rails.nodeVolts[1].toFixed(3), "3V3", rails.nodeVolts[2].toFixed(3))
assert.ok(Math.abs(rails.nodeVolts[1] - 4.99) < 0.02, "5V sag " + rails.nodeVolts[1])
assert.ok(Math.abs(rails.nodeVolts[2] - 3.267) < 0.02, "3.3V sag " + rails.nodeVolts[2])
assert.strictEqual(rails.parts.mcu.error, "")
assert.strictEqual(rails.parts.mcu.pins[13].mode, "in")
assert.strictEqual(rails.parts.mcu.running, false)
assert.strictEqual(E.isTimeDependent(net([duinoElement("")], 50)), true)

var limited33 = solve([duinoElement("", { 2: 0 })], 50)
assert.ok(warnLevel(limited33, "warn", "mcu"), "3.3V short should warn")

var boardState = E.createState()
var stubNet = net([duinoElement(STUB, { 9: 4 })], 50)
var stub1 = E.solve(stubNet, boardState, 0)
assert.strictEqual(stub1.parts.mcu.running, true)
assert.strictEqual(stub1.parts.mcu.pins[2].mode, "in")
var cached = boardState.mcu.mcu.vm
cached.pins[2].mode = "pullup"
cached.pins[13].mode = "out"
cached.pins[13].level = 1
var pulled = E.solve(stubNet, boardState, 0)
assert.strictEqual(boardState.mcu.mcu.vm, cached, "same sketch keeps the VM")
assert.strictEqual(pulled.parts.mcu.pins[13].mode, "out")
assert.ok(pulled.nodeVolts[4] > 4.5, "pull-up sits near 5V " + pulled.nodeVolts[4])
var pressed = E.solve(net([
  duinoElement(STUB, { 9: 4 }),
  { id: "b", type: "pushButton", nodes: [4, 0], props: { pressed: true } }
], 50), boardState, 0)
assert.ok(pressed.nodeVolts[4] < 0.05, "pressed button pulls the pin down " + pressed.nodeVolts[4])

var shortState = E.createState()
var shortNet = net([duinoElement(STUB, { 20: 0 })], 50)
E.solve(shortNet, shortState, 0)
shortState.mcu.mcu.vm.pins[13].mode = "out"
shortState.mcu.mcu.vm.pins[13].level = 1
var pinShort = E.solve(shortNet, shortState, 0)
var pinWarn = (pinShort.warnings || []).filter(function (w) { return w.part === "mcu" && w.message.indexOf("D13") >= 0 })
console.log("shorted D13", JSON.stringify(pinWarn))
assert.ok(pinWarn.some(function (w) { return w.level === "warn" && w.message.indexOf("200 mA") >= 0 }))
assert.ok(pinWarn.some(function (w) { return w.level === "danger" }))

var badCode = solve([duinoElement("this is not a sketch")], 50)
assert.ok(badCode.parts.mcu.error, "compile error is reported")
assert.ok(badCode.parts.mcu.errorLine >= 1)
assert.strictEqual(badCode.parts.mcu.running, false)

stubNet.elements[0].props.code = ""
var wiped = E.solve(stubNet, boardState, 0)
assert.strictEqual(wiped.parts.mcu.pins[13].mode, "in")
assert.strictEqual(wiped.parts.mcu.error, "")
assert.strictEqual(boardState.mcu.mcu.vm, null)

// --- sketch time: stamp, solve, then run the VM one dt ---
function lessonBare(id) {
  var lesson = L.lessons.filter(function (x) { return x.id === id })[0]
  var nl = B.buildNetlist(lesson.build())
  return { nodeCount: nl.nodeCount, ground: nl.ground, elements: nl.elements }
}
function stepLesson(id, n, mutate) {
  var lesson = L.lessons.filter(function (x) { return x.id === id })[0]
  var bench = lesson.build()
  if (mutate) mutate(bench)
  var nl = B.buildNetlist(bench)
  var bare = { nodeCount: nl.nodeCount, ground: nl.ground, elements: nl.elements }
  var st = E.createState()
  var result = null
  for (var i = 0; i < n; i++) result = E.solve(bare, st, 0.001)
  return { result: result, state: st, bare: bare }
}
var blinkRun = []
var blinkBare = lessonBare("blink")
var blinkState = E.createState()
for (var bt = 0; bt < 1500; bt++) {
  var br = E.solve(blinkBare, blinkState, 0.001)
  blinkRun.push(br.parts.led.brightness > 0.2 ? 1 : 0)
}
var blinkRuns = []
var blinkCur = blinkRun[0]
var blinkN = 0
for (var bi = 0; bi < blinkRun.length; bi++) {
  if (blinkRun[bi] === blinkCur) blinkN++
  else { blinkRuns.push(blinkCur + "x" + blinkN); blinkCur = blinkRun[bi]; blinkN = 1 }
}
blinkRuns.push(blinkCur + "x" + blinkN)
console.log("blink runs", blinkRuns.join(" "))
var blinkOn = 0
var blinkOff = 0
for (var brn = 0; brn < blinkRuns.length; brn++) {
  var partRun = blinkRuns[brn].split("x")
  var count = Number(partRun[1])
  if (partRun[0] === "1" && blinkOn === 0) blinkOn = count
  else if (partRun[0] === "0" && blinkOn > 0 && blinkOff === 0) blinkOff = count
}
assert.ok(blinkOn > 450 && blinkOn < 560, "LED on about 500 ms, was " + blinkOn)
assert.ok(blinkOff > 450 && blinkOff < 560, "LED off about 500 ms, was " + blinkOff)
assert.strictEqual(blinkState.mcu.mcu.vm.pins[13].mode, "out")

var buttonUp = stepLesson("mcubutton", 5)
var buttonDown = stepLesson("mcubutton", 5, function (bench) {
  bench.parts.forEach(function (p) { if (p.type === "pushButton") p.props.pressed = true })
})
console.log("button up", buttonUp.result.parts.led.brightness.toFixed(3), "down", buttonDown.result.parts.led.brightness.toFixed(3))
assert.ok(buttonUp.result.parts.led.brightness < 0.05, "button up keeps the LED off")
assert.ok(buttonDown.result.parts.led.brightness > 0.2, "button down lights the LED")

var McuLib = load("Mcu.js")
var knobState = E.createState()
var knobEl = duinoElement(McuLib.example("knob"), { 3: 4 })
var knobNet = net([
  knobEl,
  { id: "pot", type: "potentiometer", nodes: [1, 4, 0], props: { ohms: 10000, turn: 0.5 } }
], 50)
var knobResult = null
for (var ks = 0; ks < 5; ks++) knobResult = E.solve(knobNet, knobState, 0.001)
console.log("knob serial", JSON.stringify(knobResult.parts.mcu.serial))
assert.ok(/A0 = 51[0-4]/.test(knobResult.parts.mcu.serial), "analogRead near 512")

var perfBare = lessonBare("blink")
var perfState = E.createState()
var perfT = Date.now()
for (var ps = 0; ps < 1000; ps++) E.solve(perfBare, perfState, 0.001)
var perfMs = Date.now() - perfT
console.log("blink 1000 steps", perfMs, "ms")
assert.ok(perfMs < 1000, "1000 blink steps took " + perfMs + "ms")

// --- HC-SR04: 15 mA load, and pulseIn reports distance * 58 µs ---
var sonarDc = solve([
  duinoElement(""),
  { id: "us", type: "hcsr04", nodes: [1, 5, 6, 0], props: { distance: 30 } }
], 50)
assert.strictEqual(sonarDc.converged, true)
console.log("sonar mA", (sonarDc.parts.us.current * 1000).toFixed(2), "ping", sonarDc.parts.us.pinging)
assert.ok(sonarDc.parts.us.current > 0.014 && sonarDc.parts.us.current < 0.017, "about 15 mA, was " + sonarDc.parts.us.current)
assert.strictEqual(sonarDc.parts.us.pinging, false)
assert.ok(!warnLevel(sonarDc, "info", "us"))
assert.ok(!warnLevel(sonarDc, "warn", "us"))
assert.ok(Math.abs(sonarDc.nodeVolts[6]) < 0.05, "echo sits near 0")

var sonarDark = solve([
  duinoElement(""),
  { id: "us", type: "hcsr04", nodes: [8, 5, 6, 0], props: { distance: 30 } }
], 50)
assert.ok(warnLevel(sonarDark, "warn", "us"), "unpowered sensor warns")
assert.strictEqual(sonarDark.parts.us.pinging, false)

var pingState = E.createState()
var pingNet = net([
  duinoElement(STUB, { 14: 5 }),
  { id: "us", type: "hcsr04", nodes: [1, 5, 6, 0], props: { distance: 30 } }
], 50)
E.solve(pingNet, pingState, 0)
pingState.mcu.mcu.vm.pins[7].mode = "out"
pingState.mcu.mcu.vm.pins[7].level = 1
var pingHigh = E.solve(pingNet, pingState, 0)
assert.strictEqual(pingHigh.parts.us.pinging, true, "TRIG high means pinging")

function readDistance(cm, trigNode) {
  var code = McuLib.example("distance")
  var nodes = { 15: 6 }
  if (trigNode !== undefined) nodes[14] = trigNode
  var bare = net([
    duinoElement(code, nodes),
    { id: "us", type: "hcsr04", nodes: [1, trigNode === undefined ? 9 : trigNode, 6, 0], props: { distance: cm } }
  ], 50)
  var st = E.createState()
  var last = null
  var pinged = false
  for (var i = 0; i < 40; i++) {
    last = E.solve(bare, st, 0.001)
    if (last.parts.us && last.parts.us.pinging) pinged = true
  }
  return { serial: last.parts.mcu.serial, pinged: pinged, warn: warnLevel(last, "info", "us") }
}
var dist30 = readDistance(30, 5)
console.log("distance serial", JSON.stringify(dist30.serial), "pinged", dist30.pinged)
assert.ok(/30 cm/.test(dist30.serial), "serial shows 30 cm")
assert.strictEqual(dist30.pinged, true)
assert.ok(!dist30.warn)

var distLoose = readDistance(30)
console.log("unwired trig serial", JSON.stringify(distLoose.serial))
assert.ok(!/cm/.test(distLoose.serial), "TRIG must be a board pin")

var sonarLesson = stepLesson("sonar", 40)
console.log("lesson sonar", JSON.stringify(sonarLesson.result.parts.mcu.serial))
assert.ok(/40 cm/.test(sonarLesson.result.parts.mcu.serial), "lesson sonar reads 40 cm")

console.log("engine tests ok")

// The .mjs copies are what WorkerScript runs (strict mode). The vm above is sloppy.
const { pathToFileURL } = require("url")
function near(a, b) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9
  return false
}
function sameSolve(a, b, label) {
  assert.strictEqual(b.ok, a.ok, label + " ok")
  assert.strictEqual(b.converged, a.converged, label + " converged")
  Object.keys(a.parts || {}).forEach(function (id) {
    var pb = b.parts && b.parts[id]
    assert.ok(pb, label + " missing " + id)
    ;["current", "brightness", "spin", "volts"].forEach(function (key) {
      if (typeof a.parts[id][key] === "number") {
        assert.ok(near(a.parts[id][key], pb[key]), label + " " + id + " " + key + " " + pb[key])
      }
    })
    if (a.parts[id].segments && pb.segments) {
      ;["a", "b", "c", "d", "e", "f", "g", "dp"].forEach(function (name) {
        assert.ok(near(a.parts[id].segments[name], pb.segments[name]), label + " seg " + name)
      })
    }
  })
}
import(pathToFileURL(path.join(__dirname, "..", "qml", "lib", "worker", "Engine.mjs")).href).then(function (mod) {
  assert.strictEqual(typeof mod.solve, "function")
  assert.strictEqual(typeof mod.createState, "function")
  assert.strictEqual(typeof mod.isTimeDependent, "function")
  var again = mod.solve(net([
    { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
    { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 470 } },
    { id: "d", type: "led", nodes: [2, 0], props: { color: "red" } }
  ], 3), mod.createState(), 0)
  sameSolve(led, again, "mjs led")
  sameSolve(segLit, mod.solve(net([
    { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
    { id: "ra", type: "resistor", nodes: [1, 2], props: { ohms: 470 } },
    { id: "rb", type: "resistor", nodes: [1, 3], props: { ohms: 470 } },
    { id: "disp", type: "sevenSeg", nodes: [2, 3, 4, 4, 4, 4, 4, 4, 0], props: {} }
  ], 5), mod.createState(), 0), "mjs seven")
  L.lessons.forEach(function (lesson) {
    var nl = B.buildNetlist(lesson.build())
    var bare = { nodeCount: nl.nodeCount, ground: nl.ground, elements: nl.elements }
    sameSolve(E.solve(bare, E.createState(), 0), mod.solve(bare, mod.createState(), 0), "mjs " + lesson.id)
  })
  console.log("worker modules ok", L.lessons.length, "lessons")
}).catch(function (err) {
  console.error(err)
  process.exit(1)
})
