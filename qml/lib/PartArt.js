.pragma library
.import "Catalog.js" as Catalog

// Draws one part with Canvas 2D in its own unrotated grid units. The caller
// has translated the context so (0, 0) is the part's first pin and scaled it
// so 1.0 is one grid step. `live` is the engine's result for this part (or
// null while stopped).

var INK = "#1a1a1a"
var LEG = "#9aa0a6"

function draw(ctx, part, live, running) {
  var fn = painters[part.type]
  if (fn) fn(ctx, part, live || {}, running)
}

function leg(ctx, x0, y0, x1, y1) {
  ctx.strokeStyle = LEG
  ctx.lineWidth = 0.09
  ctx.lineCap = "round"
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
  pinDot(ctx, x1, y1)
}

function pinDot(ctx, x, y) {
  ctx.fillStyle = "#5f6368"
  ctx.beginPath(); ctx.arc(x, y, 0.13, 0, Math.PI * 2); ctx.fill()
}

function terminal(ctx, x, y, color) {
  ctx.fillStyle = "#c0c4c8"
  ctx.strokeStyle = INK; ctx.lineWidth = 0.05
  ctx.beginPath(); ctx.arc(x, y, 0.32, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(x, y, 0.16, 0, Math.PI * 2); ctx.fill()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function label(ctx, text, x, y, size, color, align) {
  ctx.fillStyle = color || INK
  ctx.textAlign = align || "center"
  ctx.textBaseline = "middle"
  // Canvas fonts want pixels; we are in grid units, so scale for the text.
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(0.01, 0.01)
  ctx.font = "bold " + Math.round(size * 100) + "px sans-serif"
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

function glow(ctx, x, y, radius, color, strength) {
  if (strength <= 0.01) return
  var g = ctx.createRadialGradient(x, y, 0, x, y, radius)
  var c = Qt.color(color)
  g.addColorStop(0, Qt.rgba(c.r, c.g, c.b, Math.min(1, 0.85 * strength)))
  g.addColorStop(0.45, Qt.rgba(c.r, c.g, c.b, 0.45 * strength))
  g.addColorStop(1, Qt.rgba(c.r, c.g, c.b, 0))
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill()
}

function smoke(ctx, x, y) {
  ctx.fillStyle = "rgba(90,90,90,0.55)"
  var puffs = [[0, -0.9, 0.35], [0.35, -1.25, 0.28], [-0.25, -1.4, 0.24]]
  for (var i = 0; i < puffs.length; i++) {
    ctx.beginPath(); ctx.arc(x + puffs[i][0], y + puffs[i][1], puffs[i][2], 0, Math.PI * 2); ctx.fill()
  }
}

function battery(ctx, w, h, title, sub, color) {
  roundRect(ctx, -0.6, 0.4, w, h, 0.25)
  ctx.fillStyle = color; ctx.fill()
  ctx.strokeStyle = INK; ctx.lineWidth = 0.06; ctx.stroke()
  label(ctx, title, -0.6 + w / 2, 0.4 + h * 0.45, 0.75, "#ffffff")
  if (sub) label(ctx, sub, -0.6 + w / 2, 0.4 + h * 0.72, 0.42, "#e8e8e8")
}

function toNumber(v, d) { var n = Number(v); return isFinite(n) ? n : d }

var painters = {
  battery9v: function (ctx, p, live) {
    battery(ctx, 3.2, 4.6, "9V", "battery", "#2b2b2b")
    ctx.fillStyle = "#e6b800"; ctx.fillRect(-0.6, 3.6, 3.2, 0.5)
    terminal(ctx, 0, 0, "#e53935"); terminal(ctx, 2, 0, "#1b1b1b")
    label(ctx, "+", 0, -0.6, 0.5, "#e53935"); label(ctx, "−", 2, -0.6, 0.6, INK)
  },
  aaPack: function (ctx, p, live) {
    var cells = toNumber(p.props.cells, 2)
    battery(ctx, 3.2, 5.6, (cells * 1.5).toFixed(1) + "V", cells + " × AA", "#37474f")
    for (var i = 0; i < cells; i++) {
      ctx.fillStyle = "#90a4ae"
      ctx.fillRect(-0.4 + i * (2.8 / cells), 4.6, 2.8 / cells - 0.15, 0.6)
    }
    terminal(ctx, 0, 0, "#e53935"); terminal(ctx, 2, 0, "#1b1b1b")
    label(ctx, "+", 0, -0.6, 0.5, "#e53935"); label(ctx, "−", 2, -0.6, 0.6, INK)
  },
  benchSupply: function (ctx, p, live) {
    roundRect(ctx, -0.6, 0.4, 5.2, 4.4, 0.25)
    ctx.fillStyle = "#263238"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.06; ctx.stroke()
    roundRect(ctx, -0.2, 0.8, 4.4, 1.6, 0.12)
    ctx.fillStyle = "#0b1a10"; ctx.fill()
    var v = live.volts !== undefined ? live.volts : toNumber(p.props.volts, 5)
    label(ctx, v.toFixed(2) + " V", 2, 1.35, 0.6, "#66ff88")
    var a = live.current !== undefined ? Math.abs(live.current) : 0
    label(ctx, (a * 1000 >= 1000 ? a.toFixed(2) + " A" : (a * 1000).toFixed(1) + " mA"), 2, 2.0, 0.42, live.limited ? "#ffb74d" : "#66ff88")
    label(ctx, live.limited ? "CURRENT LIMIT" : "BENCH SUPPLY", 2, 3.3, 0.36, live.limited ? "#ffb74d" : "#b0bec5")
    terminal(ctx, 1, 0, "#e53935"); terminal(ctx, 3, 0, "#1b1b1b")
    label(ctx, "+", 1, -0.6, 0.5, "#e53935"); label(ctx, "−", 3, -0.6, 0.6, INK)
  },
  resistor: function (ctx, p, live) {
    var span = toNumber(p.props.span, 4)
    leg(ctx, span / 2 - 1, 0, 0, 0); leg(ctx, span / 2 + 1, 0, span, 0)
    var cx = span / 2
    roundRect(ctx, cx - 1.1, -0.33, 2.2, 0.66, 0.3)
    ctx.fillStyle = live.burnt ? "#5d4037" : "#d9c08c"; ctx.fill()
    ctx.strokeStyle = "#7a6a45"; ctx.lineWidth = 0.04; ctx.stroke()
    var bands = Catalog.resistorBands(toNumber(p.props.ohms, 220))
    var xs = [cx - 0.65, cx - 0.35, cx - 0.05, cx + 0.6]
    for (var i = 0; i < 4; i++) { ctx.fillStyle = bands[i]; ctx.fillRect(xs[i] - 0.09, -0.33, 0.18, 0.66) }
    if (live.hot) glow(ctx, cx, 0, 1.4, "#ff6a00", Math.min(1, live.hot))
    // Printed value, so you can read it without the color code.
    ctx.fillStyle = "rgba(255,255,255,0.85)"
    roundRect(ctx, cx - 0.95, -1.05, 1.9, 0.55, 0.15); ctx.fill()
    label(ctx, Catalog.si(toNumber(p.props.ohms, 220), "Ω").replace(" ", ""), cx, -0.78, 0.4, INK)
  },
  led: function (ctx, p, live, running) {
    var c = Catalog.ledColors[p.props.color] || Catalog.ledColors.red
    leg(ctx, 0.5, -0.3, 0, 0); leg(ctx, 0.5, -0.3, 1, 0)
    var b = live.burnt ? 0 : toNumber(live.brightness, 0)
    // Even a dim LED should read as "on", so the glow starts strong.
    var g = b > 0.01 ? Math.min(1, 0.45 + b * 0.8) : 0
    glow(ctx, 0.5, -0.45, 2.0 + g * 1.8, c.glow, g)
    glow(ctx, 0.5, -0.45, 1.1 + g * 0.6, c.glow, g)
    ctx.fillStyle = live.burnt ? "#4a4a4a" : (g > 0 ? c.glow : c.body)
    ctx.globalAlpha = live.burnt ? 1 : (g > 0 ? 1 : 0.75)
    ctx.beginPath(); ctx.arc(0.5, -0.45, 0.48, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
    // Hot white center when lit.
    if (g > 0) glow(ctx, 0.5, -0.45, 0.42, "#ffffff", g)
    ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.lineWidth = 0.05; ctx.stroke()
    // Flat edge on the cathode side.
    ctx.strokeStyle = INK; ctx.lineWidth = 0.08
    ctx.beginPath(); ctx.moveTo(0.93, -0.75); ctx.lineTo(0.93, -0.15); ctx.stroke()
    ctx.fillStyle = "rgba(255,255,255,0.6)"
    ctx.beginPath(); ctx.arc(0.36, -0.6, 0.12, 0, Math.PI * 2); ctx.fill()
    if (live.burnt) smoke(ctx, 0.5, -0.4)
  },
  rgbLed: function (ctx, p, live) {
    for (var i = 0; i < 4; i++) leg(ctx, 1.5, -0.4, i, 0)
    var br = live.brightness || {}
    var r = toNumber(br.r, 0), g = toNumber(br.g, 0), b = toNumber(br.b, 0)
    var m = Math.max(r, g, b)
    var mix = Qt.rgba(Math.min(1, r * 1.2), Math.min(1, g * 1.2), Math.min(1, b * 1.2), 1)
    var gm = m > 0.01 ? Math.min(1, 0.45 + m * 0.8) : 0
    glow(ctx, 1.5, -0.6, 2.6 + gm * 1.8, mix, gm)
    glow(ctx, 1.5, -0.6, 1.3, mix, gm)
    ctx.fillStyle = m > 0.05 ? mix : "#e8eef2"
    ctx.globalAlpha = 0.75
    ctx.beginPath(); ctx.arc(1.5, -0.6, 0.62, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 0.05; ctx.stroke()
    label(ctx, "R", 0, 0.55, 0.32, "#c62828"); label(ctx, "−", 1, 0.55, 0.4, INK)
    label(ctx, "G", 2, 0.55, 0.32, "#2e7d32"); label(ctx, "B", 3, 0.55, 0.32, "#1565c0")
  },
  capacitor: function (ctx, p) {
    leg(ctx, 0.3, -0.35, 0, 0); leg(ctx, 0.7, -0.35, 1, 0)
    ctx.fillStyle = "#e0a030"
    ctx.beginPath(); ctx.ellipse(0.0, -0.75, 1.0, 0.6); ctx.fill()
    ctx.strokeStyle = "#8a5a10"; ctx.lineWidth = 0.04; ctx.stroke()
    label(ctx, Catalog.si(toNumber(p.props.farads, 1e-7), "F").replace(" ", ""), 0.5, -0.45, 0.26, "#3a2500")
  },
  electrolytic: function (ctx, p, live) {
    leg(ctx, 0.3, -0.2, 0, 0); leg(ctx, 0.7, -0.2, 1, 0)
    ctx.fillStyle = live.burnt ? "#5a5a5a" : "#1f3a93"
    ctx.beginPath(); ctx.arc(0.5, -0.65, 0.8, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = INK; ctx.lineWidth = 0.05; ctx.stroke()
    // Stripe marks the − leg.
    ctx.fillStyle = "#cfd8dc"
    ctx.beginPath(); ctx.moveTo(0.9, -1.35); ctx.arc(0.5, -0.65, 0.8, -1.05, 0.45); ctx.closePath(); ctx.fill()
    label(ctx, "−", 1.05, -0.55, 0.36, INK)
    label(ctx, Catalog.si(toNumber(p.props.farads, 1e-4), "F").replace(" ", ""), 0.35, -0.65, 0.26, "#ffffff")
    if (live.burnt) smoke(ctx, 0.5, -0.8)
  },
  pushButton: function (ctx, p) {
    leg(ctx, 0.5, 0, 0, 0); leg(ctx, 2.5, 0, 3, 0)
    roundRect(ctx, 0.3, -1.2, 2.4, 2.4, 0.15)
    ctx.fillStyle = "#2f2f2f"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.05; ctx.stroke()
    var down = p.props.pressed === true
    ctx.fillStyle = down ? "#c62828" : "#ef5350"
    ctx.beginPath(); ctx.arc(1.5, 0, down ? 0.62 : 0.72, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.stroke()
  },
  slideSwitch: function (ctx, p) {
    leg(ctx, 0, -0.3, 0, 0); leg(ctx, 1, -0.3, 1, 0); leg(ctx, 2, -0.3, 2, 0)
    roundRect(ctx, -0.4, -1.05, 2.8, 0.8, 0.1)
    ctx.fillStyle = "#3c4043"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.05; ctx.stroke()
    var pos = toNumber(p.props.position, 0)
    roundRect(ctx, pos === 0 ? -0.2 : 1.0, -0.95, 1.2, 0.6, 0.08)
    ctx.fillStyle = "#e8eaed"; ctx.fill()
  },
  potentiometer: function (ctx, p) {
    leg(ctx, 0, -0.3, 0, 0); leg(ctx, 1, -0.3, 1, 0); leg(ctx, 2, -0.3, 2, 0)
    roundRect(ctx, -0.45, -2.55, 2.9, 2.3, 0.2)
    ctx.fillStyle = "#1e5aa8"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.05; ctx.stroke()
    ctx.fillStyle = "#eceff1"
    ctx.beginPath(); ctx.arc(1, -1.4, 0.85, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = "#455a64"; ctx.lineWidth = 0.05; ctx.stroke()
    var turn = toNumber(p.props.turn, 0.5)
    var ang = (-225 + 270 * turn) * Math.PI / 180
    ctx.strokeStyle = "#263238"; ctx.lineWidth = 0.14; ctx.lineCap = "round"
    ctx.beginPath(); ctx.moveTo(1, -1.4); ctx.lineTo(1 + Math.cos(ang) * 0.7, -1.4 + Math.sin(ang) * 0.7); ctx.stroke()
  },
  ldr: function (ctx, p) {
    leg(ctx, 0.3, -0.3, 0, 0); leg(ctx, 0.7, -0.3, 1, 0)
    ctx.fillStyle = "#f5f0e0"
    ctx.beginPath(); ctx.arc(0.5, -0.55, 0.45, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = "#8d6e63"; ctx.lineWidth = 0.05; ctx.stroke()
    ctx.strokeStyle = "#c0392b"; ctx.lineWidth = 0.06
    ctx.beginPath()
    for (var i = 0; i < 5; i++) { ctx.moveTo(0.2, -0.85 + i * 0.15); ctx.lineTo(0.8, -0.85 + i * 0.15) }
    ctx.stroke()
    var l = toNumber(p.props.light, 0.5)
    glow(ctx, 0.5, -0.55, 1.2, "#fff3a0", l * 0.7)
  },
  thermistor: function (ctx, p) {
    leg(ctx, 0.35, -0.3, 0, 0); leg(ctx, 0.65, -0.3, 1, 0)
    ctx.fillStyle = "#2e7d32"
    ctx.beginPath(); ctx.ellipse(0.1, -0.85, 0.8, 0.6); ctx.fill()
    ctx.strokeStyle = INK; ctx.lineWidth = 0.04; ctx.stroke()
    var t = toNumber(p.props.celsius, 25)
    label(ctx, Math.round(t) + "°", 0.5, -1.2, 0.3, t > 60 ? "#d32f2f" : "#455a64")
  },
  tmp36: function (ctx, p) { to92(ctx, "TMP36", "#212121") },
  npn: function (ctx, p) { to92(ctx, "NPN", "#212121"); pinLetters(ctx, ["E", "B", "C"]) },
  pnp: function (ctx, p) { to92(ctx, "PNP", "#212121"); pinLetters(ctx, ["E", "B", "C"]) },
  nmos: function (ctx, p) { to92(ctx, "MOSFET", "#212121"); pinLetters(ctx, ["S", "G", "D"]) },
  diode: function (ctx, p) { diodeBody(ctx, "#1b1b1b", "#d0d0d0") },
  zener: function (ctx, p) { diodeBody(ctx, "#c0602a", "#1b1b1b") },
  buzzer: function (ctx, p, live) {
    leg(ctx, 0.2, -0.3, 0, 0); leg(ctx, 1.8, -0.3, 2, 0)
    ctx.fillStyle = "#212121"
    ctx.beginPath(); ctx.arc(1, -1.3, 1.25, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = "#424242"
    ctx.beginPath(); ctx.arc(1, -1.3, 0.25, 0, Math.PI * 2); ctx.fill()
    // The + leg, big enough to see which way round it is.
    ctx.fillStyle = "#ef5350"
    ctx.beginPath(); ctx.arc(-0.05, -2.05, 0.32, 0, Math.PI * 2); ctx.fill()
    label(ctx, "+", -0.05, -2.05, 0.46, "#ffffff")
    if (!live.reversed && (live.on || toNumber(live.freq, 0) > 0)) {
      // Three rings moving outward and fading, on both sides.
      var ph = toNumber(live.phase, 0)
      for (var i = 0; i < 3; i++) {
        var t = (i + ph) / 3
        ctx.strokeStyle = "rgba(255,202,40," + (1 - t).toFixed(2) + ")"
        ctx.lineWidth = 0.12
        var rr = 1.4 + t * 1.1
        ctx.beginPath(); ctx.arc(1, -1.3, rr, -0.65, 0.65); ctx.stroke()
        ctx.beginPath(); ctx.arc(1, -1.3, rr, Math.PI - 0.65, Math.PI + 0.65); ctx.stroke()
      }
      roundRect(ctx, 0.05, -3.55, 1.9, 0.62, 0.3)
      ctx.fillStyle = "#ffca28"; ctx.fill()
      label(ctx, "BZZZ", 1, -3.24, 0.42, "#212121")
    }
  },
  motor: function (ctx, p, live) {
    terminal(ctx, 0, 0, "#c0c4c8"); terminal(ctx, 3, 0, "#c0c4c8")
    roundRect(ctx, -0.6, 0.4, 4.2, 3.8, 0.4)
    ctx.fillStyle = "#b0bec5"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.06; ctx.stroke()
    ctx.fillStyle = "#eceff1"
    ctx.beginPath(); ctx.arc(1.5, 2.3, 1.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    // Shaft flag: the overlay animates `angle`.
    var a = toNumber(live.angle, 0)
    ctx.strokeStyle = "#d32f2f"; ctx.lineWidth = 0.22; ctx.lineCap = "round"
    ctx.beginPath(); ctx.moveTo(1.5 - Math.cos(a) * 1.0, 2.3 - Math.sin(a) * 1.0); ctx.lineTo(1.5 + Math.cos(a) * 1.0, 2.3 + Math.sin(a) * 1.0); ctx.stroke()
    ctx.fillStyle = "#37474f"
    ctx.beginPath(); ctx.arc(1.5, 2.3, 0.25, 0, Math.PI * 2); ctx.fill()
    label(ctx, "M", -0.1, 3.7, 0.5, "#37474f")
  },
  omaduino: function (ctx, p, live, running) {
    roundRect(ctx, -0.8, 0.4, 24.6, 9.6, 0.5)
    ctx.fillStyle = "#00707a"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.08; ctx.stroke()
    // Header strips under the pins.
    ctx.fillStyle = "#1b1b1b"
    ctx.fillRect(-0.5, -0.45, 9.0, 0.9); ctx.fillRect(9.5, -0.45, 12.0, 0.9); ctx.fillRect(22.5, -0.45, 1.0, 0.9)
    var pins = Catalog.parts.omaduino.pins
    for (var i = 0; i < pins.length; i++) {
      ctx.fillStyle = "#d4af37"
      ctx.fillRect(pins[i].x - 0.14, -0.14, 0.28, 0.28)
      var nm = pins[i].name
      var pwm = nm === "D3" || nm === "D5" || nm === "D6" || nm === "D9" || nm === "D10" || nm === "D11"
      label(ctx, (pwm ? "~" : "") + nm.replace("D", ""), pins[i].x, 0.95, 0.34, "#e8f6f7")
    }
    // USB socket, chip and labels.
    ctx.fillStyle = "#b0bec5"; ctx.fillRect(-1.4, 4.2, 2.6, 2.4)
    label(ctx, "USB powered", 0.0, 7.3, 0.36, "#bfe9ec")
    ctx.fillStyle = "#212121"; roundRect(ctx, 9.0, 4.6, 8.0, 2.4, 0.15); ctx.fill()
    for (var k = 0; k < 14; k++) { ctx.fillStyle = "#9e9e9e"; ctx.fillRect(9.3 + k * 0.55, 4.3, 0.2, 0.3); ctx.fillRect(9.3 + k * 0.55, 7.0, 0.2, 0.3) }
    label(ctx, "OmaDuino", 13.0, 8.6, 0.8, "#ffffff")
    label(ctx, "ANALOG IN", 5.5, 1.7, 0.34, "#bfe9ec")
    label(ctx, "DIGITAL (~ = PWM)", 15.5, 1.7, 0.34, "#bfe9ec")
    // Power LED, the "L" LED on pin 13, and the TX LED for Serial.
    var on = running === true
    function led(x, y, color, lit, text) {
      if (lit) glow(ctx, x, y, 0.9, color, 1)
      ctx.fillStyle = lit ? color : "#4a4a4a"
      ctx.fillRect(x - 0.22, y - 0.14, 0.44, 0.28)
      label(ctx, text, x, y + 0.5, 0.3, "#e8f6f7")
    }
    led(20.0, 3.0, "#3dff5a", on, "ON")
    led(21.4, 3.0, "#ffb300", on && live.pins && live.pins[13] && live.pins[13].level === 1, "L")
    led(22.8, 3.0, "#ffb300", on && live.serialActive, "TX")
    if (live.error) {
      roundRect(ctx, 0.0, 2.4, 8.4, 1.4, 0.15); ctx.fillStyle = "#b71c1c"; ctx.fill()
      label(ctx, "Code error", 4.2, 3.1, 0.5, "#ffffff")
    } else if (on && live.running) {
      label(ctx, "running sketch", 4.2, 3.1, 0.45, "#bfe9ec")
    } else if (!p.props.code) {
      label(ctx, "select to program", 4.2, 3.1, 0.45, "#bfe9ec")
    }
  },
  servo: function (ctx, p, live) {
    leg(ctx, 0, -0.4, 0, 0); leg(ctx, 1, -0.4, 1, 0); leg(ctx, 2, -0.4, 2, 0)
    ctx.fillStyle = "#6d4c41"; ctx.fillRect(-0.15, -0.9, 0.3, 0.5)
    ctx.fillStyle = "#e53935"; ctx.fillRect(0.85, -0.9, 0.3, 0.5)
    ctx.fillStyle = "#fb8c00"; ctx.fillRect(1.85, -0.9, 0.3, 0.5)
    roundRect(ctx, -0.3, -3.3, 4.8, 2.4, 0.2)
    ctx.fillStyle = "#1565c0"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.06; ctx.stroke()
    label(ctx, "SERVO", 1.3, -1.6, 0.42, "#e3f2fd")
    var ang = toNumber(live.angle, 90)
    var cx = 3.3, cy = -2.1
    ctx.fillStyle = "#eeeeee"
    ctx.beginPath(); ctx.arc(cx, cy, 0.5, 0, Math.PI * 2); ctx.fill()
    var a = Math.PI - ang * Math.PI / 180
    ctx.strokeStyle = "#fafafa"; ctx.lineWidth = 0.38; ctx.lineCap = "round"
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 1.6, cy - Math.sin(a) * 1.6); ctx.stroke()
    ctx.strokeStyle = INK; ctx.lineWidth = 0.05
    ctx.beginPath(); ctx.arc(cx, cy, 0.5, 0, Math.PI * 2); ctx.stroke()
    label(ctx, Math.round(ang) + "°", 1.3, -2.6, 0.38, "#ffffff")
  },
  hcsr04: function (ctx, p, live) {
    for (var i = 0; i < 4; i++) leg(ctx, i, -0.4, i, 0)
    roundRect(ctx, -0.8, -2.5, 4.6, 2.1, 0.15)
    ctx.fillStyle = "#1e88e5"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.05; ctx.stroke()
    var eyes = [0.4, 2.6]
    for (var e = 0; e < 2; e++) {
      ctx.fillStyle = "#cfd8dc"
      ctx.beginPath(); ctx.arc(eyes[e], -1.45, 0.85, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = "#37474f"
      ctx.beginPath(); ctx.arc(eyes[e], -1.45, 0.55, 0, Math.PI * 2); ctx.fill()
    }
    label(ctx, toNumber(p.props.distance, 30) + " cm", 1.5, -2.9, 0.42, "#ffffff")
    var names = ["V", "T", "E", "G"]
    for (var k = 0; k < 4; k++) label(ctx, names[k], k, 0.55, 0.3, "#37474f")
    if (live.pinging) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 0.07
      for (var w = 1; w <= 2; w++) { ctx.beginPath(); ctx.arc(1.5, -1.45, 1.2 + w * 0.5, -2.4, -0.74); ctx.stroke() }
    }
  },
  sevenSeg: function (ctx, p, live) {
    for (var i = 0; i <= 8; i++) leg(ctx, i, -0.4, i, 0)
    roundRect(ctx, -0.2, -4.1, 8.4, 3.7, 0.15)
    ctx.fillStyle = "#1a1a1a"; ctx.fill()
    var seg = live.segments || {}
    var x0 = 2.6, y0 = -3.7, w = 2.4, h = 1.45, t = 0.32
    function bar(name, x, y, horiz) {
      var lit = Number(seg[name] || 0)
      ctx.fillStyle = lit > 0.05 ? Qt.rgba(1, 0.15 + 0.1 * lit, 0.1, 0.35 + 0.65 * Math.min(1, lit)) : "#3a1414"
      if (horiz) ctx.fillRect(x, y - t / 2, w, t); else ctx.fillRect(x - t / 2, y, t, h)
      if (lit > 0.3) glow(ctx, horiz ? x + w / 2 : x, horiz ? y : y + h / 2, 0.9, "#ff3a2a", lit * 0.6)
    }
    bar("a", x0, y0, true); bar("g", x0, y0 + h, true); bar("d", x0, y0 + 2 * h, true)
    bar("f", x0, y0, false); bar("e", x0, y0 + h, false)
    bar("b", x0 + w, y0, false); bar("c", x0 + w, y0 + h, false)
    var dp = Number(seg.dp || 0)
    ctx.fillStyle = dp > 0.05 ? "#ff3a2a" : "#3a1414"
    ctx.beginPath(); ctx.arc(x0 + w + 0.6, y0 + 2 * h, 0.2, 0, Math.PI * 2); ctx.fill()
    var names = ["a", "b", "c", "d", "e", "f", "g", ".", "−"]
    for (var k = 0; k <= 8; k++) label(ctx, names[k], k, 0.55, 0.32, "#37474f")
  },
  motorDriver: function (ctx, p, live) {
    for (var i = 0; i <= 9; i++) leg(ctx, i, -0.4, i, 0)
    roundRect(ctx, -0.4, -2.9, 9.8, 2.5, 0.15)
    ctx.fillStyle = "#c62828"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.05; ctx.stroke()
    ctx.fillStyle = "#212121"; roundRect(ctx, 2.6, -2.5, 3.8, 1.5, 0.1); ctx.fill()
    label(ctx, "H-BRIDGE", 4.5, -1.75, 0.38, "#e0e0e0")
    var names = ["VM", "G", "1", "2", "3", "4", "O1", "O2", "O3", "O4"]
    for (var k = 0; k <= 9; k++) label(ctx, names[k], k, 0.55, 0.28, "#37474f")
    var a = toNumber(live.motorA, 0), b = toNumber(live.motorB, 0)
    label(ctx, a > 0.05 ? "A ▶" : a < -0.05 ? "◀ A" : "A ■", 7.0, -2.2, 0.36, "#ffffff")
    label(ctx, b > 0.05 ? "B ▶" : b < -0.05 ? "◀ B" : "B ■", 8.5, -1.2, 0.36, "#ffffff")
  },
  robotCar: function (ctx, p, live) {
    for (var i = 0; i < 8; i++) terminal(ctx, [0, 1, 2, 3, 5, 6, 7, 8][i], 0, i < 4 ? "#ff9800" : "#03a9f4")
    roundRect(ctx, -0.8, 0.4, 9.6, 8.0, 0.8)
    ctx.fillStyle = "#37474f"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.08; ctx.stroke()
    ctx.fillStyle = "#212121"
    roundRect(ctx, -1.1, 3.0, 1.0, 3.2, 0.3); ctx.fill()
    roundRect(ctx, 8.1, 3.0, 1.0, 3.2, 0.3); ctx.fill()
    ctx.fillStyle = "#1e88e5"; roundRect(ctx, 2.6, 0.8, 2.8, 1.3, 0.2); ctx.fill()
    ctx.fillStyle = "#cfd8dc"
    ctx.beginPath(); ctx.arc(3.3, 1.45, 0.45, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(4.7, 1.45, 0.45, 0, Math.PI * 2); ctx.fill()
    label(ctx, "ROBOT", 4.0, 4.4, 0.7, "#eceff1")
    label(ctx, Math.round(toNumber(p.props.distance, 100)) + " cm ahead", 4.0, 5.4, 0.42, "#b0bec5")
    var l = toNumber(live.leftSpin, 0), r = toNumber(live.rightSpin, 0)
    label(ctx, "L " + Math.round(l * 100) + "%", 1.4, 7.4, 0.4, l > 0.05 ? "#69f0ae" : l < -0.05 ? "#ff8a80" : "#90a4ae")
    label(ctx, "R " + Math.round(r * 100) + "%", 6.6, 7.4, 0.4, r > 0.05 ? "#69f0ae" : r < -0.05 ? "#ff8a80" : "#90a4ae")
    label(ctx, "motors", 1.5, -0.65, 0.34, "#ff9800"); label(ctx, "sonar", 6.5, -0.65, 0.34, "#03a9f4")
  },
  multimeter: function (ctx, p, live) {
    roundRect(ctx, -0.6, 0.4, 6.2, 6.4, 0.4)
    ctx.fillStyle = "#f9a825"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.06; ctx.stroke()
    roundRect(ctx, -0.2, 0.9, 5.4, 2.1, 0.15)
    ctx.fillStyle = "#c5d6b0"; ctx.fill(); ctx.strokeStyle = "#5d6b4a"; ctx.lineWidth = 0.04; ctx.stroke()
    var reading = live.reading || "– – –"
    label(ctx, reading, 2.5, 1.95, 0.78, "#1b2410")
    var mode = String(p.props.mode || "V")
    var modes = ["V", "A", "Ω"]
    for (var i = 0; i < 3; i++) {
      var x = 0.8 + i * 1.7
      ctx.fillStyle = modes[i] === mode ? "#212121" : "#fbc02d"
      ctx.beginPath(); ctx.arc(x, 4.3, 0.55, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = INK; ctx.lineWidth = 0.05; ctx.stroke()
      label(ctx, modes[i], x, 4.3, 0.5, modes[i] === mode ? "#fbc02d" : "#212121")
    }
    terminal(ctx, 1, 0, "#e53935"); terminal(ctx, 4, 0, "#1b1b1b")
    label(ctx, "COM", 4, 5.8, 0.38, INK); label(ctx, "V Ω A", 1, 5.8, 0.38, "#b71c1c")
  },
  // The lead and jaw are drawn by the bench, from the socket at (2.5, 0.3).
  clampMeter: function (ctx, p, live) {
    roundRect(ctx, 0, 0.3, 5, 5.9, 0.45)
    ctx.fillStyle = "#ef6c00"; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.06; ctx.stroke()
    roundRect(ctx, 0.35, 1.0, 4.3, 1.9, 0.15)
    ctx.fillStyle = "#c5d6b0"; ctx.fill(); ctx.strokeStyle = "#5d6b4a"; ctx.lineWidth = 0.04; ctx.stroke()
    label(ctx, live.reading || "– – –", 2.5, 1.95, 0.74, "#1b2410")
    // Jaw badge: an open ring around a wire.
    ctx.strokeStyle = "#212121"; ctx.lineWidth = 0.28
    ctx.beginPath(); ctx.arc(2.5, 4.2, 0.85, -Math.PI * 0.3, Math.PI * 1.3); ctx.stroke()
    ctx.strokeStyle = "#ffcc80"; ctx.lineWidth = 0.14
    ctx.beginPath(); ctx.moveTo(1.2, 4.2); ctx.lineTo(3.8, 4.2); ctx.stroke()
    label(ctx, "CLAMP  A", 2.5, 5.65, 0.4, "#212121")
    ctx.fillStyle = "#212121"; ctx.beginPath(); ctx.arc(2.5, 0.3, 0.3, 0, Math.PI * 2); ctx.fill()
  }
}

function to92(ctx, name, color) {
  leg(ctx, 0, -0.3, 0, 0); leg(ctx, 1, -0.3, 1, 0); leg(ctx, 2, -0.3, 2, 0)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(-0.4, -0.25); ctx.lineTo(2.4, -0.25)
  ctx.arc(1, -0.25, 1.4, 0, Math.PI, true)
  ctx.closePath()
  ctx.fill()
  label(ctx, name, 1, -0.65, name.length > 4 ? 0.3 : 0.36, "#e0e0e0")
}

function pinLetters(ctx, letters) {
  for (var i = 0; i < letters.length; i++) label(ctx, letters[i], i, 0.55, 0.34, "#37474f")
}

function diodeBody(ctx, body, stripe) {
  leg(ctx, 0.8, 0, 0, 0); leg(ctx, 2.2, 0, 3, 0)
  roundRect(ctx, 0.75, -0.28, 1.5, 0.56, 0.12)
  ctx.fillStyle = body; ctx.fill()
  ctx.fillStyle = stripe; ctx.fillRect(1.9, -0.28, 0.2, 0.56)
}
