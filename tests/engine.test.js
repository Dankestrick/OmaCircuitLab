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
assert.notStrictEqual(part(buzz, "z").reversed, true)
assert.strictEqual(part(buzz, "z").freq, 2300)

var buzzBack = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "z", type: "buzzer", nodes: [0, 1], props: {} }
], 2)
assert.strictEqual(part(buzzBack, "z").on, false)
assert.strictEqual(part(buzzBack, "z").reversed, true)
assert.strictEqual(part(buzzBack, "z").freq, 0)
assert.ok(Math.abs(part(buzzBack, "z").current) > 0.04)
assert.ok(buzzBack.warnings.some(function (w) {
  return w.part === "z" && w.level === "warn" && w.message === "This buzzer is in backwards: its + leg (marked +) needs the higher voltage. Turn it around (R)."
}))

var buzzQuiet = solve([
  { id: "z", type: "buzzer", nodes: [1, 0], props: {} }
], 2)
assert.strictEqual(part(buzzQuiet, "z").on, false)
assert.strictEqual(part(buzzQuiet, "z").freq, 0)

var buzzSoft = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 1000 } },
  { id: "z", type: "buzzer", nodes: [2, 0], props: {} }
], 3)
assert.strictEqual(part(buzzSoft, "z").on, false)
assert.strictEqual(part(buzzSoft, "z").freq, 0)

// D8 (catalog index 15, sketch pin 8) on the + leg. tone() wins even
// though pwm 127 averages under the 2.5 V on-threshold.
var toneState = E.createState()
var toneNet = net([
  duinoElement("void setup() {}\nvoid loop() {}\n", { 15: 5 }),
  { id: "z", type: "buzzer", nodes: [5, 0], props: {} }
], 50)
E.solve(toneNet, toneState, 0)
toneState.mcu.mcu.vm.pins[8].mode = "out"
toneState.mcu.mcu.vm.pins[8].pwm = 127
toneState.mcu.mcu.vm.pins[8].tone = 440
var toned = E.solve(toneNet, toneState, 0)
assert.strictEqual(part(toned, "z").freq, 440)
assert.strictEqual(part(toned, "z").on, false)

toneState.mcu.mcu.vm.pins[8].tone = null
toneState.mcu.mcu.vm.pins[8].pwm = null
toneState.mcu.mcu.vm.pins[8].level = 1
var buzzHigh = E.solve(toneNet, toneState, 0)
assert.strictEqual(part(buzzHigh, "z").on, true)
assert.strictEqual(part(buzzHigh, "z").freq, 2300)

// A tone on the minus leg does not set the pitch.
var toneMinus = E.createState()
var minusNet = net([
  duinoElement("void setup() {}\nvoid loop() {}\n", { 15: 5 }),
  { id: "z", type: "buzzer", nodes: [0, 5], props: {} }
], 50)
E.solve(minusNet, toneMinus, 0)
toneMinus.mcu.mcu.vm.pins[8].mode = "out"
toneMinus.mcu.mcu.vm.pins[8].level = 1
toneMinus.mcu.mcu.vm.pins[8].tone = 880
var minusBuzz = E.solve(minusNet, toneMinus, 0)
assert.strictEqual(part(minusBuzz, "z").reversed, true)
assert.strictEqual(part(minusBuzz, "z").on, false)
assert.strictEqual(part(minusBuzz, "z").freq, 0)

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
assert.ok(sonarDc.parts.us.pinCurrents && Math.abs(sonarDc.parts.us.pinCurrents[0] + sonarDc.parts.us.pinCurrents[1] + sonarDc.parts.us.pinCurrents[2] + sonarDc.parts.us.pinCurrents[3]) < 1e-9, "sonar pin currents sum to 0")

// --- servo: 100 ohm when powered, angle follows the pin, holds when the wire leaves ---
var servoDc = solve([
  duinoElement(""),
  { id: "sv", type: "servo", nodes: [0, 1, 4], props: {} }
], 50)
assert.strictEqual(servoDc.converged, true)
console.log("servo mA", (servoDc.parts.sv.current * 1000).toFixed(1), "angle", servoDc.parts.sv.angle)
assert.ok(servoDc.parts.sv.current < -0.045 && servoDc.parts.sv.current > -0.055, "about 50 mA into GND, was " + servoDc.parts.sv.current)
assert.strictEqual(servoDc.parts.sv.angle, 90)
assert.ok(!warnLevel(servoDc, "warn", "sv"))
assert.ok(!warnLevel(servoDc, "info", "sv"))
assert.ok(Math.abs(servoDc.parts.sv.pinCurrents[0] + servoDc.parts.sv.pinCurrents[1] + servoDc.parts.sv.pinCurrents[2]) < 1e-9)

var servoDark = solve([
  duinoElement(""),
  { id: "sv", type: "servo", nodes: [0, 8, 4], props: {} }
], 50)
assert.strictEqual(servoDark.parts.sv.angle, 90)
assert.ok((servoDark.warnings || []).some(function (w) { return w.part === "sv" && w.message === "The servo needs 5V and GND." }))

var servoBare = lessonBare("servo")
var servoState = E.createState()
var servoStart = E.solve(servoBare, servoState, 0)
assert.strictEqual(servoStart.parts.sv.angle, 90)
var servoAt = []
for (var sa = 0; sa < 25; sa++) servoAt.push(E.solve(servoBare, servoState, 0.001).parts.sv.angle)
console.log("servo angles", servoAt[0], servoAt[4], servoAt[24])
assert.strictEqual(servoAt[4], 0, "sweep writes 0")
assert.ok(servoAt[24] >= 2 && servoAt[24] <= 4, "sweep moves on, was " + servoAt[24])

var sweepCode = McuLib.example("servo")
var sweepState = E.createState()
var sweepNet = net([
  duinoElement(sweepCode, { 16: 4 }),
  { id: "sv", type: "servo", nodes: [0, 1, 4], props: {} }
], 50)
var held = null
for (var sw = 0; sw < 8; sw++) held = E.solve(sweepNet, sweepState, 0.001).parts.sv.angle
assert.strictEqual(held, 0)
var letGo = E.solve(net([
  duinoElement(sweepCode, { 16: 7 }),
  { id: "sv", type: "servo", nodes: [0, 1, 4], props: {} }
], 50), sweepState, 0.001)
assert.strictEqual(letGo.parts.sv.angle, 0, "angle stays when the signal wire leaves")

// --- motor driver: outputs follow the inputs, PWM scales them ---
function driverNet(in1) {
  return [
    duinoElement(""),
    { id: "bat", type: "aaPack", nodes: [3, 0], props: { cells: 4 } },
    { id: "drv", type: "motorDriver", nodes: [3, 0, in1, 0, 8, 8, 4, 5, 6, 7], props: {} },
    { id: "ma", type: "motor", nodes: [4, 5], props: {} }
  ]
}
var driven = solve(driverNet(1), 50)
assert.strictEqual(driven.converged, true)
console.log("driver A", driven.parts.drv.motorA.toFixed(3), "spin", driven.parts.ma.spin.toFixed(3))
assert.ok(driven.parts.drv.motorA > 0.7 && driven.parts.drv.motorA < 0.95, "motor A forward " + driven.parts.drv.motorA)
assert.strictEqual(driven.parts.ma.spin, 1)
assert.ok(!warnLevel(driven, "info", "drv"))
assert.ok(!warnLevel(driven, "warn", "drv"))

var reversed = solve([
  duinoElement(""),
  { id: "bat", type: "aaPack", nodes: [3, 0], props: { cells: 4 } },
  { id: "drv", type: "motorDriver", nodes: [3, 0, 0, 1, 8, 8, 4, 5, 6, 7], props: {} },
  { id: "ma", type: "motor", nodes: [4, 5], props: {} }
], 50)
assert.ok(reversed.parts.drv.motorA < -0.7, "motor A reverse " + reversed.parts.drv.motorA)
assert.strictEqual(reversed.parts.ma.spin, -1)

var noVm = solve([
  duinoElement(""),
  { id: "drv", type: "motorDriver", nodes: [0, 0, 1, 0, 8, 8, 4, 5, 6, 7], props: {} }
], 50)
assert.strictEqual(noVm.parts.drv.motorA, 0)
assert.ok((noVm.warnings || []).some(function (w) { return w.part === "drv" && w.message === "Motor driver has no motor power (VM)" }))

var pwmState = E.createState()
var pwmNet = net([
  duinoElement(STUB, { 12: 9 }),
  { id: "bat", type: "aaPack", nodes: [3, 0], props: { cells: 4 } },
  { id: "drv", type: "motorDriver", nodes: [3, 0, 9, 0, 8, 8, 4, 5, 6, 7], props: {} },
  { id: "ma", type: "motor", nodes: [4, 5], props: {} }
], 50)
E.solve(pwmNet, pwmState, 0)
pwmState.mcu.mcu.vm.pins[5].mode = "out"
pwmState.mcu.mcu.vm.pins[5].pwm = 128
var pwmHalf = E.solve(pwmNet, pwmState, 0)
console.log("driver pwm", pwmHalf.parts.drv.motorA.toFixed(3))
assert.ok(pwmHalf.parts.drv.motorA > 0.3 && pwmHalf.parts.drv.motorA < 0.55, "half speed " + pwmHalf.parts.drv.motorA)

// --- robot car: drives ahead at 100 cm, backs up when the object is close ---
var robotBare = lessonBare("robot")
var robotState = E.createState()
var ahead = null
var aheadN = 0
for (var ri = 0; ri < 80; ri++) {
  ahead = E.solve(robotBare, robotState, 0.001)
  aheadN = ri + 1
  if (ahead.parts.car.leftSpin > 0.5 && ahead.parts.car.rightSpin > 0.5) break
}
console.log("robot ahead", aheadN, ahead.parts.car.leftSpin.toFixed(2), ahead.parts.car.rightSpin.toFixed(2), JSON.stringify(ahead.parts.mcu.serial))
assert.ok(ahead.parts.car.leftSpin > 0.5 && ahead.parts.car.rightSpin > 0.5, "both wheels forward")
assert.ok(!warnLevel(ahead, "info", "car"))
for (var re = 0; re < robotBare.elements.length; re++) {
  if (robotBare.elements[re].id === "car") robotBare.elements[re].props.distance = 10
}
var backed = ahead
var backN = 0
for (var rj = 0; rj < 80; rj++) {
  backed = E.solve(robotBare, robotState, 0.001)
  backN = rj + 1
  if (backed.parts.car.leftSpin < -0.5 && backed.parts.car.rightSpin < -0.5) break
}
console.log("robot back", backN, backed.parts.car.leftSpin.toFixed(2), backed.parts.car.rightSpin.toFixed(2), JSON.stringify(backed.parts.mcu.serial))
assert.ok(backed.parts.car.leftSpin < -0.5 && backed.parts.car.rightSpin < -0.5, "both wheels reverse")

// setProp changes a prop, does not solve, and does not reply.
var propWorker = loadWorker()
var propCode = McuLib.example("distance")
var propNet = net([
  duinoElement(propCode, { 14: 5, 15: 6 }),
  { id: "us", type: "hcsr04", nodes: [1, 5, 6, 0], props: { distance: 30 } }
], 50)
propWorker.send({ cmd: "load", netlist: propNet })
var propCalls = propWorker.calls()
var propSilent = propWorker.send({ cmd: "setProp", id: "us", key: "distance", value: 12 })
assert.strictEqual(propSilent.length, 0, "setProp does not reply")
assert.strictEqual(propWorker.calls(), propCalls, "setProp does not solve")
var propMissing = propWorker.send({ cmd: "setProp", id: "missing", key: "distance", value: 1 })
assert.strictEqual(propMissing.length, 0)
var propFar = propWorker.send({ cmd: "step", dt: 0.001, steps: 150 })
var propSerial = propFar[0].result.parts.mcu.serial.trim().split("\n")
console.log("setProp serial", JSON.stringify(propSerial[propSerial.length - 1]))
assert.strictEqual(propSerial[propSerial.length - 1], "12 cm")
var idle = loadWorker()
assert.strictEqual(idle.send({ cmd: "setProp", id: "us", key: "distance", value: 3 }).length, 0)

// --- pin currents into every leg of a 3+ pin part sum to about 0 ---
function sumPins(live) {
  assert.ok(live.pinCurrents && live.pinCurrents.length >= 3, "missing pinCurrents " + JSON.stringify(live.pinCurrents))
  var s = 0
  for (var i = 0; i < live.pinCurrents.length; i++) s += live.pinCurrents[i]
  return s
}
function assertKcl(live, what) {
  var s = sumPins(live)
  assert.ok(Math.abs(s) < 1e-8, what + " kcl " + s)
}

var potK = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "k", type: "potentiometer", nodes: [1, 2, 0], props: { ohms: 10000, turn: 0.5 } },
  { id: "r", type: "resistor", nodes: [2, 0], props: { ohms: 10000 } }
], 3)
assertKcl(part(potK, "k"), "pot")
assert.strictEqual(part(potK, "k").pinCurrents[0], part(potK, "k").current)
assert.ok(part(potK, "k").pinCurrents[0] > 0.0005, "current enters the high end")

var swA = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "sw", type: "slideSwitch", nodes: [2, 1, 3], props: { position: 0 } },
  { id: "r", type: "resistor", nodes: [2, 0], props: { ohms: 100 } }
], 4)
assertKcl(part(swA, "sw"), "switch A")
assert.strictEqual(part(swA, "sw").pinCurrents[0], part(swA, "sw").current)
assert.ok(part(swA, "sw").pinCurrents[0] < -0.05, "current leaves A")
assert.strictEqual(part(swA, "sw").pinCurrents[2], 0)
var swB = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "sw", type: "slideSwitch", nodes: [3, 1, 2], props: { position: 1 } },
  { id: "r", type: "resistor", nodes: [2, 0], props: { ohms: 100 } }
], 4)
assertKcl(part(swB, "sw"), "switch B")
assert.strictEqual(part(swB, "sw").pinCurrents[0], 0)
assert.ok(part(swB, "sw").pinCurrents[2] < -0.05, "current leaves B")

assertKcl(part(npnOn, "q"), "npn")
assert.strictEqual(part(npnOn, "q").pinCurrents[0], part(npnOn, "q").current)
assert.strictEqual(part(npnOn, "q").pinCurrents[2], part(npnOn, "q").collectorCurrent)
assert.ok(part(npnOn, "q").pinCurrents[0] < 0, "emitter current leaves")
assertKcl(part(pnp, "q"), "pnp")
assert.strictEqual(part(pnp, "q").pinCurrents[0], part(pnp, "q").current)
assert.strictEqual(part(pnp, "q").pinCurrents[2], part(pnp, "q").collectorCurrent)
assertKcl(part(mosOn, "q"), "nmos")
assert.strictEqual(part(mosOn, "q").pinCurrents[0], part(mosOn, "q").current)
assert.strictEqual(part(mosOn, "q").pinCurrents[1], 0)
assert.strictEqual(part(mosOn, "q").pinCurrents[2], part(mosOn, "q").collectorCurrent)

assertKcl(part(tmp, "t"), "tmp36")
assert.strictEqual(part(tmp, "t").pinCurrents[0], part(tmp, "t").current)
assert.ok(Math.abs(part(tmp, "t").pinCurrents[0] - 50e-6) < 1e-9, "bias")
assert.ok(Math.abs(part(tmp, "t").pinCurrents[1]) < 1e-6, "open output")
var tmpLoad = solve([
  { id: "ps", type: "benchSupply", nodes: [1, 0], props: { volts: 5, currentLimit: 0.1 } },
  { id: "t", type: "tmp36", nodes: [1, 2, 0], props: { celsius: 25 } },
  { id: "r", type: "resistor", nodes: [2, 0], props: { ohms: 1000 } }
], 3)
assertKcl(part(tmpLoad, "t"), "tmp36 loaded")
assert.ok(part(tmpLoad, "t").pinCurrents[1] < -0.0004, "output sources into the load")

var rgbK = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "rr", type: "resistor", nodes: [1, 2], props: { ohms: 470 } },
  { id: "rg", type: "resistor", nodes: [1, 3], props: { ohms: 470 } },
  { id: "led", type: "rgbLed", nodes: [2, 0, 3, 4], props: {} }
], 5)
assertKcl(part(rgbK, "led"), "rgb")
assert.strictEqual(part(rgbK, "led").pinCurrents.length, 4)
assert.strictEqual(part(rgbK, "led").pinCurrents[0], part(rgbK, "led").current)
assert.ok(part(rgbK, "led").pinCurrents[0] > 0.01 && part(rgbK, "led").pinCurrents[2] > 0.01)
assert.ok(Math.abs(part(rgbK, "led").pinCurrents[3]) < 0.001, "blue is open")

assertKcl(part(segLit, "disp"), "seven")
assert.strictEqual(part(segLit, "disp").pinCurrents.length, 9)
assert.strictEqual(part(segLit, "disp").pinCurrents[0], part(segLit, "disp").current)
assert.ok(part(segLit, "disp").pinCurrents[8] < -0.01, "common cathode returns the segments")

assertKcl(rails.parts.mcu, "board rails")
assert.strictEqual(rails.parts.mcu.pinCurrents.length, 22)
assert.ok(rails.parts.mcu.pinCurrents[1] < -0.04, "5V sources " + rails.parts.mcu.pinCurrents[1])
assert.ok(rails.parts.mcu.pinCurrents[2] < -0.02, "3.3V sources " + rails.parts.mcu.pinCurrents[2])
assert.ok(rails.parts.mcu.pinCurrents[0] > 0.06, "GND returns the rails")

var gpioState = E.createState()
var gpioNet = net([
  duinoElement(STUB, { 20: 3 }),
  { id: "r", type: "resistor", nodes: [3, 0], props: { ohms: 470 } }
], 50)
E.solve(gpioNet, gpioState, 0)
gpioState.mcu.mcu.vm.pins[13].mode = "out"
gpioState.mcu.mcu.vm.pins[13].level = 1
var gpio = E.solve(gpioNet, gpioState, 0)
assertKcl(gpio.parts.mcu, "gpio")
assert.ok(gpio.parts.mcu.pinCurrents[20] < -0.008, "D13 sources " + gpio.parts.mcu.pinCurrents[20])

var pullState = E.createState()
var pullNet = net([duinoElement(STUB, { 9: 0 })], 50)
E.solve(pullNet, pullState, 0)
pullState.mcu.mcu.vm.pins[2].mode = "pullup"
var pullGnd = E.solve(pullNet, pullState, 0)
assertKcl(pullGnd.parts.mcu, "pullup")
assert.ok(pullGnd.parts.mcu.pinCurrents[9] < -100e-6 && pullGnd.parts.mcu.pinCurrents[9] > -200e-6, "D2 pull-up into GND")
assert.ok(Math.abs(pullGnd.parts.mcu.pinCurrents[1]) < 50e-6, "pull-up does not leave the 5V pin")

assertKcl(driven.parts.drv, "driver")
assert.strictEqual(driven.parts.drv.pinCurrents.length, 10)
assertKcl(ahead.parts.car, "car")
assert.strictEqual(ahead.parts.car.pinCurrents.length, 8)

var deadPot = E.solve({
  nodeCount: 3, ground: -1,
  elements: [{ id: "k", type: "potentiometer", nodes: [0, 1, 2], props: { ohms: 10000, turn: 0.5 } }]
}, E.createState(), 0)
assert.strictEqual(deadPot.parts.k.pinCurrents.length, 3)
assert.ok(deadPot.parts.k.pinCurrents.every(function (x) { return x === 0 }), "unpowered pot legs are 0")

// --- AC time base, function generator, wall adapter, ground rules ---
var fresh = E.createState()
assert.strictEqual(fresh.t, 0)
assert.strictEqual(E.isTimeDependent(net([{ id: "ac", type: "acSource", nodes: [1, 0], props: {} }], 2)), true)
assert.strictEqual(E.isTimeDependent(net([{ id: "wall", type: "acAdapter", nodes: [1, 0], props: {} }], 2)), true)

var acState = E.createState()
var acNet = net([
  { id: "ac", type: "acSource", nodes: [1, 0], props: { wave: "sine", freq: 60, amplitude: 5, offset: 0 } },
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 1000 } }
], 2)
var acDc = E.solve(acNet, acState, 0)
assert.strictEqual(acState.t, 0, "DC solve does not move time")
assert.ok(Math.abs(part(acDc, "ac").volts) < 1e-6, "sine at t=0 is 0, got " + part(acDc, "ac").volts)
assert.strictEqual(part(acDc, "ac").vpeak, 5)
assert.strictEqual(part(acDc, "ac").freq, 60)

var acPeak = E.solve(acNet, acState, 1 / 240)
assert.ok(Math.abs(acState.t - 1 / 240) < 1e-12, "t advanced by dt")
var acHeld = E.solve(acNet, acState, 0)
assert.ok(Math.abs(acState.t - 1 / 240) < 1e-12, "DC solve keeps t")
var vIdeal = 5
var iIdeal = vIdeal / 1050
var vTerm = iIdeal * 1000
console.log("ac sine", part(acPeak, "ac").volts.toFixed(4), "A", part(acPeak, "ac").current.toFixed(6))
assert.ok(Math.abs(part(acPeak, "ac").volts - vTerm) < 1e-3, "terminal " + part(acPeak, "ac").volts)
assert.ok(Math.abs(part(acPeak, "ac").current + iIdeal) < 1e-5, "source current " + part(acPeak, "ac").current)
assert.ok(Math.abs(part(acPeak, "r").current - iIdeal) < 1e-5)
assert.ok(Math.abs(part(acHeld, "ac").volts - part(acPeak, "ac").volts) < 1e-6, "DC reread stays at the same time")

var sq = E.solve(net([
  { id: "ac", type: "acSource", nodes: [1, 0], props: { wave: "square", freq: 60, amplitude: 5, offset: 1 } },
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 1000 } }
], 2), E.createState(), 0)
var sqV = 6 * 1000 / 1050
assert.ok(Math.abs(part(sq, "ac").volts - sqV) < 1e-3, "square high " + part(sq, "ac").volts)
var sqLow = E.createState()
sqLow.t = 0.5 / 60 - 1e-4
E.solve(net([
  { id: "ac", type: "acSource", nodes: [1, 0], props: { wave: "square", freq: 60, amplitude: 5 } },
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 1000 } }
], 2), sqLow, 1e-4)
var sqNeg = -5 * 1000 / 1050
assert.ok(Math.abs(part(E.solve(net([
  { id: "ac", type: "acSource", nodes: [1, 0], props: { wave: "square", freq: 60, amplitude: 5 } },
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 1000 } }
], 2), sqLow, 0), "ac").volts - sqNeg) < 1e-3, "square low")

var tri = E.createState()
E.solve(net([
  { id: "ac", type: "acSource", nodes: [1, 0], props: { wave: "triangle", freq: 60, amplitude: 4 } }
], 2), tri, 0.25 / 60)
assert.ok(Math.abs(part(E.solve(net([
  { id: "ac", type: "acSource", nodes: [1, 0], props: { wave: "triangle", freq: 60, amplitude: 4 } }
], 2), tri, 0), "ac").volts - 4) < 1e-3, "triangle peak")

var clamped = E.solve(net([
  { id: "ac", type: "acSource", nodes: [1, 0], props: { freq: 9000, amplitude: 80, offset: 0 } }
], 2), E.createState(), 0)
assert.strictEqual(part(clamped, "ac").freq, 5000)
assert.strictEqual(part(clamped, "ac").vpeak, 30)

var wallPeak = 12 * Math.SQRT2
var wallI = wallPeak / 1001
var wall = E.solve(net([
  { id: "wall", type: "acAdapter", nodes: [1, 0], props: { vrms: 12, freq: 60 } },
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 1000 } }
], 2), E.createState(), 1 / 240)
console.log("adapter", part(wall, "wall").volts.toFixed(3), "peak", part(wall, "wall").vpeak.toFixed(3))
assert.ok(Math.abs(part(wall, "wall").vpeak - wallPeak) < 1e-6)
assert.strictEqual(part(wall, "wall").freq, 60)
assert.ok(Math.abs(part(wall, "wall").volts - wallI * 1000) < 1e-3, "adapter terminal " + part(wall, "wall").volts)

// No bench ground: the generator's − pin is the reference, not node 0.
var floatAc = E.solve(net([
  { id: "ac", type: "acSource", nodes: [1, 2], props: { wave: "sine", freq: 60, amplitude: 5 } },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 1000 } }
], 3, -1), E.createState(), 1 / 240)
assert.ok(Math.abs(floatAc.nodeVolts[2]) < 1e-8, "ac − is reference")
assert.ok(Math.abs(floatAc.nodeVolts[1] - vTerm) < 1e-3, "floating sine " + floatAc.nodeVolts[1])

var floatWall = E.solve(net([
  { id: "wall", type: "acAdapter", nodes: [1, 2], props: { vrms: 12, freq: 60 } },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 1000 } }
], 3, -1), E.createState(), 1 / 240)
assert.ok(Math.abs(floatWall.nodeVolts[2]) < 1e-8, "adapter ~2 is reference")

// A picked ground (node 0) wins, so the generator's − is not forced to 0.
var grounded = E.solve(net([
  { id: "ac", type: "acSource", nodes: [1, 2], props: { wave: "sine", freq: 60, amplitude: 5 } },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 1000 } }
], 3, 0), E.createState(), 1 / 240)
assert.strictEqual(grounded.nodeVolts[0], 0)
assert.ok(Math.abs(grounded.nodeVolts[2]) > 1, "minus is not the reference when ground is set, got " + grounded.nodeVolts[2])
assert.ok(Math.abs((grounded.nodeVolts[1] - grounded.nodeVolts[2]) - vTerm) < 1e-3)

// A battery still owns the reference when both are present.
var both = E.solve(net([
  { id: "bat", type: "battery9v", nodes: [1, 2], props: {} },
  { id: "ac", type: "acSource", nodes: [3, 4], props: { amplitude: 5 } },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 1000 } }
], 5, -1), E.createState(), 0)
assert.ok(Math.abs(both.nodeVolts[2]) < 1e-8, "battery − wins")
assert.ok(Math.abs(both.nodeVolts[1] - 9 * 1000 / 1001.5) < 0.05)

// --- oscilloscope: 60 Hz sine across 1 kΩ ---
assert.strictEqual(E.isTimeDependent(net([{ id: "s", type: "oscilloscope", nodes: [1, 2, 0], props: {} }], 3)), true)
var scopeNet = net([
  { id: "ac", type: "acSource", nodes: [1, 0], props: { wave: "sine", freq: 60, amplitude: 5, offset: 0 } },
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 1000 } },
  { id: "s", type: "oscilloscope", nodes: [1, 1, 0], props: { timePerDiv: 0.005, ch2: false } }
], 2)
var scopeState = E.createState()
var scopeDc = E.solve(scopeNet, scopeState, 0)
assert.strictEqual(scopeState.t, 0)
assert.strictEqual(scopeState.scope.s.t.length, 1, "a DC solve pushes one sample")
assert.ok(Math.abs(part(scopeDc, "s").vpp1) < 1e-6, "flat at t=0")
assert.strictEqual(part(scopeDc, "s").freq1, 0)
assert.strictEqual(part(scopeDc, "s").samples.t.length, 1)
assert.strictEqual(part(scopeDc, "s").pinCurrents.length, 3)
assert.ok(Math.abs(part(scopeDc, "s").pinCurrents[0] + part(scopeDc, "s").pinCurrents[1] + part(scopeDc, "s").pinCurrents[2]) < 1e-12)

var scopeH = 1 / 2400
var scopeSteps = Math.round(0.1 / scopeH)
var scopeLast = null
for (var scopeI = 0; scopeI < scopeSteps; scopeI++) scopeLast = E.solve(scopeNet, scopeState, scopeH)
var scopePart = part(scopeLast, "s")
console.log("scope vpp", scopePart.vpp1.toFixed(3), "f", scopePart.freq1.toFixed(2), "rms", scopePart.vrms1.toFixed(3), "shown", scopePart.samples.t.length)
assert.ok(Math.abs(scopePart.vpp1 - 10) < 0.6, "vpp1 " + scopePart.vpp1)
assert.ok(Math.abs(scopePart.vpp2 - scopePart.vpp1) < 1e-6, "ch2 is recorded even when the prop is off")
assert.ok(Math.abs(scopePart.freq1 - 60) < 1, "freq1 " + scopePart.freq1)
assert.ok(Math.abs(scopePart.vrms1 - scopePart.vpp1 / (2 * Math.SQRT2)) < 0.05, "vrms1 " + scopePart.vrms1)
assert.strictEqual(scopeState.scope.s.t.length, scopeSteps + 1, "one sample per solve, not per Newton step")
assert.ok(scopePart.samples.t.length > 50 && scopePart.samples.t.length <= 600)
assert.strictEqual(scopePart.samples.ch1.length, scopePart.samples.t.length)
assert.strictEqual(scopePart.samples.ch2.length, scopePart.samples.t.length)
var scopeStored = scopeState.scope.s
var scopeEnd = scopeStored.t[scopeStored.t.length - 1]
var scopeStart = 0
while (scopeStored.t[scopeStart] < scopeEnd - 0.05 - 1e-12) scopeStart++
assert.strictEqual(scopePart.samples.t[0], scopeStored.t[scopeStart])
assert.strictEqual(scopePart.samples.t[scopePart.samples.t.length - 1], scopeEnd)

var decNet = net([
  { id: "ac", type: "acSource", nodes: [1, 0], props: { wave: "sine", freq: 60, amplitude: 5 } },
  { id: "r", type: "resistor", nodes: [1, 0], props: { ohms: 1000 } },
  { id: "s", type: "oscilloscope", nodes: [1, 0, 0], props: { timePerDiv: 0.005 } }
], 2)
var decState = E.createState()
var decLast = null
for (var decI = 0; decI < 1200; decI++) decLast = E.solve(decNet, decState, 5e-5)
var decPart = part(decLast, "s")
assert.strictEqual(decPart.samples.t.length, 600, "decimate to 600 " + decPart.samples.t.length)
var decStored = decState.scope.s
var decEnd = decStored.t[decStored.t.length - 1]
var decFrom = 0
while (decStored.t[decFrom] < decEnd - 0.05 - 1e-12) decFrom++
assert.strictEqual(decPart.samples.t[0], decStored.t[decFrom])
assert.strictEqual(decPart.samples.t[599], decEnd)

var ringState = E.createState()
var ringNet = net([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "s", type: "oscilloscope", nodes: [1, 0, 0], props: {} }
], 2)
var ringLast = null
for (var ringI = 0; ringI < 2005; ringI++) ringLast = E.solve(ringNet, ringState, 0.001)
assert.strictEqual(ringState.scope.s.t.length, 2000)
assert.ok(Math.abs(ringState.scope.s.t[0] - 0.006) < 1e-9, "oldest kept " + ringState.scope.s.t[0])
assert.ok(part(ringLast, "s").vpp1 < 0.05, "DC vpp " + part(ringLast, "s").vpp1)
assert.strictEqual(part(ringLast, "s").freq1, 0)

// --- schottky, bridge, fuse, tilt, IR LED, photodiode ---
var sk = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 820 } },
  { id: "d", type: "schottky", nodes: [2, 0], props: {} }
], 3)
var si = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 820 } },
  { id: "d", type: "diode", nodes: [2, 0], props: {} }
], 3)
var skV = part(sk, "d").pinVolts[0] - part(sk, "d").pinVolts[1]
var siV = part(si, "d").pinVolts[0] - part(si, "d").pinVolts[1]
console.log("schottky", skV.toFixed(3), "V", part(sk, "d").current.toFixed(4), "A silicon", siV.toFixed(3))
assert.ok(sk.converged && si.converged)
assert.ok(skV > 0.18 && skV < 0.4, "schottky Vf " + skV)
assert.ok(siV > 0.6, "silicon Vf " + siV)
assert.ok(skV < siV - 0.3)

var brNet = net([
  { id: "wall", type: "acAdapter", nodes: [1, 0], props: { vrms: 12, freq: 60 } },
  { id: "br", type: "bridgeRectifier", nodes: [1, 0, 2, 3], props: {} },
  { id: "c", type: "electrolytic", nodes: [2, 3], props: { farads: 1e-3, ratedVolts: 25 } },
  { id: "r", type: "resistor", nodes: [2, 3], props: { ohms: 1000 } }
], 4)
var brState = E.createState()
var brLast = null
var brH = 1 / 2400
for (var brI = 0; brI < Math.round(0.2 / brH); brI++) brLast = E.solve(brNet, brState, brH)
var brLo = 1e9
var brHi = -1e9
for (var brJ = 0; brJ < 48; brJ++) {
  var brNow = E.solve(brNet, brState, brH)
  var brV = part(brNow, "c").pinVolts[0] - part(brNow, "c").pinVolts[1]
  if (brV < brLo) brLo = brV
  if (brV > brHi) brHi = brV
  brLast = brNow
}
var brDc = (brLo + brHi) / 2
console.log("bridge", brDc.toFixed(2), "V ripple", (brHi - brLo).toFixed(3), "burnt", part(brLast, "c").burnt)
assert.ok(brLast.converged, "bridge settled")
assert.strictEqual(part(brLast, "c").burnt, false)
assert.ok(Math.abs(brDc - 15) < 2, "bridge DC " + brDc)
assert.ok(brHi - brLo < 1.5, "ripple " + (brHi - brLo))
assert.strictEqual(part(brLast, "br").pinCurrents.length, 4)
var brSum = 0
part(brLast, "br").pinCurrents.forEach(function (x) { brSum += x })
assert.ok(Math.abs(brSum) < 1e-6, "bridge KCL " + brSum)

var fuseNet = net([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "f", type: "fuse", nodes: [1, 0], props: { amps: 0.5 } }
], 2)
var fuseBlow = E.solve(fuseNet, E.createState(), 0)
assert.strictEqual(part(fuseBlow, "f").burnt, true)
assert.ok((fuseBlow.warnings || []).some(function (w) {
  return w.part === "f" && w.message === "The fuse blew: too much current. Fix the short, then press Reset."
}), "fuse warning")
var fuseDead = E.createState()
E.solve(fuseNet, fuseDead, 0)
var fuseOpen = E.solve(fuseNet, fuseDead, 0)
assert.ok(Math.abs(part(fuseOpen, "f").current) < 1e-6, "blown fuse is open")

var slowNet = net([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "f", type: "fuse", nodes: [1, 2], props: { amps: 0.5 } },
  { id: "r", type: "resistor", nodes: [2, 0], props: { ohms: 10 } }
], 3)
var slow = E.createState()
var slowLast = null
for (var slowI = 0; slowI < 40; slowI++) slowLast = E.solve(slowNet, slow, 0.001)
assert.strictEqual(part(slowLast, "f").burnt, false, "40 ms is under the 50 ms hold")
for (var slowJ = 0; slowJ < 20; slowJ++) slowLast = E.solve(slowNet, slow, 0.001)
assert.strictEqual(part(slowLast, "f").burnt, true, "60 ms over the rating blows it")

var tiltOff = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "sw", type: "tiltSwitch", nodes: [1, 2], props: { tilted: false } },
  { id: "r", type: "resistor", nodes: [2, 0], props: { ohms: 1000 } }
], 3)
var tiltOn = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "sw", type: "tiltSwitch", nodes: [1, 2], props: { tilted: true } },
  { id: "r", type: "resistor", nodes: [2, 0], props: { ohms: 1000 } }
], 3)
assert.ok(Math.abs(part(tiltOff, "r").current) < 1e-6, "tilt open")
assert.ok(part(tiltOn, "r").current > 0.008, "tilt closed " + part(tiltOn, "r").current)

var irOk = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 470 } },
  { id: "d", type: "irLed", nodes: [2, 0], props: {} }
], 3)
console.log("ir", part(irOk, "d").current.toFixed(4), "bright", part(irOk, "d").brightness.toFixed(2))
assert.strictEqual(part(irOk, "d").invisible, true)
assert.strictEqual(part(irOk, "d").burnt, false)
assert.ok(part(irOk, "d").brightness > 0.5 && part(irOk, "d").brightness <= 1)
var irBurn = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "d", type: "irLed", nodes: [1, 0], props: {} }
], 2)
assert.strictEqual(part(irBurn, "d").burnt, true)

var photo = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "d", type: "photodiode", nodes: [0, 1], props: { light: 1 } }
], 2)
console.log("photo", part(photo, "d").current.toExponential(3), "light", part(photo, "d").light)
assert.ok(Math.abs(part(photo, "d").current + 50e-6) < 2e-6, "photocurrent " + part(photo, "d").current)

var coupled = solve([
  { id: "bat", type: "battery9v", nodes: [1, 0], props: {} },
  { id: "r", type: "resistor", nodes: [1, 2], props: { ohms: 330 } },
  { id: "ir", type: "irLed", nodes: [2, 0], props: {} },
  { id: "pd", type: "photodiode", nodes: [0, 1], props: { light: 0 } }
], 3)
console.log("coupled", part(coupled, "pd").current.toExponential(3), "ir bright", part(coupled, "ir").brightness.toFixed(2))
assert.ok(part(coupled, "ir").brightness > 0.9)
assert.ok(Math.abs(part(coupled, "pd").current + 25e-6) < 5e-6, "IR lights the photodiode " + part(coupled, "pd").current)

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
