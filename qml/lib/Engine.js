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
var DIODE_IS = 1e-12
var DIODE_NVT = 1.9 * VT
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
    capV: {},
    burnt: {},
    burnWhy: {},
    spin: {},
    nodeVolts: null,
    nodeCount: -1,
    mcu: {},
    servoAngle: {}
  }
}

function isTimeDependent(netlist) {
  var els = netlist && netlist.elements
  if (!els) return false
  for (var i = 0; i < els.length; i++) {
    var t = els[i].type
    if (t === "capacitor" || t === "electrolytic" || t === "motor" || t === "buzzer" || t === "omaduino") return true
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
    if (nl.nodeCount > 500) return fail("This circuit is too big for the simulator.")
    if (nl.ground < 0 && !isPowered(nl) && !hasOhmProbe(nl)) return unpowered(nl, state)
    syncBoards(nl, state)

    var ref = chooseRef(nl)
    var v = zeros(nl.nodeCount)
    if (dt > 0 && state.nodeVolts && state.nodeCount === nl.nodeCount && state.nodeVolts.length === nl.nodeCount) {
      for (var s = 0; s < nl.nodeCount; s++) v[s] = Number(state.nodeVolts[s]) || 0
      if (ref >= 0 && ref < nl.nodeCount) v[ref] = 0
    }

    var work = { junc: {}, supplyMode: {}, tmpOn: {}, hitLimit: false, changed: false }
    seedTmp(nl, v, work)

    var last = null
    var converged = false
    for (var iter = 0; iter < MAX_ITERS; iter++) {
      work.hitLimit = false
      var built = build(nl, state, v, dt, ref, work)
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
      noteModes(built, v, work)
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
    if (dt > 0) runBoards(nl, state, result, last, dt)
    return result
  } catch (err) {
    return fail("Something went wrong while simulating this circuit.")
  }
}

// ---------------------------------------------------------------------------
// Netlist hygiene

function ensureState(state) {
  if (!state.capV) state.capV = {}
  if (!state.burnt) state.burnt = {}
  if (!state.burnWhy) state.burnWhy = {}
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

function isPowered(nl) {
  for (var i = 0; i < nl.elements.length; i++) {
    var t = nl.elements[i].type
    if (t === "battery9v" || t === "aaPack" || t === "benchSupply" || t === "omaduino") return true
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

function chooseRef(nl) {
  if (nl.ground >= 0) return 0
  if (isPowered(nl)) {
    for (var i = 0; i < nl.elements.length; i++) {
      var el = nl.elements[i]
      var t = el.type
      if (t !== "battery9v" && t !== "aaPack" && t !== "benchSupply" && t !== "omaduino") continue
      if (t === "omaduino") {
        var nb = pins(el, nl.nodeCount, 1)
        if (nb) return nb[0]
        continue
      }
      var n = pins(el, nl.nodeCount, 2)
      if (n) return n[1]
    }
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
    if (el.type === "multimeter") {
      var mode = str(el, "mode", "V")
      p.value = 0
      p.reading = mode === "A" ? "0 A" : mode === "Ω" ? "OL" : "0 V"
    }
    if (el.type === "led") p.brightness = 0
    if (el.type === "rgbLed") p.brightness = { r: 0, g: 0, b: 0 }
    if (el.type === "motor") p.spin = 0
    if (el.type === "buzzer") p.on = false
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
        var cells = num(el, "cells", 2)
        if (cells < 0) cells = 0
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
    } else if (kind === "omaduino") {
      var plan = boardPlan(el, state, id)
      nExtra += plan.outputs.length
      list.push(plan)
    } else {
      list.push(null)
    }
  }
  return { list: list, nExtra: nExtra }
}

function noteModes(built, v, work) {
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
  }
}

function build(nl, state, v, dt, ref, work) {
  var plan = sourceList(nl, v, state, work)
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
      stampBoard(sys, src)
      sources.push(src)
      continue
    }
    if (src) sources.push(src)

    if (state.burnt[id] && (el.type === "led" || el.type === "rgbLed" || el.type === "electrolytic")) continue

    if (el.type === "resistor" || el.type === "ldr" || el.type === "thermistor" || el.type === "pushButton" || el.type === "buzzer" || el.type === "motor") {
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
    } else if (kind === "resistor" || kind === "ldr" || kind === "thermistor" || kind === "pushButton" || kind === "buzzer" || kind === "motor") {
      fillR(p, el, id, pv, state, warnings)
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
    } else if (kind === "capacitor" || kind === "electrolytic") {
      fillCap(p, el, id, pv, state, dt, warnings)
    } else if (kind === "multimeter") {
      fillMeter(p, el, id, pv, nl, warnings)
    } else if (kind === "tmp36") {
      fillTmp(p, el, id, pv, work, warnings)
    } else if (kind === "omaduino") {
      fillBoard(p, el, id, pv, state, v, warnings)
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
    var cells = num(el, "cells", 2)
    if (cells < 0) cells = 0
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

function fillR(p, el, id, pv, state, warnings) {
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
  if (el.type === "buzzer") p.on = (v0 - v1) > 2.5
  if (el.type === "motor") {
    var spin = i / 0.25
    spin = clamp(spin, -1, 1)
    state.spin[id] = spin
    p.spin = spin
  }
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
  for (var i = 0; i < 8; i++) {
    var sid = id + ":" + names[i]
    if (state.burnt[sid]) {
      anyBurn = true
      continue
    }
    var vd = (pv[i] || 0) - common
    var s = shockley(clamp(vd, -5, lp.vf + 0.45), lp.is, lp.nVt)
    if (s.id > LED_IMAX) {
      state.burnt[sid] = true
      state.burnWhy[sid] = "led"
      anyBurn = true
      pushWarn(warnings, id, "warn", "Segment " + names[i] + " burned out from too much current. Add a resistor, then press Reset.")
    } else {
      var b = s.id / LED_INOM
      if (b < 0) b = 0
      if (b > 1) b = 1
      segs[names[i]] = b
      power += Math.abs(s.id * vd)
      if (i === 0) i0 = s.id
      if (vd < -2 && s.id < 0.001) pushWarn(warnings, id, "warn", "Segment " + names[i] + " is in backwards, so it stays dark.")
    }
  }
  p.current = i0
  p.power = power
  p.segments = segs
  p.burnt = anyBurn
}

function fillRgb(p, el, id, pv, state, warnings) {
  var names = ["red", "green", "blue"]
  var an = [0, 2, 3]
  var bright = { r: 0, g: 0, b: 0 }
  var current0 = 0
  var power = 0
  var burnt = state.burnt[id] === true
  var over = false
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
      if (c === 0) current0 = s.id
      if (s.id > LED_IMAX) over = true
    }
  }
  if (over) {
    state.burnt[id] = true
    state.burnWhy[id] = "led"
    burnt = true
  }
  p.current = burnt ? 0 : current0
  p.power = burnt ? 0 : power
  p.brightness = burnt ? { r: 0, g: 0, b: 0 } : bright
  p.burnt = burnt
  if (burnt) pushWarn(warnings, id, "warn", "This LED burned out from too much current. Add a resistor on each color, then press Reset.")
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
  p.power = Math.abs(idDrain * (vd - vs))
  if (vgs < MOS_VTH && Math.abs(idDrain) < 1e-4) p.state = "off"
  else if (vgs >= MOS_VTH && vds < (vgs - MOS_VTH) && Math.abs(idDrain) > 1e-5) p.state = "saturated"
  else if (Math.abs(idDrain) < 1e-5) p.state = "off"
  else p.state = "active"
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
  var vsup = (pv[0] || 0) - (pv[2] || 0)
  var on = vsup > 2.6
  p.current = on || vsup > 0.2 ? 50e-6 : 0
  p.power = Math.abs(p.current * vsup)
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
// OmaDuino. The VM is cached on state and only rebuilt when the sketch text
// changes. Each dt > 0 solve stamps the current pins, then runs the sketch
// forward by dt. The new pin levels are what the next solve stamps.

function syncBoards(nl, state) {
  if (!state.mcu) state.mcu = {}
  var live = {}
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (el.type !== "omaduino") continue
    var id = partId(el, i)
    live[id] = true
    var code = el.props && el.props.code ? String(el.props.code) : ""
    var slot = state.mcu[id]
    if (slot && slot.code === code) continue
    if (!code) {
      state.mcu[id] = { code: "", vm: null, error: "", errorLine: 0 }
      continue
    }
    var compiled = Mcu.compile(code)
    if (!compiled || !compiled.ok) {
      var err = compiled && compiled.errors && compiled.errors[0] ? compiled.errors[0] : { line: 1, message: "This sketch didn't compile." }
      state.mcu[id] = { code: code, vm: null, error: String(err.message || "This sketch didn't compile."), errorLine: err.line || 1 }
    } else {
      state.mcu[id] = { code: code, vm: Mcu.create(compiled.program), error: "", errorLine: 0 }
    }
  }
  for (var k in state.mcu) if (!live[k]) delete state.mcu[k]
}

function boardMap(el) {
  var map = []
  for (var i = 0; i < 20; i++) map.push(-1)
  var gnd = -1
  var gnds = []
  var v5 = -1
  var v33 = -1
  var nodes = el && el.nodes ? el.nodes : []
  for (var n = 0; n < nodes.length; n++) {
    var node = nodes[n]
    if (typeof node !== "number" || !isFinite(node)) continue
    node = node | 0
    var name = (typeof Catalog !== "undefined" && Catalog.mcuPinNumber) ? Catalog.mcuPinNumber(n) : null
    if (name === "gnd") {
      gnds.push(node)
      if (gnd < 0) gnd = node
    } else if (name === "5v") v5 = node
    else if (name === "3v3") v33 = node
    else if (typeof name === "number" && name >= 0 && name < 20) map[name] = node
  }
  return { gnd: gnd, gnds: gnds, v5: v5, v33: v33, pins: map }
}

function boardPlan(el, state, id) {
  var map = boardMap(el)
  var slot = state.mcu && state.mcu[id]
  var pinStates = slot && slot.vm ? slot.vm.pins : null
  var outputs = []
  if (map.gnd >= 0) {
    if (map.v5 >= 0) outputs.push({ kind: "rail5" })
    if (map.v33 >= 0) outputs.push({ kind: "rail33" })
    for (var p = 0; p < 20; p++) {
      if (map.pins[p] < 0) continue
      var mode = pinStates && pinStates[p] ? pinStates[p].mode : "in"
      if (mode === "out") outputs.push({ kind: "gpio", pin: p })
    }
  }
  return { kind: "board", id: id, map: map, outputs: outputs, pinStates: pinStates }
}

function gpioVolts(pin) {
  if (!pin) return 0
  if (pin.pwm !== null && pin.pwm !== undefined && isFinite(Number(pin.pwm))) {
    var duty = Number(pin.pwm)
    if (duty < 0) duty = 0
    if (duty > 255) duty = 255
    return 5 * duty / 255
  }
  return pin.level ? 5 : 0
}

function gpioName(p) {
  if (p >= 14) return "A" + (p - 14)
  return "D" + p
}

function stampBoard(sys, src) {
  var map = src.map
  var gnd = map.gnd
  if (gnd < 0) return
  for (var g = 0; g < map.gnds.length; g++) stampG(sys, map.gnds[g], gnd, 1 / 0.05)
  var pins = src.pinStates
  for (var i = 0; i < src.outputs.length; i++) {
    var o = src.outputs[i]
    if (o.kind === "rail5") stampVsrc(sys, map.v5, gnd, 5, 0.2)
    else if (o.kind === "rail33") stampVsrc(sys, map.v33, gnd, 3.3, 1)
    else stampVsrc(sys, map.pins[o.pin], gnd, gpioVolts(pins && pins[o.pin]), 25)
  }
  for (var p = 0; p < 20; p++) {
    var node = map.pins[p]
    if (node < 0) continue
    var pin = pins && pins[p] ? pins[p] : null
    var mode = pin && pin.mode ? pin.mode : "in"
    if (mode === "out") continue
    if (mode === "pullup" && map.v5 >= 0) stampG(sys, node, map.v5, 1 / 35000)
    else stampG(sys, node, gnd, 1 / 1e7)
  }
}

function fillBoard(p, el, id, pv, state, v, warnings) {
  var map = boardMap(el)
  var slot = state.mcu && state.mcu[id]
  var gndV = map.gnd >= 0 ? nodeV(v, map.gnd) : 0
  var i5 = 0
  var i33 = 0
  if (map.v5 >= 0 && map.gnd >= 0) {
    var v5 = nodeV(v, map.v5) - gndV
    i5 = (5 - v5) / 0.2
    if (i5 > 0.5) pushWarn(warnings, id, "warn", "The 5V pin is past its 0.5 A limit.")
  }
  if (map.v33 >= 0 && map.gnd >= 0) {
    var v33 = nodeV(v, map.v33) - gndV
    i33 = (3.3 - v33) / 1
    if (i33 > 0.05) pushWarn(warnings, id, "warn", "The 3.3V pin is past its 0.05 A limit.")
  }
  var srcPins = slot && slot.vm ? slot.vm.pins : null
  var pins = []
  var iGpio = 0
  for (var i = 0; i < 20; i++) {
    var src = srcPins && srcPins[i] ? srcPins[i] : { mode: "in", level: 0, pwm: null, servo: null, tone: null }
    pins.push({
      mode: src.mode || "in",
      level: src.level ? 1 : 0,
      pwm: src.pwm === undefined ? null : src.pwm,
      servo: src.servo === undefined ? null : src.servo,
      tone: src.tone === undefined ? null : src.tone
    })
    if (src.mode === "out" && map.pins[i] >= 0 && map.gnd >= 0) {
      var ideal = gpioVolts(src)
      var iPin = (ideal - (nodeV(v, map.pins[i]) - gndV)) / 25
      iGpio += iPin
      var ma = Math.abs(iPin) * 1000
      if (ma > 40) pushWarn(warnings, id, "warn", "Pin " + gpioName(i) + " is giving " + Math.round(ma) + " mA; add a resistor (220 Ω for an LED).")
      var node = map.pins[i]
      if (node === map.gnd || (map.v5 >= 0 && node === map.v5)) {
        pushWarn(warnings, id, "danger", "Pin " + gpioName(i) + " is shorted straight to " + (node === map.gnd ? "GND" : "5V") + ".")
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
  p.running = !!(slot && slot.vm && !p.error)
  p.current = i5 + i33 + iGpio
  p.power = 0
}

function runBoards(nl, state, result, v, dt) {
  var stepUs = Math.round(dt * 1e6)
  if (stepUs < 1) stepUs = 1
  for (var i = 0; i < nl.elements.length; i++) {
    var el = nl.elements[i]
    if (el.type !== "omaduino") continue
    var id = partId(el, i)
    var slot = state.mcu && state.mcu[id]
    if (!slot || !slot.vm || slot.error) continue
    var before = slot.vm.serial ? String(slot.vm.serial) : ""
    var map = boardMap(el)
    slot.vm.run(slot.vm.time + stepUs, {
      volts: function (pin) {
        pin = pin | 0
        if (pin < 0 || pin >= 20 || map.gnd < 0) return 0
        var node = map.pins[pin]
        if (node < 0) return 0
        return nodeV(v, node) - nodeV(v, map.gnd)
      },
      pulseIn: function () { return 0 }
    })
    copyBoardRuntime(result.parts[id], slot, before)
  }
}

function copyBoardRuntime(part, slot, before) {
  if (!part || !slot || !slot.vm) return
  var srcPins = slot.vm.pins
  var pins = []
  for (var i = 0; i < 20; i++) {
    var src = srcPins && srcPins[i] ? srcPins[i] : { mode: "in", level: 0, pwm: null, servo: null, tone: null }
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
