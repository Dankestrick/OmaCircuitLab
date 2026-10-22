import QtQuick
import "lib/Catalog.js" as Catalog
import "lib/Bench.js" as Bench
import "lib/Router.js" as Router

// The workbench: breadboard, parts and wires, plus every mouse interaction.
// Parts and wires are plain data in `bench`; everything here is drawn from it
// and hit-tested in grid units, so there is one MouseArea for the whole view.
Item {
  id: view
  clip: true

  property var bench: ({ parts: [], wires: [] })
  property int revision: 0
  property var result: null
  property var netlist: null
  property bool running: false
  property var motorAngles: ({})

  property string placingType: ""
  property int placingRot: 0
  property string wireColor: "red"
  property string selectedPart: ""
  property string selectedWire: ""
  property string fontFamily: "sans-serif"
  property color benchColor: "#20262b"
  property color dotColor: "#3a434b"

  signal bump()                       // bench data changed in place: redraw
  signal edited(string what)          // a committed change (for undo + re-solve)
  signal liveChanged()                // a button/knob change while running (no undo step)
  signal placed()
  signal wheelEdited()                // a value changed by scrolling (one undo step per burst)
  signal hoverChanged(var info)       // { title, body } or null

  // ---------------------------------------------------------------- zoom/pan
  readonly property real baseCell: 20
  property real zoom: 1
  readonly property real cell: baseCell * zoom
  property real offX: 0
  property real offY: 0

  // Zoom to what's on the bench (the breadboard plus every part and wire).
  function fit() {
    var r = Bench.boardRect()
    var x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h
    for (var i = 0; i < bench.parts.length; i++) {
      var b = Catalog.benchBox(bench.parts[i])
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0 - 0.8); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1)
    }
    for (var j = 0; j < bench.wires.length; j++) {
      var w = bench.wires[j]
      x0 = Math.min(x0, w.a.x, w.b.x); y0 = Math.min(y0, w.a.y, w.b.y); x1 = Math.max(x1, w.a.x, w.b.x); y1 = Math.max(y1, w.a.y, w.b.y)
    }
    x0 -= 1; y0 -= 1; x1 += 1; y1 += 1
    var z = Math.min(width / ((x1 - x0) * baseCell), height / ((y1 - y0) * baseCell))
    zoom = Math.max(0.5, Math.min(2.4, z))
    offX = (width - (x1 - x0) * cell) / 2 - x0 * cell
    offY = (height - (y1 - y0) * cell) / 2 - y0 * cell
  }
  onWidthChanged: Qt.callLater(fit)
  onHeightChanged: Qt.callLater(fit)

  function zoomAt(px, py, factor) {
    var gx = (px - offX) / cell, gy = (py - offY) / cell
    zoom = Math.max(0.5, Math.min(2.4, zoom * factor))
    offX = px - gx * cell
    offY = py - gy * cell
  }

  function toGrid(px, py) { return { x: (px - offX) / cell, y: (py - offY) / cell } }

  // ---------------------------------------------------------------- routing
  property var routes: ({})
  property int partCount: 0
  property var bodies: []

  function reroute() {
    var b = []
    for (var i = 0; i < bench.parts.length; i++) b.push(Catalog.benchBox(bench.parts[i]))
    bodies = b
    partCount = bench.parts.length
    function overPart(u, v) {
      var x = u / 2, y = v / 2
      for (var k = 0; k < b.length; k++)
        if (x > b[k].x0 && x < b[k].x1 && y > b[k].y0 && y < b[k].y1) return true
      return false
    }
    routes = Router.routeAll(bench.wires, overPart, { w: Bench.benchW, h: Bench.benchH })
    wiresCanvas.requestPaint()
  }
  onRevisionChanged: reroute()
  Component.onCompleted: { reroute(); Qt.callLater(fit) }

  // ---------------------------------------------------------------- hit tests
  function partAt(g) {
    for (var i = bench.parts.length - 1; i >= 0; i--) {
      var bb = Catalog.benchBox(bench.parts[i])
      if (g.x >= bb.x0 - 0.15 && g.x <= bb.x1 + 0.15 && g.y >= bb.y0 - 0.15 && g.y <= bb.y1 + 0.15) return bench.parts[i]
    }
    return null
  }

  function partById(id) {
    for (var i = 0; i < bench.parts.length; i++) if (bench.parts[i].id === id) return bench.parts[i]
    return null
  }
  function wireById(id) {
    for (var i = 0; i < bench.wires.length; i++) if (bench.wires[i].id === id) return bench.wires[i]
    return null
  }

  function wireAt(g) {
    var best = null, bestD = 0.3
    for (var i = bench.wires.length - 1; i >= 0; i--) {
      var pts = routes[bench.wires[i].id]
      if (!pts) continue
      for (var j = 1; j < pts.length; j++) {
        var d = segDist(g, pts[j - 1], pts[j])
        if (d < bestD) { bestD = d; best = bench.wires[i] }
      }
    }
    return best
  }

  // Segment of wire `w` under g (not right at its two ends), or -1.
  function segmentAt(w, g, tol) {
    var pts = routes[w.id]
    if (!pts) return -1
    if (Math.abs(g.x - w.a.x) < 0.45 && Math.abs(g.y - w.a.y) < 0.45) return -1
    if (Math.abs(g.x - w.b.x) < 0.45 && Math.abs(g.y - w.b.y) < 0.45) return -1
    var best = -1, bestD = tol
    for (var j = 1; j < pts.length; j++) {
      var d = segDist(g, pts[j - 1], pts[j])
      if (d < bestD) { bestD = d; best = j - 1 }
    }
    return best
  }

  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y
    var l = dx * dx + dy * dy
    var t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0
    var x = a.x + t * dx - p.x, y = a.y + t * dy - p.y
    return Math.sqrt(x * x + y * y)
  }

  // A point where a wire may start or end: a hole, a terminal on an
  // off-board part, or the end of another wire.
  function isWirePoint(x, y) {
    if (Bench.holeAt(x, y)) return true
    for (var i = 0; i < bench.parts.length; i++) {
      if (!Catalog.isOffBoard(bench.parts[i].type)) continue
      var pts = Catalog.pinPoints(bench.parts[i])
      for (var j = 0; j < pts.length; j++) if (pts[j].x === x && pts[j].y === y) return true
    }
    for (var w = 0; w < bench.wires.length; w++) {
      var wi = bench.wires[w]
      if ((wi.a.x === x && wi.a.y === y) || (wi.b.x === x && wi.b.y === y)) return true
    }
    return false
  }

  function snapPoint(g) {
    var x = Math.round(g.x), y = Math.round(g.y)
    var dx = g.x - x, dy = g.y - y
    if (dx * dx + dy * dy > 0.45 * 0.45) return null
    return isWirePoint(x, y) ? { x: x, y: y } : null
  }

  // Where the ghost part's first pin lands so the body is under the cursor.
  function ghostOrigin(g) {
    var b = Catalog.box(placingType, Catalog.defaults(placingType))
    var c = Catalog.rotate((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, placingRot)
    return { x: Math.round(g.x - c.x), y: Math.round(g.y - c.y) }
  }

  // ---------------------------------------------------------------- hover info
  property var hoverStrip: []
  property bool overWire: false
  property var hoverPoint: null

  function voltsAt(x, y) {
    if (!running || !result || !result.nodeVolts || !netlist) return null
    var n = Bench.nodeAt(netlist, x, y)
    if (n < 0 || n >= result.nodeVolts.length) return null
    return result.nodeVolts[n]
  }

  function describeHover(g) {
    var pt = { x: Math.round(g.x), y: Math.round(g.y) }
    var close = Math.abs(g.x - pt.x) < 0.4 && Math.abs(g.y - pt.y) < 0.4
    var part = partAt(g)
    var hole = close ? Bench.holeAt(pt.x, pt.y) : null
    hoverStrip = hole && !part ? Bench.stripHoles(pt.x, pt.y) : []
    hoverPoint = close && !part && isWirePoint(pt.x, pt.y) ? pt : null
    if (part) {
      var def = Catalog.parts[part.type]
      var lines = [def.tip]
      var live = result && result.parts ? result.parts[part.id] : null
      if (running && live) {
        var bits = []
        if (live.current !== undefined) bits.push("Current " + Catalog.si(Math.abs(live.current), "A"))
        if (live.pinVolts && live.pinVolts.length >= 2) bits.push("Voltage across " + Catalog.si(Math.abs(live.pinVolts[0] - live.pinVolts[1]), "V"))
        if (live.power !== undefined && live.power > 1e-4) bits.push("Power " + Catalog.si(live.power, "W"))
        if (bits.length) lines.push(bits.join("  ·  "))
      }
      var pins = Catalog.pinPoints(part)
      for (var i = 0; i < pins.length; i++) {
        if (Math.abs(g.x - pins[i].x) < 0.4 && Math.abs(g.y - pins[i].y) < 0.4) {
          var v = voltsAt(pins[i].x, pins[i].y)
          lines.unshift("Leg: " + def.pins[i].name + (v !== null ? "  (" + Catalog.si(v, "V") + ")" : ""))
        }
      }
      if (def.editable && def.editable.length) lines.push("Click it to change " + def.editable.map(function (e) { return e.label.toLowerCase() }).join(", ") + " in Inspect, or scroll on it for a quick change.")
      return { title: def.name, body: lines.join("\n") }
    }
    var wire = wireAt(g)
    if (wire) {
      var wv = voltsAt(wire.a.x, wire.a.y)
      var hint = ""
      for (var c = 0; c < Catalog.wireColors.length; c++) if (Catalog.wireColors[c].id === wire.color) hint = Catalog.wireColors[c].hint
      return { title: "Jumper wire", body: "Wires connect two points with almost no resistance. " + hint + (wv !== null ? "\nVoltage on this wire: " + Catalog.si(wv, "V") : "") }
    }
    if (hole) {
      var hv = voltsAt(pt.x, pt.y)
      var body = hole.kind === "rail"
        ? "Power rail: every hole along this line is connected. Wire your supply's " + (hole.sign === "+" ? "+ (red)" : "− (black)") + " here, then tap power anywhere along it."
        : "The five holes " + (hole.half === "top" ? "a–e" : "f–j") + " in column " + hole.column + " are connected inside the board (they light up now). The center channel separates the two halves."
      if (hv !== null) body += "\nVoltage here: " + Catalog.si(hv, "V")
      return { title: hole.label, body: body }
    }
    return null
  }

  // ---------------------------------------------------------------- painting
  // Board: drawn once per zoom, then just moved while panning.
  Item {
    id: world
    x: view.offX
    y: view.offY
    width: Bench.benchW * view.cell
    height: Bench.benchH * view.cell

    // Workbench mat with a faint dot grid: solid so see-through themes stay readable.
    Rectangle {
      anchors.fill: parent
      color: view.benchColor
      radius: view.cell * 0.4
    }

    Canvas {
      id: boardCanvas
      readonly property var r: Bench.boardRect()
      x: r.x * view.cell
      y: r.y * view.cell
      width: r.w * view.cell
      height: r.h * view.cell
      property real cellAtPaint: 0
      onWidthChanged: requestPaint()
      onPaint: {
        var ctx = getContext("2d")
        var c = view.cell
        ctx.reset()
        ctx.save()
        ctx.scale(c, c)
        ctx.translate(-r.x, -r.y)
        // Board body with a soft shadow.
        ctx.fillStyle = "rgba(0,0,0,0.35)"
        ctx.fillRect(r.x + 0.15, r.y + 0.2, r.w, r.h)
        ctx.fillStyle = "#f3f1ea"
        ctx.fillRect(r.x, r.y, r.w, r.h)
        // Center channel.
        ctx.fillStyle = "#dedbd1"
        ctx.fillRect(Bench.boardX - 1.2, Bench.boardY + 8.25, Bench.columns + 1.4, 1.5)
        // Rail stripes.
        var stripes = [[0, -0.6, "#d32f2f"], [1, 0.6, "#1e63c8"], [16, -0.6, "#d32f2f"], [17, 0.6, "#1e63c8"]]
        for (var s = 0; s < stripes.length; s++) {
          ctx.fillStyle = stripes[s][2]
          ctx.fillRect(Bench.boardX - 0.6, Bench.boardY + stripes[s][0] + stripes[s][1] - 0.04, Bench.columns - 0.8, 0.08)
        }
        // Holes.
        var holes = Bench.allHoles()
        ctx.fillStyle = "#3b3b3b"
        for (var i = 0; i < holes.length; i++) ctx.fillRect(holes[i].x - 0.17, holes[i].y - 0.17, 0.34, 0.34)
        // Labels: rail signs, row letters, every 5th column number.
        ctx.save()
        ctx.scale(0.01, 0.01)
        ctx.font = "bold 42px sans-serif"
        ctx.textAlign = "center"; ctx.textBaseline = "middle"
        function t(text, x, y, color) { ctx.fillStyle = color; ctx.fillText(text, x * 100, y * 100) }
        var signs = [[0, "+", "#d32f2f"], [1, "−", "#1e63c8"], [16, "+", "#d32f2f"], [17, "−", "#1e63c8"]]
        for (var k = 0; k < signs.length; k++) {
          t(signs[k][1], Bench.boardX - 1.0, Bench.boardY + signs[k][0], signs[k][2])
          t(signs[k][1], Bench.boardX + Bench.columns, Bench.boardY + signs[k][0], signs[k][2])
        }
        for (var row in Bench.rowLetters) {
          t(Bench.rowLetters[row], Bench.boardX - 1.0, Bench.boardY + Number(row), "#6d6a60")
          t(Bench.rowLetters[row], Bench.boardX + Bench.columns, Bench.boardY + Number(row), "#6d6a60")
        }
        for (var col = 1; col <= Bench.columns; col++) {
          if (col !== 1 && col % 5 !== 0) continue
          t(String(col), Bench.boardX + col - 1, Bench.boardY + 2.05, "#6d6a60")
          t(String(col), Bench.boardX + col - 1, Bench.boardY + 14.95, "#6d6a60")
        }
        ctx.restore()
        ctx.restore()
      }
      Connections {
        target: view
        function onCellChanged() { boardCanvas.requestPaint() }
      }
    }

    // Connected holes under the cursor.
    Repeater {
      model: view.hoverStrip
      delegate: Rectangle {
        required property var modelData
        x: (modelData.x - 0.32) * view.cell
        y: (modelData.y - 0.32) * view.cell
        width: 0.64 * view.cell
        height: width
        radius: width / 2
        color: "transparent"
        border.color: "#00b0ff"
        border.width: Math.max(2, view.cell * 0.12)
      }
    }

    // Model is the part count, so dragging one part never rebuilds the others.
    Repeater {
      model: view.partCount
      delegate: PartView {
        required property int index
        readonly property var src: view.revision >= 0 && index < view.bench.parts.length ? view.bench.parts[index] : null
        part: src
        revision: view.revision
        cell: view.cell
        running: view.running
        live: src && view.running && view.result && view.result.parts ? view.result.parts[src.id] || null : null
        angle: src ? view.motorAngles[src.id] || 0 : 0
        selected: src ? view.selectedPart === src.id : false
        warning: src ? view.warningFor(src.id) : ""
      }
    }

    // Only as big as the visible area (so zooming in doesn't eat memory);
    // it repaints when the view moves.
    Canvas {
      id: wiresCanvas
      x: -view.offX
      y: -view.offY
      width: view.width
      height: view.height
      onWidthChanged: requestPaint()
      onHeightChanged: requestPaint()
      onXChanged: requestPaint()
      onYChanged: requestPaint()
      onPaint: {
        var ctx = getContext("2d")
        ctx.reset()
        ctx.save()
        ctx.translate(view.offX, view.offY)
        ctx.scale(view.cell, view.cell)
        ctx.lineCap = "round"; ctx.lineJoin = "round"
        function path(pts) {
          ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y)
          for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y)
        }
        for (var i = 0; i < view.bench.wires.length; i++) {
          var w = view.bench.wires[i]
          var pts = view.routes[w.id]
          if (!pts) continue
          var hex = Catalog.wireHex(w.color)
          var sel = view.selectedWire === w.id
          // Outline keeps every color visible on the light board and the dark mat.
          ctx.strokeStyle = sel ? "#00b0ff" : (w.color === "black" ? "#8a8a8a" : "rgba(0,0,0,0.75)")
          ctx.lineWidth = sel ? 0.46 : 0.34
          path(pts); ctx.stroke()
          ctx.strokeStyle = hex
          ctx.lineWidth = 0.22
          path(pts); ctx.stroke()
          ctx.strokeStyle = "rgba(255,255,255,0.28)"
          ctx.lineWidth = 0.06
          path(pts); ctx.stroke()
          var ends = [w.a, w.b]
          for (var e = 0; e < 2; e++) {
            ctx.fillStyle = "#9aa0a6"
            ctx.beginPath(); ctx.arc(ends[e].x, ends[e].y, 0.2, 0, Math.PI * 2); ctx.fill()
            ctx.fillStyle = hex
            ctx.beginPath(); ctx.arc(ends[e].x, ends[e].y, 0.11, 0, Math.PI * 2); ctx.fill()
          }
        }
        // Wire being drawn.
        if (view.drag.kind === "wire" && view.drag.preview) {
          var pv = view.drag.preview
          ctx.globalAlpha = 0.85
          ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 0.34; path(pv); ctx.stroke()
          ctx.strokeStyle = Catalog.wireHex(view.wireColor); ctx.lineWidth = 0.22; path(pv); ctx.stroke()
          ctx.globalAlpha = 1
        }
        ctx.restore()
      }
    }

    // Wire end handles on the selected wire.
    Repeater {
      model: {
        var w = view.selectedWire ? view.wireById(view.selectedWire) : null
        return w ? [w.a, w.b] : []
      }
      delegate: Rectangle {
        required property var modelData
        x: (modelData.x - 0.35) * view.cell
        y: (modelData.y - 0.35) * view.cell
        width: 0.7 * view.cell; height: width; radius: width / 2
        color: "transparent"; border.color: "#00b0ff"; border.width: 2
      }
    }

    // Bend handles (squares) and run handles (bars) on the selected wire.
    Repeater {
      model: {
        var _ = view.revision
        var pts = view.selectedWire ? view.routes[view.selectedWire] : null
        if (!pts) return []
        var out = []
        for (var i = 1; i < pts.length - 1; i++) out.push({ x: pts[i].x, y: pts[i].y, kind: "bend" })
        for (var j = 1; j < pts.length; j++) {
          var len = Math.abs(pts[j].x - pts[j - 1].x) + Math.abs(pts[j].y - pts[j - 1].y)
          if (len >= 1.5) out.push({ x: (pts[j].x + pts[j - 1].x) / 2, y: (pts[j].y + pts[j - 1].y) / 2, kind: pts[j].y === pts[j - 1].y ? "runH" : "runV" })
        }
        return out
      }
      delegate: Rectangle {
        required property var modelData
        readonly property bool bend: modelData.kind === "bend"
        width: (bend ? 0.5 : modelData.kind === "runH" ? 0.9 : 0.36) * view.cell
        height: (bend ? 0.5 : modelData.kind === "runV" ? 0.9 : 0.36) * view.cell
        x: modelData.x * view.cell - width / 2
        y: modelData.y * view.cell - height / 2
        radius: bend ? 2 : height / 2
        color: bend ? "#ffffff" : "#00b0ff"
        border.color: "#00b0ff"
        border.width: 2
      }
    }

    // Snap target under the cursor while drawing a wire or hovering a point.
    Rectangle {
      visible: view.hoverPoint !== null && view.placingType === ""
      x: view.hoverPoint ? (view.hoverPoint.x - 0.42) * view.cell : 0
      y: view.hoverPoint ? (view.hoverPoint.y - 0.42) * view.cell : 0
      width: 0.84 * view.cell; height: width; radius: width / 2
      color: "transparent"
      border.color: "#ffd600"; border.width: Math.max(2, view.cell * 0.1)
    }

    // Ghost of the part being placed.
    PartView {
      id: ghost
      visible: view.placingType !== "" && view.ghostPos !== null
      opacity: 0.7
      cell: view.cell
      part: view.placingType !== "" && view.ghostPos
        ? { id: "ghost", type: view.placingType, x: view.ghostPos.x, y: view.ghostPos.y, rot: view.placingRot, props: Catalog.defaults(view.placingType) }
        : null
    }
  }

  property var ghostPos: null

  function warningFor(id) {
    if (!running || !result || !result.warnings) return ""
    var level = ""
    for (var i = 0; i < result.warnings.length; i++) {
      var w = result.warnings[i]
      if (w.part !== id) continue
      if (w.level === "danger") return "danger"
      if (w.level === "warn") level = "warn"
    }
    return level
  }

  onRoutesChanged: wiresCanvas.requestPaint()
  onSelectedWireChanged: wiresCanvas.requestPaint()
  onCellChanged: wiresCanvas.requestPaint()

  // ---------------------------------------------------------------- input
  property var drag: ({ kind: "" })

  function newId(prefix) { return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36) }

  function rotateSelected() {
    if (placingType !== "") { placingRot = (placingRot + 1) % 4; return }
    var p = partById(selectedPart)
    if (!p) return
    p.rot = (p.rot + 1) % 4
    bump()
    edited("Rotate")
  }

  function deleteSelected() {
    if (selectedPart) {
      bench.parts = bench.parts.filter(function (p) { return p.id !== view.selectedPart })
      selectedPart = ""
      bump()
      edited("Delete part")
    } else if (selectedWire) {
      bench.wires = bench.wires.filter(function (w) { return w.id !== view.selectedWire })
      selectedWire = ""
      bump()
      edited("Delete wire")
    }
  }

  // Next (or previous) entry of a list, staying at the ends.
  function stepList(list, current, step) {
    var i = list.indexOf(current)
    if (i < 0) {
      for (i = 0; i < list.length - 1 && list[i] < current; i++) {}
    }
    return list[Math.max(0, Math.min(list.length - 1, i + step))]
  }

  // Scroll over a part changes its main value; anywhere else zooms.
  function wheelPart(part, delta) {
    var step = delta > 0 ? 1 : -1
    var pr = part.props
    if (part.type === "potentiometer") pr.turn = Math.max(0, Math.min(1, Math.round((pr.turn + step * 0.05) * 100) / 100))
    else if (part.type === "ldr") pr.light = Math.max(0, Math.min(1, Math.round((pr.light + step * 0.05) * 100) / 100))
    else if (part.type === "thermistor" || part.type === "tmp36") pr.celsius = Math.max(-20, Math.min(120, pr.celsius + step * 2))
    else if (part.type === "benchSupply") pr.volts = Math.max(0, Math.min(15, Math.round((pr.volts + step * 0.1) * 10) / 10))
    else if (part.type === "hcsr04" || part.type === "robotCar") pr.distance = Math.max(2, Math.min(300, pr.distance + step * 2))
    else if (part.type === "resistor") pr.ohms = stepList(Catalog.resistorValues, pr.ohms, step)
    else if (part.type === "capacitor") pr.farads = stepList([1e-9, 1e-8, 1e-7, 1e-6], pr.farads, step)
    else if (part.type === "electrolytic") pr.farads = stepList([1e-6, 1e-5, 1e-4, 4.7e-4, 1e-3], pr.farads, step)
    else if (part.type === "led") pr.color = stepList(["red", "orange", "yellow", "green", "blue", "white"], pr.color, step)
    else if (part.type === "aaPack") { pr.cells = stepList([2, 3, 4], pr.cells, step); pr.volts = pr.cells * 1.5 }
    else if (part.type === "zener") pr.zenerVolts = stepList([3.3, 5.1, 9.1, 12], pr.zenerVolts, step)
    else return false
    bump()
    liveChanged()
    wheelEdited()
    return true
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.LeftButton | Qt.MiddleButton | Qt.RightButton
    cursorShape: view.drag.kind === "pan" ? Qt.ClosedHandCursor
      : view.drag.kind === "seg" || view.drag.kind === "bend" || view.overWire ? Qt.SizeAllCursor
      : view.placingType !== "" ? Qt.CrossCursor
      : view.hoverPoint ? Qt.CrossCursor : Qt.ArrowCursor

    onWheel: function (wheel) {
      var g = view.toGrid(wheel.x, wheel.y)
      var p = view.partAt(g)
      if (p && view.wheelPart(p, wheel.angleDelta.y)) { view.hoverChanged(view.describeHover(g)); return }
      view.zoomAt(wheel.x, wheel.y, wheel.angleDelta.y > 0 ? 1.1 : 1 / 1.1)
    }

    onPressed: function (m) {
      view.forceActiveFocus()
      var g = view.toGrid(m.x, m.y)
      if (m.button === Qt.MiddleButton || (m.button === Qt.LeftButton && (m.modifiers & Qt.ShiftModifier) && view.placingType === "")) {
        view.drag = { kind: "pan", sx: m.x, sy: m.y, ox: view.offX, oy: view.offY }
        return
      }
      if (m.button === Qt.RightButton) {
        if (view.placingType !== "") { view.placingType = ""; return }
        var rp = view.partAt(g)
        if (rp) { view.selectedPart = rp.id; view.selectedWire = ""; view.rotateSelected() }
        return
      }
      if (view.placingType !== "") {
        var o = view.ghostOrigin(g)
        var part = { id: view.newId("p"), type: view.placingType, x: o.x, y: o.y, rot: view.placingRot, props: Catalog.defaults(view.placingType) }
        view.bench.parts.push(part)
        view.selectedPart = part.id
        view.selectedWire = ""
        if (!(m.modifiers & Qt.ControlModifier)) view.placingType = ""
        view.bump()
        view.edited("Add " + Catalog.parts[part.type].name)
        view.placed()
        return
      }
      // Grab an end of the selected wire to move it.
      var sw = view.selectedWire ? view.wireById(view.selectedWire) : null
      if (sw) {
        var ends = ["a", "b"]
        for (var e = 0; e < 2; e++) {
          var pe = sw[ends[e]]
          if (Math.abs(g.x - pe.x) < 0.45 && Math.abs(g.y - pe.y) < 0.45) {
            view.drag = { kind: "wireEnd", wire: sw.id, end: ends[e], moved: false }
            return
          }
        }
      }
      // Bends and runs of the selected wire can be dragged into place.
      if (sw) {
        var spts = view.routes[sw.id] || []
        for (var c = 1; c < spts.length - 1; c++) {
          if (Math.abs(g.x - spts[c].x) < 0.35 && Math.abs(g.y - spts[c].y) < 0.35) {
            view.drag = { kind: "bend", wire: sw.id, k: c, base: Router.copyPath(spts), moved: false }
            return
          }
        }
        var si = view.segmentAt(sw, g, 0.32)
        if (si >= 0) {
          view.drag = { kind: "seg", wire: sw.id, i: si, base: Router.copyPath(spts), moved: false }
          return
        }
      }
      // Any wire: press on it to select it, drag to slide that run sideways.
      for (var wi = view.bench.wires.length - 1; wi >= 0; wi--) {
        var ww = view.bench.wires[wi]
        var wsi = view.segmentAt(ww, g, 0.24)
        if (wsi >= 0) {
          view.selectedWire = ww.id
          view.selectedPart = ""
          view.drag = { kind: "seg", wire: ww.id, i: wsi, base: Router.copyPath(view.routes[ww.id]), moved: false }
          return
        }
      }
      var hit = view.partAt(g)
      var sp = view.snapPoint(g)
      // On a part, a leg starts a wire only for off-board terminals; else it is the part.
      if (sp && (!hit || Catalog.isOffBoard(hit.type))) {
        var onTerminal = hit && Catalog.isOffBoard(hit.type)
        var term = false
        if (onTerminal) {
          var pins = Catalog.pinPoints(hit)
          for (var k = 0; k < pins.length; k++) if (pins[k].x === sp.x && pins[k].y === sp.y) term = true
        }
        if (!hit || term) {
          view.drag = { kind: "wire", from: sp, preview: null }
          view.selectedPart = ""; view.selectedWire = ""
          return
        }
      }
      if (hit) {
        view.selectedPart = hit.id
        view.selectedWire = ""
        if (hit.type === "pushButton") { hit.props.pressed = true; view.bump(); view.liveChanged() }
        view.drag = { kind: "part", id: hit.id, gx: g.x, gy: g.y, px: hit.x, py: hit.y, moved: false }
        return
      }
      var wh = view.wireAt(g)
      if (wh) {
        view.selectedWire = wh.id
        view.selectedPart = ""
        return
      }
      view.selectedPart = ""
      view.selectedWire = ""
      view.drag = { kind: "pan", sx: m.x, sy: m.y, ox: view.offX, oy: view.offY }
    }

    onPositionChanged: function (m) {
      var g = view.toGrid(m.x, m.y)
      var d = view.drag
      if (d.kind === "pan") {
        view.offX = d.ox + (m.x - d.sx)
        view.offY = d.oy + (m.y - d.sy)
        return
      }
      if (d.kind === "part") {
        var nx = d.px + Math.round(g.x - d.gx), ny = d.py + Math.round(g.y - d.gy)
        var p = view.partById(d.id)
        if (p && (nx !== p.x || ny !== p.y)) {
          if (!d.moved && p.type === "pushButton" && p.props.pressed) { p.props.pressed = false; view.liveChanged() }
          d.moved = true
          p.x = nx; p.y = ny
          view.bump()
        }
        return
      }
      if (d.kind === "wire") {
        var to = { x: Math.round(g.x), y: Math.round(g.y) }
        d.preview = Router.route(d.from, to, new Router.Occupancy(), function () { return false }, { w: Bench.benchW, h: Bench.benchH })
        var snap = view.snapPoint(g)
        view.hoverPoint = snap
        wiresCanvas.requestPaint()
        return
      }
      if (d.kind === "seg" || d.kind === "bend") {
        var sw2 = view.wireById(d.wire)
        if (!sw2) return
        var lane = function (v) { return Math.round(v * 2) / 2 }
        var np
        if (d.kind === "seg") {
          var horiz = d.base[d.i].y === d.base[d.i + 1].y
          var val = lane(horiz ? g.y : g.x)
          if (val === (horiz ? d.base[d.i].y : d.base[d.i].x) && !d.moved) return
          np = Router.moveSegment(d.base, d.i, val)
        } else {
          np = Router.moveCorner(d.base, d.k, lane(g.x), lane(g.y))
        }
        if (JSON.stringify(np) !== JSON.stringify(sw2.path || null)) {
          sw2.path = np
          d.moved = true
          view.bump()
        }
        return
      }
      if (d.kind === "wireEnd") {
        var ws = view.snapPoint(g)
        var w = view.wireById(d.wire)
        if (ws && w && (ws.x !== w[d.end].x || ws.y !== w[d.end].y)) {
          w[d.end] = ws
          delete w.path
          d.moved = true
          view.bump()
        }
        return
      }
      if (view.placingType !== "") {
        view.ghostPos = view.ghostOrigin(g)
        return
      }
      var ow = false
      for (var wi2 = 0; wi2 < view.bench.wires.length && !ow; wi2++) if (view.segmentAt(view.bench.wires[wi2], g, 0.24) >= 0) ow = true
      view.overWire = ow
      view.hoverChanged(view.describeHover(g))
    }

    onReleased: function (m) {
      var d = view.drag
      view.drag = { kind: "" }
      var g = view.toGrid(m.x, m.y)
      if (d.kind === "wire") {
        var to = view.snapPoint(g)
        if (to && (to.x !== d.from.x || to.y !== d.from.y)) {
          var wire = { id: view.newId("w"), a: d.from, b: to, color: view.wireColor }
          view.bench.wires.push(wire)
          view.selectedWire = wire.id
          view.bump()
          view.edited("Add wire")
        } else {
          wiresCanvas.requestPaint()
        }
      } else if (d.kind === "part") {
        var p = view.partById(d.id)
        if (p && p.type === "pushButton" && p.props.pressed) { p.props.pressed = false; view.bump(); view.liveChanged() }
        if (d.moved) view.edited("Move part")
        else if (p && p.type === "slideSwitch") { p.props.position = p.props.position ? 0 : 1; view.bump(); view.liveChanged() }
        else if (p && p.type === "multimeter") {
          var modes = ["V", "A", "Ω"]
          p.props.mode = modes[(modes.indexOf(p.props.mode) + 1) % 3]
          view.bump()
          view.edited("Meter mode")
        }
      } else if (d.kind === "wireEnd" && d.moved) {
        view.edited("Move wire end")
      } else if ((d.kind === "seg" || d.kind === "bend") && d.moved) {
        view.edited("Shape wire")
      }
    }

    onExited: { view.hoverStrip = []; view.hoverPoint = null; view.ghostPos = null; view.hoverChanged(null) }
  }
}
