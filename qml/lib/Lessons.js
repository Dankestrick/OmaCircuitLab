.pragma library
.import "Bench.js" as Bench
.import "Catalog.js" as Catalog
.import "Mcu.js" as Mcu

// The Learner's Guide. Each lesson explains one idea, lists the steps, can
// build its circuit for you, and checks the running circuit to tell you when
// you got it.

var letters = { a: 3, b: 4, c: 5, d: 6, e: 7, f: 10, g: 11, h: 12, i: 13, j: 14 }

// Hole "c14" style helpers in bench grid units.
function H(col, letter) { return { x: Bench.boardX + col - 1, y: Bench.boardY + letters[letter] } }
function rail(side, sign, col) {
  var row = side === "top" ? (sign === "+" ? 0 : 1) : (sign === "+" ? 16 : 17)
  return { x: Bench.boardX + col - 1, y: Bench.boardY + row }
}

function part(id, type, at, rot, props) {
  var p = { id: id, type: type, x: at.x, y: at.y, rot: rot || 0, props: Catalog.defaults(type) }
  for (var k in props) p.props[k] = props[k]
  return p
}
function wire(id, a, b, color) { return { id: id, a: a, b: b, color: color } }

// The 9 V battery on the left and its two wires to the top rails.
function battery(parts, wires) {
  parts.push(part("bat", "battery9v", { x: 2, y: 10 }))
  wires.push(wire("wbp", { x: 2, y: 10 }, rail("top", "+", 3), "red"))
  wires.push(wire("wbn", { x: 4, y: 10 }, rail("top", "−", 3), "black"))
}

function partsOf(ctx, type) {
  var out = []
  for (var i = 0; i < ctx.bench.parts.length; i++) if (ctx.bench.parts[i].type === type) out.push(ctx.bench.parts[i])
  return out
}
function liveOf(ctx, p) { return ctx.result && ctx.result.parts ? ctx.result.parts[p.id] || {} : {} }
function litLeds(ctx) {
  var n = 0, leds = partsOf(ctx, "led")
  for (var i = 0; i < leds.length; i++) { var l = liveOf(ctx, leds[i]); if (!l.burnt && l.brightness > 0.15) n++ }
  return n
}
function burntLeds(ctx) {
  var n = 0, leds = partsOf(ctx, "led")
  for (var i = 0; i < leds.length; i++) if (liveOf(ctx, leds[i]).burnt) n++
  return n
}
function meterReading(ctx, mode) {
  var m = partsOf(ctx, "multimeter")
  for (var i = 0; i < m.length; i++) {
    if (m[i].props.mode !== mode) continue
    var l = liveOf(ctx, m[i])
    if (l.value !== undefined && isFinite(l.value)) return l.value
  }
  return null
}


// OmaDuino on the bench below the breadboard. pin("D13") gives its header point.
var DUINO = { x: 12, y: 28 }
function pin(name) {
  var pins = Catalog.parts.omaduino.pins
  for (var i = 0; i < pins.length; i++) if (pins[i].name === name) return { x: DUINO.x + pins[i].x, y: DUINO.y }
  return null
}
function duino(parts, wires, sketch) {
  parts.push(part("mcu", "omaduino", DUINO, 0, { code: Mcu.example(sketch) }))
  wires.push(wire("wgnd", pin("GND"), rail("bottom", "−", 36), "black"))
}
// An LED on the bottom half driven by a board pin through 220 Ω.
function pinLed(parts, wires, pinName, col, color, id) {
  id = id || "led"
  wires.push(wire(id + "w1", pin(pinName), H(col, "j"), "orange"))
  parts.push(part(id + "r", "resistor", H(col, "i"), 0, { ohms: 220, span: 3 }))
  parts.push(part(id, "led", H(col + 3, "h"), 0, { color: color || "red" }))
  wires.push(wire(id + "w2", H(col + 4, "j"), rail("bottom", "−", col + 5), "black"))
}
function board(ctx) { var b = partsOf(ctx, "omaduino"); return b.length ? b[0] : null }
function boardLive(ctx) { var b = board(ctx); return b ? liveOf(ctx, b) : {} }
function needBoard(ctx) {
  if (!board(ctx)) return { done: false, hint: "Add an OmaDuino board from Microcontroller & robotics." }
  if (!board(ctx).props.code) return { done: false, hint: "Select the board, open the code editor, load the example and press Upload." }
  return needRun(ctx)
}

function needRun(ctx) { return ctx.running ? null : { done: false, hint: "Press Run to power the circuit." } }

var lessons = [
  {
    id: "led",
    title: "Light an LED",
    idea: "Electricity needs a full loop: out of the battery's +, through your parts, and back to −. An LED only lights when current flows into its long leg (+) and out of its short leg (−). A resistor keeps the current safe.",
    steps: [
      "Add a 9 V battery and wire + to the red rail and − to the blue rail at the top.",
      "Add a 470 Ω resistor from the + rail's column into the board.",
      "Add an LED: the + leg in the resistor's column, the − leg in the next column.",
      "Wire the LED's − column back to the blue rail, then press Run."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      p.push(part("r1", "resistor", H(10, "a"), 0, { ohms: 470 }))
      p.push(part("d1", "led", H(14, "c"), 0, { color: "red" }))
      w.push(wire("w1", rail("top", "+", 10), H(10, "b"), "red"))
      w.push(wire("w2", H(15, "d"), rail("top", "−", 15), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      if (partsOf(ctx, "led").length === 0) return { done: false, hint: "Add an LED from the parts list." }
      var r = needRun(ctx); if (r) return r
      if (burntLeds(ctx) > 0) return { done: false, hint: "That LED burned out from too much current. Add a resistor in the loop, then press Reset." }
      if (litLeds(ctx) > 0) return { done: true, hint: "It lights! Current flows + → resistor → LED → −." }
      return { done: false, hint: "No light yet. Check that the loop is closed and the LED's long leg faces +." }
    }
  },
  {
    id: "meter",
    title: "Measure with a multimeter",
    idea: "A multimeter in V mode measures the voltage between its two probes. Touch red to one side of a part and black to the other to see how many volts that part uses.",
    steps: [
      "Build lesson 1 (or press Build it for me).",
      "Add a multimeter and set it to V (click it to change mode).",
      "Wire the red probe to the LED's + column and the black probe to its − column.",
      "Run it: a red LED uses about 1.8 V. The resistor uses the rest of the 9 V."
    ],
    build: function () {
      var c = lessons[0].build()
      c.parts.push(part("m1", "multimeter", { x: 75, y: 10 }, 0, { mode: "V" }))
      c.wires.push(wire("wm1", { x: 76, y: 10 }, H(14, "e"), "red"))
      c.wires.push(wire("wm2", { x: 79, y: 10 }, H(15, "e"), "black"))
      return c
    },
    check: function (ctx) {
      if (partsOf(ctx, "multimeter").length === 0) return { done: false, hint: "Add a multimeter from Meters." }
      var r = needRun(ctx); if (r) return r
      var v = meterReading(ctx, "V")
      if (v !== null && Math.abs(v) > 0.2) return { done: true, hint: "The meter reads " + Math.abs(v).toFixed(2) + " V. Try moving the probes across the resistor instead." }
      return { done: false, hint: "Set the meter to V and wire both probes across a part." }
    }
  },
  {
    id: "ohm",
    title: "Ohm's law: change the resistor",
    idea: "Current = Voltage ÷ Resistance. A bigger resistor means less current and a dimmer LED. Too small and the LED burns out.",
    steps: [
      "Start from lesson 1 and press Run.",
      "Select the resistor and change it to 1 kΩ, then 10 kΩ. Watch the LED dim.",
      "Hover the resistor to see the current in milliamps.",
      "Try 100 Ω: the LED gets very bright and hot. 10–20 mA is the safe range."
    ],
    build: function () { return lessons[0].build() },
    check: function (ctx) {
      var r = needRun(ctx); if (r) return r
      var rs = partsOf(ctx, "resistor")
      for (var i = 0; i < rs.length; i++) if (rs[i].props.ohms >= 1000 && litLeds(ctx) > 0) return { done: true, hint: "Dimmer, right? With 1 kΩ only about 7 mA flows." }
      return { done: false, hint: "Select the resistor and pick 1 kΩ or more while the LED is lit." }
    }
  },
  {
    id: "button",
    title: "Push button",
    idea: "A push button closes the loop only while it is pressed. The button straddles the center channel so its two legs sit in different columns.",
    steps: [
      "Wire the battery to the rails.",
      "Put a push button across the center channel (rotate it with R).",
      "Wire + to the top leg, and from the bottom leg go resistor → LED → −.",
      "Run, then click and hold the button."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      w.push(wire("wbr", rail("top", "−", 4), rail("bottom", "−", 4), "black"))
      p.push(part("b1", "pushButton", H(14, "e"), 1))
      p.push(part("r1", "resistor", H(14, "h"), 0, { ohms: 470 }))
      p.push(part("d1", "led", H(18, "i"), 0, { color: "green" }))
      w.push(wire("w1", rail("top", "+", 14), H(14, "a"), "red"))
      w.push(wire("w2", H(19, "j"), rail("bottom", "−", 20), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var b = partsOf(ctx, "pushButton")
      if (b.length === 0) return { done: false, hint: "Add a push button from Inputs & switches." }
      var r = needRun(ctx); if (r) return r
      for (var i = 0; i < b.length; i++) if (b[i].props.pressed && litLeds(ctx) > 0) return { done: true, hint: "Pressed = loop closed = light." }
      return { done: false, hint: "Click and hold the button while the circuit runs." }
    }
  },
  {
    id: "pot",
    title: "Dimmer knob",
    idea: "A potentiometer is a resistor with a sliding middle leg (the wiper). Use one end and the wiper and it becomes a resistor you can turn: more resistance, less current, dimmer light.",
    steps: [
      "Put a 1 kΩ potentiometer near the top of the board and wire one end to +.",
      "From the middle leg (wiper), go through a 220 Ω resistor to an LED, then to −. Leave the pot's other end empty.",
      "Run, then scroll on the knob: the LED dims and brightens.",
      "The 220 Ω keeps the LED safe even with the knob turned all the way."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      p.push(part("k1", "potentiometer", H(10, "a"), 0, { ohms: 1000, turn: 0.3 }))
      p.push(part("r1", "resistor", H(11, "d"), 0, { ohms: 220 }))
      p.push(part("d1", "led", H(15, "c"), 0, { color: "yellow" }))
      w.push(wire("w1", rail("top", "+", 9), H(10, "c"), "red"))
      w.push(wire("w3", H(16, "e"), rail("top", "−", 17), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      if (partsOf(ctx, "potentiometer").length === 0) return { done: false, hint: "Add a potentiometer from Inputs & switches." }
      var r = needRun(ctx); if (r) return r
      if (litLeds(ctx) > 0) return { done: true, hint: "Scroll on the knob: turning it changes the LED's current." }
      return { done: false, hint: "Wire the wiper (middle leg) to the resistor and LED." }
    }
  },
  {
    id: "ldr",
    title: "Light sensor",
    idea: "An LDR's resistance drops in bright light. Put it in series with a fixed resistor and the middle point becomes a voltage that follows the light: a voltage divider.",
    steps: [
      "Put an LDR from the + rail's column to a free column.",
      "Put a 10 kΩ resistor from that column to a column wired to −.",
      "Measure the middle column with the multimeter (V).",
      "Run, then scroll on the LDR to change the light. The voltage follows."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      p.push(part("s1", "ldr", H(20, "c"), 0, { light: 0.5 }))
      p.push(part("r1", "resistor", H(21, "d"), 0, { ohms: 10000 }))
      p.push(part("m1", "multimeter", { x: 75, y: 10 }, 0, { mode: "V" }))
      w.push(wire("w1", rail("top", "+", 20), H(20, "b"), "red"))
      w.push(wire("w2", H(25, "e"), rail("top", "−", 27), "black"))
      w.push(wire("wm1", { x: 76, y: 10 }, H(21, "e"), "yellow"))
      w.push(wire("wm2", { x: 79, y: 10 }, rail("top", "−", 29), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      if (partsOf(ctx, "ldr").length === 0) return { done: false, hint: "Add a light sensor from Sensors." }
      var r = needRun(ctx); if (r) return r
      var v = meterReading(ctx, "V")
      if (v !== null && Math.abs(v) > 0.1) return { done: true, hint: "Divider voltage " + Math.abs(v).toFixed(2) + " V. Scroll on the LDR and watch it change." }
      return { done: false, hint: "Measure the point between the LDR and the resistor with the meter on V." }
    }
  },
  {
    id: "npn",
    title: "Transistor switch",
    idea: "A transistor lets a tiny base current switch a much bigger current. This is how a microcontroller pin drives motors, buzzers and bright lights.",
    steps: [
      "Place an NPN transistor (flat side toward you: E, B, C).",
      "Emitter to −. Base through a 10 kΩ resistor and a push button (over the rail) to +.",
      "Collector through 470 Ω and an LED to +.",
      "Run and press the button: a ~1 mA base current switches ~15 mA."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      p.push(part("q1", "npn", H(30, "e"), 0))
      p.push(part("rb", "resistor", H(26, "d"), 0, { ohms: 10000, span: 5 }))
      p.push(part("b1", "pushButton", H(26, "a"), 3))
      p.push(part("rc", "resistor", H(32, "c"), 0, { ohms: 470 }))
      p.push(part("d1", "led", H(37, "b"), 2, { color: "blue" }))
      w.push(wire("w1", H(30, "a"), rail("top", "−", 30), "black"))
      w.push(wire("w3", H(37, "a"), rail("top", "+", 38), "red"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var q = partsOf(ctx, "npn")
      if (q.length === 0) return { done: false, hint: "Add an NPN transistor from Diodes & transistors." }
      var r = needRun(ctx); if (r) return r
      for (var i = 0; i < q.length; i++) {
        var l = liveOf(ctx, q[i])
        if (l.collectorCurrent !== undefined && Math.abs(l.collectorCurrent) > 0.002) return { done: true, hint: "Switched on: collector current " + (Math.abs(l.collectorCurrent) * 1000).toFixed(1) + " mA." }
      }
      if (litLeds(ctx) > 0) return { done: true, hint: "The transistor is switching the LED." }
      return { done: false, hint: "Give the base a small current through a resistor (press the button if you used one)." }
    }
  },
  {
    id: "tmp36",
    title: "Temperature probe",
    idea: "The TMP36 turns temperature into voltage: 0.5 V plus 10 mV per °C. At 25 °C it outputs 0.75 V. A microcontroller reads that voltage to know the temperature.",
    steps: [
      "Place a TMP36 with its flat face toward you: +V, out, GND.",
      "Wire +V to + and GND to −. (Real TMP36s want 2.7–5.5 V, so use the bench supply at 5 V.)",
      "Measure the middle leg with the multimeter on V.",
      "Scroll on the probe to heat it up and watch the voltage rise."
    ],
    build: function () {
      var p = [], w = []
      p.push(part("ps", "benchSupply", { x: 1, y: 10 }, 0, { volts: 5 }))
      w.push(wire("wbp", { x: 2, y: 10 }, rail("top", "+", 3), "red"))
      w.push(wire("wbn", { x: 4, y: 10 }, rail("top", "−", 3), "black"))
      p.push(part("t1", "tmp36", H(30, "e"), 0, { celsius: 25 }))
      p.push(part("m1", "multimeter", { x: 75, y: 10 }, 0, { mode: "V" }))
      w.push(wire("w1", rail("top", "+", 30), H(30, "a"), "red"))
      w.push(wire("w2", H(32, "a"), rail("top", "−", 33), "black"))
      w.push(wire("wm1", { x: 76, y: 10 }, H(31, "b"), "yellow"))
      w.push(wire("wm2", { x: 79, y: 10 }, rail("top", "−", 35), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      if (partsOf(ctx, "tmp36").length === 0) return { done: false, hint: "Add the temperature probe from Sensors." }
      var r = needRun(ctx); if (r) return r
      var v = meterReading(ctx, "V")
      if (v !== null && v > 0.1 && v < 2) return { done: true, hint: Math.abs(v).toFixed(3) + " V → " + Math.round((v - 0.5) * 100) + " °C." }
      return { done: false, hint: "Measure the middle leg against − with the meter on V." }
    }
  },
  {
    id: "rc",
    title: "Capacitor fade",
    idea: "A capacitor stores charge. Charge it with the button, let go, and it slowly empties through the LED, so the light fades out instead of snapping off.",
    steps: [
      "Button from + to a column; 100 Ω from there to the capacitor column.",
      "Put a 1000 µF electrolytic capacitor there, stripe (−) to the − rail.",
      "From the capacitor column, 470 Ω → LED → −.",
      "Run, press and release the button. Watch the slow fade."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      w.push(wire("wbr", rail("top", "−", 4), rail("bottom", "−", 4), "black"))
      p.push(part("b1", "pushButton", H(20, "e"), 1))
      w.push(wire("w1", rail("top", "+", 20), H(20, "a"), "red"))
      p.push(part("r0", "resistor", H(20, "h"), 0, { ohms: 100, span: 3 }))
      p.push(part("c1", "electrolytic", H(23, "i"), 0, { farads: 1e-3 }))
      w.push(wire("w2", H(24, "j"), rail("bottom", "−", 24), "black"))
      p.push(part("r1", "resistor", H(23, "g"), 0, { ohms: 470, span: 4 }))
      p.push(part("d1", "led", H(27, "h"), 0, { color: "orange" }))
      w.push(wire("w3", H(28, "j"), rail("bottom", "−", 28), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var c = partsOf(ctx, "electrolytic").concat(partsOf(ctx, "capacitor"))
      if (c.length === 0) return { done: false, hint: "Add an electrolytic capacitor from Basics." }
      var r = needRun(ctx); if (r) return r
      for (var i = 0; i < c.length; i++) {
        var l = liveOf(ctx, c[i])
        if (l.pinVolts && Math.abs(l.pinVolts[0] - l.pinVolts[1]) > 1) return { done: true, hint: "The capacitor holds " + Math.abs(l.pinVolts[0] - l.pinVolts[1]).toFixed(2) + " V. Release the button and watch it drain." }
      }
      return { done: false, hint: "Press the button to charge the capacitor." }
    }
  },
  {
    id: "motor",
    title: "Drive a motor",
    idea: "Motors need far more current than a chip pin can give, so a transistor does the heavy lifting. A diode across the motor catches the voltage spike when it switches off.",
    steps: [
      "Bench supply at 6 V to the rails.",
      "NPN transistor: emitter to −, base through 1 kΩ and a button to +.",
      "Motor from + to the collector. Diode across the motor, stripe toward +.",
      "Run and press the button: the motor spins."
    ],
    build: function () {
      var p = [], w = []
      p.push(part("ps", "benchSupply", { x: 1, y: 10 }, 0, { volts: 6 }))
      w.push(wire("wbp", { x: 2, y: 10 }, rail("top", "+", 3), "red"))
      w.push(wire("wbn", { x: 4, y: 10 }, rail("top", "−", 3), "black"))
      p.push(part("q1", "npn", H(30, "e"), 0))
      p.push(part("rb", "resistor", H(26, "d"), 0, { ohms: 1000, span: 5 }))
      p.push(part("b1", "pushButton", H(26, "a"), 3))
      w.push(wire("w1", H(30, "a"), rail("top", "−", 30), "black"))
      p.push(part("dm", "diode", H(32, "b"), 0))
      p.push(part("mo", "motor", { x: 38, y: 25 }))
      w.push(wire("w3", H(35, "a"), rail("top", "+", 36), "red"))
      w.push(wire("w4", { x: 38, y: 25 }, rail("bottom", "+", 29), "red"))
      w.push(wire("w5", rail("top", "+", 40), rail("bottom", "+", 40), "red"))
      w.push(wire("w6", { x: 41, y: 25 }, H(32, "j"), "green"))
      w.push(wire("w7", H(32, "c"), H(32, "f"), "green"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var m = partsOf(ctx, "motor")
      if (m.length === 0) return { done: false, hint: "Add a DC motor from Outputs & motion." }
      var r = needRun(ctx); if (r) return r
      for (var i = 0; i < m.length; i++) if (Math.abs(liveOf(ctx, m[i]).spin || 0) > 0.1) return { done: true, hint: "It spins! Now you can make robots move." }
      return { done: false, hint: "Press the button to switch the transistor on." }
    }
  },
  {
    id: "parallel",
    title: "Two LEDs in parallel",
    idea: "Parallel means side by side: each LED gets its own path from + to −, and its own resistor. Both get the full voltage, and the battery supplies both currents added together.",
    steps: [
      "Build lesson 1's LED circuit.",
      "Build a second copy further along the board: resistor from + into a new column, LED, then to −.",
      "Run: both light at the same brightness.",
      "Hover each resistor: the current is the same in each, and the battery gives the sum."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      p.push(part("r1", "resistor", H(10, "a"), 0, { ohms: 470 }))
      p.push(part("d1", "led", H(14, "c"), 0, { color: "red" }))
      w.push(wire("w1", rail("top", "+", 10), H(10, "b"), "red"))
      w.push(wire("w2", H(15, "d"), rail("top", "−", 15), "black"))
      p.push(part("r2", "resistor", H(20, "a"), 0, { ohms: 470 }))
      p.push(part("d2", "led", H(24, "c"), 0, { color: "green" }))
      w.push(wire("w3", rail("top", "+", 21), H(20, "b"), "red"))
      w.push(wire("w4", H(25, "d"), rail("top", "−", 26), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var r = needRun(ctx); if (r) return r
      if (litLeds(ctx) >= 2) return { done: true, hint: "Both are lit. In parallel, one LED failing doesn't turn off the other." }
      return { done: false, hint: "Give each LED its own path from + to −." }
    }
  },
  {
    id: "clamp",
    title: "Follow the current with a clamp meter",
    idea: "A clamp meter's jaw closes around a wire and reads the current inside it, without cutting anything. In one loop the current is the same everywhere: before a resistor, after it, through the LED. Where the path splits, the branches share it, and they add back up to what the battery gives.",
    steps: [
      "Build two LED branches off the + rail, one with 470 Ω and one with 1 kΩ.",
      "Add a clamp meter from Meters. Click the battery's red wire to clip it on, then Run.",
      "Click the jaw, then click the wire into the 470 Ω branch. Then try the 1 kΩ branch.",
      "Clip before and after a resistor too: same current on both sides."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      p.push(part("r1", "resistor", H(10, "a"), 0, { ohms: 470 }))
      p.push(part("d1", "led", H(14, "c"), 0, { color: "red" }))
      w.push(wire("w1", rail("top", "+", 10), H(10, "b"), "red"))
      w.push(wire("w2", H(15, "d"), rail("top", "−", 15), "black"))
      p.push(part("r2", "resistor", H(20, "a"), 0, { ohms: 1000 }))
      p.push(part("d2", "led", H(24, "c"), 0, { color: "green" }))
      w.push(wire("w3", rail("top", "+", 21), H(20, "b"), "red"))
      w.push(wire("w4", H(25, "d"), rail("top", "−", 26), "black"))
      p.push(part("cm", "clampMeter", { x: 3, y: 18 }, 0, { clip: { kind: "wire", id: "wbp", x: 8, y: 7 } }))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var cms = partsOf(ctx, "clampMeter")
      if (cms.length === 0) return { done: false, hint: "Add a clamp meter from Meters." }
      var r = needRun(ctx); if (r) return r
      var bats = partsOf(ctx, "battery9v")
      var total = bats.length ? Math.abs(liveOf(ctx, bats[0]).current || 0) : 0
      for (var i = 0; i < cms.length; i++) {
        var a = liveOf(ctx, cms[i]).value
        if (!(a > 1e-4)) continue
        if (total > 0 && a < total - 0.001)
          return { done: true, hint: "This branch carries " + Catalog.si(a, "A") + " of the battery's " + Catalog.si(total, "A") + ". The branches add up to the total." }
        return { done: false, hint: "It reads " + Catalog.si(a, "A") + ", all of the battery's current. Now clip it on one branch: click the jaw, then a branch wire." }
      }
      return { done: false, hint: "Click the clamp meter, then click a wire carrying current." }
    }
  },
  {
    id: "switch2",
    title: "A two-way switch",
    idea: "A slide switch connects its middle leg to one side or the other. Wire + to the middle, and the switch chooses which LED gets power: the idea behind every selector.",
    steps: [
      "Put a slide switch in the top half. Wire + to its middle leg.",
      "From the left leg, wire to a red LED circuit; from the right leg to a green one.",
      "Run and click the switch to flip between them."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      w.push(wire("wbr", rail("top", "−", 4), rail("bottom", "−", 4), "black"))
      p.push(part("s1", "slideSwitch", H(10, "e"), 0))
      w.push(wire("w1", rail("top", "+", 11), H(11, "b"), "red"))
      w.push(wire("w2", H(10, "c"), H(10, "f"), "orange"))
      p.push(part("r1", "resistor", H(10, "g"), 0, { ohms: 470 }))
      p.push(part("d1", "led", H(14, "h"), 0, { color: "red" }))
      w.push(wire("w3", H(15, "j"), rail("bottom", "−", 15), "black"))
      w.push(wire("w4", H(12, "c"), H(20, "f"), "yellow"))
      p.push(part("r2", "resistor", H(20, "g"), 0, { ohms: 470 }))
      p.push(part("d2", "led", H(24, "h"), 0, { color: "green" }))
      w.push(wire("w5", H(25, "j"), rail("bottom", "−", 26), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      if (partsOf(ctx, "slideSwitch").length === 0) return { done: false, hint: "Add a slide switch from Inputs & switches." }
      var r = needRun(ctx); if (r) return r
      if (litLeds(ctx) > 0) return { done: true, hint: "Click the switch to move the power to the other LED." }
      return { done: false, hint: "Wire + to the switch's middle leg." }
    }
  },
  {
    id: "rgb",
    title: "Mix colors with an RGB LED",
    idea: "An RGB LED holds red, green and blue LEDs in one bulb. Change each color's resistor and the mix changes: red + green makes yellow, all three make white.",
    steps: [
      "Place the RGB LED: its second leg (−) goes to the blue rail.",
      "Give red, green and blue each a resistor from the + rail.",
      "Run, then select a resistor and change its value to change the mix."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      p.push(part("d1", "rgbLed", H(21, "c"), 0))
      p.push(part("rr", "resistor", rail("top", "+", 21), 1, { ohms: 470, span: 3 }))
      p.push(part("rg", "resistor", rail("top", "+", 23), 1, { ohms: 1000, span: 3 }))
      p.push(part("rb", "resistor", rail("top", "+", 24), 1, { ohms: 470, span: 3 }))
      w.push(wire("w1", H(22, "b"), rail("top", "−", 22), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var d = partsOf(ctx, "rgbLed")
      if (d.length === 0) return { done: false, hint: "Add an RGB LED from Basics." }
      var r = needRun(ctx); if (r) return r
      var b = liveOf(ctx, d[0]).brightness || {}
      if ((b.r || 0) + (b.g || 0) + (b.b || 0) > 0.3) return { done: true, hint: "Mixing! Try 10 kΩ on one color to take it out of the mix." }
      return { done: false, hint: "Each color needs a resistor from +, and the long − leg to the blue rail." }
    }
  },
  {
    id: "zener",
    title: "Make 5 V from 9 V (zener regulator)",
    idea: "Backwards, a zener diode holds a fixed voltage. With a resistor to soak up the rest, 9 V in becomes a steady 5.1 V out, even if the battery sags. It's the simplest voltage regulator.",
    steps: [
      "Resistor (470 Ω) from + into a column.",
      "Zener diode from that column to −, with its stripe (cathode) toward the resistor.",
      "Measure across the zener with the multimeter on V.",
      "Run: about 5.1 V. Try the bench supply and turn the voltage up and down."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      p.push(part("r1", "resistor", H(10, "a"), 0, { ohms: 470 }))
      w.push(wire("w1", rail("top", "+", 10), H(10, "b"), "red"))
      p.push(part("z1", "zener", H(17, "c"), 2))
      w.push(wire("w2", H(17, "d"), rail("top", "−", 17), "black"))
      p.push(part("m1", "multimeter", { x: 75, y: 10 }, 0, { mode: "V" }))
      w.push(wire("wm1", { x: 76, y: 10 }, H(14, "e"), "red"))
      w.push(wire("wm2", { x: 79, y: 10 }, H(17, "e"), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      if (partsOf(ctx, "zener").length === 0) return { done: false, hint: "Add a zener diode from Diodes & transistors." }
      var r = needRun(ctx); if (r) return r
      var v = meterReading(ctx, "V")
      if (v !== null && Math.abs(Math.abs(v) - 5.1) < 0.6) return { done: true, hint: "Steady " + Math.abs(v).toFixed(2) + " V. That's a regulated supply." }
      return { done: false, hint: "The zener's stripe faces the resistor (+ side). Measure across it." }
    }
  },
  {
    id: "mosfet",
    title: "MOSFET switch",
    idea: "A MOSFET is switched by voltage, not current: raise the gate a few volts above the source and it conducts. A pull-down resistor keeps the gate at 0 V (off) when nothing drives it.",
    steps: [
      "N-MOSFET with its source to −.",
      "Gate: a push button up to +, and a 100 kΩ pull-down to −.",
      "Drain: LED and 470 Ω up to +.",
      "Run and press the button."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      p.push(part("q1", "nmos", H(30, "e"), 0))
      w.push(wire("w1", H(30, "a"), rail("top", "−", 30), "black"))
      p.push(part("b1", "pushButton", H(27, "a"), 3))
      w.push(wire("w2", H(27, "c"), H(31, "c"), "orange"))
      p.push(part("rp", "resistor", H(31, "b"), 0, { ohms: 100000 }))
      w.push(wire("w3", H(35, "c"), rail("top", "−", 35), "black"))
      p.push(part("d1", "led", H(33, "d"), 2, { color: "yellow" }))
      p.push(part("rd", "resistor", rail("top", "+", 33), 1, { ohms: 470, span: 3 }))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var q = partsOf(ctx, "nmos")
      if (q.length === 0) return { done: false, hint: "Add an N-MOSFET from Diodes & transistors." }
      var r = needRun(ctx); if (r) return r
      for (var i = 0; i < q.length; i++) if (Math.abs(liveOf(ctx, q[i]).collectorCurrent || 0) > 0.002) return { done: true, hint: "The gate voltage switched it on. The gate itself takes almost no current." }
      return { done: false, hint: "Press the button to raise the gate." }
    }
  },
  {
    id: "heatalarm",
    title: "Temperature alarm",
    idea: "A thermistor and a resistor make a voltage that rises as it gets hot. Feed it to a transistor through a resistor and, past a certain temperature, the transistor switches a buzzer on.",
    steps: [
      "Thermistor from + into a column; 1 kΩ from that column to −.",
      "10 kΩ from that column to an NPN's base. Emitter to −.",
      "Buzzer from + to the collector.",
      "Run, then scroll on the thermistor to heat it toward 80 °C."
    ],
    build: function () {
      var p = [], w = []
      battery(p, w)
      p.push(part("t1", "thermistor", H(39, "c"), 0, { celsius: 25 }))
      w.push(wire("w1", rail("top", "+", 39), H(39, "b"), "red"))
      p.push(part("rl", "resistor", H(40, "d"), 0, { ohms: 1000 }))
      w.push(wire("w2", H(44, "e"), rail("top", "−", 44), "black"))
      p.push(part("rb", "resistor", H(40, "b"), 0, { ohms: 10000, span: 6 }))
      p.push(part("q1", "npn", H(45, "e"), 0))
      w.push(wire("w3", H(45, "a"), rail("top", "−", 45), "black"))
      p.push(part("bz", "buzzer", H(50, "a"), 0))
      w.push(wire("w4", rail("top", "+", 50), H(50, "b"), "red"))
      w.push(wire("w5", H(52, "b"), H(47, "b"), "orange"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var b = partsOf(ctx, "buzzer")
      if (b.length === 0 || partsOf(ctx, "thermistor").length === 0) return { done: false, hint: "You need a thermistor and a buzzer." }
      var r = needRun(ctx); if (r) return r
      for (var i = 0; i < b.length; i++) if (liveOf(ctx, b[i]).on) return { done: true, hint: "Too hot: the alarm sounds. Cool it down and it stops." }
      return { done: false, hint: "Scroll on the thermistor to heat it up." }
    }
  },
  {
    id: "blink",
    title: "Program a microcontroller: Blink",
    idea: "A microcontroller is a tiny computer. Its program (a sketch) runs setup() once, then loop() forever. digitalWrite(pin, HIGH) puts 5 V on a pin; LOW puts 0 V. With a delay in between, the LED blinks.",
    steps: [
      "Add an OmaDuino board below the breadboard and wire its GND to the blue rail.",
      "Wire pin 13 to a column, then 220 Ω → LED → blue rail.",
      "Select the board, press Open code editor, load the Blink example and press Upload.",
      "Run: the LED (and the board's L light) blink every half second. Change delay(500) to delay(100) and upload again."
    ],
    build: function () {
      var p = [], w = []
      duino(p, w, "blink")
      pinLed(p, w, "D13", 40, "red")
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var r = needBoard(ctx); if (r) return r
      var l = boardLive(ctx)
      if (l.error) return { done: false, hint: "The board stopped with an error: " + l.error }
      if (l.pins && l.pins[13] && l.pins[13].mode === "out") return { done: true, hint: "Your first program is running! Try a different delay." }
      return { done: false, hint: "Use pinMode(13, OUTPUT) in setup()." }
    }
  },
  {
    id: "mcubutton",
    title: "Read a button with code",
    idea: "digitalRead(pin) tells your program whether a pin is HIGH or LOW. INPUT_PULLUP holds the pin HIGH through a built-in resistor, so pressing a button to GND makes it read LOW.",
    steps: [
      "Start from the Blink circuit.",
      "Add a push button: one leg to pin 2, the other leg to the blue rail (GND).",
      "Upload the Button → LED example.",
      "Run and hold the button: the LED lights only while it's pressed."
    ],
    build: function () {
      var p = [], w = []
      duino(p, w, "button")
      pinLed(p, w, "D13", 40, "green")
      p.push(part("b1", "pushButton", H(20, "h"), 0))
      w.push(wire("wb1", pin("D2"), H(20, "j"), "yellow"))
      w.push(wire("wb2", H(23, "j"), rail("bottom", "−", 24), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var r = needBoard(ctx); if (r) return r
      var b = partsOf(ctx, "pushButton")
      for (var i = 0; i < b.length; i++) if (b[i].props.pressed && litLeds(ctx) > 0) return { done: true, hint: "The program saw the button go LOW and switched the LED on." }
      return { done: false, hint: "Hold the button down while it runs." }
    }
  },
  {
    id: "fade",
    title: "Dim an LED with PWM",
    idea: "analogWrite(pin, 0–255) flicks a pin on and off very fast. The more of the time it is on, the brighter the LED looks. Only the ~ pins (3, 5, 6, 9, 10, 11) can do it.",
    steps: [
      "Wire pin 9 → 220 Ω → LED → GND.",
      "Upload the Fade example.",
      "Run: the LED breathes up and down.",
      "Change step = 5 to step = 1 for a slower fade."
    ],
    build: function () {
      var p = [], w = []
      duino(p, w, "fade")
      pinLed(p, w, "D9", 40, "blue")
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var r = needBoard(ctx); if (r) return r
      var l = boardLive(ctx)
      for (var i = 0; l.pins && i < l.pins.length; i++) if (l.pins[i].pwm !== null && l.pins[i].pwm !== undefined) return { done: true, hint: "PWM is running on pin " + i + ". Watch the LED breathe." }
      return { done: false, hint: "Use analogWrite on pin 9." }
    }
  },
  {
    id: "mcunight",
    title: "Automatic night light",
    idea: "analogRead(A0) turns the voltage on A0 into a number from 0 (0 V) to 1023 (5 V). With a light sensor in a voltage divider, the program can tell light from dark.",
    steps: [
      "LDR from the board's 5V to a column; 10 kΩ from that column to GND.",
      "Wire that middle column to A0.",
      "LED on pin 13, then upload the Night light example.",
      "Run, open the code editor to watch the Serial Monitor, and scroll on the LDR to make it dark."
    ],
    build: function () {
      var p = [], w = []
      duino(p, w, "nightlight")
      pinLed(p, w, "D13", 40, "white")
      p.push(part("s1", "ldr", H(10, "h"), 0, { light: 0.6 }))
      p.push(part("r1", "resistor", H(11, "g"), 0, { ohms: 10000 }))
      w.push(wire("wl1", pin("5V"), H(10, "j"), "red"))
      w.push(wire("wl2", pin("A0"), H(11, "j"), "yellow"))
      w.push(wire("wl3", H(15, "j"), rail("bottom", "−", 16), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var r = needBoard(ctx); if (r) return r
      if (partsOf(ctx, "ldr").length === 0) return { done: false, hint: "Add a light sensor (LDR)." }
      var l = boardLive(ctx)
      if (l.serial && l.serial.length > 0) return { done: true, hint: "The board is reading light levels. Scroll on the LDR to make it dark and watch the LED." }
      return { done: false, hint: "Upload the Night light example and run it." }
    }
  },
  {
    id: "servo",
    title: "Move a servo",
    idea: "A servo turns to the angle you ask for. The Servo library does the timing: attach() picks the pin, write(angle) sets 0–180°. Robot arms, grippers and steering all use servos.",
    steps: [
      "Put a servo on the board: brown to GND, red to 5V, orange (signal) to pin 9.",
      "Upload the Servo sweep example.",
      "Run: the horn sweeps back and forth.",
      "Try arm.write(45); delay(1000); arm.write(135); delay(1000); in loop()."
    ],
    build: function () {
      var p = [], w = []
      duino(p, w, "servo")
      p.push(part("sv", "servo", H(48, "h"), 0))
      w.push(wire("ws1", H(48, "j"), rail("bottom", "−", 48), "black"))
      w.push(wire("ws2", H(49, "j"), pin("5V"), "red"))
      w.push(wire("ws3", H(50, "j"), pin("D9"), "orange"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var r = needBoard(ctx); if (r) return r
      var s = partsOf(ctx, "servo")
      if (s.length === 0) return { done: false, hint: "Add a hobby servo." }
      for (var i = 0; i < s.length; i++) { var a = liveOf(ctx, s[i]).angle; if (a !== undefined && Math.abs(a - 90) > 5) return { done: true, hint: "The servo is at " + Math.round(a) + "°." } }
      return { done: false, hint: "Wire the signal to pin 9 and upload the sweep example." }
    }
  },
  {
    id: "sonar",
    title: "Distance alarm",
    idea: "The HC-SR04 measures distance with sound. Your program sends a short pulse on TRIG, then pulseIn() times how long ECHO stays HIGH: every 58 µs is 1 cm. This is how robots see walls.",
    steps: [
      "Sensor VCC → 5V, GND → GND, TRIG → pin 7, ECHO → pin 8.",
      "LED on pin 13, then upload the Distance sensor example.",
      "Run and open the Serial Monitor to see the distance.",
      "Scroll on the sensor to bring the object closer than 20 cm: the LED lights."
    ],
    build: function () {
      var p = [], w = []
      duino(p, w, "distance")
      pinLed(p, w, "D13", 40, "red")
      p.push(part("us", "hcsr04", H(52, "h"), 0, { distance: 40 }))
      w.push(wire("wu1", H(52, "j"), pin("5V"), "red"))
      w.push(wire("wu2", H(53, "j"), pin("D7"), "green"))
      w.push(wire("wu3", H(54, "j"), pin("D8"), "blue"))
      w.push(wire("wu4", H(55, "j"), rail("bottom", "−", 56), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var r = needBoard(ctx); if (r) return r
      if (partsOf(ctx, "hcsr04").length === 0) return { done: false, hint: "Add the ultrasonic distance sensor." }
      var l = boardLive(ctx)
      if (l.serial && /\d+ cm/.test(l.serial)) return { done: true, hint: "Reading distance. Bring the object under 20 cm to trip the alarm." }
      return { done: false, hint: "Check TRIG → 7 and ECHO → 8, then upload the example." }
    }
  },
  {
    id: "robot",
    title: "Build a wall-dodging robot",
    idea: "Time to put it together. The board reads the sonar, decides, and tells the motor driver which way to spin each wheel. Motors get their own battery; everything shares GND so the signals make sense.",
    steps: [
      "Batteries (6 V) → motor driver VM; battery −, driver GND and board GND all to the blue rail.",
      "Driver IN1–IN4 → pins 5, 6, 9, 10. OUT1/OUT2 → left motor, OUT3/OUT4 → right motor.",
      "Robot sonar: VCC → 5V, TRIG → 7, ECHO → 8, GND → blue rail.",
      "Upload the Wall-dodging robot example, select the robot, Open robot arena, and Run."
    ],
    build: function () {
      var p = [], w = []
      duino(p, w, "robot")
      p.push(part("bat", "aaPack", { x: 76, y: 26 }, 0, { cells: 4, volts: 6 }))
      p.push(part("drv", "motorDriver", H(44, "h"), 0))
      p.push(part("car", "robotCar", { x: 60, y: 26 }, 0, { distance: 100 }))
      w.push(wire("wb1", { x: 76, y: 26 }, H(44, "j"), "red"))
      w.push(wire("wb2", { x: 78, y: 26 }, rail("bottom", "−", 58), "black"))
      w.push(wire("wd0", H(45, "j"), rail("bottom", "−", 46), "black"))
      w.push(wire("wd1", H(46, "j"), pin("D5"), "yellow"))
      w.push(wire("wd2", H(47, "j"), pin("D6"), "yellow"))
      w.push(wire("wd3", H(48, "j"), pin("D9"), "green"))
      w.push(wire("wd4", H(49, "j"), pin("D10"), "green"))
      w.push(wire("wm1", H(50, "j"), { x: 60, y: 26 }, "orange"))
      w.push(wire("wm2", H(51, "j"), { x: 61, y: 26 }, "orange"))
      w.push(wire("wm3", H(52, "j"), { x: 62, y: 26 }, "purple"))
      w.push(wire("wm4", H(53, "j"), { x: 63, y: 26 }, "purple"))
      w.push(wire("ws1", { x: 65, y: 26 }, pin("5V"), "red"))
      w.push(wire("ws2", { x: 66, y: 26 }, pin("D7"), "blue"))
      w.push(wire("ws3", { x: 67, y: 26 }, pin("D8"), "white"))
      w.push(wire("ws4", { x: 68, y: 26 }, rail("bottom", "−", 62), "black"))
      return { parts: p, wires: w }
    },
    check: function (ctx) {
      var r = needBoard(ctx); if (r) return r
      var c = partsOf(ctx, "robotCar")
      if (c.length === 0) return { done: false, hint: "Add the Robot car from Microcontroller & robotics." }
      var l = liveOf(ctx, c[0])
      if (Math.abs(l.leftSpin || 0) > 0.1 || Math.abs(l.rightSpin || 0) > 0.1) return { done: true, hint: "Your robot is driving! Open the arena, try the Maze, and tune the turn timing in the code." }
      return { done: false, hint: "Check the motor driver wiring and that the battery reaches VM." }
    }
  }
]

// Number the lessons in order, so new ones can be slotted in anywhere.
for (var li = 0; li < lessons.length; li++) lessons[li].title = (li + 1) + ". " + lessons[li].title
