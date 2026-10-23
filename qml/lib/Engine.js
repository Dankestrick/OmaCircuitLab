.pragma library
.import "Catalog.js" as Catalog
.import "Mcu.js" as Mcu

// DC and one-step transient solver for the breadboard.
// Modified nodal analysis, dense Gaussian elimination with partial pivoting,
// Newton-Raphson with SPICE-style junction limiting, and a 1e-9 S gmin from
// every node to ground so a floating leg still solves.
//
// Stamp convention (node 0, or `ref`, is ground and is not an unknown):
//   g(a, b, s)              conductance s between a and b
//   inject(into, outof, i)  current i enters `into` and leaves `outof`
//   vsrc(plus, minus, v, r) unknown i is the current LEAVING the + node
//                           into the source: (v+ − v−) − r·i = v.
//                           Current delivered out of the + pin is −i.
// `current` on a part is the current entering pin 0. Supplies that are
// powering a circuit therefore report a negative pin-0 current; the UI
// shows the absolute value. dt is seconds. Nothing in here throws.

var GMIN = 1e-9
var VT = 0.02585
var MAX_ITERS = 100
// A dense solve is about n³. 250 unknowns keeps one factor near the worker's
// 25 ms budget. 500 nodes is the old cap and still stops a huge index before
// any voltage array is built. The part cap in the UI is 400, so 2000 elements
// only rejects a netlist that skipped that check.
var MAX_UNKNOWNS = 250
var MAX_NODES = 500
var MAX_ELEMENTS = 2000
var DIODE_IS = 1e-12
var DIODE_NVT = 1.9 * VT
var SCHOTTKY_IS = 1e-6
var SCHOTTKY_NVT = 1.05 * VT
var FUSE_R = 0.1
var FUSE_HOLD = 0.05
var IR_VF = 1.2
var IR_IMAX = 0.05
var PHOTO_I = 50e-6
var FUSE_MSG = "The fuse blew: too much current. Fix the short, then press Reset."
var REG_LOW = "This 7805 needs at least 7 V in to make 5 V."
var REG_HOT = "This 7805 is passing more than 1 A. It will get hot."
var TINY_VOLT = "This OmaTiny needs between 2.7 V and 5.5 V on VCC. Above 6 V it stays off."
var OP_GAIN = 1e5
var OP_ROUT = 50
var BJT_IS = 1e-14
var BJT_BR = 5
var LED_NVT = 0.05
var LED_INOM = 0.02
var LED_IMAX = 0.04
var ZENER_IS = 1.565e-3
var ZENER_NVT = 0.05
var MOS_VTH = 2
var MOS_K = 0.1
var METER_R = 0.1
var OHM_I = 1e-6

function createState() {
  return {
    t: 0,
    capV: {},
    burnt: {},
    burnWhy: {},
    spin: {},
    nodeVolts: null,
    nodeCount: -1,
    mcu: {},
    servoAngle: {},
    scope: {},
    fuse: {},
    indI: {},
    relayOn: {},
    timer: {}
  }
}

function isTimeDependent(netlist) {
  var els = netlist && netlist.elements
  if (!els) return false
  for (var i = 0; i < els.length; i++) {
    var t = els[i].type
    if (t === "capacitor" || t === "electrolytic" || t === "motor" || t === "buzzer" || t === "omaduino" || t === "omaNano" || t === "omaTiny" || t === "hcsr04" || t === "servo" || t === "motorDriver" || t === "robotCar" || t === "acSource" || t === "acAdapter" || t === "oscilloscope" || t === "inductor" || t === "transformer" || t === "relay" || t === "timer555") return true
  }
  return false
}

function solve(netlist, state, dt) {
  try {
    if (!state) state = createState()
    ensureState(state)
    dt = Number(dt)
    if (!isFinite(dt) || dt < 0) dt = 0
    var nl = normalize(netlist)
    if (!nl) return fail("Add a circuit first.")
    if (nl.elements.length > MAX_ELEMENTS || nl.nodeCount > MAX_NODES) return fail("This circuit is too big for the simulator.")
    if (nl.ground < 0 && !isPowered(nl) && !hasOhmProbe(nl)) return unpowered(nl, state)
    syncBoards(nl, state)

    var ref = chooseRef(nl)
    var v = zeros(nl.nodeCount)
    if (dt > 0 && state.nodeVolts && state.nodeCount === nl.nodeCount && state.nodeVolts.length === nl.nodeCount) {
      for (var s = 0; s < nl.nodeCount; s++) v[s] = Number(state.nodeVolts[s]) || 0
      if (ref >= 0 && ref < nl.nodeCount) v[ref] = 0
    }

    var work = { junc: {}, supplyMode: {}, regMode: {}, opMode: {}, tmpOn: {}, servoOn: {}, driverScale: {}, hitLimit: false, changed: false }
    var tNow = Number(state.t)
    if (!isFinite(tNow)) tNow = 0
    // A step is the voltage at the end of dt. A DC solve stays at the current time.
    work.t = dt > 0 ? tNow + dt : tNow
    seedTmp(nl, v, work)
    seedServo(nl, v, work)
    seedDriver(nl, v, state, work)

    var last = null
    var converged = false
    for (var iter = 0; iter < MAX_ITERS; iter++) {
      work.hitLimit = false
      var built = build(nl, state, v, dt, ref, work)
      if (!built) return fail("This circuit is too big for the simulator.")
      var vNew
      if (built.n === 0) {
        vNew = zeros(nl.nodeCount)
        if (ref >= 0 && ref < vNew.length) vNew[ref] = 0
      } else {
        var x = solveLinear(built.A, built.z, built.n)
        if (!x) break
        vNew = voltagesFrom(x, nl.nodeCount, ref)
        if (!allFinite(vNew)) break
      }
      var dv = maxDiff(v, vNew)
      // A flat saturation Jacobian can propose tens of volts. Take at most a
      // 2 V step so the next linearization stays in a real operating region.
      if (dv > 2) {
        for (var d = 0; d < vNew.length; d++) {
          var delta = vNew[d] - v[d]
          if (delta > 2) vNew[d] = v[d] + 2
          else if (delta < -2) vNew[d] = v[d] - 2
        }
        work.hitLimit = true
      }
      v = vNew
      noteModes(built, v, work, nl, state)
      last = v
      var scale = 1 + maxAbs(v)
      if (dv < 1e-5 * scale && !work.hitLimit && !work.changed) {
        converged = true
        break
      }
    }

    if (!last) return fail("This circuit didn't settle. Look for a short, or a part in backwards.")
    var result = assemble(nl, state, last, dt, converged, work)
    state.nodeVolts = last.slice()
    state.nodeCount = nl.nodeCount
    if (dt > 0) {
      state.t = work.t
      runBoards(nl, state, result, last, dt)
    }
    return result
  } catch (err) {
    return fail("Something went wrong while simulating this circuit.")
  }
}

// ---------------------------------------------------------------------------
// Netlist hygiene

function ensureState(state) {
  if (typeof state.t !== "number" || !isFinite(state.t)) state.t = 0
  if (!state.scope) state.scope = {}
  if (!state.capV) state.capV = {}
  if (!state.burnt) state.burnt = {}
  if (!state.burnWhy) state.burnWhy = {}
  if (!state.fuse) state.fuse = {}
  if (!state.indI) state.indI = {}
  if (!state.relayOn) state.relayOn = {}
  if (!state.timer) state.timer = {}
  if (!state.spin) state.spin = {}
  if (!state.mcu) state.mcu = {}
  if (!state.servoAngle) state.servoAngle = {}
}

function normalize(netlist) {
  if (!netlist || !netlist.elements || !netlist.elements.length && netlist.elements.length !== 0) return null
  if (!netlist.elements) return null
  var elements = netlist.elements
  var nodeCount = netlist.nodeCount | 0
  if (nodeCount < 0) nodeCount = 0
  for (var i = 0; i < elements.length; i++) {
    var ns = elements[i].nodes
    if (!ns) continue
    for (var j = 0; j < ns.length; j++) {
      if (typeof ns[j] === "number" && ns[j] + 1 > nodeCount) nodeCount = (ns[j] | 0) + 1
    }
  }
  var ground = netlist.ground
  if (ground !== 0 && ground !== -1) ground = 0
  return { nodeCount: nodeCount, ground: ground, elements: elements }
}

function isBoard(type) {
  return type === "omaduino" || type === "omaNano" || type === "omaTiny"
}

function isSupplyBoard(type) {
  return type === "omaduino" || type === "omaNano"
}

function supplyBoardGround(el, nodeCount) {
  var idx = 0
  if (typeof Catalog !== "undefined" && Catalog.groundPin) {
    var g = Catalog.groundPin(el.type)
    if (typeof g === "number" && g >= 0) idx = g
  }
  var nodes = el && el.nodes
  if (!nodes || idx >= nodes.length) return -1
  var n = nodes[idx]
  if (typeof n !== "number" || (n | 0) < 0 || (n | 0) >= nodeCount) return -1
  return n | 0
}

function isPowered(nl) {
  for (var i = 0; i < nl.elements.length; i++) {
    var t = nl.elements[i].type
    if (t === "battery9v" || t === "aaPack" || t === "benchSupply" || isSupplyBoard(t) || t === "acSource" || t === "acAdapter") return true
  }
  return false
}

function hasOhmProbe(nl) {
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (el.type === "multimeter" && str(el, "mode", "V") === "Ω") return true
  }
  return false
}

function hasDcSupply(nl) {
  for (var i = 0; i < nl.elements.length; i++) {
    var t = nl.elements[i].type
    if (t === "battery9v" || t === "aaPack" || t === "benchSupply" || isSupplyBoard(t)) return true
  }
  return false
}

function chooseRef(nl) {
  // A ground the bench already picked (node 0) always wins.
  if (nl.ground >= 0) return 0
  if (hasDcSupply(nl)) {
    for (var i = 0; i < nl.elements.length; i++) {
      var el = nl.elements[i]
      var t = el.type
      if (t !== "battery9v" && t !== "aaPack" && t !== "benchSupply" && !isSupplyBoard(t)) continue
      if (isSupplyBoard(t)) {
        var gb = supplyBoardGround(el, nl.nodeCount)
        if (gb >= 0) return gb
        continue
      }
      var n = pins(el, nl.nodeCount, 2)
      if (n) return n[1]
    }
  }
  // AC alone: the function generator's −, or the adapter's ~2.
  for (var a = 0; a < nl.elements.length; a++) {
    var ac = nl.elements[a]
    if (ac.type !== "acSource" && ac.type !== "acAdapter") continue
    var na = pins(ac, nl.nodeCount, 2)
    if (na) return na[1]
  }
  return ohmRef(nl)
}

function ohmRef(nl) {
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (el.type === "multimeter" && str(el, "mode", "V") === "Ω" && el.nodes && el.nodes.length > 1) {
      var n = el.nodes[1] | 0
      if (n >= 0 && n < nl.nodeCount) return n
    }
  }
  return 0
}

function unpowered(nl, state) {
  var volts = zeros(nl.nodeCount)
  var parts = {}
  var warnings = [{ part: "", level: "info", message: nl.elements.length ? "Add a battery or a bench supply to power the circuit." : "The bench is empty. Add a part, then press Run." }]
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    var id = partId(el, i)
    var pv = []
    var n = el.nodes ? el.nodes.length : 0
    for (var k = 0; k < n; k++) pv.push(0)
    var p = { current: 0, power: 0, pinVolts: pv }
    if (n >= 3) {
      var legs = []
      for (var c = 0; c < n; c++) legs.push(0)
      p.pinCurrents = legs
    }
    if (el.type === "multimeter") {
      var mode = str(el, "mode", "V")
      p.value = 0
      p.reading = mode === "A" ? "0 A" : mode === "Ω" ? "OL" : "0 V"
    }
    if (el.type === "led") p.brightness = 0
    if (el.type === "rgbLed") p.brightness = { r: 0, g: 0, b: 0 }
    if (el.type === "motor") p.spin = 0
    if (el.type === "buzzer") {
      p.on = false
      p.reversed = false
      p.freq = 0
    }
    parts[id] = p
  }
  state.nodeVolts = volts.slice()
  state.nodeCount = nl.nodeCount
  return { ok: true, converged: true, nodeVolts: volts, parts: parts, warnings: warnings }
}

function fail(message) {
  return {
    ok: false,
    converged: false,
    nodeVolts: [],
    parts: {},
    warnings: [{ part: "", level: "warn", message: message }]
  }
}

function zeros(n) {
  var a = []
  for (var i = 0; i < n; i++) a.push(0)
  return a
}

function partId(el, index) {
  if (el && el.id !== undefined && el.id !== null && el.id !== "") return String(el.id)
  return "p" + index
}

function num(el, key, dflt) {
  if (!el || !el.props) return dflt
  var n = Number(el.props[key])
  return isFinite(n) ? n : dflt
}

function str(el, key, dflt) {
  if (!el || !el.props || el.props[key] === undefined || el.props[key] === null || el.props[key] === "") return dflt
  return String(el.props[key])
}

function pins(el, nodeCount, need) {
  if (!el.nodes || el.nodes.length < need) return null
  var out = []
  for (var i = 0; i < need; i++) {
    var n = el.nodes[i]
    if (typeof n !== "number" || !isFinite(n)) return null
    n = n | 0
    if (n < 0 || n >= nodeCount) return null
    out.push(n)
  }
  return out
}

function nodeV(v, n) {
  return n >= 0 && n < v.length ? v[n] : 0
}

// ---------------------------------------------------------------------------
// Linear algebra

function solveLinear(A, z, n) {
  var M = []
  var b = []
  for (var i = 0; i < n; i++) {
    M.push(A[i].slice())
    b.push(z[i])
  }
  for (var k = 0; k < n; k++) {
    var piv = k
    var max = Math.abs(M[k][k])
    for (var r = k + 1; r < n; r++) {
      var val = Math.abs(M[r][k])
      if (val > max) { max = val; piv = r }
    }
    if (max < 1e-18) return null
    if (piv !== k) {
      var row = M[k]; M[k] = M[piv]; M[piv] = row
      var tmp = b[k]; b[k] = b[piv]; b[piv] = tmp
    }
    var akk = M[k][k]
    for (var i2 = k + 1; i2 < n; i2++) {
      var f = M[i2][k] / akk
      M[i2][k] = 0
      for (var j = k + 1; j < n; j++) M[i2][j] -= f * M[k][j]
      b[i2] -= f * b[k]
    }
  }
  var x = []
  for (var i3 = n - 1; i3 >= 0; i3--) {
    var sum = b[i3]
    for (var j2 = i3 + 1; j2 < n; j2++) sum -= M[i3][j2] * x[j2]
    var diag = M[i3][i3]
    if (Math.abs(diag) < 1e-18) return null
    var xi = sum / diag
    if (!isFinite(xi)) return null
    x[i3] = xi
  }
  return x
}

function System(nodeCount, ref, nExtra) {
  this.nodeCount = nodeCount
  this.ref = ref
  this.nV = nodeCount > 0 ? nodeCount - 1 : 0
  this.n = this.nV + nExtra
  this.extra = this.nV
  this.A = []
  this.z = []
  for (var i = 0; i < this.n; i++) {
    var row = []
    for (var j = 0; j < this.n; j++) row.push(0)
    this.A.push(row)
    this.z.push(0)
  }
}

function uiOf(sys, node) {
  if (node === sys.ref) return -1
  if (node < 0 || node >= sys.nodeCount) return -1
  return node > sys.ref ? node - 1 : node
}

function stampG(sys, a, b, cond) {
  if (!(cond > 0) || !isFinite(cond) || a === b) return
  var ia = uiOf(sys, a)
  var ib = uiOf(sys, b)
  if (ia >= 0) sys.A[ia][ia] += cond
  if (ib >= 0) sys.A[ib][ib] += cond
  if (ia >= 0 && ib >= 0) {
    sys.A[ia][ib] -= cond
    sys.A[ib][ia] -= cond
  }
}

function stampI(sys, into, outof, amps) {
  if (!isFinite(amps) || amps === 0) return
  var ia = uiOf(sys, into)
  var ib = uiOf(sys, outof)
  if (ia >= 0) sys.z[ia] += amps
  if (ib >= 0) sys.z[ib] -= amps
}

function stampVsrc(sys, plus, minus, volts, r) {
  var k = sys.extra++
  var ip = uiOf(sys, plus)
  var im = uiOf(sys, minus)
  if (ip >= 0) { sys.A[ip][k] += 1; sys.A[k][ip] += 1 }
  if (im >= 0) { sys.A[im][k] -= 1; sys.A[k][im] -= 1 }
  if (r) sys.A[k][k] -= r
  sys.z[k] += volts
  return k
}

// Stay in a region until the input is clearly on the other side of it.
function regRegion(vin, prev) {
  if (!(vin > -100)) vin = 0
  if (prev === "reg") {
    if (vin >= 6.8) return "reg"
    if (vin >= 2) return "drop"
    return "off"
  }
  if (prev === "off") {
    if (vin < 2.2) return "off"
    if (vin >= 7) return "reg"
    return "drop"
  }
  if (vin >= 7) return "reg"
  if (vin < 2) return "off"
  return "drop"
}

function stampRegulator(sys, src) {
  // 5 mA from IN to GND no matter which region the output is in.
  stampI(sys, src.gnd, src.inn, 0.005)
  if (src.mode === "drop") {
    // V(out) − V(in) = −2, behind 0.1 Ω. The load current leaves IN.
    src.k = stampVsrc(sys, src.out, src.inn, -2, 0.1)
    return
  }
  // 5 V (or 0 V when the input is under 2 V) from OUT to GND, behind 0.1 Ω.
  // The source current is taken from IN, not from GND.
  src.k = stampVsrc(sys, src.out, src.gnd, src.mode === "reg" ? 5 : 0, 0.1)
  var k = src.k
  var ig = uiOf(sys, src.gnd)
  var ii = uiOf(sys, src.inn)
  if (ig >= 0) sys.A[ig][k] += 1
  if (ii >= 0) sys.A[ii][k] -= 1
}

function opRails(v, src) {
  var lower = nodeV(v, src.vn) + 0.05
  var upper = nodeV(v, src.vpwr) - 1.5
  if (upper < lower) upper = lower
  return { lo: lower, hi: upper }
}

function stampOpamp(sys, src, v) {
  // Each input is 10 MΩ to the V− pin.
  stampG(sys, src.inn, src.vn, 1e-7)
  stampG(sys, src.inp, src.vn, 1e-7)
  var k = sys.extra++
  src.k = k
  var io = uiOf(sys, src.out)
  var ivn = uiOf(sys, src.vn)
  // i leaves OUT and returns into the V− pin, so the part's currents sum to 0.
  if (io >= 0) { sys.A[io][k] += 1; sys.A[k][io] += 1 }
  if (ivn >= 0) sys.A[ivn][k] -= 1
  sys.A[k][k] -= OP_ROUT
  if (src.mode === "lin") {
    var ip = uiOf(sys, src.inp)
    var im = uiOf(sys, src.inn)
    if (ip >= 0) sys.A[k][ip] -= OP_GAIN
    if (im >= 0) sys.A[k][im] += OP_GAIN
    return
  }
  var rails = opRails(v, src)
  sys.z[k] += src.mode === "hi" ? rails.hi : rails.lo
}

function stampTimer(sys, src) {
  var n = src.pins
  var gnd = n[0]
  var out = n[2]
  var reset = n[3]
  var ctrl = n[4]
  var dis = n[6]
  var vcc = n[7]
  // 5k above CTRL and 10k below it: open CTRL sits at 2/3 VCC.
  stampG(sys, vcc, ctrl, 1 / 5000)
  stampG(sys, ctrl, gnd, 1 / 10000)
  stampG(sys, reset, vcc, 1 / 100000)
  if (src.q) {
    src.k = stampVsrc(sys, out, vcc, -1.5, 10)
  } else {
    src.k = stampVsrc(sys, out, gnd, 0.1, 10)
    stampG(sys, dis, gnd, 1 / 10)
  }
}

function stampGmin(sys) {
  for (var n = 0; n < sys.nodeCount; n++) {
    if (n !== sys.ref) stampG(sys, n, sys.ref, GMIN)
  }
}

function voltagesFrom(x, nodeCount, ref) {
  var v = zeros(nodeCount)
  for (var n = 0; n < nodeCount; n++) {
    if (n === ref) v[n] = 0
    else {
      var i = n > ref ? n - 1 : n
      v[n] = x[i] || 0
    }
  }
  return v
}

function allFinite(v) {
  for (var i = 0; i < v.length; i++) if (!isFinite(v[i])) return false
  return true
}

function maxDiff(a, b) {
  var m = 0
  var n = a.length < b.length ? a.length : b.length
  for (var i = 0; i < n; i++) {
    var d = Math.abs(a[i] - b[i])
    if (d > m) m = d
  }
  return m
}

function maxAbs(v) {
  var m = 0
  for (var i = 0; i < v.length; i++) {
    var a = Math.abs(v[i])
    if (a > m) m = a
  }
  return m
}

// ---------------------------------------------------------------------------
// Device laws

function shockley(vd, is, nVt) {
  var x = vd / nVt
  if (x < -40) return { id: -is, gd: 0 }
  if (x > 80) x = 80
  var e = Math.exp(x)
  return { id: is * (e - 1), gd: (is * e) / nVt }
}

function vcrit(is, nVt) {
  var x = nVt / (1.41421356237 * is)
  if (!(x > 1)) return nVt
  return nVt * Math.log(x)
}

function pnjlim(vnew, vold, vt, crit) {
  if (vnew > crit && Math.abs(vnew - vold) > vt + vt) {
    if (vold > 0) {
      var arg = 1 + (vnew - vold) / vt
      if (arg > 0) return vold + vt * Math.log(arg)
      return crit
    }
    if (vnew > vt) return vt * Math.log(vnew / vt)
  }
  return vnew
}

function limitJunction(work, key, vdRaw, vmax, vmin, nVt, is) {
  var prev = work.junc[key]
  if (prev === undefined) {
    prev = vdRaw
    if (prev > vmax) prev = vmax
    if (prev < vmin) prev = vmin
  }
  var vd = pnjlim(vdRaw, prev, nVt, vcrit(is, nVt))
  if (vd > vmax) vd = vmax
  if (vd < vmin) vd = vmin
  // A hard clamp (reverse junction, LED rail) stays off the raw voltage forever.
  // Count it only while the accepted voltage is still walking.
  if (Math.abs(vd - prev) > 1e-4) work.hitLimit = true
  work.junc[key] = vd
  return vd
}

function stampDiode(sys, anode, cathode, vd, is, nVt) {
  var s = shockley(vd, is, nVt)
  var ieq = s.id - s.gd * vd
  stampG(sys, anode, cathode, s.gd)
  stampI(sys, cathode, anode, ieq)
  return s
}

function ledParams(color) {
  var table = (typeof Catalog !== "undefined" && Catalog.ledColors) ? Catalog.ledColors : null
  var c = (table && (table[color] || table.red)) || { vf: 1.8 }
  var vf = c.vf > 0 ? c.vf : 1.8
  var is = LED_INOM / (Math.exp(vf / LED_NVT) - 1)
  return { vf: vf, is: is, nVt: LED_NVT }
}

function bjtEval(vbe, vbc, beta) {
  var vt = VT
  var is = BJT_IS
  var bf = beta > 1 ? beta : 150
  var br = BJT_BR
  var eb = Math.exp(clamp(vbe / vt, -40, 40))
  var ec = Math.exp(clamp(vbc / vt, -40, 40))
  var ie = -is * (1 + 1 / bf) * eb + is * ec + is / bf
  var ic = is * eb - is * (1 + 1 / br) * ec + is / br
  var ib = (is / bf) * (eb - 1) + (is / br) * (ec - 1)
  var die_dvbe = -is * (1 + 1 / bf) * eb / vt
  var die_dvbc = is * ec / vt
  var dic_dvbe = is * eb / vt
  var dic_dvbc = -is * (1 + 1 / br) * ec / vt
  var dib_dvbe = (is / bf) * eb / vt
  var dib_dvbc = (is / br) * ec / vt
  return {
    ie: ie, ib: ib, ic: ic,
    die_dvbe: die_dvbe, die_dvbc: die_dvbc,
    dic_dvbe: dic_dvbe, dic_dvbc: dic_dvbc,
    dib_dvbe: dib_dvbe, dib_dvbc: dib_dvbc
  }
}

// Currents into emitter, base, collector. vbe/vbc are the limited junctions.
function stampBjt(sys, ne, nb, nc, ev, vbe, vbc) {
  var terms = [
    [ne, ev.ie, ev.die_dvbe, ev.die_dvbc],
    [nb, ev.ib, ev.dib_dvbe, ev.dib_dvbc],
    [nc, ev.ic, ev.dic_dvbe, ev.dic_dvbc]
  ]
  for (var t = 0; t < 3; t++) {
    var node = terms[t][0]
    var ieq = terms[t][1] - terms[t][2] * vbe - terms[t][3] * vbc
    var dbe = terms[t][2]
    var dbc = terms[t][3]
    addJ(sys, node, ne, -dbe)
    addJ(sys, node, nb, dbe + dbc)
    addJ(sys, node, nc, -dbc)
    var ri = uiOf(sys, node)
    if (ri >= 0) sys.z[ri] -= ieq
  }
}

function addJ(sys, rowNode, colNode, coeff) {
  if (!coeff || !isFinite(coeff)) return
  var r = uiOf(sys, rowNode)
  var c = uiOf(sys, colNode)
  if (r < 0 || c < 0) return
  sys.A[r][c] += coeff
}

function mosLaw(vgs, vds) {
  var vgst = vgs - MOS_VTH
  if (vgst <= 0 || vds <= -0.2) return { id: 0, gm: 0, gds: 0, region: vds <= 0 ? "rev" : "off" }
  // The triode slope at Vds = 0, extended a little below 0, so a Newton
  // overshoot does not snap the channel off and spring the drain back up.
  if (vds <= 0) {
    var g0 = 2 * MOS_K * vgst
    return { id: g0 * vds, gm: 0, gds: g0, region: "triode" }
  }
  if (vds < vgst) {
    return {
      id: MOS_K * (2 * vgst * vds - vds * vds),
      gm: 2 * MOS_K * vds,
      gds: 2 * MOS_K * (vgst - vds),
      region: "triode"
    }
  }
  return { id: MOS_K * vgst * vgst, gm: 2 * MOS_K * vgst, gds: 0, region: "sat" }
}

function stampMos(sys, ns, ng, nd, vgs, vds) {
  var m = mosLaw(vgs, vds)
  var ieq = m.id - m.gm * vgs - m.gds * vds
  // Id = gm*(vg-vs) + gds*(vd-vs) + ieq, into the drain, out of the source.
  addJ(sys, nd, ng, m.gm)
  addJ(sys, nd, nd, m.gds)
  addJ(sys, nd, ns, -m.gm - m.gds)
  addJ(sys, ns, ng, -m.gm)
  addJ(sys, ns, nd, -m.gds)
  addJ(sys, ns, ns, m.gm + m.gds)
  var rd = uiOf(sys, nd)
  var rs = uiOf(sys, ns)
  if (rd >= 0) sys.z[rd] -= ieq
  if (rs >= 0) sys.z[rs] += ieq
  return m
}

function clamp(x, lo, hi) {
  if (x < lo) return lo
  if (x > hi) return hi
  return x
}

function ldrOhms(light) {
  var L = clamp(light, 0, 1)
  return 1e6 * Math.pow(0.001, L)
}

function ntcOhms(celsius) {
  var t = clamp(celsius + 273.15, 200, 500)
  return 10000 * Math.exp(3950 * (1 / t - 1 / 298.15))
}

// Fraction of a cycle in [0, 1). freq*t keeps the half-cycle boundary exact;
// wrapping through 2π and back lands a hair under 0.5.
function acPhase(freq, t) {
  var p = freq * t
  if (!isFinite(p)) return 0
  p = p - Math.floor(p)
  if (p < 0) p += 1
  return p
}

// Square is +1 for the first half cycle and −1 from the midpoint on.
// Triangle is 0 at phase 0 and +1 at a quarter cycle.
function acShape(wave, p) {
  if (wave === "square") return p < 0.5 ? 1 : -1
  if (wave === "triangle") {
    if (p < 0.25) return p / 0.25
    if (p < 0.75) return 1 - (p - 0.25) / 0.25
    return -1 + (p - 0.75) / 0.25
  }
  return Math.sin(2 * Math.PI * p)
}

// Catalog offers 2, 3 or 4 AA cells. A saved bench can still say 10000, and
// the 2 V Newton cap would then walk for every one of the 100 iterations.
function aaCells(el) {
  var cells = num(el, "cells", 2)
  if (!(cells > 0)) cells = 0
  if (cells > 4) cells = 4
  return cells
}

function acInstant(el, t) {
  if (!isFinite(t)) t = 0
  if (el.type === "acAdapter") {
    var vrms = num(el, "vrms", 12)
    if (!(vrms >= 0)) vrms = 12
    if (vrms > 24) vrms = 24
    var af = num(el, "freq", 60)
    if (!(af > 0)) af = 60
    if (af > 5000) af = 5000
    var apeak = vrms * Math.SQRT2
    return { volts: apeak * acShape("sine", acPhase(af, t)), vpeak: apeak, freq: af, r: 1 }
  }
  var wave = str(el, "wave", "sine")
  if (wave !== "square" && wave !== "triangle") wave = "sine"
  var freq = num(el, "freq", 60)
  if (!(freq >= 1)) freq = 1
  if (freq > 5000) freq = 5000
  var amp = num(el, "amplitude", 5)
  if (!(amp >= 0)) amp = 0
  if (amp > 30) amp = 30
  var offset = num(el, "offset", 0)
  if (offset > 10) offset = 10
  else if (offset < -10) offset = -10
  return { volts: offset + amp * acShape(wave, acPhase(freq, t)), vpeak: amp, freq: freq, r: 50 }
}

function potSections(el) {
  var ohms = num(el, "ohms", 10000)
  if (ohms < 2) ohms = 2
  var turn = clamp(num(el, "turn", 0.5), 0, 1)
  var r1 = ohms * turn
  if (r1 < 1) r1 = 1
  var r2 = ohms - r1
  if (r2 < 1) r2 = 1
  return { r1: r1, r2: r2, turn: turn }
}

function capStored(state, id) {
  var v = state.capV[id]
  return typeof v === "number" && isFinite(v) ? v : 0
}

// ---------------------------------------------------------------------------
// Build one Newton matrix

function seedTmp(nl, v, work) {
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (el.type !== "tmp36") continue
    var n = pins(el, nl.nodeCount, 3)
    if (!n) continue
    var vsup = nodeV(v, n[0]) - nodeV(v, n[2])
    work.tmpOn[partId(el, i)] = vsup > 2.7
  }
}

function seedServo(nl, v, work) {
  if (!work.servoOn) work.servoOn = {}
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (el.type !== "servo") continue
    var n = pins(el, nl.nodeCount, 3)
    var on = n ? nodeV(v, n[1]) - nodeV(v, n[0]) > 4 : false
    work.servoOn[partId(el, i)] = on
  }
}

function sourceList(nl, v, state, work) {
  var list = []
  var nExtra = 0
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    var id = partId(el, i)
    var kind = el.type
    if (state.burnt[id] && (kind === "led" || kind === "rgbLed" || kind === "electrolytic")) {
      list.push(null)
      continue
    }
    if (kind === "battery9v" || kind === "aaPack" || kind === "benchSupply" || kind === "tmp36") {
      var need = kind === "tmp36" ? 3 : 2
      var n = pins(el, nl.nodeCount, need)
      if (!n) { list.push(null); continue }
      if (kind === "battery9v") {
        nExtra++
        list.push({ kind: "v", plus: n[0], minus: n[1], volts: 9, r: 1.5, id: id })
      } else if (kind === "aaPack") {
        var cells = aaCells(el)
        nExtra++
        list.push({ kind: "v", plus: n[0], minus: n[1], volts: cells * 1.5, r: Math.max(cells, 1) * 0.3, id: id })
      } else if (kind === "benchSupply") {
        var vset = clamp(num(el, "volts", 5), 0, 30)
        var limit = num(el, "currentLimit", 1)
        if (!(limit > 0)) limit = 0.01
        var mode = work.supplyMode[id] || "v"
        var vterm = nodeV(v, n[0]) - nodeV(v, n[1])
        if (mode === "i" && vterm >= vset - 1e-3) mode = "v"
        if (mode === "v") nExtra++
        list.push({ kind: "bench", plus: n[0], minus: n[1], volts: vset, r: 0.05, limit: limit, mode: mode, id: id })
      } else if (work.tmpOn[id]) {
        var tout = 0.5 + 0.01 * num(el, "celsius", 25)
        nExtra++
        list.push({ kind: "v", plus: n[1], minus: n[2], volts: tout, r: 100, id: id, tmp: true, vp: n[0], vg: n[2] })
      } else {
        list.push({ kind: "tmpOff", vp: n[0], vg: n[2], out: n[1], id: id })
      }
    } else if (isBoard(kind)) {
      var plan = boardPlan(el, state, id, v)
      nExtra += plan.outputs.length
      list.push(plan)
    } else if (kind === "motorDriver") {
      var ndrv = pins(el, nl.nodeCount, 10)
      if (!ndrv) { list.push(null); continue }
      nExtra += 4
      list.push({ kind: "driver", id: id, pins: ndrv })
    } else if (kind === "acSource" || kind === "acAdapter") {
      var nac = pins(el, nl.nodeCount, 2)
      if (!nac) { list.push(null); continue }
      var ac = acInstant(el, work.t)
      nExtra++
      list.push({ kind: "v", plus: nac[0], minus: nac[1], volts: ac.volts, r: ac.r, id: id })
    } else if (kind === "transformer") {
      var nxf = pins(el, nl.nodeCount, 4)
      if (!nxf) { list.push(null); continue }
      var ratio = num(el, "ratio", 10)
      if (!(ratio > 0)) ratio = 10
      nExtra++
      list.push({ kind: "xfmr", id: id, p1: nxf[0], p2: nxf[1], s1: nxf[2], s2: nxf[3], ratio: ratio })
    } else if (kind === "regulator7805") {
      var nreg = pins(el, nl.nodeCount, 3)
      if (!nreg) { list.push(null); continue }
      nExtra++
      var rmode = work.regMode[id]
      if (rmode !== "reg" && rmode !== "drop" && rmode !== "off") rmode = regRegion(nodeV(v, nreg[0]) - nodeV(v, nreg[1]), "")
      list.push({ kind: "reg", id: id, inn: nreg[0], gnd: nreg[1], out: nreg[2], mode: rmode })
    } else if (kind === "opamp") {
      var nop = pins(el, nl.nodeCount, 5)
      if (!nop) { list.push(null); continue }
      nExtra++
      var omode = work.opMode[id]
      if (omode !== "lin" && omode !== "hi" && omode !== "lo") omode = "lin"
      list.push({ kind: "op", id: id, inn: nop[0], inp: nop[1], vn: nop[2], vpwr: nop[3], out: nop[4], mode: omode })
    } else if (kind === "timer555") {
      var n555 = pins(el, nl.nodeCount, 8)
      if (!n555) { list.push(null); continue }
      nExtra++
      if (!state.timer[id]) state.timer[id] = { q: 0, rises: [] }
      list.push({ kind: "t555", id: id, pins: n555, q: state.timer[id].q === 1 })
    } else {
      list.push(null)
    }
  }
  return { list: list, nExtra: nExtra }
}

function noteModes(built, v, work, nl, state) {
  work.changed = false
  var srcs = built.sources
  for (var i = 0; i < srcs.length; i++) {
    var s = srcs[i]
    if (!s) continue
    if (s.kind === "bench") {
      var vterm = nodeV(v, s.plus) - nodeV(v, s.minus)
      var iOut = s.mode === "i" ? s.limit : (s.volts - vterm) / s.r
      var prev = work.supplyMode[s.id] || "v"
      var next = prev
      if (prev !== "i" && iOut > s.limit * 1.002 && vterm < s.volts - 1e-3) next = "i"
      if (prev === "i" && vterm >= s.volts - 1e-3) next = "v"
      if (next !== prev) work.changed = true
      work.supplyMode[s.id] = next
    }
    if (s.tmp || s.kind === "tmpOff") {
      var vp = s.vp !== undefined ? s.vp : s.plus
      var vg = s.vg !== undefined ? s.vg : s.minus
      var vsup = nodeV(v, vp) - nodeV(v, vg)
      var was = work.tmpOn[s.id] === true
      var now = was ? vsup > 2.5 : vsup > 2.7
      if (now !== was) work.changed = true
      work.tmpOn[s.id] = now
    }
    if (s.kind === "servo") {
      var vServo = nodeV(v, s.vcc) - nodeV(v, s.gnd)
      var wasServo = work.servoOn[s.id] === true
      var nowServo = vServo > 4
      if (nowServo !== wasServo) work.changed = true
      work.servoOn[s.id] = nowServo
    }
    if (s.kind === "driver") {
      var nowD = driverScales(v, state, nl, s.pins)
      var prevD = work.driverScale[s.id]
      var flip = !prevD
      if (!flip) for (var d = 0; d < 4; d++) if (nowD[d] !== prevD[d]) flip = true
      if (flip) work.changed = true
      work.driverScale[s.id] = nowD
    }
  }
  noteRelays(nl, v, work, state)
  noteRegulators(built, v, work)
  noteOpamps(built, v, work)
  noteTimers(built, v, work, state)
}

function noteOpamps(built, v, work) {
  if (!work.opMode) work.opMode = {}
  var srcs = built.sources
  for (var i = 0; i < srcs.length; i++) {
    var s = srcs[i]
    if (!s || s.kind !== "op") continue
    // A capped Newton step has not reached the real input yet. Stay put.
    if (work.hitLimit) {
      work.opMode[s.id] = s.mode
      continue
    }
    var rails = opRails(v, s)
    var vd = nodeV(v, s.inp) - nodeV(v, s.inn)
    var unlimited = OP_GAIN * vd
    var prev = s.mode
    var next = prev
    if (prev === "hi") {
      if (vd < -1e-4) next = "lin"
    } else if (prev === "lo") {
      if (vd > 1e-4) next = "lin"
    } else if (unlimited > rails.hi) {
      next = "hi"
    } else if (unlimited < rails.lo) {
      next = "lo"
    } else {
      next = "lin"
    }
    if (next !== prev) work.changed = true
    work.opMode[s.id] = next
  }
}

function noteRegulators(built, v, work) {
  if (!work.regMode) work.regMode = {}
  var srcs = built.sources
  for (var i = 0; i < srcs.length; i++) {
    var s = srcs[i]
    if (!s || s.kind !== "reg") continue
    var vin = nodeV(v, s.inn) - nodeV(v, s.gnd)
    var next = regRegion(vin, s.mode)
    if (next !== s.mode) work.changed = true
    work.regMode[s.id] = next
  }
}

function noteTimers(built, v, work, state) {
  if (!state.timer) state.timer = {}
  var srcs = built.sources
  for (var i = 0; i < srcs.length; i++) {
    var s = srcs[i]
    if (!s || s.kind !== "t555") continue
    var n = s.pins
    var tm = state.timer[s.id]
    if (!tm) tm = state.timer[s.id] = { q: 0, rises: [] }
    if (!tm.rises) tm.rises = []
    var was = s.q === true
    var vctrl = nodeV(v, n[4])
    var now = was
    // One flip per solve. An open timing cap at DC would otherwise set and
    // reset forever, and the Newton loop would never settle.
    if (!work.timerHold) work.timerHold = {}
    if (!work.timerHold[s.id]) {
      if (nodeV(v, n[3]) < 0.7) now = false
      else if (nodeV(v, n[5]) > vctrl) now = false
      else if (nodeV(v, n[1]) < vctrl * 0.5) now = true
      if (now !== was) work.timerHold[s.id] = true
    }
    if (now !== was) work.changed = true
    if (now && !was) {
      var tt = work.t
      if (tm.rises.length === 0 || tm.rises[tm.rises.length - 1] !== tt) {
        tm.rises.push(tt)
        if (tm.rises.length > 4) tm.rises.shift()
      }
    } else if (!now && was) {
      if (tm.rises.length && tm.rises[tm.rises.length - 1] === work.t) tm.rises.pop()
    }
    tm.q = now ? 1 : 0
  }
}

function noteRelays(nl, v, work, state) {
  if (!state.relayOn) state.relayOn = {}
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (el.type !== "relay") continue
    var n = pins(el, nl.nodeCount, 5)
    if (!n) continue
    var id = partId(el, i)
    var coil = nodeV(v, n[0]) - nodeV(v, n[1])
    var pull = num(el, "pullIn", 3.5)
    var drop = num(el, "dropOut", 1.5)
    if (!(pull > drop)) { pull = 3.5; drop = 1.5 }
    var was = state.relayOn[id] === true
    var now = was
    if (coil >= pull) now = true
    else if (coil < drop) now = false
    if (now !== was) work.changed = true
    state.relayOn[id] = now
  }
}

function build(nl, state, v, dt, ref, work) {
  work.irBright = benchIrBright(nl, v, state)
  var plan = sourceList(nl, v, state, work)
  var nV = nl.nodeCount > 0 ? nl.nodeCount - 1 : 0
  // nExtra is every voltage-source unknown. It is not part of nodeCount, so a
  // pile of packs or board rails used to allocate past the 500-node check.
  if (!(plan.nExtra >= 0) || plan.nExtra > MAX_UNKNOWNS || nV + plan.nExtra > MAX_UNKNOWNS) return null
  var sys = new System(nl.nodeCount, ref, plan.nExtra)
  stampGmin(sys)
  var powered = isPowered(nl)
  var sources = []

  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    var id = partId(el, i)
    var src = plan.list[i]
    if (src && src.kind === "v") {
      src.k = stampVsrc(sys, src.plus, src.minus, src.volts, src.r)
      sources.push(src)
      if (src.tmp) stampI(sys, src.vg, src.vp, 50e-6)
      continue
    }
    if (src && src.kind === "bench") {
      if (src.mode === "i") stampI(sys, src.plus, src.minus, src.limit)
      else src.k = stampVsrc(sys, src.plus, src.minus, src.volts, src.r)
      sources.push(src)
      continue
    }
    if (src && src.kind === "tmpOff") {
      stampI(sys, src.vg, src.vp, 50e-6)
      sources.push(src)
      continue
    }
    if (src && src.kind === "board") {
      stampBoard(sys, src, v)
      sources.push(src)
      continue
    }
    if (src && src.kind === "driver") {
      stampDriver(sys, src, v, state, nl, work)
      sources.push(src)
      continue
    }
    if (src && src.kind === "xfmr") {
      stampTransformer(sys, src)
      sources.push(src)
      continue
    }
    if (src && src.kind === "reg") {
      stampRegulator(sys, src)
      sources.push(src)
      continue
    }
    if (src && src.kind === "op") {
      stampOpamp(sys, src, v)
      sources.push(src)
      continue
    }
    if (src && src.kind === "t555") {
      stampTimer(sys, src)
      sources.push(src)
      continue
    }
    if (src) sources.push(src)

    if (state.burnt[id] && (el.type === "led" || el.type === "rgbLed" || el.type === "electrolytic" || el.type === "irLed" || el.type === "fuse")) continue

    if (el.type === "resistor" || el.type === "ldr" || el.type === "thermistor" || el.type === "pushButton" || el.type === "tiltSwitch" || el.type === "buzzer" || el.type === "motor" || el.type === "fuse") {
      var n2 = pins(el, nl.nodeCount, 2)
      if (!n2) continue
      var r = twoTermR(el)
      stampG(sys, n2[0], n2[1], 1 / r)
    } else if (el.type === "slideSwitch") {
      var ns = pins(el, nl.nodeCount, 3)
      if (!ns) continue
      var pos = num(el, "position", 0) >= 0.5 ? 1 : 0
      if (pos === 0) stampG(sys, ns[1], ns[0], 1 / 0.05)
      else stampG(sys, ns[1], ns[2], 1 / 0.05)
    } else if (el.type === "potentiometer") {
      var np = pins(el, nl.nodeCount, 3)
      if (!np) continue
      var pot = potSections(el)
      stampG(sys, np[0], np[1], 1 / pot.r1)
      stampG(sys, np[1], np[2], 1 / pot.r2)
    } else if (el.type === "led") {
      var nd = pins(el, nl.nodeCount, 2)
      if (!nd) continue
      var lp = ledParams(str(el, "color", "red"))
      var vd = limitJunction(work, id, nodeV(v, nd[0]) - nodeV(v, nd[1]), lp.vf + 0.45, -5, lp.nVt, lp.is)
      stampDiode(sys, nd[0], nd[1], vd, lp.is, lp.nVt)
    } else if (el.type === "hcsr04" || el.type === "robotCar") {
      if (el.type === "robotCar") {
        var nCar = pins(el, nl.nodeCount, 8)
        if (!nCar) continue
        stampG(sys, nCar[0], nCar[1], 1 / 10)
        stampG(sys, nCar[2], nCar[3], 1 / 10)
      }
      var nSonar = sonarNodes(el, nl.nodeCount)
      if (!nSonar) continue
      stampG(sys, nSonar.vcc, nSonar.gnd, 1 / 330)
      stampG(sys, nSonar.trig, nSonar.gnd, 1 / 1e6)
      stampG(sys, nSonar.echo, nSonar.gnd, 1 / 1000)
    } else if (el.type === "servo") {
      var nServo = pins(el, nl.nodeCount, 3)
      if (!nServo) continue
      stampG(sys, nServo[2], nServo[0], 1 / 1e6)
      if (work.servoOn && work.servoOn[id]) stampG(sys, nServo[1], nServo[0], 1 / 100)
      sources.push({ kind: "servo", id: id, vcc: nServo[1], gnd: nServo[0] })
    } else if (el.type === "sevenSeg") {
      var n7 = pins(el, nl.nodeCount, 9)
      if (!n7) continue
      var common = n7[8]
      var segNames = ["a", "b", "c", "d", "e", "f", "g", "dp"]
      var lp7 = ledParams("red")
      for (var s7 = 0; s7 < 8; s7++) {
        var sid = id + ":" + segNames[s7]
        if (state.burnt[sid]) continue
        var vd7 = limitJunction(work, sid, nodeV(v, n7[s7]) - nodeV(v, common), lp7.vf + 0.45, -5, lp7.nVt, lp7.is)
        stampDiode(sys, n7[s7], common, vd7, lp7.is, lp7.nVt)
      }
    } else if (el.type === "rgbLed") {
      var nr = pins(el, nl.nodeCount, 4)
      if (!nr) continue
      var colors = ["red", "green", "blue"]
      var anodes = [nr[0], nr[2], nr[3]]
      for (var c = 0; c < 3; c++) {
        var rp = ledParams(colors[c])
        var vdr = limitJunction(work, id + ":" + colors[c], nodeV(v, anodes[c]) - nodeV(v, nr[1]), rp.vf + 0.45, -5, rp.nVt, rp.is)
        stampDiode(sys, anodes[c], nr[1], vdr, rp.is, rp.nVt)
      }
    } else if (el.type === "schottky") {
      var nsk = pins(el, nl.nodeCount, 2)
      if (!nsk) continue
      var vdSk = limitJunction(work, id, nodeV(v, nsk[0]) - nodeV(v, nsk[1]), 1.5, -20, SCHOTTKY_NVT, SCHOTTKY_IS)
      stampDiode(sys, nsk[0], nsk[1], vdSk, SCHOTTKY_IS, SCHOTTKY_NVT)
    } else if (el.type === "bridgeRectifier") {
      var nbr = pins(el, nl.nodeCount, 4)
      if (!nbr) continue
      // ~1→+, ~2→+, −→~1, −→~2.
      stampDiode(sys, nbr[0], nbr[2], limitJunction(work, id + ":a", nodeV(v, nbr[0]) - nodeV(v, nbr[2]), 1.5, -20, DIODE_NVT, DIODE_IS), DIODE_IS, DIODE_NVT)
      stampDiode(sys, nbr[1], nbr[2], limitJunction(work, id + ":b", nodeV(v, nbr[1]) - nodeV(v, nbr[2]), 1.5, -20, DIODE_NVT, DIODE_IS), DIODE_IS, DIODE_NVT)
      stampDiode(sys, nbr[3], nbr[0], limitJunction(work, id + ":c", nodeV(v, nbr[3]) - nodeV(v, nbr[0]), 1.5, -20, DIODE_NVT, DIODE_IS), DIODE_IS, DIODE_NVT)
      stampDiode(sys, nbr[3], nbr[1], limitJunction(work, id + ":d", nodeV(v, nbr[3]) - nodeV(v, nbr[1]), 1.5, -20, DIODE_NVT, DIODE_IS), DIODE_IS, DIODE_NVT)
    } else if (el.type === "irLed") {
      var nir = pins(el, nl.nodeCount, 2)
      if (!nir) continue
      var irp = irLedParams()
      var vdir = limitJunction(work, id, nodeV(v, nir[0]) - nodeV(v, nir[1]), irp.vf + 0.45, -5, irp.nVt, irp.is)
      stampDiode(sys, nir[0], nir[1], vdir, irp.is, irp.nVt)
    } else if (el.type === "photodiode") {
      var nph = pins(el, nl.nodeCount, 2)
      if (!nph) continue
      var vdph = limitJunction(work, id, nodeV(v, nph[0]) - nodeV(v, nph[1]), 1.5, -20, DIODE_NVT, DIODE_IS)
      stampDiode(sys, nph[0], nph[1], vdph, DIODE_IS, DIODE_NVT)
      // Photocurrent leaves the anode into the circuit.
      stampI(sys, nph[0], nph[1], PHOTO_I * photoLight(el, work))
    } else if (el.type === "diode" || el.type === "zener") {
      var nz = pins(el, nl.nodeCount, 2)
      if (!nz) continue
      var vdRaw = nodeV(v, nz[0]) - nodeV(v, nz[1])
      if (el.type === "diode") {
        var vdd = limitJunction(work, id, vdRaw, 1.5, -20, DIODE_NVT, DIODE_IS)
        stampDiode(sys, nz[0], nz[1], vdd, DIODE_IS, DIODE_NVT)
      } else {
        var vz = num(el, "zenerVolts", 5.1)
        if (!(vz > 0.1)) vz = 5.1
        var vdz = limitJunction(work, id, vdRaw, 1.5, -(vz + 0.4), DIODE_NVT, DIODE_IS)
        stampZener(sys, nz[0], nz[1], vdz, vz)
      }
    } else if (el.type === "npn" || el.type === "pnp") {
      var nq = pins(el, nl.nodeCount, 3)
      if (!nq) continue
      var beta = num(el, "beta", 150)
      if (el.type === "npn") {
        var vbeR = nodeV(v, nq[1]) - nodeV(v, nq[0])
        var vbcR = nodeV(v, nq[1]) - nodeV(v, nq[2])
        var vbe = limitJunction(work, id + ":be", vbeR, 1.05, -5, VT, BJT_IS)
        var vbc = limitJunction(work, id + ":bc", vbcR, 1.05, -5, VT, BJT_IS)
        stampBjt(sys, nq[0], nq[1], nq[2], bjtEval(vbe, vbc, beta), vbe, vbc)
      } else {
        var vebR = nodeV(v, nq[0]) - nodeV(v, nq[1])
        var vcbR = nodeV(v, nq[2]) - nodeV(v, nq[1])
        var veb = limitJunction(work, id + ":be", vebR, 1.05, -5, VT, BJT_IS)
        var vcb = limitJunction(work, id + ":bc", vcbR, 1.05, -5, VT, BJT_IS)
        // Same injection model with the junctions flipped, currents negated.
        var ev = bjtEval(veb, vcb, beta)
        // I_pnp = −I_npn(Veb, Vcb). dI_pnp/d(Vb−Ve) = dI_npn/dVeb, so the
        // derivatives stay as the NPN ones and the junction arguments flip sign.
        var flipped = {
          ie: -ev.ie, ib: -ev.ib, ic: -ev.ic,
          die_dvbe: ev.die_dvbe, die_dvbc: ev.die_dvbc,
          dib_dvbe: ev.dib_dvbe, dib_dvbc: ev.dib_dvbc,
          dic_dvbe: ev.dic_dvbe, dic_dvbc: ev.dic_dvbc
        }
        stampBjt(sys, nq[0], nq[1], nq[2], flipped, -veb, -vcb)
      }
    } else if (el.type === "nmos") {
      var nm = pins(el, nl.nodeCount, 3)
      if (!nm) continue
      var vgsR = nodeV(v, nm[1]) - nodeV(v, nm[0])
      var vdsR = nodeV(v, nm[2]) - nodeV(v, nm[0])
      var vgs = clamp(vgsR, -5, 20)
      var vds = clamp(vdsR, -5, 40)
      var prevGs = work.junc[id + ":gs"]
      var prevDs = work.junc[id + ":ds"]
      if (prevGs === undefined) prevGs = vgs
      if (prevDs === undefined) prevDs = vds
      if ((Math.abs(vgs - vgsR) > 1e-4 && Math.abs(vgs - prevGs) > 1e-4) ||
          (Math.abs(vds - vdsR) > 1e-4 && Math.abs(vds - prevDs) > 1e-4)) work.hitLimit = true
      work.junc[id + ":gs"] = vgs
      work.junc[id + ":ds"] = vds
      stampMos(sys, nm[0], nm[1], nm[2], vgs, vds)
      var vbd = limitJunction(work, id + ":bd", nodeV(v, nm[0]) - nodeV(v, nm[2]), 1.5, -20, DIODE_NVT, DIODE_IS)
      stampDiode(sys, nm[0], nm[2], vbd, DIODE_IS, DIODE_NVT)
    } else if (el.type === "inductor") {
      var nL = pins(el, nl.nodeCount, 2)
      if (!nL) continue
      var henries = num(el, "henries", 0.01)
      if (!(henries > 0)) henries = 0
      if (henries > 0 && dt > 0) {
        var geq = 1 / (0.5 + henries / dt)
        var ihist = indStored(state, id) * (henries / dt) * geq
        stampG(sys, nL[0], nL[1], geq)
        stampI(sys, nL[1], nL[0], ihist)
      } else {
        stampG(sys, nL[0], nL[1], 1 / 0.5)
      }
    } else if (el.type === "relay") {
      var nK = pins(el, nl.nodeCount, 5)
      if (!nK) continue
      var rc = num(el, "coilOhms", 70)
      if (!(rc > 0)) rc = 70
      if (dt > 0) {
        var gCoil = 1 / (rc + 0.01 / dt)
        var iCoil = indStored(state, id) * (0.01 / dt) * gCoil
        stampG(sys, nK[0], nK[1], gCoil)
        stampI(sys, nK[1], nK[0], iCoil)
      } else {
        stampG(sys, nK[0], nK[1], 1 / rc)
      }
      var closed = state.relayOn[id] === true
      stampG(sys, nK[2], nK[3], closed ? 1 / 0.05 : 1e-9)
      stampG(sys, nK[2], nK[4], closed ? 1e-9 : 1 / 0.05)
    } else if (el.type === "capacitor" || el.type === "electrolytic") {
      var nc = pins(el, nl.nodeCount, 2)
      if (!nc) continue
      var farads = num(el, "farads", el.type === "electrolytic" ? 1e-4 : 1e-7)
      if (farads > 0 && dt > 0) {
        var g = farads / dt
        if (g > 1e7) g = 1e7
        var vprev = capStored(state, id)
        stampG(sys, nc[0], nc[1], g)
        stampI(sys, nc[1], nc[0], -g * vprev)
      }
    } else if (el.type === "multimeter") {
      var nmet = pins(el, nl.nodeCount, 2)
      if (!nmet) continue
      var mode = str(el, "mode", "V")
      if (mode === "A") stampG(sys, nmet[0], nmet[1], 1 / METER_R)
      else if (mode === "Ω" && !powered) stampI(sys, nmet[0], nmet[1], OHM_I)
    } else if (el.type === "oscilloscope") {
      var nsc = pins(el, nl.nodeCount, 3)
      if (!nsc) continue
      // 10 MΩ from each channel to the ground clip.
      stampG(sys, nsc[0], nsc[2], 1e-7)
      stampG(sys, nsc[1], nsc[2], 1e-7)
    }
  }

  return { A: sys.A, z: sys.z, n: sys.n, sources: sources }
}

function stampZener(sys, anode, cathode, vd, vz) {
  var fwd = shockley(vd, DIODE_IS, DIODE_NVT)
  var vb = -vd - vz
  var rev = shockley(vb, ZENER_IS, ZENER_NVT)
  var id = fwd.id - rev.id
  var gd = fwd.gd + rev.gd
  var ieq = id - gd * vd
  stampG(sys, anode, cathode, gd)
  stampI(sys, cathode, anode, ieq)
}

function twoTermR(el) {
  if (el.type === "pushButton") return (el.props && (el.props.pressed === true || el.props.pressed === 1)) ? 0.05 : 1e9
  if (el.type === "tiltSwitch") return (el.props && (el.props.tilted === true || el.props.tilted === 1)) ? 0.05 : 1e9
  if (el.type === "fuse") return FUSE_R
  if (el.type === "ldr") return ldrOhms(num(el, "light", 0.5))
  if (el.type === "thermistor") return ntcOhms(num(el, "celsius", 25))
  if (el.type === "buzzer") return 200
  if (el.type === "motor") return 10
  var r = num(el, "ohms", 220)
  if (!(r > 0)) r = 1e-3
  return r
}

// ---------------------------------------------------------------------------
// Results

function assemble(nl, state, v, dt, converged, work) {
  work.irBright = benchIrBright(nl, v, state)
  var warnings = []
  var parts = {}
  if (!converged) pushWarn(warnings, "", "warn", "This circuit didn't settle. Look for a short, or a part in backwards.")

  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    var id = partId(el, i)
    var pv = pinVoltsOf(el, v, nl.nodeCount)
    var p = { current: 0, power: 0, pinVolts: pv }
    var kind = el.type

    if (kind === "battery9v" || kind === "aaPack" || kind === "benchSupply") {
      fillSource(p, el, id, pv, warnings)
    } else if (kind === "acSource" || kind === "acAdapter") {
      fillAc(p, el, pv, work)
    } else if (kind === "oscilloscope") {
      fillScope(p, el, id, pv, state, work)
    } else if (kind === "resistor" || kind === "ldr" || kind === "thermistor" || kind === "pushButton" || kind === "tiltSwitch" || kind === "buzzer" || kind === "motor") {
      fillR(p, el, id, pv, state, nl, warnings)
    } else if (kind === "fuse") {
      fillFuse(p, el, id, pv, state, dt, warnings)
    } else if (kind === "schottky") {
      fillSchottky(p, pv)
    } else if (kind === "bridgeRectifier") {
      fillBridge(p, pv)
    } else if (kind === "irLed") {
      fillIrLed(p, el, id, pv, state, warnings)
    } else if (kind === "photodiode") {
      fillPhoto(p, el, pv, work)
    } else if (kind === "slideSwitch") {
      fillSwitch(p, el, pv)
    } else if (kind === "potentiometer") {
      fillPot(p, el, pv)
    } else if (kind === "led") {
      fillLed(p, el, id, pv, state, warnings)
    } else if (kind === "sevenSeg") {
      fillSeven(p, el, id, pv, state, warnings)
    } else if (kind === "rgbLed") {
      fillRgb(p, el, id, pv, state, warnings)
    } else if (kind === "diode") {
      fillDiode(p, pv)
    } else if (kind === "zener") {
      fillZener(p, el, pv)
    } else if (kind === "npn" || kind === "pnp") {
      fillBjt(p, el, pv)
    } else if (kind === "nmos") {
      fillMos(p, pv)
    } else if (kind === "inductor") {
      fillInductor(p, el, id, pv, state, dt)
    } else if (kind === "relay") {
      fillRelay(p, el, id, pv, state, dt, warnings)
    } else if (kind === "transformer") {
      fillTransformer(p, el, pv)
    } else if (kind === "regulator7805") {
      fillRegulator(p, id, pv, warnings)
    } else if (kind === "opamp") {
      fillOpamp(p, pv)
    } else if (kind === "timer555") {
      fillTimer(p, id, pv, state)
    } else if (kind === "capacitor" || kind === "electrolytic") {
      fillCap(p, el, id, pv, state, dt, warnings)
    } else if (kind === "multimeter") {
      fillMeter(p, el, id, pv, nl, warnings)
    } else if (kind === "tmp36") {
      fillTmp(p, el, id, pv, work, warnings)
    } else if (isBoard(kind)) {
      fillBoard(p, el, id, pv, state, v, warnings)
    } else if (kind === "hcsr04") {
      fillSonar(p, el, id, v, warnings)
    } else if (kind === "servo") {
      fillServo(p, el, id, v, state, nl, warnings)
    } else if (kind === "motorDriver") {
      fillDriver(p, el, id, v, state, nl, warnings)
    } else if (kind === "robotCar") {
      fillCar(p, el, id, v, warnings)
    } else {
      pushWarn(warnings, id, "info", "This part isn't in the simulator yet, so it was left unconnected.")
    }
    parts[id] = p
  }

  return { ok: true, converged: converged, nodeVolts: v.slice(), parts: parts, warnings: warnings }
}

function pinVoltsOf(el, v, nodeCount) {
  var pv = []
  if (!el.nodes) return pv
  for (var i = 0; i < el.nodes.length; i++) {
    var n = el.nodes[i]
    if (typeof n !== "number" || (n | 0) < 0 || (n | 0) >= nodeCount) pv.push(0)
    else pv.push(nodeV(v, n | 0))
  }
  return pv
}

function scopeRing(state, id) {
  var ring = state.scope[id]
  if (!ring || !ring.t) {
    ring = { t: [], ch1: [], ch2: [] }
    state.scope[id] = ring
  }
  return ring
}

function scopePush(ring, t, c1, c2) {
  ring.t.push(t)
  ring.ch1.push(c1)
  ring.ch2.push(c2)
  var extra = ring.t.length - 2000
  if (extra > 0) {
    ring.t.splice(0, extra)
    ring.ch1.splice(0, extra)
    ring.ch2.splice(0, extra)
  }
}

function scopeSpan(el) {
  var div = num(el, "timePerDiv", 0.005)
  if (!(div > 0)) div = 0.005
  return div * 10
}

function scopeWindow(ring, span) {
  var n = ring.t.length
  var start = 0
  if (n > 0) {
    var oldest = ring.t[n - 1] - span
    while (start < n && ring.t[start] < oldest - 1e-12) start++
  }
  return { t: ring.t.slice(start), ch1: ring.ch1.slice(start), ch2: ring.ch2.slice(start) }
}

function scopeDecimate(series, maxN) {
  var n = series.t.length
  if (n <= maxN) return { t: series.t.slice(), ch1: series.ch1.slice(), ch2: series.ch2.slice() }
  var t = []
  var c1 = []
  var c2 = []
  var last = n - 1
  for (var i = 0; i < maxN; i++) {
    var idx = Math.round(i * last / (maxN - 1))
    t.push(series.t[idx])
    c1.push(series.ch1[idx])
    c2.push(series.ch2[idx])
  }
  return { t: t, ch1: c1, ch2: c2 }
}

function scopeVpp(xs) {
  if (!xs.length) return 0
  var lo = xs[0]
  var hi = xs[0]
  for (var i = 1; i < xs.length; i++) {
    if (xs[i] < lo) lo = xs[i]
    if (xs[i] > hi) hi = xs[i]
  }
  return hi - lo
}

function scopeRms(xs) {
  if (!xs.length) return 0
  var s = 0
  for (var i = 0; i < xs.length; i++) s += xs[i] * xs[i]
  return Math.sqrt(s / xs.length)
}

// Rising zero crossings, interpolated. One less than the count, over the time
// from the first rise to the last, is the frequency. Fewer than two rises → 0.
function scopeFreq(ts, xs) {
  if (xs.length < 2) return 0
  var rises = []
  for (var i = 1; i < xs.length; i++) {
    var a = xs[i - 1]
    var b = xs[i]
    if (!(a < 0 && b >= 0)) continue
    var den = b - a
    var frac = den !== 0 ? -a / den : 0
    if (frac < 0) frac = 0
    if (frac > 1) frac = 1
    rises.push(ts[i - 1] + (ts[i] - ts[i - 1]) * frac)
  }
  if (rises.length < 2) return 0
  var dur = rises[rises.length - 1] - rises[0]
  if (!(dur > 0)) return 0
  return (rises.length - 1) / dur
}

function fillScope(p, el, id, pv, state, work) {
  var gnd = pv[2] || 0
  var ch1 = (pv[0] || 0) - gnd
  var ch2 = (pv[1] || 0) - gnd
  var t = work && isFinite(work.t) ? work.t : 0
  var ring = scopeRing(state, id)
  scopePush(ring, t, ch1, ch2)
  var win = scopeWindow(ring, scopeSpan(el))
  p.samples = scopeDecimate(win, 600)
  p.vpp1 = scopeVpp(win.ch1)
  p.vpp2 = scopeVpp(win.ch2)
  p.vrms1 = scopeRms(win.ch1)
  p.freq1 = scopeFreq(win.t, win.ch1)
  var i1 = ch1 / 1e7
  var i2 = ch2 / 1e7
  p.current = i1
  p.power = Math.abs(i1 * ch1) + Math.abs(i2 * ch2)
  p.pinCurrents = [i1, i2, -(i1 + i2)]
}

function fillAc(p, el, pv, work) {
  var ac = acInstant(el, work && isFinite(work.t) ? work.t : 0)
  var vterm = (pv[0] || 0) - (pv[1] || 0)
  var iOut = (ac.volts - vterm) / ac.r
  p.current = -iOut
  p.power = Math.abs(iOut * vterm)
  p.volts = vterm
  p.vpeak = ac.vpeak
  p.freq = ac.freq
}

function fillSource(p, el, id, pv, warnings) {
  var vterm = (pv[0] || 0) - (pv[1] || 0)
  if (el.type === "battery9v") {
    var iOut = (9 - vterm) / 1.5
    p.current = -iOut
    p.power = Math.abs(iOut * vterm)
    if (shorted(el, vterm, iOut)) pushWarn(warnings, id, "danger", "The + and − of this battery are shorted. That can get very hot. Break the short.")
    return
  }
  if (el.type === "aaPack") {
    var cells = aaCells(el)
    var voc = cells * 1.5
    var r = Math.max(cells, 1) * 0.3
    var iPack = (voc - vterm) / r
    p.current = -iPack
    p.power = Math.abs(iPack * vterm)
    p.volts = vterm
    if (cells > 0 && shorted(el, vterm, iPack)) pushWarn(warnings, id, "danger", "The + and − of this battery pack are shorted. That can get very hot. Break the short.")
    return
  }
  var vset = clamp(num(el, "volts", 5), 0, 30)
  var limit = num(el, "currentLimit", 1)
  if (!(limit > 0)) limit = 0.01
  var iIf = (vset - vterm) / 0.05
  var limited = iIf > limit * 1.002 && vterm < vset - 0.01
  var iSup = limited ? limit : iIf
  p.current = -iSup
  p.power = Math.abs(iSup * vterm)
  p.volts = vterm
  p.limited = limited
  if (limited) pushWarn(warnings, id, "info", "The bench supply is at its current limit, so the voltage is lower than you set.")
  if (shorted(el, vterm, iSup)) pushWarn(warnings, id, "danger", "The + and − of this supply are shorted. That can get very hot. Break the short.")
}

function shorted(el, vterm, iOut) {
  if (el.nodes && el.nodes.length >= 2 && (el.nodes[0] | 0) === (el.nodes[1] | 0)) return true
  if (Math.abs(iOut) > 0.2 && Math.abs(vterm) / Math.abs(iOut) < 1) return true
  return false
}

function fillR(p, el, id, pv, state, nl, warnings) {
  var r = twoTermR(el)
  var v0 = pv[0] || 0
  var v1 = pv[1] || 0
  var i = (v0 - v1) / r
  p.current = i
  p.power = Math.abs(i * (v0 - v1))
  if (el.type === "resistor") {
    var hot = p.power > 0.25 ? (p.power - 0.25) / 0.25 : 0
    if (hot > 1) hot = 1
    p.hot = hot
    if (p.power > 0.25) pushWarn(warnings, id, "warn", "This resistor is over 1/4 watt, so it would get hot. A bigger value runs cooler.")
  }
  if (el.type === "buzzer") {
    var forward = (v0 - v1) > 2.5
    var backwards = (v1 - v0) > 2.5
    p.reversed = backwards
    p.on = forward && !backwards
    var plus = el.nodes && el.nodes.length ? (el.nodes[0] | 0) : -1
    var tone = buzzerTone(state, nl, plus)
    if (tone > 0) p.freq = tone
    else if (p.on) p.freq = 2300
    else p.freq = 0
    if (backwards) pushWarn(warnings, id, "warn", "This buzzer is in backwards: its + leg (marked +) needs the higher voltage. Turn it around (R).")
  }
  if (el.type === "motor") {
    var spin = i / 0.25
    spin = clamp(spin, -1, 1)
    state.spin[id] = spin
    p.spin = spin
  }
}

// A signal wire may pass through parts that are closed right now. One hop is
// one of those parts. Four hops is the limit, and the closest board pin wins.
function signalLink(adj, a, b) {
  if (a === b || a < 0 || b < 0) return
  if (!adj[a]) adj[a] = []
  if (!adj[b]) adj[b] = []
  adj[a].push(b)
  adj[b].push(a)
}

function signalAdj(nl, state) {
  var adj = {}
  if (!nl) return adj
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    var t = el.type
    if (t === "resistor") {
      var nr = pins(el, nl.nodeCount, 2)
      if (!nr) continue
      var ohms = num(el, "ohms", 220)
      if (!(ohms > 0)) ohms = 1e-3
      if (ohms <= 10000) signalLink(adj, nr[0], nr[1])
    } else if (t === "pushButton") {
      var nb = pins(el, nl.nodeCount, 2)
      if (!nb) continue
      if (el.props && (el.props.pressed === true || el.props.pressed === 1)) signalLink(adj, nb[0], nb[1])
    } else if (t === "tiltSwitch") {
      var nt = pins(el, nl.nodeCount, 2)
      if (!nt) continue
      if (el.props && (el.props.tilted === true || el.props.tilted === 1)) signalLink(adj, nt[0], nt[1])
    } else if (t === "slideSwitch") {
      var ns = pins(el, nl.nodeCount, 3)
      if (!ns) continue
      signalLink(adj, ns[1], num(el, "position", 0) >= 0.5 ? ns[2] : ns[0])
    } else if (t === "relay") {
      var nk = pins(el, nl.nodeCount, 5)
      if (!nk) continue
      var on = state && state.relayOn && state.relayOn[partId(el, i)] === true
      signalLink(adj, nk[2], on ? nk[3] : nk[4])
    }
  }
  return adj
}

function pinDrive(state, nl, node, kind) {
  if (!nl || node < 0) return null
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (!isBoard(el.type)) continue
    var map = boardMap(el)
    var slot = state && state.mcu && state.mcu[partId(el, i)]
    var srcPins = slot && slot.vm ? slot.vm.pins : null
    for (var p = 0; p < map.pins.length; p++) {
      if (map.pins[p] !== node) continue
      if (kind === "pin") return true
      if (!srcPins || !srcPins[p]) continue
      var src = srcPins[p]
      if (kind === "servo") {
        if (src.servo === null || src.servo === undefined) continue
        var ang = Number(src.servo)
        if (isFinite(ang)) return ang
      } else if (kind === "tone") {
        if (src.tone === null || src.tone === undefined) continue
        var hz = Number(src.tone)
        if (isFinite(hz) && hz > 0) return hz
      } else if (kind === "pwm") {
        if (src.pwm === null || src.pwm === undefined) continue
        var duty = Number(src.pwm)
        if (isFinite(duty)) return duty
      }
    }
  }
  return null
}

function nearestDrive(state, nl, start, kind) {
  if (!nl || typeof start !== "number" || start < 0) return null
  var direct = pinDrive(state, nl, start, kind)
  if (direct !== null) return direct
  var adj = signalAdj(nl, state)
  var seen = {}
  seen[start] = true
  var q = [start]
  var depth = [0]
  var qi = 0
  while (qi < q.length) {
    var node = q[qi]
    var hops = depth[qi]
    qi++
    if (hops >= 4) continue
    var next = adj[node]
    if (!next) continue
    for (var k = 0; k < next.length; k++) {
      var nb = next[k]
      if (seen[nb]) continue
      seen[nb] = true
      var hit = pinDrive(state, nl, nb, kind)
      if (hit !== null) return hit
      q.push(nb)
      depth.push(hops + 1)
    }
  }
  return null
}

function buzzerTone(state, nl, plusNode) {
  var hz = nearestDrive(state, nl, plusNode, "tone")
  return hz === null ? 0 : hz
}

function fillSwitch(p, el, pv) {
  var pos = num(el, "position", 0) >= 0.5 ? 1 : 0
  var a = pos === 0 ? 0 : 2
  var vCommon = pv[1] || 0
  var vA = pv[a] || 0
  var i = (vA - vCommon) / 0.05
  // Pin 0 is A. Current into A is nonzero only when the slider is on A.
  p.current = pos === 0 ? i : 0
  p.power = Math.abs(i * (vA - vCommon))
  var legs = [0, 0, 0]
  legs[a] = i
  legs[1] = -i
  p.pinCurrents = legs
}

function fillPot(p, el, pv) {
  var pot = potSections(el)
  var v0 = pv[0] || 0
  var v1 = pv[1] || 0
  var v2 = pv[2] || 0
  var i1 = (v0 - v1) / pot.r1
  var i2 = (v1 - v2) / pot.r2
  p.current = i1
  p.power = Math.abs(i1 * (v0 - v1)) + Math.abs(i2 * (v1 - v2))
  p.pinCurrents = [i1, i2 - i1, -i2]
}

function fillLed(p, el, id, pv, state, warnings) {
  var lp = ledParams(str(el, "color", "red"))
  var vd = (pv[0] || 0) - (pv[1] || 0)
  if (state.burnt[id]) {
    p.current = 0
    p.power = 0
    p.brightness = 0
    p.burnt = true
    pushWarn(warnings, id, "warn", "This LED burned out from too much current. Add a bigger resistor, then press Reset.")
    return
  }
  var s = shockley(clamp(vd, -5, lp.vf + 0.45), lp.is, lp.nVt)
  p.current = s.id
  p.power = Math.abs(s.id * vd)
  var bright = s.id / LED_INOM
  if (bright < 0) bright = 0
  if (bright > 1) bright = 1
  p.brightness = bright
  p.burnt = false
  if (s.id > LED_IMAX) {
    state.burnt[id] = true
    state.burnWhy[id] = "led"
    p.burnt = true
    p.brightness = 0
    pushWarn(warnings, id, "warn", "This LED burned out from too much current. Add a bigger resistor, then press Reset.")
  } else if (vd < -2 && s.id < 0.001) {
    pushWarn(warnings, id, "warn", "This LED is in backwards, so it stays dark. Current goes in the long leg and out the short leg.")
  }
}

function fillSeven(p, el, id, pv, state, warnings) {
  var names = ["a", "b", "c", "d", "e", "f", "g", "dp"]
  var lp = ledParams("red")
  var segs = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, dp: 0 }
  var common = pv[8] || 0
  var power = 0
  var i0 = 0
  var anyBurn = false
  var iSeg = []
  for (var i = 0; i < 8; i++) {
    var sid = id + ":" + names[i]
    if (state.burnt[sid]) {
      anyBurn = true
      iSeg.push(0)
      continue
    }
    var vd = (pv[i] || 0) - common
    var s = shockley(clamp(vd, -5, lp.vf + 0.45), lp.is, lp.nVt)
    if (s.id > LED_IMAX) {
      state.burnt[sid] = true
      state.burnWhy[sid] = "led"
      anyBurn = true
      iSeg.push(0)
      pushWarn(warnings, id, "warn", "Segment " + names[i] + " burned out from too much current. Add a resistor, then press Reset.")
    } else {
      var b = s.id / LED_INOM
      if (b < 0) b = 0
      if (b > 1) b = 1
      segs[names[i]] = b
      power += Math.abs(s.id * vd)
      iSeg.push(s.id)
      if (i === 0) i0 = s.id
      if (vd < -2 && s.id < 0.001) pushWarn(warnings, id, "warn", "Segment " + names[i] + " is in backwards, so it stays dark.")
    }
  }
  var iCommon = 0
  for (var j = 0; j < iSeg.length; j++) iCommon -= iSeg[j]
  iSeg.push(iCommon)
  p.current = i0
  p.power = power
  p.segments = segs
  p.burnt = anyBurn
  p.pinCurrents = iSeg
}

function fillRgb(p, el, id, pv, state, warnings) {
  var names = ["red", "green", "blue"]
  var an = [0, 2, 3]
  var bright = { r: 0, g: 0, b: 0 }
  var current0 = 0
  var power = 0
  var burnt = state.burnt[id] === true
  var over = false
  var iAn = [0, 0, 0]
  if (!burnt) {
    for (var c = 0; c < 3; c++) {
      var lp = ledParams(names[c])
      var vd = (pv[an[c]] || 0) - (pv[1] || 0)
      var s = shockley(clamp(vd, -5, lp.vf + 0.45), lp.is, lp.nVt)
      var b = s.id / LED_INOM
      if (b < 0) b = 0
      if (b > 1) b = 1
      bright[names[c] === "red" ? "r" : names[c] === "green" ? "g" : "b"] = b
      power += Math.abs(s.id * vd)
      iAn[c] = s.id
      if (c === 0) current0 = s.id
      if (s.id > LED_IMAX) over = true
    }
  }
  if (over) {
    state.burnt[id] = true
    state.burnWhy[id] = "led"
    burnt = true
    iAn = [0, 0, 0]
    current0 = 0
  }
  p.current = burnt ? 0 : current0
  p.power = burnt ? 0 : power
  p.brightness = burnt ? { r: 0, g: 0, b: 0 } : bright
  p.burnt = burnt
  p.pinCurrents = [iAn[0], -(iAn[0] + iAn[1] + iAn[2]), iAn[1], iAn[2]]
  if (burnt) pushWarn(warnings, id, "warn", "This LED burned out from too much current. Add a resistor on each color, then press Reset.")
}

function irLedParams() {
  var is = LED_INOM / (Math.exp(IR_VF / LED_NVT) - 1)
  return { vf: IR_VF, is: is, nVt: LED_NVT }
}

function benchIrBright(nl, v, state) {
  var maxB = 0
  var lp = irLedParams()
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (el.type !== "irLed") continue
    if (state.burnt[partId(el, i)]) continue
    var n = pins(el, nl.nodeCount, 2)
    if (!n) continue
    var vd = nodeV(v, n[0]) - nodeV(v, n[1])
    var s = shockley(clamp(vd, -5, lp.vf + 0.45), lp.is, lp.nVt)
    var b = s.id / LED_INOM
    if (b > maxB) maxB = b
  }
  if (maxB < 0) maxB = 0
  if (maxB > 1) maxB = 1
  return maxB
}

function photoLight(el, work) {
  var light = num(el, "light", 0.5)
  if (!(light >= 0)) light = 0
  if (light > 1) light = 1
  var extra = work && work.irBright ? 0.5 * work.irBright : 0
  return light + extra
}

function fillFuse(p, el, id, pv, state, dt, warnings) {
  var v0 = pv[0] || 0
  var v1 = pv[1] || 0
  if (state.burnt[id]) {
    p.current = 0
    p.power = 0
    p.burnt = true
    pushWarn(warnings, id, "warn", FUSE_MSG)
    return
  }
  var i = (v0 - v1) / FUSE_R
  p.current = i
  p.power = Math.abs(i * (v0 - v1))
  p.burnt = false
  var amps = num(el, "amps", 0.5)
  if (!(amps > 0)) amps = 0.5
  var absI = Math.abs(i)
  if (dt > 0 && absI > amps) state.fuse[id] = (state.fuse[id] || 0) + dt
  var held = (state.fuse[id] || 0) > FUSE_HOLD
  if (absI >= amps * 3 || (dt > 0 && held)) {
    state.burnt[id] = true
    state.burnWhy[id] = "fuse"
    p.burnt = true
    pushWarn(warnings, id, "warn", FUSE_MSG)
  }
}

function fillSchottky(p, pv) {
  var vd = (pv[0] || 0) - (pv[1] || 0)
  var s = shockley(clamp(vd, -20, 1.5), SCHOTTKY_IS, SCHOTTKY_NVT)
  p.current = s.id
  p.power = Math.abs(s.id * vd)
}

function fillBridge(p, pv) {
  var node = []
  for (var k = 0; k < 4; k++) node.push(pv[k] || 0)
  var pair = [[0, 2], [1, 2], [3, 0], [3, 1]]
  var idio = []
  var power = 0
  for (var i = 0; i < 4; i++) {
    var vd = node[pair[i][0]] - node[pair[i][1]]
    var cur = shockley(clamp(vd, -20, 1.5), DIODE_IS, DIODE_NVT).id
    idio.push(cur)
    power += Math.abs(cur * vd)
  }
  p.current = idio[0] - idio[2]
  p.power = power
  p.pinCurrents = [idio[0] - idio[2], idio[1] - idio[3], -(idio[0] + idio[1]), idio[2] + idio[3]]
}

function fillIrLed(p, el, id, pv, state, warnings) {
  var lp = irLedParams()
  var vd = (pv[0] || 0) - (pv[1] || 0)
  p.invisible = true
  if (state.burnt[id]) {
    p.current = 0
    p.power = 0
    p.brightness = 0
    p.burnt = true
    pushWarn(warnings, id, "warn", "This IR LED burned out from too much current. Add a bigger resistor, then press Reset.")
    return
  }
  var s = shockley(clamp(vd, -5, lp.vf + 0.45), lp.is, lp.nVt)
  p.current = s.id
  p.power = Math.abs(s.id * vd)
  var bright = s.id / LED_INOM
  if (bright < 0) bright = 0
  if (bright > 1) bright = 1
  p.brightness = bright
  p.burnt = false
  if (s.id > IR_IMAX) {
    state.burnt[id] = true
    state.burnWhy[id] = "ir"
    p.burnt = true
    p.brightness = 0
    pushWarn(warnings, id, "warn", "This IR LED burned out from too much current. Add a bigger resistor, then press Reset.")
  }
}

function fillPhoto(p, el, pv, work) {
  var vd = (pv[0] || 0) - (pv[1] || 0)
  var s = shockley(clamp(vd, -20, 1.5), DIODE_IS, DIODE_NVT)
  var iph = PHOTO_I * photoLight(el, work)
  p.current = s.id - iph
  p.power = Math.abs(p.current * vd)
  p.light = photoLight(el, work)
}

function fillDiode(p, pv) {
  var vd = (pv[0] || 0) - (pv[1] || 0)
  var s = shockley(clamp(vd, -20, 1.5), DIODE_IS, DIODE_NVT)
  p.current = s.id
  p.power = Math.abs(s.id * vd)
}

function fillZener(p, el, pv) {
  var vz = num(el, "zenerVolts", 5.1)
  if (!(vz > 0.1)) vz = 5.1
  var vd = (pv[0] || 0) - (pv[1] || 0)
  vd = clamp(vd, -(vz + 0.4), 1.5)
  var fwd = shockley(vd, DIODE_IS, DIODE_NVT)
  var rev = shockley(-vd - vz, ZENER_IS, ZENER_NVT)
  var id = fwd.id - rev.id
  p.current = id
  p.power = Math.abs(id * ((pv[0] || 0) - (pv[1] || 0)))
}

function fillBjt(p, el, pv) {
  var ve = pv[0] || 0
  var vb = pv[1] || 0
  var vc = pv[2] || 0
  var beta = num(el, "beta", 150)
  var ev, vbe, vce
  if (el.type === "npn") {
    vbe = clamp(vb - ve, -5, 1.05)
    var vbc = clamp(vb - vc, -5, 1.05)
    ev = bjtEval(vbe, vbc, beta)
    vce = vc - ve
    p.current = ev.ie
    p.collectorCurrent = ev.ic
    p.state = bjtState(vbe, vce, ev.ic)
  } else {
    var veb = clamp(ve - vb, -5, 1.05)
    var vcb = clamp(vc - vb, -5, 1.05)
    var raw = bjtEval(veb, vcb, beta)
    ev = { ie: -raw.ie, ib: -raw.ib, ic: -raw.ic }
    vce = ve - vc
    p.current = ev.ie
    p.collectorCurrent = ev.ic
    p.state = bjtState(veb, vce, -ev.ic)
  }
  p.power = Math.abs(ve * ev.ie + vb * ev.ib + vc * ev.ic)
  p.pinCurrents = [ev.ie, ev.ib, ev.ic]
}

function bjtState(vbe, vce, icForward) {
  if (vbe < 0.45 && Math.abs(icForward) < 1e-5) return "off"
  if (vce < 0.3 && Math.abs(icForward) > 1e-5) return "saturated"
  if (vbe < 0.45) return "off"
  return "active"
}

function fillMos(p, pv) {
  var vs = pv[0] || 0
  var vg = pv[1] || 0
  var vd = pv[2] || 0
  var vgs = vg - vs
  var vds = vd - vs
  var m = mosLaw(clamp(vgs, -5, 20), clamp(vds, -5, 40))
  var bd = shockley(clamp(vs - vd, -20, 1.5), DIODE_IS, DIODE_NVT)
  var idDrain = m.id - bd.id
  p.current = -idDrain
  p.collectorCurrent = idDrain
  p.pinCurrents = [-idDrain, 0, idDrain]
  p.power = Math.abs(idDrain * (vd - vs))
  if (vgs < MOS_VTH && Math.abs(idDrain) < 1e-4) p.state = "off"
  else if (vgs >= MOS_VTH && vds < (vgs - MOS_VTH) && Math.abs(idDrain) > 1e-5) p.state = "saturated"
  else if (Math.abs(idDrain) < 1e-5) p.state = "off"
  else p.state = "active"
}

function indStored(state, id) {
  var i = state.indI[id]
  return typeof i === "number" && isFinite(i) ? i : 0
}

function stampTransformer(sys, src) {
  var ratio = src.ratio
  stampG(sys, src.p1, src.p2, 1e-6)
  var k = sys.extra++
  src.k = k
  var ip1 = uiOf(sys, src.p1)
  var ip2 = uiOf(sys, src.p2)
  var is1 = uiOf(sys, src.s1)
  var is2 = uiOf(sys, src.s2)
  // i leaves P1 and enters P2. ratio*i comes out of S1 and returns into S2,
  // so Vs = Vp/ratio and the power balances. 0.5 Ω sits on the secondary.
  if (ip1 >= 0) { sys.A[ip1][k] += 1; sys.A[k][ip1] += 1 }
  if (ip2 >= 0) { sys.A[ip2][k] -= 1; sys.A[k][ip2] -= 1 }
  if (is1 >= 0) { sys.A[is1][k] -= ratio; sys.A[k][is1] -= ratio }
  if (is2 >= 0) { sys.A[is2][k] += ratio; sys.A[k][is2] += ratio }
  sys.A[k][k] -= 0.5 * ratio * ratio
}

var RELAY_SPIKE = "The relay coil spiked below -20 V when it turned off. Put a diode across the coil, stripe toward +."

function fillTimer(p, id, pv, state) {
  var tm = state.timer && state.timer[id]
  var q = tm && tm.q === 1
  var vgnd = pv[0] || 0
  var vout = pv[2] || 0
  var vreset = pv[3] || 0
  var vctrl = pv[4] || 0
  var vdis = pv[6] || 0
  var vvcc = pv[7] || 0
  var i5 = (vvcc - vctrl) / 5000
  var i10 = (vctrl - vgnd) / 10000
  var ipu = (vvcc - vreset) / 100000
  var iOut = q ? (vout - vvcc + 1.5) / 10 : (vout - vgnd - 0.1) / 10
  var iDis = q ? 0 : (vdis - vgnd) / 10
  var iGnd = i10 + (q ? 0 : (-iOut - iDis))
  var iVcc = -i5 - ipu + (q ? -iOut : 0)
  p.current = iGnd
  p.out = q ? 1 : 0
  p.freq = 0
  if (tm && tm.rises && tm.rises.length >= 2) {
    var last = tm.rises[tm.rises.length - 1]
    var prev = tm.rises[tm.rises.length - 2]
    if (last > prev) p.freq = 1 / (last - prev)
  }
  p.power = Math.abs(iOut * (vout - vgnd))
  p.pinCurrents = [iGnd, 0, iOut, ipu, i5 - i10, 0, iDis, iVcc]
}

function fillOpamp(p, pv) {
  var vn = pv[2] || 0
  var vd = (pv[1] || 0) - (pv[0] || 0)
  var unlimited = OP_GAIN * vd
  var lower = vn + 0.05
  var upper = (pv[3] || 0) - 1.5
  if (upper < lower) upper = lower
  var target = unlimited
  if (target > upper) target = upper
  if (target < lower) target = lower
  var iOut = ((pv[4] || 0) - target) / OP_ROUT
  var iInm = ((pv[0] || 0) - vn) / 1e7
  var iInp = ((pv[1] || 0) - vn) / 1e7
  p.current = iInm
  p.out = pv[4] || 0
  p.saturated = unlimited > upper + 1e-3 || unlimited < lower - 1e-3
  p.power = Math.abs(iOut * (pv[4] || 0))
  p.pinCurrents = [iInm, iInp, -iOut - iInm - iInp, 0, iOut]
}

function fillRegulator(p, id, pv, warnings) {
  var vin = (pv[0] || 0) - (pv[1] || 0)
  var vout = (pv[2] || 0) - (pv[1] || 0)
  var target = vin - 2
  if (target > 5) target = 5
  if (target < 0) target = 0
  var iOut = (vout - target) / 0.1
  var iIn = -iOut + 0.005
  var iGnd = -0.005
  p.current = iIn
  p.volts = vout
  p.dropout = vin < 7
  p.power = Math.abs((pv[0] || 0) * iIn + (pv[1] || 0) * iGnd + (pv[2] || 0) * iOut)
  p.pinCurrents = [iIn, iGnd, iOut]
  if (vin < 7) pushWarn(warnings, id, "warn", REG_LOW)
  if (Math.abs(iOut) > 1) pushWarn(warnings, id, "warn", REG_HOT)
}

function fillRelay(p, el, id, pv, state, dt, warnings) {
  var coil = (pv[0] || 0) - (pv[1] || 0)
  var rc = num(el, "coilOhms", 70)
  if (!(rc > 0)) rc = 70
  var i
  if (dt > 0) {
    var geq = 1 / (rc + 0.01 / dt)
    var ihist = indStored(state, id) * (0.01 / dt) * geq
    i = geq * coil + ihist
  } else {
    i = coil / rc
  }
  p.current = i
  p.coilV = coil
  p.on = state.relayOn[id] === true
  p.power = Math.abs(i * coil)
  if (isFinite(i)) state.indI[id] = i
  var rNo = p.on ? 0.05 : 1e9
  var rNc = p.on ? 1e9 : 0.05
  var vCom = pv[2] || 0
  var iNo = (vCom - (pv[3] || 0)) / rNo
  var iNc = (vCom - (pv[4] || 0)) / rNc
  p.pinCurrents = [i, -i, iNo + iNc, -iNo, -iNc]
  if (coil < -20) pushWarn(warnings, id, "warn", RELAY_SPIKE)
}

function fillInductor(p, el, id, pv, state, dt) {
  var v = (pv[0] || 0) - (pv[1] || 0)
  var henries = num(el, "henries", 0.01)
  if (!(henries > 0)) henries = 0
  var i
  if (henries > 0 && dt > 0) {
    var geq = 1 / (0.5 + henries / dt)
    var ihist = indStored(state, id) * (henries / dt) * geq
    i = geq * v + ihist
  } else {
    i = v / 0.5
  }
  p.current = i
  p.power = Math.abs(i * v)
  if (isFinite(i)) state.indI[id] = i
}

function fillTransformer(p, el, pv) {
  var ratio = num(el, "ratio", 10)
  if (!(ratio > 0)) ratio = 10
  var vp = (pv[0] || 0) - (pv[1] || 0)
  var vs = (pv[2] || 0) - (pv[3] || 0)
  var isec = (vp / ratio - vs) / 0.5
  var ipri = isec / ratio
  var imag = vp * 1e-6
  var i1 = ipri + imag
  p.current = i1
  p.volts = vs
  p.power = Math.abs(imag * vp) + isec * isec * 0.5
  // Secondary current leaves S1, so the current entering that pin is negative.
  p.pinCurrents = [i1, -i1, -isec, isec]
}

function fillCap(p, el, id, pv, state, dt, warnings) {
  var v0 = pv[0] || 0
  var v1 = pv[1] || 0
  var vcap = v0 - v1
  var prev = capStored(state, id)
  var farads = num(el, "farads", el.type === "electrolytic" ? 1e-4 : 1e-7)
  var i = 0
  if (!state.burnt[id] && farads > 0 && dt > 0) {
    var g = farads / dt
    if (g > 1e7) g = 1e7
    i = g * (vcap - prev)
  }
  p.current = state.burnt[id] ? 0 : i
  p.power = Math.abs(p.current * vcap)
  if (isFinite(vcap) && Math.abs(vcap) < 200) state.capV[id] = vcap
  if (el.type !== "electrolytic") return
  p.burnt = state.burnt[id] === true
  if (p.burnt) {
    var why = state.burnWhy[id]
    pushWarn(warnings, id, "warn", why === "over"
      ? "This capacitor has more volts across it than it is rated for. Press Reset after you swap it."
      : "This capacitor is in backwards. The stripe (−) goes to the negative side. Press Reset after you turn it around.")
    return
  }
  var rated = num(el, "ratedVolts", 16)
  if (!(rated > 0)) rated = 16
  if (vcap < -1) {
    state.burnt[id] = true
    state.burnWhy[id] = "rev"
    p.burnt = true
    pushWarn(warnings, id, "warn", "This capacitor is in backwards. The stripe (−) goes to the negative side. Press Reset after you turn it around.")
  } else if (vcap > rated) {
    state.burnt[id] = true
    state.burnWhy[id] = "over"
    p.burnt = true
    pushWarn(warnings, id, "warn", "This capacitor has more volts across it than it is rated for. Press Reset after you swap it.")
  } else {
    p.burnt = false
  }
}

function fillMeter(p, el, id, pv, nl, warnings) {
  var mode = str(el, "mode", "V")
  var vred = pv[0] || 0
  var vblk = pv[1] || 0
  var powered = isPowered(nl)
  if (mode === "A") {
    var i = (vred - vblk) / METER_R
    p.current = i
    p.value = i
    p.power = Math.abs(i * (vred - vblk))
    p.reading = fmt(i, "A")
    if (bridgesSupply(nl, el)) pushWarn(warnings, id, "danger", "This meter is in A mode straight across the supply, which shorts it. A mode goes in line with the parts. Use V to measure across a part.")
    return
  }
  if (mode === "Ω") {
    p.current = 0
    p.power = 0
    if (powered) {
      p.value = NaN
      p.reading = "Power on!"
      pushWarn(warnings, id, "warn", "This meter is set to ohms while the circuit is powered. Ohms only works with the power off.")
      return
    }
    var r = (vred - vblk) / OHM_I
    if (!isFinite(r) || r < 0 || r > 2e7) {
      p.value = r > 2e7 ? r : NaN
      p.reading = "OL"
    } else {
      p.value = r
      p.reading = fmt(r, "Ω")
    }
    return
  }
  var volts = vred - vblk
  p.current = 0
  p.power = 0
  p.value = volts
  p.reading = fmt(volts, "V")
}

function fillTmp(p, el, id, pv, work, warnings) {
  var vPlus = pv[0] || 0
  var vOut = pv[1] || 0
  var vGnd = pv[2] || 0
  var vsup = vPlus - vGnd
  var on = vsup > 2.6
  var bias = on || vsup > 0.2 ? 50e-6 : 0
  var iOut = 0
  if (work && work.tmpOn && work.tmpOn[id]) {
    var vset = 0.5 + 0.01 * num(el, "celsius", 25)
    iOut = (vOut - vGnd - vset) / 100
  }
  p.current = bias
  p.power = Math.abs(bias * vsup)
  p.pinCurrents = [bias, iOut, -(bias + iOut)]
  if (!on) pushWarn(warnings, id, "info", "This temperature probe needs at least 2.7 V from +V to GND before its output means anything.")
}

function bridgesSupply(nl, meter) {
  if (!meter.nodes || meter.nodes.length < 2) return false
  var a = meter.nodes[0] | 0
  var b = meter.nodes[1] | 0
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    var t = el.type
    if (t !== "battery9v" && t !== "aaPack" && t !== "benchSupply") continue
    if (!el.nodes || el.nodes.length < 2) continue
    var p = el.nodes[0] | 0
    var m = el.nodes[1] | 0
    if ((p === a && m === b) || (p === b && m === a)) return true
  }
  return false
}

function pushWarn(list, part, level, message) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].part === part && list[i].message === message) return
  }
  list.push({ part: part || "", level: level, message: message })
}

function fmt(v, unit) {
  if (!isFinite(v)) return "– – –"
  var sign = v < 0 ? "-" : ""
  var a = Math.abs(v)
  if (unit === "V") {
    if (a >= 100) return sign + a.toFixed(0) + " V"
    if (a >= 1) return sign + trimNum(a.toFixed(2)) + " V"
    if (a >= 1e-3) return sign + trimNum((a * 1000).toFixed(1)) + " mV"
    return "0 V"
  }
  if (unit === "A") {
    if (a >= 1) return sign + trimNum(a.toFixed(2)) + " A"
    if (a >= 1e-3) return sign + trimNum((a * 1000).toFixed(1)) + " mA"
    if (a >= 1e-6) return sign + trimNum((a * 1e6).toFixed(0)) + " µA"
    return "0 A"
  }
  if (a >= 1e6) return sign + trimNum((a / 1e6).toFixed(2)) + " MΩ"
  if (a >= 1e3) return sign + trimNum((a / 1e3).toFixed(2)) + " kΩ"
  if (a >= 1) return sign + trimNum(a.toFixed(1)) + " Ω"
  return sign + trimNum(a.toFixed(2)) + " Ω"
}

function trimNum(s) {
  if (s.indexOf(".") < 0) return s
  return s.replace(/0+$/, "").replace(/\.$/, "")
}

// ---------------------------------------------------------------------------
// Boards. Each element id keeps its own VM, rebuilt only when the sketch
// text or the board type changes. Each dt > 0 solve stamps the current pins,
// then runs that sketch forward by dt. The new pin levels are what the next
// solve stamps. omaNano uses the OmaDuino rails. omaTiny has no regulator:
// it runs only while VCC − GND is between 2.7 V and 5.5 V, and a HIGH output
// drives to VCC through 25 Ω.

function boardProfile(type) {
  var fallback = type === "omaTiny"
    ? { pins: 5, pwm: { 0: true, 1: true, 4: true }, analog: { 1: 2, 2: 4, 3: 3 }, serial: false }
    : { pins: 20, pwm: { 3: true, 5: true, 6: true, 9: true, 10: true, 11: true }, analog: null, serial: true }
  if (typeof Catalog === "undefined" || !Catalog.mcuProfile) return fallback
  try {
    var profile = Catalog.mcuProfile(type)
    if (profile && profile.pins > 0) return profile
  } catch (err) {}
  return fallback
}

function makeBoard(program, type) {
  var profile = boardProfile(type)
  try {
    return Mcu.create(program, profile)
  } catch (err) {
    return Mcu.create(program)
  }
}

function tinyRail(map, v) {
  if (!map || !map.tiny || !v || map.vcc < 0 || map.gnd < 0) return 0
  return nodeV(v, map.vcc) - nodeV(v, map.gnd)
}

function tinyOk(rail) {
  return rail >= 2.7 && rail <= 5.5
}

function pinPwm(pin) {
  if (!pin || pin.pwm === null || pin.pwm === undefined) return false
  return isFinite(Number(pin.pwm))
}

function syncBoards(nl, state) {
  if (!state.mcu) state.mcu = {}
  var live = {}
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (!isBoard(el.type)) continue
    var id = partId(el, i)
    live[id] = true
    var code = el.props && el.props.code ? String(el.props.code) : ""
    var slot = state.mcu[id]
    if (slot && slot.code === code && slot.type === el.type) continue
    if (!code) {
      state.mcu[id] = { code: "", type: el.type, vm: null, error: "", errorLine: 0 }
      continue
    }
    var compiled = Mcu.compile(code)
    if (!compiled || !compiled.ok) {
      var err = compiled && compiled.errors && compiled.errors[0] ? compiled.errors[0] : { line: 1, message: "This sketch didn't compile." }
      state.mcu[id] = { code: code, type: el.type, vm: null, error: String(err.message || "This sketch didn't compile."), errorLine: err.line || 1 }
    } else {
      state.mcu[id] = { code: code, type: el.type, vm: makeBoard(compiled.program, el.type), error: "", errorLine: 0 }
    }
  }
  for (var k in state.mcu) if (!live[k]) delete state.mcu[k]
}

function boardMap(el) {
  var profile = boardProfile(el && el.type)
  var count = profile.pins > 0 ? profile.pins : 20
  var map = []
  for (var i = 0; i < count; i++) map.push(-1)
  var gnd = -1
  var gnds = []
  var v5 = -1
  var v33 = -1
  var vcc = -1
  var nodes = el && el.nodes ? el.nodes : []
  var type = el && el.type
  for (var n = 0; n < nodes.length; n++) {
    var node = nodes[n]
    if (typeof node !== "number" || !isFinite(node)) continue
    node = node | 0
    var name = (typeof Catalog !== "undefined" && Catalog.mcuPinNumber) ? Catalog.mcuPinNumber(n, type) : null
    if (name === "gnd") {
      gnds.push(node)
      if (gnd < 0) gnd = node
    } else if (name === "5v") v5 = node
    else if (name === "3v3") v33 = node
    else if (name === "vcc") vcc = node
    else if (typeof name === "number" && name >= 0 && name < count) map[name] = node
  }
  return { gnd: gnd, gnds: gnds, v5: v5, v33: v33, vcc: vcc, pins: map, tiny: !!(el && el.type === "omaTiny"), count: count }
}

function boardPlan(el, state, id, v) {
  var map = boardMap(el)
  var slot = state.mcu && state.mcu[id]
  var pinStates = slot && slot.vm ? slot.vm.pins : null
  var rail = map.tiny ? tinyRail(map, v) : 5
  var run = map.tiny ? tinyOk(rail) : map.gnd >= 0
  var outputs = []
  if (run) {
    if (!map.tiny) {
      if (map.v5 >= 0) outputs.push({ kind: "rail5" })
      if (map.v33 >= 0) outputs.push({ kind: "rail33" })
    }
    for (var p = 0; p < map.pins.length; p++) {
      if (map.pins[p] < 0) continue
      var mode = pinStates && pinStates[p] ? pinStates[p].mode : "in"
      if (mode === "out") outputs.push({ kind: "gpio", pin: p })
    }
  }
  return { kind: "board", id: id, map: map, outputs: outputs, pinStates: pinStates, rail: rail, run: run }
}

function gpioVolts(pin, rail) {
  if (!pin) return 0
  if (!(rail > 0)) rail = 5
  if (pin.pwm !== null && pin.pwm !== undefined) {
    var duty = Number(pin.pwm)
    if (isFinite(duty)) {
      if (duty < 0) duty = 0
      if (duty > 255) duty = 255
      return rail * duty / 255
    }
  }
  return pin.level ? rail : 0
}

function gpioName(p, tiny) {
  if (tiny) return "PB" + p
  if (p >= 14) return "A" + (p - 14)
  return "D" + p
}

function stampBoard(sys, src) {
  var map = src.map
  var gnd = map.gnd
  if (gnd < 0) return
  for (var g = 0; g < map.gnds.length; g++) stampG(sys, map.gnds[g], gnd, 1 / 0.05)
  if (!src.run) {
    for (var q = 0; q < map.pins.length; q++) {
      if (map.pins[q] < 0) continue
      stampG(sys, map.pins[q], gnd, 1 / 1e7)
    }
    return
  }
  var pins = src.pinStates
  var rail = map.tiny ? src.rail : 5
  for (var i = 0; i < src.outputs.length; i++) {
    var o = src.outputs[i]
    if (o.kind === "rail5") stampVsrc(sys, map.v5, gnd, 5, 0.2)
    else if (o.kind === "rail33") stampVsrc(sys, map.v33, gnd, 3.3, 1)
    else if (map.tiny && map.vcc >= 0 && !pinPwm(pins && pins[o.pin])) {
      if (pins && pins[o.pin] && pins[o.pin].level) stampVsrc(sys, map.pins[o.pin], map.vcc, 0, 25)
      else stampVsrc(sys, map.pins[o.pin], gnd, 0, 25)
    } else stampVsrc(sys, map.pins[o.pin], gnd, gpioVolts(pins && pins[o.pin], rail), 25)
  }
  for (var p = 0; p < map.pins.length; p++) {
    var node = map.pins[p]
    if (node < 0) continue
    var pin = pins && pins[p] ? pins[p] : null
    var mode = pin && pin.mode ? pin.mode : "in"
    if (mode === "out") continue
    if (mode === "pullup" && map.v5 >= 0) stampG(sys, node, map.v5, 1 / 35000)
    else if (mode === "pullup" && map.vcc >= 0) stampG(sys, node, map.vcc, 1 / 35000)
    else stampG(sys, node, gnd, 1 / 1e7)
  }
}

function fillBoard(p, el, id, pv, state, v, warnings) {
  var map = boardMap(el)
  var slot = state.mcu && state.mcu[id]
  var gndV = map.gnd >= 0 ? nodeV(v, map.gnd) : 0
  var rail = map.tiny ? tinyRail(map, v) : 5
  var powered = map.tiny ? tinyOk(rail) : true
  var i5 = 0
  var i33 = 0
  if (!map.tiny && map.v5 >= 0 && map.gnd >= 0) {
    var v5 = nodeV(v, map.v5) - gndV
    i5 = (5 - v5) / 0.2
    if (i5 > 0.5) pushWarn(warnings, id, "warn", "The 5V pin is past its 0.5 A limit.")
  }
  if (!map.tiny && map.v33 >= 0 && map.gnd >= 0) {
    var v33 = nodeV(v, map.v33) - gndV
    i33 = (3.3 - v33) / 1
    if (i33 > 0.05) pushWarn(warnings, id, "warn", "The 3.3V pin is past its 0.05 A limit.")
  }
  if (map.tiny && map.vcc >= 0 && map.gnd >= 0 && rail > 6) pushWarn(warnings, id, "warn", TINY_VOLT)
  var srcPins = slot && slot.vm ? slot.vm.pins : null
  var pins = []
  var iGpio = 0
  for (var i = 0; i < map.pins.length; i++) {
    var src = srcPins && srcPins[i] ? srcPins[i] : { mode: "in", level: 0, pwm: null, servo: null, tone: null }
    pins.push({
      mode: src.mode || "in",
      level: src.level ? 1 : 0,
      pwm: src.pwm === undefined ? null : src.pwm,
      servo: src.servo === undefined ? null : src.servo,
      tone: src.tone === undefined ? null : src.tone
    })
    if (powered && src.mode === "out" && map.pins[i] >= 0 && map.gnd >= 0) {
      var ideal = gpioVolts(src, map.tiny ? rail : 5)
      var iPin = (ideal - (nodeV(v, map.pins[i]) - gndV)) / 25
      iGpio += iPin
      var ma = Math.abs(iPin) * 1000
      if (ma > 40) pushWarn(warnings, id, "warn", "Pin " + gpioName(i, map.tiny) + " is giving " + Math.round(ma) + " mA; add a resistor (220 Ω for an LED).")
      var node = map.pins[i]
      var shorted = node === map.gnd || (!map.tiny && map.v5 >= 0 && node === map.v5) || (map.tiny && map.vcc >= 0 && node === map.vcc)
      if (shorted) {
        var shortTo = node === map.gnd ? "GND" : (map.tiny ? "VCC" : "5V")
        pushWarn(warnings, id, "danger", "Pin " + gpioName(i, map.tiny) + " is shorted straight to " + shortTo + ".")
      }
    }
  }
  p.pins = pins
  p.serial = slot && slot.vm && slot.vm.serial ? String(slot.vm.serial) : ""
  p.serialActive = false
  p.error = slot && slot.error ? slot.error : ""
  p.errorLine = slot && slot.error ? (slot.errorLine || 0) : 0
  if (slot && slot.vm && slot.vm.error) {
    p.error = slot.vm.error
    p.errorLine = slot.vm.errorLine || 0
  }
  p.running = !!(slot && slot.vm && !p.error) && powered
  p.current = i5 + i33 + iGpio
  p.power = 0
  p.pinCurrents = boardPinCurrents(el, map, srcPins, v, gndV, i5, i33, powered)
}

function boardPinCurrents(el, map, srcPins, v, gndV, i5, i33, powered) {
  var nodes = el && el.nodes ? el.nodes : []
  var into = []
  var gndHeader = []
  var v5Header = -1
  var vccHeader = -1
  var headerOf = []
  var count = map.pins.length
  var type = el && el.type
  for (var s = 0; s < count; s++) headerOf.push(-1)
  for (var h = 0; h < nodes.length; h++) {
    into.push(0)
    var name = (typeof Catalog !== "undefined" && Catalog.mcuPinNumber) ? Catalog.mcuPinNumber(h, type) : null
    if (name === "gnd") gndHeader.push(h)
    else if (name === "5v") v5Header = h
    else if (name === "vcc") vccHeader = h
    else if (typeof name === "number" && name >= 0 && name < count) headerOf[name] = h
  }
  if (map.gnd < 0) return into
  var rail = map.tiny ? tinyRail(map, v) : 5
  if (!map.tiny && v5Header >= 0 && map.v5 >= 0) into[v5Header] = -i5
  for (var h3 = 0; h3 < nodes.length; h3++) {
    var name3 = (typeof Catalog !== "undefined" && Catalog.mcuPinNumber) ? Catalog.mcuPinNumber(h3, type) : null
    if (name3 === "3v3" && map.v33 >= 0 && !map.tiny) into[h3] = -i33
  }
  for (var p = 0; p < count; p++) {
    var header = headerOf[p]
    if (header < 0 || map.pins[p] < 0) continue
    var src = srcPins && srcPins[p] ? srcPins[p] : null
    var mode = src && src.mode ? src.mode : "in"
    var vpin = nodeV(v, map.pins[p])
    if (mode === "out" && powered) {
      var iExt = -((gpioVolts(src, map.tiny ? rail : 5) - (vpin - gndV)) / 25)
      into[header] = iExt
      if (map.tiny && src && src.level && !pinPwm(src) && vccHeader >= 0) into[vccHeader] -= iExt
    } else if (mode === "pullup" && powered && map.v5 >= 0) {
      var iPull = (vpin - nodeV(v, map.v5)) / 35000
      into[header] = iPull
      if (v5Header >= 0) into[v5Header] -= iPull
    } else if (mode === "pullup" && powered && map.vcc >= 0) {
      var iPullT = (vpin - nodeV(v, map.vcc)) / 35000
      into[header] = iPullT
      if (vccHeader >= 0) into[vccHeader] -= iPullT
    } else {
      into[header] = (vpin - gndV) / 1e7
    }
  }
  if (gndHeader.length) {
    var first = gndHeader[0]
    var vFirst = nodeV(v, nodes[first] | 0)
    for (var g = 1; g < gndHeader.length; g++) {
      var hx = gndHeader[g]
      var node = nodes[hx]
      if (typeof node !== "number" || !isFinite(node)) continue
      into[hx] += (nodeV(v, node | 0) - vFirst) / 0.05
    }
    var others = 0
    for (var u = 0; u < into.length; u++) if (u !== first) others += into[u]
    into[first] = -others
  }
  return into
}

function runBoards(nl, state, result, v, dt) {
  var stepUs = Math.round(dt * 1e6)
  if (stepUs < 1) stepUs = 1
  var answered = {}
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (!isBoard(el.type)) continue
    var id = partId(el, i)
    var slot = state.mcu && state.mcu[id]
    if (!slot || !slot.vm || slot.error) continue
    var map = boardMap(el)
    if (map.tiny && !tinyOk(tinyRail(map, v))) continue
    var before = slot.vm.serial ? String(slot.vm.serial) : ""
    var count = map.pins.length
    slot.vm.run(slot.vm.time + stepUs, {
      volts: function (pin) {
        pin = pin | 0
        if (pin < 0 || pin >= count || map.gnd < 0) return 0
        var node = map.pins[pin]
        if (node < 0) return 0
        return nodeV(v, node) - nodeV(v, map.gnd)
      },
      pulseIn: function (pin) {
        return sonarEchoUs(nl, v, map, pin, answered, state)
      }
    })
    copyBoardRuntime(result.parts[id], slot, before)
  }
  markSonarPings(result, answered)
}

// VCC, TRIG, ECHO, GND. The echo pin stays at 0 V. pulseIn returns the
// travel time directly, so the sound pulse is not a circuit transient.
function sonarNodes(el, nodeCount) {
  if (!el) return null
  var base = -1
  var dflt = 30
  if (el.type === "hcsr04") { base = 0; dflt = 30 }
  else if (el.type === "robotCar") { base = 4; dflt = 100 }
  else return null
  var n = pins(el, nodeCount, base + 4)
  if (!n) return null
  var cm = num(el, "distance", dflt)
  if (cm < 0) cm = 0
  return { vcc: n[base], trig: n[base + 1], echo: n[base + 2], gnd: n[base + 3], distance: cm }
}

function fillCar(p, el, id, v, warnings) {
  var n = pins(el, v.length, 8)
  p.leftSpin = 0
  p.rightSpin = 0
  p.pinging = false
  p.pinCurrents = [0, 0, 0, 0, 0, 0, 0, 0]
  if (!n) return
  var iL = (nodeV(v, n[0]) - nodeV(v, n[1])) / 10
  var iR = (nodeV(v, n[2]) - nodeV(v, n[3])) / 10
  p.current = iL
  p.power = Math.abs(iL * (nodeV(v, n[0]) - nodeV(v, n[1]))) + Math.abs(iR * (nodeV(v, n[2]) - nodeV(v, n[3])))
  p.leftSpin = clamp(iL / 0.25, -1, 1)
  p.rightSpin = clamp(iR / 0.25, -1, 1)
  var ns = sonarNodes(el, v.length)
  var iV = 0
  var iT = 0
  var iE = 0
  if (ns) {
    var vg = nodeV(v, ns.gnd)
    iV = (nodeV(v, ns.vcc) - vg) / 330
    iT = (nodeV(v, ns.trig) - vg) / 1e6
    iE = (nodeV(v, ns.echo) - vg) / 1000
    if (nodeV(v, ns.vcc) - vg > 4) {
      if (nodeV(v, ns.trig) - vg > 2.5) p.pinging = true
    } else {
      pushWarn(warnings, id, "warn", "The distance sensor needs 5V and GND.")
    }
  }
  p.pinCurrents = [iL, -iL, iR, -iR, iV, iT, iE, -(iV + iT + iE)]
}

function fillSonar(p, el, id, v, warnings) {
  p.pinging = false
  p.pinCurrents = [0, 0, 0, 0]
  var ns = sonarNodes(el, v.length)
  if (!ns) return
  var vg = nodeV(v, ns.gnd)
  var vcc = nodeV(v, ns.vcc) - vg
  var iV = vcc / 330
  var iT = (nodeV(v, ns.trig) - vg) / 1e6
  var iE = (nodeV(v, ns.echo) - vg) / 1000
  p.current = iV
  p.power = Math.abs(iV * vcc)
  p.pinCurrents = [iV, iT, iE, -(iV + iT + iE)]
  if (vcc > 4) {
    if (nodeV(v, ns.trig) - vg > 2.5) p.pinging = true
  } else {
    pushWarn(warnings, id, "warn", "The distance sensor needs 5V and GND.")
  }
}

function fillServo(p, el, id, v, state, nl, warnings) {
  var n = pins(el, v.length, 3)
  var angle = state.servoAngle && typeof state.servoAngle[id] === "number" && isFinite(state.servoAngle[id]) ? state.servoAngle[id] : 90
  var i5 = 0
  var iSig = 0
  var powered = false
  if (n) {
    var vg = nodeV(v, n[0])
    var v5 = nodeV(v, n[1]) - vg
    if (v5 > 4) {
      powered = true
      i5 = v5 / 100
    }
    iSig = (nodeV(v, n[2]) - vg) / 1e6
    var driven = servoDriveAngle(state, nl, n[2])
    if (driven !== null) angle = driven
  }
  if (!state.servoAngle) state.servoAngle = {}
  state.servoAngle[id] = angle
  p.angle = angle
  p.current = -(i5 + iSig)
  p.power = Math.abs(i5) * (n ? Math.abs(nodeV(v, n[1]) - nodeV(v, n[0])) : 0)
  p.pinCurrents = [-(i5 + iSig), i5, iSig]
  if (!powered) pushWarn(warnings, id, "warn", "The servo needs 5V and GND.")
}

function servoDriveAngle(state, nl, signalNode) {
  return nearestDrive(state, nl, signalNode, "servo")
}

function seedDriver(nl, v, state, work) {
  if (!work.driverScale) work.driverScale = {}
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (el.type !== "motorDriver") continue
    var n = pins(el, nl.nodeCount, 10)
    if (!n) continue
    work.driverScale[partId(el, i)] = driverScales(v, state, nl, n)
  }
}

function driverScales(v, state, nl, n) {
  var scales = []
  for (var i = 0; i < 4; i++) scales.push(driverScale(v, state, nl, n[1], n[2 + i]))
  return scales
}

function driverScale(v, state, nl, gnd, inNode) {
  var pwm = pwmOnNode(state, nl, inNode)
  if (pwm !== null) {
    if (pwm < 0) pwm = 0
    if (pwm > 255) pwm = 255
    return pwm / 255
  }
  return nodeV(v, inNode) - nodeV(v, gnd) > 2.5 ? 1 : 0
}

function pwmOnNode(state, nl, node) {
  return nearestDrive(state, nl, node, "pwm")
}

function stampDriver(sys, src, v, state, nl, work) {
  var n = src.pins
  var gnd = n[1]
  var vm = nodeV(v, n[0]) - nodeV(v, gnd)
  var scales = work.driverScale && work.driverScale[src.id]
  for (var i = 0; i < 4; i++) {
    stampG(sys, n[2 + i], gnd, 1 / 100000)
    var scale = scales && typeof scales[i] === "number" ? scales[i] : 0
    stampVsrc(sys, n[6 + i], gnd, vm * scale, 1)
  }
}

function fillDriver(p, el, id, v, state, nl, warnings) {
  var n = pins(el, v.length, 10)
  p.motorA = 0
  p.motorB = 0
  p.pinCurrents = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  if (!n) return
  var vg = nodeV(v, n[1])
  var vm = nodeV(v, n[0]) - vg
  var scales = driverScales(v, state, nl, n)
  var iIn = []
  var iOut = []
  for (var i = 0; i < 4; i++) {
    iIn.push((nodeV(v, n[2 + i]) - vg) / 100000)
    iOut.push((nodeV(v, n[6 + i]) - vg) - vm * scales[i])
  }
  var sum = iIn[0] + iIn[1] + iIn[2] + iIn[3] + iOut[0] + iOut[1] + iOut[2] + iOut[3]
  p.pinCurrents = [0, -sum, iIn[0], iIn[1], iIn[2], iIn[3], iOut[0], iOut[1], iOut[2], iOut[3]]
  p.current = 0
  p.power = 0
  var denom = Math.abs(vm) < 0.05 ? 0 : vm
  p.motorA = denom === 0 ? 0 : clamp((nodeV(v, n[6]) - nodeV(v, n[7])) / denom, -1, 1)
  p.motorB = denom === 0 ? 0 : clamp((nodeV(v, n[8]) - nodeV(v, n[9])) / denom, -1, 1)
  var driving = false
  for (var h = 0; h < 4; h++) if (scales[h] > 0) driving = true
  if (vm < 3 && driving) pushWarn(warnings, id, "warn", "Motor driver has no motor power (VM)")
}

function sonarEchoUs(nl, v, map, pin, answered, state) {
  pin = pin | 0
  if (!nl || !map || !map.pins || pin < 0 || pin >= map.pins.length) return 0
  var echoNode = map.pins[pin]
  if (echoNode < 0) return 0
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    var ns = sonarNodes(el, v.length)
    if (!ns || ns.echo !== echoNode) continue
    if (!(nodeV(v, ns.vcc) - nodeV(v, ns.gnd) > 4)) continue
    if (!trigOnBoard(nl, ns.trig, state)) continue
    answered[partId(el, i)] = true
    return ns.distance * 58
  }
  return 0
}

function trigOnBoard(nl, trigNode, state) {
  return nearestDrive(state, nl, trigNode, "pin") === true
}

function markSonarPings(result, answered) {
  if (!result || !result.parts) return
  for (var id in answered) {
    if (answered[id] && result.parts[id]) result.parts[id].pinging = true
  }
}

function copyBoardRuntime(part, slot, before) {
  if (!part || !slot || !slot.vm) return
  var srcPins = slot.vm.pins
  var pins = []
  var nPins = srcPins ? srcPins.length : 0
  for (var i = 0; i < nPins; i++) {
    var src = srcPins[i] ? srcPins[i] : { mode: "in", level: 0, pwm: null, servo: null, tone: null }
    pins.push({
      mode: src.mode || "in",
      level: src.level ? 1 : 0,
      pwm: src.pwm === undefined ? null : src.pwm,
      servo: src.servo === undefined ? null : src.servo,
      tone: src.tone === undefined ? null : src.tone
    })
  }
  part.pins = pins
  part.serial = slot.vm.serial ? String(slot.vm.serial) : ""
  part.serialActive = part.serial !== before
  part.error = slot.vm.error || ""
  part.errorLine = slot.vm.error ? (slot.vm.errorLine || 0) : 0
  part.running = !part.error
}
