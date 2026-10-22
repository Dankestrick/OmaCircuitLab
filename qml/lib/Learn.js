.pragma library
.import "Catalog.js" as Catalog

// Calculators and reference text for the Tools tab. Pure functions so the
// tests can check the math.

// Ohm's law: give any two of V, I, R (others null) and get all three plus power.
function ohm(v, i, r) {
  if (v !== null && i !== null) r = i !== 0 ? v / i : Infinity
  else if (v !== null && r !== null) i = r !== 0 ? v / r : Infinity
  else if (i !== null && r !== null) v = i * r
  else return null
  return { v: v, i: i, r: r, p: v * i }
}

// Nearest standard E12 value at or above `ohms` (safer for an LED).
function nextE12(ohms) {
  var vals = Catalog.resistorValues
  for (var k = 0; k < vals.length; k++) if (vals[k] >= ohms - 1e-9) return vals[k]
  return vals[vals.length - 1]
}

// Resistor for an LED: (supply - Vf) / I.
function ledResistor(supply, color, milliamps) {
  var c = Catalog.ledColors[color] || Catalog.ledColors.red
  var i = milliamps / 1000
  var drop = supply - c.vf
  if (drop <= 0) return { ok: false, vf: c.vf, message: "The supply (" + supply + " V) is lower than this LED needs (" + c.vf + " V). It will not light." }
  var exact = drop / i
  var pick = nextE12(exact)
  var actual = drop / pick
  return { ok: true, vf: c.vf, exact: exact, pick: pick, actualMilliamps: actual * 1000, watts: drop * actual }
}

function divider(vin, r1, r2) {
  var vout = vin * r2 / (r1 + r2)
  return { vout: vout, current: vin / (r1 + r2) }
}

function series(list) { var s = 0; for (var i = 0; i < list.length; i++) s += list[i]; return s }
function parallel(list) {
  var g = 0
  for (var i = 0; i < list.length; i++) { if (list[i] <= 0) return 0; g += 1 / list[i] }
  return g > 0 ? 1 / g : Infinity
}

// Capacitor RC time constant and time to ~99% (5 tau).
function rc(r, c) { return { tau: r * c, full: 5 * r * c } }

var bandNames = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"]
var bandLabel = ["Black", "Brown", "Red", "Orange", "Yellow", "Green", "Blue", "Violet", "Grey", "White"]

// Value from three color bands (digit, digit, multiplier).
function fromBands(a, b, m) { return (a * 10 + b) * Math.pow(10, m) }

function bandsFor(ohms) {
  if (ohms < 10) return null
  var exp = Math.floor(Math.log(ohms) / Math.LN10 + 1e-9) - 1
  var digits = Math.round(ohms / Math.pow(10, exp))
  if (digits >= 100) { digits = Math.round(digits / 10); exp += 1 }
  return [Math.floor(digits / 10), digits % 10, exp]
}

var glossary = [
  ["Voltage (V)", "The push that moves electric charge, measured in volts. Like water pressure in a pipe. A 9 V battery pushes harder than a 1.5 V cell."],
  ["Current (A)", "How much charge flows each second, in amps. 1 mA (milliamp) is a thousandth of an amp. LEDs like about 10–20 mA."],
  ["Resistance (Ω)", "How hard it is for current to flow, in ohms. More resistance means less current for the same voltage."],
  ["Ohm's law", "V = I × R. Know any two and you can work out the third. The calculator above does it for you."],
  ["Power (W)", "How much energy a part uses each second: P = V × I. Most small resistors are rated for 0.25 W; go above that and they get hot."],
  ["Circuit", "A complete loop from + back to −. If the loop is broken anywhere (an open circuit), no current flows."],
  ["Short circuit", "A path from + to − with almost no resistance. Huge current flows, batteries get hot and parts burn. Always have something in the loop."],
  ["Series", "Parts one after another in a single path. The same current flows through each, and their voltages add up."],
  ["Parallel", "Parts side by side between the same two points. Each gets the same voltage, and their currents add up."],
  ["Ground (GND)", "The reference point we call 0 V, usually the − side of the supply. Voltages are measured from here."],
  ["Breadboard", "A board with hidden metal strips. Each column of five holes (a–e or f–j) is connected, and the long rails along the edges carry power."],
  ["Polarity", "Some parts only work one way round: LEDs, diodes, electrolytic capacitors and batteries. Look for the long leg, the stripe or the + mark."],
  ["Voltage divider", "Two resistors in series make a smaller voltage at their middle point: Vout = Vin × R2 ÷ (R1 + R2). Sensors like LDRs use this."],
  ["Diode", "A one-way valve for current. Forward it drops about 0.7 V; backward it blocks."],
  ["LED forward voltage", "The voltage an LED uses when lit: about 1.8 V for red up to 3 V for blue and white. The resistor takes the rest."],
  ["Transistor", "A switch or amplifier controlled by a small current (BJT) or a voltage (MOSFET). It lets weak signals control big loads."],
  ["Capacitor", "Stores charge like a tiny, fast battery. Charges and empties through resistors at a speed set by R × C (the time constant)."],
  ["Pull-up / pull-down", "A resistor that holds an input at a known voltage when a button is not pressed, so it never floats."],
  ["PWM", "Switching power on and off very fast. The share of time it is on (the duty cycle) sets an LED's brightness or a motor's speed."],
  ["Microcontroller", "A tiny computer on a chip (like an Arduino) that reads sensors and switches outputs from a program you write."]
]

// Read "4.7k", "220", "20m", "100u", "1M", "0.5" (an optional unit letter after
// is ignored). Returns null when it can't.
function parseSI(text) {
  var t = String(text || "").trim().replace(/[ΩωvVaAfFwW]$/, "").replace(/\s+/g, "").replace(",", ".")
  if (t === "") return null
  var m = t.match(/^(-?\d*\.?\d+)([pnuµmkKM]?)$/)
  if (!m) return null
  var mult = { "": 1, p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6 }[m[2]]
  return Number(m[1]) * mult
}
