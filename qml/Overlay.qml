import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import qs.Commons
import qs.Ui
import "lib/Catalog.js" as Catalog
import "lib/Bench.js" as Bench
import "lib/Clamp.js" as Clamp
import "lib/Lessons.js" as Lessons
import "lib/Arena.js" as Arena

// The OmaCircuitLab window. Opened from the app menu (omarchy-shell shell
// toggle io.github.dankestrick.omacircuitlab). Nothing is loaded while it is
// closed: the shell only creates this file when the window opens, so the
// simulator costs nothing in the background. Work is saved on every edit.
Item {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: ""

  property bool opened: false
  property bool closingFromHost: false
  readonly property string pluginId: (manifest && manifest.id) || "io.github.dankestrick.omacircuitlab"

  // ------------------------------------------------------------------ theme
  readonly property color themeBg: Color.menu.background
  readonly property color fg: Color.menu.text
  readonly property color accent: Color.accent
  readonly property color muted: Color.muted
  readonly property color urgent: Color.urgent
  property string fontFamily: Style.font.family
  // A learning tool in a big window: text runs about a quarter larger than the shell's.
  readonly property int fCaption: Math.round(Style.font.caption * 1.25)
  readonly property int fSmall: Math.round(Style.font.bodySmall * 1.25)
  readonly property int fBody: Math.round(Style.font.body * 1.25)
  readonly property int fSubtitle: Math.round(Style.font.subtitle * 1.3)
  readonly property int fTitle: Math.round(Style.font.title * 1.35)
  readonly property int pad: Style.spacing.panelPadding

  // Solid by default: see-through themes make a circuit hard to read.
  property string opacityMode: "solid"     // solid | theme | custom
  property real customOpacity: 0.85
  readonly property real chromeAlpha: opacityMode === "theme" ? themeBg.a : 1
  readonly property color chromeBg: Qt.rgba(themeBg.r, themeBg.g, themeBg.b, chromeAlpha)
  readonly property bool darkTheme: (themeBg.r * 0.299 + themeBg.g * 0.587 + themeBg.b * 0.114) < 0.5
  // Cards and the bench mat are always opaque and a step off the background.
  readonly property color cardBg: darkTheme ? Qt.lighter(Qt.rgba(themeBg.r, themeBg.g, themeBg.b, 1), 1.45) : Qt.darker(Qt.rgba(themeBg.r, themeBg.g, themeBg.b, 1), 1.06)
  readonly property color matBg: darkTheme ? Qt.rgba(0.16, 0.19, 0.21, 1) : Qt.rgba(0.80, 0.83, 0.85, 1)
  readonly property color lineColor: Qt.rgba(fg.r, fg.g, fg.b, 0.18)

  function textOn(fill) {
    var c = Qt.color(fill)
    return (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) > 0.55 ? "#111111" : "#f4f4f4"
  }

  // ------------------------------------------------------------------ state
  property var bench: ({ parts: [], wires: [] })
  property int revision: 0
  property bool running: false
  property var netlist: null
  property var result: null
  property bool engineBusy: false
  property bool timeDependent: false
  property var history: []
  property int historyIndex: -1
  property string wireColor: "red"
  property string rightTab: "inspect"     // inspect | guide | tools
  property int lessonIndex: 0
  property string category: "basics"
  property var hoverInfo: null
  property var motorAngles: ({})
  property bool loadedOnce: false
  property string codePartId: ""          // OmaDuino whose code editor is open
  property bool arenaOpen: false
  property bool projectsOpen: false
  property var projects: ({})
  property var arenaState: Arena.createState("boxes")

  readonly property var robotCar: {
    var _ = revision
    for (var i = 0; i < bench.parts.length; i++) if (bench.parts[i].type === "robotCar") return bench.parts[i]
    return null
  }
  readonly property var robotLive: running && robotCar && result && result.parts ? result.parts[robotCar.id] || null : null

  // Drive the car around the arena with the wheel speeds the engine reports,
  // and feed what its sonar sees back into the circuit. Only while visible.
  Timer {
    interval: 33
    repeat: true
    running: root.arenaOpen && root.running && root.windowShown && root.robotCar !== null
    onTriggered: {
      var l = root.robotLive ? Number(root.robotLive.leftSpin) || 0 : 0
      var r = root.robotLive ? Number(root.robotLive.rightSpin) || 0 : 0
      root.arenaState = Arena.step(root.arenaState, l, r, 0.033)
      var d = Math.round(root.arenaState.distance)
      if (Math.abs(d - root.robotCar.props.distance) >= 1) {
        root.robotCar.props.distance = d
        engine.sendMessage({ cmd: "setProp", id: root.robotCar.id, key: "distance", value: d })
      }
    }
  }

  // One file, so nothing has to create a folder first.
  readonly property string savePath: Quickshell.env("HOME") + "/.local/share/omacircuitlab.json"

  function cloneBench(b) { return JSON.parse(JSON.stringify(b)) }

  function pushHistory() {
    var snap = JSON.stringify(bench)
    if (historyIndex >= 0 && history[historyIndex] === snap) return
    var h = history.slice(0, historyIndex + 1)
    h.push(snap)
    if (h.length > 80) h.shift()
    history = h
    historyIndex = h.length - 1
  }

  function restore(snap) {
    bench = JSON.parse(snap)
    benchView.selectedPart = ""
    benchView.selectedWire = ""
    revision++
    circuitChanged()
  }

  function undo() { if (historyIndex > 0) { historyIndex--; restore(history[historyIndex]) } }
  function redo() { if (historyIndex < history.length - 1) { historyIndex++; restore(history[historyIndex]) } }

  function setBench(b, label) {
    loadedOnce = true   // a bench built before the save file loads wins over it
    bench = cloneBench(b)
    benchView.selectedPart = ""
    benchView.selectedWire = ""
    revision++
    pushHistory()
    circuitChanged()
  }

  function clearBench() { setBench({ parts: [], wires: [] }, "Clear") }

  // An edit happened: save soon, and re-solve if running.
  function circuitChanged() {
    saveTimer.restart()
    if (running && anyBurnt()) resetSim()   // the fix goes in with fresh parts
    else if (running) loadEngine()
    else netlist = Bench.buildNetlist(bench)   // keeps "How it's connected" current while stopped
  }

  // ------------------------------------------------------------------ engine
  // The solver runs on its own thread. Requests are one at a time, so a slow
  // circuit can never pile up work; the step timer only runs for circuits
  // that change over time, and only while the window is open and running.
  WorkerScript {
    id: engine
    source: "lib/worker/EngineWorker.mjs"
    onMessage: function (msg) {
      // A reply to a request sent before Reset/Stop would flash the old result.
      if (root.staleReplies > 0) { root.staleReplies--; return }
      root.engineBusy = false
      if (!msg || msg.kind !== "result") return
      root.result = Clamp.annotate(root.bench, root.netlist, msg.result)
      if (root.pendingLoad) { root.pendingLoad = false; root.loadEngine() }
    }
  }
  property bool pendingLoad: false
  property int staleReplies: 0

  // Forget the request in flight: its reply is dropped when it arrives.
  function dropInFlight() {
    if (engineBusy) staleReplies++
    engineBusy = false
    pendingLoad = false
  }

  // Parts whose state changes over time; only these need the step timer.
  readonly property var timeTypes: ({ capacitor: true, electrolytic: true, motor: true, buzzer: true, omaduino: true, servo: true, hcsr04: true })

  function loadEngine() {
    netlist = Bench.buildNetlist(bench)
    var timed = false
    for (var i = 0; i < netlist.elements.length; i++) if (timeTypes[netlist.elements[i].type]) timed = true
    timeDependent = timed
    if (engineBusy) { pendingLoad = true; return }
    engineBusy = true
    // Only what the solver needs crosses to the worker thread.
    // Clamp meters only watch; Clamp.annotate reads them after each solve.
    var els = netlist.elements.filter(function (e) { return e.type !== "clampMeter" })
    engine.sendMessage({ cmd: "load", netlist: { nodeCount: netlist.nodeCount, ground: netlist.ground, elements: els } })
  }

  function anyBurnt() {
    if (!result || !result.parts) return false
    for (var id in result.parts) if (result.parts[id].burnt) return true
    return false
  }

  // Every Run starts with fresh parts and empty capacitors.
  function startSim() {
    running = true
    resetSim()
  }
  function stopSim() {
    running = false
    dropInFlight()
    result = null
    motorAngles = ({})
  }
  function resetSim() {
    engine.sendMessage({ cmd: "reset" })
    dropInFlight()
    if (running) loadEngine()
  }

  readonly property bool windowShown: root.opened && panel.visible

  Timer {
    id: stepTimer
    interval: 33
    repeat: true
    running: root.running && root.windowShown && root.timeDependent
    onTriggered: {
      if (root.engineBusy) return
      root.engineBusy = true
      engine.sendMessage({ cmd: "step", dt: 0.001, steps: 33 })
    }
  }

  // Motors turn at a speed set by their current. Only ticks while one spins.
  readonly property bool anySpin: {
    if (!running || !result || !result.parts) return false
    for (var id in result.parts) if (Math.abs(result.parts[id].spin || 0) > 0.02) return true
    return false
  }
  Timer {
    interval: 33
    repeat: true
    running: root.anySpin && root.windowShown
    onTriggered: {
      var next = ({})
      for (var id in root.result.parts) {
        var s = root.result.parts[id].spin || 0
        next[id] = ((root.motorAngles[id] || 0) + s * 0.5) % (Math.PI * 2)
      }
      root.motorAngles = next
    }
  }

  // ------------------------------------------------------------------ saving
  FileView {
    id: autosaveFile
    path: root.savePath
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: root.applySaved(text())
    onLoadFailed: root.applySaved("")
  }

  // Saved circuits ("My circuits"), all in one file next to the autosave.
  FileView {
    id: projectsFile
    path: Quickshell.env("HOME") + "/.local/share/omacircuitlab-projects.json"
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: {
      try {
        var data = JSON.parse(text())
        var clean = ({})
        for (var k in data.projects) {
          var p = data.projects[k]
          if (p && p.bench && Array.isArray(p.bench.parts)) clean[String(k).substring(0, 80)] = { bench: root.sanitize(p.bench), saved: String(p.saved || "") }
        }
        root.projects = clean
      } catch (e) { root.projects = ({}) }
    }
  }

  function writeProjects() {
    projectsFile.setText(JSON.stringify({ version: 1, projects: projects }))
  }
  function saveProject(name) {
    var next = ({})
    for (var k in projects) next[k] = projects[k]
    next[name] = { bench: cloneBench(bench), saved: new Date().toISOString() }
    projects = next
    writeProjects()
    projectsOpen = false
    toast("Saved “" + name + "”")
  }
  function openProject(name) {
    if (!projects[name]) return
    setBench(projects[name].bench, "Open")
    benchView.fit()
    projectsOpen = false
    toast("Opened “" + name + "”")
  }
  function removeProject(name) {
    var next = ({})
    for (var k in projects) if (k !== name) next[k] = projects[k]
    projects = next
    writeProjects()
  }

  property string toastText: ""
  function toast(t) { toastText = t; toastTimer.restart() }
  Timer { id: toastTimer; interval: 2200; onTriggered: root.toastText = "" }

  // The app menu entry. Written on first open when missing, so a marketplace
  // install (which runs no install script) still shows up in the launcher.
  FileView {
    id: desktopEntry
    path: Quickshell.env("HOME") + "/.local/share/applications/omacircuitlab.desktop"
    watchChanges: false
    printErrors: false
    onLoadFailed: {
      setText([
        "[Desktop Entry]",
        "Type=Application",
        "Name=OmaCircuitLab",
        "GenericName=Circuit Simulator",
        "Comment=Build breadboard circuits and learn electronics: LEDs, sensors, transistors, motors",
        "Exec=omarchy-shell shell toggle " + root.pluginId,
        "TryExec=omarchy-shell",
        "Icon=" + Quickshell.env("HOME") + "/.config/omarchy/plugins/" + root.pluginId + "/icon.png",
        "Terminal=false",
        "StartupNotify=false",
        "Categories=Education;Electronics;Science;",
        "Keywords=circuit;breadboard;electronics;led;resistor;arduino;robot;simulator;learn;",
        ""
      ].join("\n"))
    }
  }

  function applySaved(text) {
    if (loadedOnce) return
    loadedOnce = true
    var data = null
    try { data = text ? JSON.parse(text) : null } catch (e) { data = null }
    if (data && data.bench && Array.isArray(data.bench.parts)) {
      bench = sanitize(data.bench)
      if (data.settings) {
        if (["solid", "theme", "custom"].indexOf(data.settings.opacityMode) >= 0) opacityMode = data.settings.opacityMode
        if (typeof data.settings.customOpacity === "number") customOpacity = Math.max(0.5, Math.min(1, data.settings.customOpacity))
        if (typeof data.settings.wireColor === "string") wireColor = data.settings.wireColor
        if (typeof data.settings.lessonIndex === "number") lessonIndex = Math.max(0, Math.min(Lessons.lessons.length - 1, data.settings.lessonIndex))
      }
    } else {
      // First run: start with lesson 1 built so there is something to try.
      bench = Lessons.lessons[0].build()
      rightTab = "guide"
    }
    revision++
    pushHistory()
    netlist = Bench.buildNetlist(bench)
  }

  // Only keep parts and wires we understand, so a hand-edited file can't break the window.
  function sanitize(b) {
    var out = { parts: [], wires: [] }
    for (var i = 0; i < b.parts.length; i++) {
      var p = b.parts[i]
      if (!p || !Catalog.parts[p.type]) continue
      var props = Catalog.defaults(p.type)
      for (var k in props) if (p.props && typeof p.props[k] === typeof props[k]) props[k] = p.props[k]
      out.parts.push({ id: String(p.id), type: p.type, x: Math.round(Number(p.x) || 0), y: Math.round(Number(p.y) || 0), rot: ((Math.round(Number(p.rot) || 0) % 4) + 4) % 4, props: props })
    }
    if (Array.isArray(b.wires)) for (var j = 0; j < b.wires.length; j++) {
      var w = b.wires[j]
      if (!w || !w.a || !w.b) continue
      var nw = { id: String(w.id), a: { x: Math.round(Number(w.a.x) || 0), y: Math.round(Number(w.a.y) || 0) }, b: { x: Math.round(Number(w.b.x) || 0), y: Math.round(Number(w.b.y) || 0) }, color: String(w.color || "blue") }
      // A hand-shaped path: half-step points only (the router checks it still fits).
      if (Array.isArray(w.path) && w.path.length >= 2 && w.path.length <= 64)
        nw.path = w.path.map(function (q) { return { x: Math.round(Number(q.x) * 2) / 2 || 0, y: Math.round(Number(q.y) * 2) / 2 || 0 } })
      out.wires.push(nw)
    }
    return out
  }

  Timer {
    id: historyTimer
    interval: 400
    onTriggered: root.pushHistory()
  }

  Timer {
    id: saveTimer
    interval: 800
    onTriggered: root.saveNow()
  }

  function saveNow() {
    if (!loadedOnce) return
    autosaveFile.setText(JSON.stringify({
      version: 1,
      bench: bench,
      settings: { opacityMode: opacityMode, customOpacity: customOpacity, wireColor: wireColor, lessonIndex: lessonIndex }
    }, null, 1))
  }

  onOpacityModeChanged: { saveTimer.restart(); applyWindowOpacity() }
  onCustomOpacityChanged: { saveTimer.restart(); applyWindowOpacity() }
  onWireColorChanged: { saveTimer.restart(); benchView.wireColor = wireColor }
  onLessonIndexChanged: saveTimer.restart()

  // Omarchy gives every window a little transparency (and many themes more),
  // which lets busy wallpapers and terminals bleed into the bench. Solid asks
  // Hyprland to draw this one window fully opaque; Custom sets its opacity;
  // Theme goes back to Omarchy's default window opacity.
  function applyWindowOpacity() {
    if (!panel.visible) return
    Hyprland.refreshToplevels()
    opacityTimer.restart()
  }
  Timer {
    id: opacityTimer
    interval: 120
    onTriggered: {
      var props = root.opacityMode === "solid" ? [["opacity", 1], ["opacity_inactive", 1], ["opacity_override", 1]]
        : root.opacityMode === "custom" ? [["opacity", root.customOpacity], ["opacity_inactive", root.customOpacity], ["opacity_override", 1]]
        : [["opacity_override", 0], ["opacity", 0.985], ["opacity_inactive", 0.96]]
      var list = Hyprland.toplevels.values
      for (var i = 0; i < list.length; i++) {
        if (list[i].title !== "OmaCircuitLab") continue
        var addr = String(list[i].address)
        if (addr.indexOf("0x") !== 0) addr = "0x" + addr
        for (var k = 0; k < props.length; k++)
          Hyprland.dispatch("hl.dsp.window.set_prop({ window = 'address:" + addr + "', prop = '" + props[k][0] + "', value = " + Number(props[k][1]).toFixed(3) + " })")
      }
    }
  }

  // ------------------------------------------------------------------ open/close
  function open(payloadJson) {
    root.closingFromHost = false
    var monitor = Hyprland.focusedMonitor
    for (var i = 0; i < Quickshell.screens.length; i++)
      if (monitor && Quickshell.screens[i].name === monitor.name && !panel.visible) panel.screen = Quickshell.screens[i]
    root.opened = true
    Qt.callLater(function () { keyCatcher.forceActiveFocus() })
    // Optional payload: {"lesson": 1-10, "build": true, "run": true}
    try {
      var payload = payloadJson ? JSON.parse(payloadJson) : null
      if (payload && typeof payload.lesson === "number" && payload.lesson >= 1 && payload.lesson <= Lessons.lessons.length) {
        root.lessonIndex = payload.lesson - 1
        root.rightTab = "guide"
        if (payload.build === true) Qt.callLater(function () { root.setBench(root.lesson.build(), "Build lesson"); benchView.fit() })
      }
      if (payload && payload.run === true) Qt.callLater(root.startSim)
    } catch (ignore) {}
  }

  function close() {
    saveNow()
    root.closingFromHost = true
    root.opened = false
    root.running = false
    root.closingFromHost = false
  }

  function dismiss() {
    root.close()
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  Component.onDestruction: saveNow()

  // ------------------------------------------------------------------ guide
  readonly property var lesson: Lessons.lessons[lessonIndex]
  readonly property var lessonStatus: {
    var _ = revision
    if (!lesson) return { done: false, hint: "" }
    try {
      return lesson.check({ bench: bench, netlist: netlist, result: result, running: running })
    } catch (e) {
      return { done: false, hint: "" }
    }
  }

  // ------------------------------------------------------------------ window
  FloatingWindow {
    id: panel
    visible: root.opened
    title: "OmaCircuitLab"
    color: root.chromeBg
    // A fixed size makes Hyprland float and center it with no window rule.
    readonly property real sw: screen ? screen.width : 1920
    readonly property real sh: screen ? screen.height : 1080
    property size fixed: Qt.size(Math.round(Math.min(sw * 0.88, 2100)), Math.round(Math.min(sh * 0.86, 1240)))
    implicitWidth: fixed.width
    implicitHeight: fixed.height
    minimumSize: fixed
    maximumSize: fixed

    onVisibleChanged: {
      if (!visible && root.opened && !root.closingFromHost) root.dismiss()
      if (visible) root.applyWindowOpacity()
    }

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true

      Keys.onPressed: function (event) {
        var ctrl = event.modifiers & Qt.ControlModifier
        if (event.key === Qt.Key_Escape) {
          if (benchView.clipping !== "") { benchView.clipping = ""; benchView.clipHover = null }
          else if (benchView.placingType !== "") benchView.placingType = ""
          else if (benchView.selectedPart || benchView.selectedWire) { benchView.selectedPart = ""; benchView.selectedWire = "" }
          else root.dismiss()
        } else if (ctrl && event.key === Qt.Key_Z) {
          (event.modifiers & Qt.ShiftModifier) ? root.redo() : root.undo()
        } else if (ctrl && event.key === Qt.Key_Y) {
          root.redo()
        } else if (event.key === Qt.Key_R && !ctrl) {
          benchView.rotateSelected()
        } else if (event.key === Qt.Key_Delete || event.key === Qt.Key_Backspace) {
          benchView.deleteSelected()
        } else if (event.key === Qt.Key_Space) {
          root.running ? root.stopSim() : root.startSim()
        } else if (event.key === Qt.Key_F) {
          benchView.fit()
        } else if (event.key >= Qt.Key_1 && event.key <= Qt.Key_8 && !ctrl) {
          root.wireColor = Catalog.wireColors[event.key - Qt.Key_1].id
        } else {
          return
        }
        event.accepted = true
      }

      ColumnLayout {
        anchors.fill: parent
        anchors.margins: root.pad
        spacing: Style.spacing.lg

        // ------------------------------------------------ title + toolbar
        RowLayout {
          Layout.fillWidth: true
          Layout.fillHeight: false
          spacing: Style.spacing.lg

          Text {
            text: "OmaCircuitLab"
            color: root.fg
            font.family: root.fontFamily
            font.pixelSize: root.fTitle
            font.bold: true
          }
          Text {
            text: root.running ? (root.result && root.result.ok === false ? "Can't solve this circuit" : "Running") : "Stopped: press Run (Space)"
            color: root.running ? root.accent : root.muted
            font.family: root.fontFamily
            font.pixelSize: root.fBody
          }

          Item { Layout.fillWidth: true }

          ToolButton {
            label: root.running ? "■  Stop" : "▶  Run"
            filled: true
            tip: "Power the circuit on or off (Space)"
            onClicked: root.running ? root.stopSim() : root.startSim()
          }
          ToolButton { label: "↺  Reset"; tip: "Fix burnt parts and empty capacitors"; onClicked: root.resetSim() }
          ToolButton { label: "↶"; tip: "Undo (Ctrl+Z)"; enabledLook: root.historyIndex > 0; onClicked: root.undo() }
          ToolButton { label: "↷"; tip: "Redo (Ctrl+Shift+Z)"; enabledLook: root.historyIndex < root.history.length - 1; onClicked: root.redo() }
          ToolButton { label: "My circuits"; selected: root.projectsOpen; tip: "Save this circuit under a name, or open one you saved"; onClicked: root.projectsOpen = !root.projectsOpen }
          ToolButton { label: "Fit"; tip: "Fit the bench to the window (F)"; onClicked: benchView.fit() }
          ToolButton { label: "Clear"; tip: "Remove everything from the bench (Undo brings it back)"; onClicked: root.clearBench() }

          Rectangle { Layout.preferredWidth: 1; Layout.preferredHeight: Style.spacing.controlHeight; color: root.lineColor }

          Text {
            text: "Window"
            color: root.muted
            font.family: root.fontFamily
            font.pixelSize: root.fSmall
          }
          ToolButton { label: "Solid"; selected: root.opacityMode === "solid"; tip: "Fully solid window (best for dark, see-through themes)"; onClicked: root.opacityMode = "solid" }
          ToolButton { label: "Theme"; selected: root.opacityMode === "theme"; tip: "Normal Omarchy window transparency"; onClicked: root.opacityMode = "theme" }
          ToolButton { label: "Custom"; selected: root.opacityMode === "custom"; tip: "Pick your own window opacity with the slider"; onClicked: root.opacityMode = "custom" }
          PanelSlider {
            visible: root.opacityMode === "custom"
            Layout.preferredWidth: Style.space(140)
            minimum: 0.5; maximum: 1; step: 0.05
            value: root.customOpacity
            onMoved: function (v) { root.customOpacity = v }
            onReleased: function (v) { root.customOpacity = v }
          }

          Rectangle { Layout.preferredWidth: 1; Layout.preferredHeight: Style.spacing.controlHeight; color: root.lineColor }
          ToolButton { label: "✕"; tip: "Close (Esc). Your bench is saved."; onClicked: root.dismiss() }
        }

        // ------------------------------------------------ body
        RowLayout {
          Layout.fillWidth: true
          Layout.fillHeight: true
          spacing: Style.spacing.lg

          // Parts picker
          Card {
            Layout.preferredWidth: Style.space(290)
            Layout.fillHeight: true

            ColumnLayout {
              anchors.fill: parent
              anchors.margins: Style.spacing.lg
              spacing: Style.spacing.md

              SectionTitle { text: "Add a part" }

              Dropdown {
                Layout.fillWidth: true
                label: "Kind of part"
                value: root.category
                foreground: root.fg
                background: root.cardBg
                options: Catalog.categories.map(function (c) { return { value: c.id, label: c.label } })
                onChanged: function (v) { root.category = v }
              }

              Text {
                Layout.fillWidth: true
                text: "Click a part, then click the bench to drop it. R turns it, right-click a placed part to turn it."
                wrapMode: Text.WordWrap
                color: root.muted
                font.family: root.fontFamily
                font.pixelSize: root.fCaption
              }

              // As tall as its tiles (scrolls if they don't fit); the notes get the rest.
              Flickable {
                id: partList
                Layout.fillWidth: true
                Layout.preferredHeight: tileColumn.implicitHeight
                Layout.minimumHeight: Math.min(tileColumn.implicitHeight, Style.space(160))
                contentHeight: tileColumn.implicitHeight
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                Column {
                  id: tileColumn
                  width: partList.width
                  spacing: Style.spacing.sm
                  Repeater {
                    model: {
                      var g = Catalog.grouped()
                      for (var i = 0; i < g.length; i++) if (g[i].id === root.category) return g[i].items
                      return []
                    }
                    delegate: Rectangle {
                      id: tile
                      required property var modelData
                      width: tileColumn.width
                      height: tileCol.implicitHeight + Style.spacing.md * 2
                      radius: Style.cornerRadius
                      readonly property bool active: benchView.placingType === modelData.id
                      color: active ? root.accent : tileMouse.containsMouse ? Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.10) : Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.04)
                      border.color: active ? root.accent : root.lineColor
                      border.width: 1
                      Column {
                        id: tileCol
                        anchors.left: parent.left; anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.margins: Style.spacing.md
                        spacing: 2
                        Text {
                          text: modelData.name
                          color: tile.active ? root.textOn(root.accent) : root.fg
                          font.family: root.fontFamily
                          font.pixelSize: root.fBody
                          font.bold: true
                        }
                        Text {
                          width: parent.width
                          text: Catalog.parts[modelData.id].tip.split(". ")[0] + "."
                          wrapMode: Text.WordWrap
                          maximumLineCount: 2
                          elide: Text.ElideRight
                          color: tile.active ? root.textOn(root.accent) : root.muted
                          font.family: root.fontFamily
                          font.pixelSize: root.fCaption
                        }
                      }
                      MouseArea {
                        id: tileMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                          benchView.placingType = tile.active ? "" : modelData.id
                          benchView.placingRot = 0
                          keyCatcher.forceActiveFocus()
                        }
                      }
                    }
                  }
                }
              }

              // Notes for whatever is under the cursor, in the space below the parts.
              Item {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.minimumHeight: Style.space(60)
                clip: true
                Column {
                  width: parent.width
                  spacing: Style.spacing.xs
                  Text {
                    width: parent.width
                    text: root.hoverInfo ? root.hoverInfo.title : "Notes"
                    color: root.fg
                    wrapMode: Text.WordWrap
                    font.family: root.fontFamily
                    font.pixelSize: root.fBody
                    font.bold: true
                  }
                  Text {
                    width: parent.width
                    text: root.hoverInfo ? root.hoverInfo.body : "Point at a part, wire or hole to learn about it here."
                    color: root.muted
                    wrapMode: Text.WordWrap
                    font.family: root.fontFamily
                    font.pixelSize: root.fCaption
                  }
                }
              }

              SectionTitle { text: "Wire color" }
              Text {
                Layout.fillWidth: true
                text: "Drag from any hole to another to add a wire. Keys 1–8 pick a color."
                wrapMode: Text.WordWrap
                color: root.muted
                font.family: root.fontFamily
                font.pixelSize: root.fCaption
              }
              Flow {
                Layout.fillWidth: true
                spacing: Style.spacing.sm
                Repeater {
                  model: Catalog.wireColors
                  delegate: Rectangle {
                    required property var modelData
                    required property int index
                    width: Style.space(30); height: width; radius: width / 2
                    color: modelData.hex
                    border.color: root.wireColor === modelData.id ? root.accent : (modelData.id === "black" ? "#9a9a9a" : "#000000")
                    border.width: root.wireColor === modelData.id ? 3 : 1
                    MouseArea {
                      id: swatchMouse
                      anchors.fill: parent
                      hoverEnabled: true
                      cursorShape: Qt.PointingHandCursor
                      onClicked: {
                        root.wireColor = modelData.id
                        var w = benchView.selectedWire ? benchView.wireById(benchView.selectedWire) : null
                        if (w) { w.color = modelData.id; root.revision++; root.pushHistory(); root.circuitChanged() }
                      }
                    }
                    PanelToolTip { visible: swatchMouse.containsMouse; text: (index + 1) + " · " + modelData.hint }
                  }
                }
              }
            }
          }

          // Bench
          Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: root.matBg
            radius: Style.cornerRadius
            border.color: root.lineColor
            clip: true

            BenchView {
              id: benchView
              anchors.fill: parent
              bench: root.bench
              revision: root.revision
              result: root.result
              netlist: root.netlist
              running: root.running
              motorAngles: root.motorAngles
              benchColor: root.matBg
              fontFamily: root.fontFamily
              Component.onCompleted: wireColor = root.wireColor
              onBump: root.revision++
              onEdited: function (what) { root.pushHistory(); root.circuitChanged() }
              onLiveChanged: root.circuitChanged()
              onWheelEdited: historyTimer.restart()
              onSelectedPartChanged: if (selectedPart !== "") root.rightTab = "inspect"
              onSelectedWireChanged: if (selectedWire !== "") root.rightTab = "inspect"
              onHoverChanged: function (info) { root.hoverInfo = info }
            }

            CodeEditor {
              id: codeEditor
              visible: root.codePartId !== "" && part !== null
              anchors.top: parent.top
              anchors.right: parent.right
              anchors.bottom: arena.visible ? arena.top : parent.bottom
              anchors.margins: Style.spacing.md
              width: Math.min(parent.width * 0.5, Style.space(760))
              theme: root
              running: root.running
              part: {
                var _ = root.revision
                return root.codePartId ? benchView.partById(root.codePartId) : null
              }
              live: root.running && root.result && root.result.parts && root.codePartId ? root.result.parts[root.codePartId] || null : null
              onUpload: function (code) {
                var p = benchView.partById(root.codePartId)
                if (!p) return
                p.props.code = code
                root.revision++
                root.pushHistory()
                root.resetSim()      // a fresh upload restarts the board
                root.circuitChanged()
              }
              onClosed: { root.codePartId = ""; keyCatcher.forceActiveFocus() }
            }

            RobotArena {
              id: arena
              visible: root.arenaOpen && root.robotCar !== null
              anchors.right: parent.right
              anchors.bottom: parent.bottom
              anchors.margins: Style.spacing.md
              width: Math.min(parent.width * 0.5, Style.space(760))
              height: Math.min(parent.height * 0.48, width * 0.75)
              theme: root
              arenaState: root.arenaState
              running: root.running
              leftSpin: root.robotLive ? Number(root.robotLive.leftSpin) || 0 : 0
              rightSpin: root.robotLive ? Number(root.robotLive.rightSpin) || 0 : 0
              onLayoutPicked: function (layout) { root.arenaState = Arena.createState(layout) }
              onResetCar: root.arenaState = Arena.createState(root.arenaState.layout)
              onClosed: root.arenaOpen = false
            }

            ProjectsPanel {
              visible: root.projectsOpen
              anchors.top: parent.top
              anchors.right: parent.right
              anchors.margins: Style.spacing.md
              width: Math.min(parent.width * 0.45, Style.space(560))
              z: 5
              theme: root
              projects: root.projects
              onSave: function (name) { root.saveProject(name) }
              onOpenProject: function (name) { root.openProject(name) }
              onRemove: function (name) { root.removeProject(name) }
              onClosed: { root.projectsOpen = false; keyCatcher.forceActiveFocus() }
            }

            // Short confirmations ("Saved …").
            Rectangle {
              visible: root.toastText !== ""
              anchors.horizontalCenter: parent.horizontalCenter
              anchors.top: parent.top
              anchors.topMargin: Style.spacing.lg
              width: toastLabel.implicitWidth + Style.spacing.xxl * 2
              height: toastLabel.implicitHeight + Style.spacing.md * 2
              radius: height / 2
              color: "#1b5e20"
              z: 6
              Text {
                id: toastLabel
                anchors.centerIn: parent
                text: root.toastText
                color: "#ffffff"
                font.family: root.fontFamily
                font.pixelSize: root.fBody
                font.bold: true
              }
            }

            // Live numbers for what's under the cursor, small, along the bottom.
            Rectangle {
              readonly property var st: root.hoverInfo && root.hoverInfo.stats ? root.hoverInfo.stats : null
              readonly property string line: {
                if (!st) return ""
                var bits = []
                if (st.v) bits.push("V= " + st.v)
                if (st.a) bits.push("A= " + st.a)
                if (st.w) bits.push("W= " + st.w)
                return bits.join("    ")
              }
              visible: line !== ""
              anchors.left: parent.left
              anchors.bottom: parent.bottom
              anchors.margins: Style.spacing.md
              width: statsText.implicitWidth + Style.spacing.lg * 2
              height: statsText.implicitHeight + Style.spacing.sm * 2
              radius: height / 2
              color: Qt.rgba(0.07, 0.08, 0.09, 0.9)
              border.color: root.accent
              border.width: 1
              z: 4
              Text {
                id: statsText
                anchors.centerIn: parent
                text: parent.line
                color: "#e8edf1"
                font.family: root.fontFamily
                font.pixelSize: root.fSmall
                font.bold: true
              }
            }

            // Warnings from the engine, top-left of the bench.
            Column {
              anchors.left: parent.left
              anchors.top: parent.top
              anchors.margins: Style.spacing.lg
              spacing: Style.spacing.sm
              width: Math.min(parent.width * 0.6, Style.space(640))
              Repeater {
                model: root.running && root.result && root.result.warnings ? root.result.warnings.filter(function (w) { return w.level !== "info" }).slice(0, 4) : []
                delegate: Rectangle {
                  required property var modelData
                  width: parent.width
                  height: warnText.implicitHeight + Style.spacing.md * 2
                  radius: Style.cornerRadius
                  color: modelData.level === "danger" ? "#b71c1c" : "#8d6e00"
                  Text {
                    id: warnText
                    anchors.fill: parent
                    anchors.margins: Style.spacing.md
                    text: (modelData.level === "danger" ? "⚠  " : "!  ") + modelData.message
                    color: "#ffffff"
                    wrapMode: Text.WordWrap
                    font.family: root.fontFamily
                    font.pixelSize: root.fSmall
                    font.bold: true
                  }
                }
              }
            }

            Text {
              anchors.right: parent.right
              anchors.bottom: parent.bottom
              anchors.margins: Style.spacing.md
              text: "Scroll: zoom · Drag empty space: move · Scroll on a part: change its value · Click a part: Inspect"
              color: root.darkTheme ? "#9aa5ad" : "#4a545b"
              font.family: root.fontFamily
              font.pixelSize: root.fCaption
            }
          }

          // Inspector / Guide
          Card {
            Layout.preferredWidth: Style.space(360)
            Layout.fillHeight: true

            ColumnLayout {
              anchors.fill: parent
              anchors.margins: Style.spacing.lg
              spacing: Style.spacing.md

              RowLayout {
                Layout.fillWidth: true
                spacing: Style.spacing.sm
                ToolButton { Layout.fillWidth: true; label: "Inspect"; selected: root.rightTab === "inspect"; onClicked: root.rightTab = "inspect" }
                ToolButton { Layout.fillWidth: true; label: "Guide"; tip: "Learner's Guide: lessons from a first LED to motors"; selected: root.rightTab === "guide"; onClicked: root.rightTab = "guide" }
                ToolButton { Layout.fillWidth: true; label: "Tools"; tip: "Calculators and a glossary"; selected: root.rightTab === "tools"; onClicked: root.rightTab = "tools" }
              }

              Inspector {
                visible: root.rightTab === "inspect"
                Layout.fillWidth: true
                Layout.fillHeight: true
                theme: root
                bench: root.bench
                revision: root.revision
                result: root.result
                running: root.running
                selectedPart: benchView.selectedPart
                selectedWire: benchView.selectedWire
                netlist: root.netlist
                onChangeProp: function (id, key, value) {
                  var p = benchView.partById(id)
                  if (!p) return
                  p.props[key] = value
                  if (p.type === "aaPack" && key === "cells") p.props.volts = value * 1.5
                  root.revision++
                  historyTimer.restart()   // a slider drag becomes one undo step
                  root.circuitChanged()
                }
                onDeletePart: benchView.deleteSelected()
                onOpenCode: function (id) { root.codePartId = id }
                onOpenArena: root.arenaOpen = true
                onAutoRoute: {
                  var w = benchView.wireById(benchView.selectedWire)
                  if (!w) return
                  delete w.path
                  root.revision++
                  root.pushHistory()
                }
                onRotatePart: benchView.rotateSelected()
              }

              ToolsPanel {
                visible: root.rightTab === "tools"
                Layout.fillWidth: true
                Layout.fillHeight: true
                theme: root
              }

              GuidePanel {
                visible: root.rightTab === "guide"
                Layout.fillWidth: true
                Layout.fillHeight: true
                theme: root
                lessons: Lessons.lessons
                index: root.lessonIndex
                status: root.lessonStatus
                onPick: function (i) { root.lessonIndex = i }
                onBuild: {
                  root.setBench(root.lesson.build(), "Build lesson")
                  benchView.fit()
                }
              }
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ small pieces
  component Card: Rectangle {
    color: root.cardBg
    radius: Style.cornerRadius
    border.color: root.lineColor
    border.width: 1
  }

  component SectionTitle: Text {
    color: root.fg
    font.family: root.fontFamily
    font.pixelSize: root.fBody
    font.bold: true
  }

  component ToolButton: Rectangle {
    id: tb
    property string label: ""
    property string tip: ""
    property bool selected: false
    property bool filled: false
    property bool enabledLook: true
    signal clicked()
    implicitWidth: tbText.implicitWidth + Style.spacing.lg * 2
    implicitHeight: Style.spacing.controlHeight
    radius: Style.cornerRadius
    color: (filled || selected) ? root.accent : tbMouse.containsMouse ? Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.12) : Qt.rgba(root.fg.r, root.fg.g, root.fg.b, 0.05)
    border.color: (filled || selected) ? root.accent : root.lineColor
    border.width: 1
    opacity: enabledLook ? 1 : 0.4
    Text {
      id: tbText
      anchors.centerIn: parent
      text: tb.label
      color: (tb.filled || tb.selected) ? root.textOn(root.accent) : root.fg
      font.family: root.fontFamily
      font.pixelSize: root.fBody
      font.bold: tb.filled || tb.selected
    }
    MouseArea {
      id: tbMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: { tb.clicked(); keyCatcher.forceActiveFocus() }
    }
    PanelToolTip { visible: tb.tip !== "" && tbMouse.containsMouse; text: tb.tip }
  }
}
