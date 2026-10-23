.pragma library
.import "Catalog.js" as Catalog
.import "Bench.js" as Bench
.import "Mcu.js" as Mcu

// Step-by-step build guides, made from each lesson's own circuit so the
// steps always match "Build it for me": one step per part (with the exact
// holes and which leg goes where), one per wire, the sketch, then Run.
// Each step can tell whether the learner's bench already does it.
//
//   var s = Guide.steps(lesson)     -> [{ text, group, points: [{x,y}], ... }]
//   Guide.progress(s, bench, netlist, running) -> [true/false per step]

// Parts that work either way round.
var symmetric = { resistor: true, capacitor: true, pushButton: true, ldr: true, thermistor: true, motor: true }

function holeName(p) {
  var h = Bench.holeAt(p.x, p.y)
  if (!h) return null
  if (h.kind === "rail") return "the " + h.side + " " + (h.sign === "+" ? "red + rail" : "blue − rail") + " at column " + h.column
  return h.letter + h.column
}

// A point in words: a hole, a rail, or a terminal on an off-board part.
function placeName(p, parts) {
  for (var i = 0; i < parts.length; i++) {
    if (!Catalog.isOffBoard(parts[i].type)) continue
    var pts = Catalog.pinPoints(parts[i])
    for (var j = 0; j < pts.length; j++) {
      if (pts[j].x !== p.x || pts[j].y !== p.y) continue
      var def = Catalog.parts[parts[i].type]
      if (parts[i].type === "omaduino") return "OmaDuino pin " + def.pins[j].name
      return "the " + lowerName(shortName(parts[i])) + "'s " + def.pins[j].name
    }
  }
  return holeName(p) || ("the point at " + p.x + ", " + p.y)
}

function shortName(part) {
  var n = Catalog.parts[part.type].name
  return n.replace(/ \(.*\)$/, "")
}

// The value a learner has to set, in words ("470 Ω", "red"), or "".
function valueText(part) {
  var pr = part.props || {}
  switch (part.type) {
    case "resistor": return Catalog.si(pr.ohms, "Ω")
    case "led": return Catalog.ledColors[pr.color] ? Catalog.ledColors[pr.color].label.toLowerCase() : ""
    case "capacitor": case "electrolytic": return Catalog.si(pr.farads, "F")
    case "aaPack": return pr.cells + " cells"
    case "benchSupply": return pr.volts + " V"
    case "zener": return pr.zenerVolts + " V"
    case "potentiometer": return Catalog.si(pr.ohms, "Ω")
    case "multimeter": return pr.mode + " mode"
  }
  return ""
}

// The props a step checks (the value the text asks for).
var valueKeys = { resistor: ["ohms"], led: ["color"], capacitor: ["farads"], electrolytic: ["farads"], aaPack: ["cells"], benchSupply: ["volts"], zener: ["zenerVolts"], potentiometer: ["ohms"], multimeter: ["mode"] }

function exampleTitle(code) {
  for (var i = 0; i < Mcu.examples.length; i++) if (Mcu.examples[i].text === code) return Mcu.examples[i].title
  return ""
}

function sideOfBoard(part) {
  var r = Bench.boardRect(), b = Catalog.benchBox(part)
  if (b.x1 <= r.x) return "left of the breadboard"
  if (b.x0 >= r.x + r.w) return "right of the breadboard"
  if (b.y0 >= r.y + r.h) return "below the breadboard"
  if (b.y1 <= r.y) return "above the breadboard"
  return "on the bench"
}

// "a" or "an" before a word.
function an(word) { return /^([aeiou]|8|11|18|NPN|N-|LDR|LED|RGB|HC-)/i.test(word) && !/^(one|use)/i.test(word) ? "an " : "a " }

// "Resistor" -> "resistor", but "LED" and "OmaDuino" stay as they are.
function lowerName(name) { return /^[A-Z][a-z]/.test(name) && name.indexOf("OmaDuino") !== 0 ? name.charAt(0).toLowerCase() + name.substring(1) : name }

function partStep(part, all, seen) {
  var def = Catalog.parts[part.type]
  var pts = Catalog.pinPoints(part)
  var val = valueText(part)
  var name = lowerName(def.name.replace(/ \(.*\)$/, ""))
  var what = part.type === "aaPack" ? "battery pack with " + part.props.cells + " AA cells"
    : part.type === "led" ? val + " LED"
    : (val && part.type !== "multimeter" ? val + " " : "") + name
  var article = an(what)
  var text
  if (Catalog.isOffBoard(part.type) || pts.length === 0) {
    text = "Add " + article + what + " and put it " + sideOfBoard(part) + "."
    if (part.type === "multimeter") text += " Click it until it shows " + val + "."
  } else if (pts.length === 2 && symmetric[part.type]) {
    text = "Put " + article + what + " in " + holeName(pts[0]) + " and " + holeName(pts[1]) + " (either way round)."
  } else if (part.type === "led") {
    text = "Put " + article + what + " with its long leg (+) in " + holeName(pts[0]) + " and its short leg (−) in " + holeName(pts[1]) + "."
  } else {
    var legs = []
    for (var i = 0; i < pts.length; i++) legs.push(def.pins[i].name + " in " + holeName(pts[i]))
    text = "Put " + article + what + " on the board: " + legs.join(", ") + "."
  }
  // Tips only the first time a kind of part comes up.
  if (!seen[part.type]) {
    seen[part.type] = true
    if (val && part.type === "led") text += " (Scroll on an LED to change its color.)"
    else if (val && part.type !== "multimeter" && !Catalog.isOffBoard(part.type)) text += " (Scroll on it to change its value.)"
  }
  if (!Catalog.isOffBoard(part.type) && part.rot) text += " It's turned: press R before you click to place it."
  return { group: "parts", text: text, points: Catalog.isOffBoard(part.type) ? [] : pts, part: part }
}

// Which off-board terminal a point is ({ type, pin }), or null for a hole.
function terminalAt(p, parts) {
  for (var i = 0; i < parts.length; i++) {
    if (!Catalog.isOffBoard(parts[i].type)) continue
    var pts = Catalog.pinPoints(parts[i])
    for (var j = 0; j < pts.length; j++) if (pts[j].x === p.x && pts[j].y === p.y) return { type: parts[i].type, pin: j }
  }
  return null
}

function wireStep(w, all) {
  var color = w.color ? w.color + " " : ""
  return { group: "wires", text: "Drag " + an(color || "wire") + color + "wire from " + placeName(w.a, all) + " to " + placeName(w.b, all) + ".",
           points: [w.a, w.b], ends: [{ p: w.a, term: terminalAt(w.a, all) }, { p: w.b, term: terminalAt(w.b, all) }], color: w.color || "" }
}

// Where a step's end really is on the learner's bench: a terminal follows
// their own battery or board, wherever they put it.
function resolve(end, bench) {
  if (!end.term) return end.p
  for (var i = 0; i < bench.parts.length; i++) {
    if (bench.parts[i].type !== end.term.type) continue
    var pts = Catalog.pinPoints(bench.parts[i])
    if (pts[end.term.pin]) return pts[end.term.pin]
  }
  return null
}

// The points to light up on the bench for a step.
function marks(s, bench) {
  if (!s) return []
  if (!s.ends) return s.points
  var out = []
  for (var i = 0; i < s.ends.length; i++) { var p = resolve(s.ends[i], bench); if (p) out.push(p) }
  return out
}

function steps(lesson) {
  if (!lesson || !lesson.build) return []
  var c = lesson.build()
  var out = []
  // Power and boards first, then parts on the breadboard, then wires.
  var off = [], on = []
  for (var i = 0; i < c.parts.length; i++) (Catalog.isOffBoard(c.parts[i].type) ? off : on).push(c.parts[i])
  var seen = {}
  for (var a = 0; a < off.length; a++) out.push(partStep(off[a], c.parts, seen))
  for (var b = 0; b < on.length; b++) out.push(partStep(on[b], c.parts, seen))
  for (var w = 0; w < c.wires.length; w++) out.push(wireStep(c.wires[w], c.parts))
  for (var k = 0; k < c.parts.length; k++) {
    if (!Catalog.mcuTypes[c.parts[k].type] || !c.parts[k].props.code) continue
    var title = exampleTitle(c.parts[k].props.code)
    out.push({ group: "code", points: [], code: c.parts[k].props.code, board: c.parts[k].type,
               text: "Click the " + Catalog.parts[c.parts[k].type].name.replace(/ (board|chip).*$/, "") + ", then \"Open code editor\" in Inspect. Pick \"" + (title || "the lesson's sketch") + "\" from \"Load an example…\" and press Upload." })
  }
  out.push({ group: "run", points: [], text: "Press Run (or Space). The guide below tells you when it works." })
  return out
}

// ------------------------------------------------------------------ progress

function samePoints(a, b) {
  if (a.length !== b.length) return false
  for (var i = 0; i < a.length; i++) if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false
  return true
}

function sameValue(want, have) {
  var keys = valueKeys[want.type] || []
  for (var i = 0; i < keys.length; i++) if (String(want.props[keys[i]]) !== String(have.props[keys[i]])) return false
  return true
}

function partDone(s, bench) {
  var want = s.part
  for (var i = 0; i < bench.parts.length; i++) {
    var have = bench.parts[i]
    if (have.type !== want.type || !sameValue(want, have)) continue
    if (Catalog.isOffBoard(want.type) || s.points.length === 0) return true
    var pts = Catalog.pinPoints(have)
    if (samePoints(pts, s.points)) return true
    if (symmetric[want.type] && samePoints(pts.slice().reverse(), s.points)) return true
  }
  return false
}

// A wire step is done when its two ends are joined, whatever the route.
function wireDone(s, bench, netlist) {
  if (!netlist) return false
  var a = resolve(s.ends[0], bench), b = resolve(s.ends[1], bench)
  if (!a || !b) return false
  var na = Bench.nodeAt(netlist, a.x, a.y), nb = Bench.nodeAt(netlist, b.x, b.y)
  return na >= 0 && na === nb
}

function progress(list, bench, netlist, running) {
  var out = []
  for (var i = 0; i < list.length; i++) {
    var s = list[i], ok = false
    if (s.group === "parts") ok = partDone(s, bench)
    else if (s.group === "wires") ok = wireDone(s, bench, netlist)
    else if (s.group === "code") {
      for (var k = 0; k < bench.parts.length; k++) if (bench.parts[k].type === s.board && bench.parts[k].props.code === s.code) ok = true
    } else if (s.group === "run") ok = !!running
    out.push(ok)
  }
  return out
}

// The first step not done yet, or -1.
function current(done) {
  for (var i = 0; i < done.length; i++) if (!done[i]) return i
  return -1
}
