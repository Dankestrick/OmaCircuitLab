import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "lib/Catalog.js" as Catalog
import "lib/Bench.js" as Bench

// Right-hand panel: what the selected part is, its values, and live readings.
// With nothing selected it shows the circuit's problems and the controls.
Flickable {
  id: root
  clip: true
  contentHeight: col.implicitHeight
  boundsBehavior: Flickable.StopAtBounds

  property var theme: null
  property var bench: null
  property int revision: 0
  property var result: null
  property var netlist: null
  property bool running: false
  property string selectedPart: ""
  property string selectedWire: ""

  signal changeProp(string id, string key, var value)
  signal deletePart()
  signal rotatePart()
  signal openCode(string id)
  signal openArena()
  signal autoRoute()

  readonly property var part: {
    var _ = revision
    if (!bench || !selectedPart) return null
    for (var i = 0; i < bench.parts.length; i++) if (bench.parts[i].id === selectedPart) return bench.parts[i]
    return null
  }
  readonly property var def: part ? Catalog.parts[part.type] : null
  readonly property var live: part && running && result && result.parts ? result.parts[part.id] || null : null

  function fmt(v, unit) { return Catalog.si(v, unit) }

  function propText(e, v) {
    if (e.kind === "values" || e.kind === "range") return e.unit === "" ? (e.key === "turn" || e.key === "light" ? Math.round(v * 100) + " %" : String(v)) : fmt(Number(v), e.unit)
    if (e.key === "color") return Catalog.ledColors[v] ? Catalog.ledColors[v].label : String(v)
    return String(v) + (e.unit ? " " + e.unit : "")
  }

  ColumnLayout {
    id: col
    width: root.width
    spacing: Style.spacing.md

    // ---------------------------------------------------- selected part
    ColumnLayout {
      visible: root.part !== null
      Layout.fillWidth: true
      spacing: Style.spacing.md

      // Long names (HC-SR04, function generator) wrap, so they can't widen
      // the column and push the readings off the right edge.
      Text {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        text: root.def ? root.def.name : ""
        color: root.theme.fg
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSubtitle
        font.bold: true
      }
      Text {
        Layout.fillWidth: true
        text: root.def ? root.def.tip : ""
        wrapMode: Text.WordWrap
        color: root.theme.fg
        opacity: 0.85
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSmall
      }

      Button {
        visible: root.part !== null && root.part.type === "robotCar"
        text: "Open robot arena"
        bordered: true
        foreground: root.theme.fg
        tooltipText: "Watch the robot drive around a room"
        onClicked: root.openArena()
      }
      Button {
        visible: root.part !== null && Catalog.mcuTypes[root.part.type] === true
        text: "</>  Open code editor"
        bordered: true
        foreground: root.theme.fg
        tooltipText: "Write and upload a sketch to this board"
        onClicked: root.openCode(root.part.id)
      }
      Text {
        visible: root.part !== null && Catalog.mcuTypes[root.part.type] === true
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        text: root.live && root.live.serial ? "Serial: " + root.live.serial.split("\n").filter(function (l) { return l !== "" }).slice(-1)[0] : ""
        color: "#7CFC7C"
        font.family: "monospace"
        font.pixelSize: root.theme.fSmall
      }

      // Legs
      Text {
        text: "Legs"
        color: root.theme.muted
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fCaption
        font.bold: true
      }
      Repeater {
        model: root.def ? root.def.pins : []
        delegate: RowLayout {
          required property var modelData
          required property int index
          Layout.fillWidth: true
          Text {
            Layout.fillWidth: true
            text: "• " + modelData.name
            color: root.theme.fg
            font.family: root.theme.fontFamily
            font.pixelSize: root.theme.fSmall
          }
          Text {
            visible: root.live !== null && root.live.pinVolts !== undefined
            text: root.live && root.live.pinVolts ? root.fmt(root.live.pinVolts[index] || 0, "V") : ""
            color: root.theme.accent
            font.family: root.theme.fontFamily
            font.pixelSize: root.theme.fSmall
            font.bold: true
          }
        }
      }

      // Editable values
      Repeater {
        model: root.def ? root.def.editable : []
        delegate: ColumnLayout {
          id: editor
          required property var modelData
          Layout.fillWidth: true
          spacing: Style.spacing.xs
          readonly property var current: root.part ? root.part.props[modelData.key] : null

          RowLayout {
            Layout.fillWidth: true
            Text {
              Layout.fillWidth: true
              text: editor.modelData.label
              color: root.theme.muted
              font.family: root.theme.fontFamily
              font.pixelSize: root.theme.fCaption
              font.bold: true
            }
            Text {
              text: editor.current !== null ? root.propText(editor.modelData, editor.current) : ""
              color: root.theme.fg
              font.family: root.theme.fontFamily
              font.pixelSize: root.theme.fSmall
              font.bold: true
            }
          }

          Dropdown {
            visible: editor.modelData.kind === "choice" || editor.modelData.kind === "values"
            Layout.fillWidth: true
            showLabel: false
            foreground: root.theme.fg
            background: root.theme.cardBg
            value: String(editor.current)
            options: {
              var m = editor.modelData
              var list = m.kind === "values" ? m.values : m.options
              return list.map(function (v) { return { value: String(v), label: root.propText(m, v) } })
            }
            onChanged: function (v) {
              var m = editor.modelData
              var list = m.kind === "values" ? m.values : m.options
              for (var i = 0; i < list.length; i++) if (String(list[i]) === v) root.changeProp(root.part.id, m.key, list[i])
            }
          }

          PanelSlider {
            visible: editor.modelData.kind === "range"
            Layout.fillWidth: true
            minimum: editor.modelData.min !== undefined ? editor.modelData.min : 0
            maximum: editor.modelData.max !== undefined ? editor.modelData.max : 1
            step: editor.modelData.step || 0.01
            value: Number(editor.current) || 0
            onMoved: function (v) { root.changeProp(root.part.id, editor.modelData.key, Math.round(v / step) * step) }
            onReleased: function (v) { root.changeProp(root.part.id, editor.modelData.key, Math.round(v / step) * step) }
          }
        }
      }

      // Live readings
      Rectangle {
        visible: root.live !== null
        Layout.fillWidth: true
        implicitHeight: liveCol.implicitHeight + Style.spacing.md * 2
        radius: Style.cornerRadius
        color: Qt.rgba(0, 0, 0, 0.25)
        border.color: root.theme.lineColor
        ColumnLayout {
          id: liveCol
          anchors.fill: parent
          anchors.margins: Style.spacing.md
          spacing: Style.spacing.xs
          Text {
            text: "Live"
            color: root.theme.muted
            font.family: root.theme.fontFamily
            font.pixelSize: root.theme.fCaption
            font.bold: true
          }
          Repeater {
            model: {
              var l = root.live
              if (!l) return []
              var rows = []
              if (l.current !== undefined) rows.push(["Current", root.fmt(Math.abs(l.current), "A")])
              if (l.pinVolts && l.pinVolts.length >= 2) rows.push(["Voltage across", root.fmt(Math.abs(l.pinVolts[0] - l.pinVolts[l.pinVolts.length - 1]), "V")])
              if (l.power !== undefined) rows.push(["Power", root.fmt(Math.abs(l.power), "W")])
              if (l.collectorCurrent !== undefined) rows.push([root.part.type === "nmos" ? "Drain current" : "Collector current", root.fmt(Math.abs(l.collectorCurrent), "A")])
              if (l.state) rows.push(["State", l.state])
              if (l.brightness !== undefined && typeof l.brightness === "number") rows.push(["Brightness", Math.round(l.brightness * 100) + " %"])
              if (l.burnt) rows.push(["Condition", "Burnt out: press Reset"])
              if (l.reading) rows.push(["Display", l.reading])
              if (l.limited) rows.push(["Supply", "Current limiting"])
              return rows
            }
            delegate: RowLayout {
              required property var modelData
              Layout.fillWidth: true
              Text {
                Layout.fillWidth: true
                text: modelData[0]
                color: root.theme.fg
                font.family: root.theme.fontFamily
                font.pixelSize: root.theme.fSmall
              }
              Text {
                text: modelData[1]
                color: root.theme.accent
                font.family: root.theme.fontFamily
                font.pixelSize: root.theme.fBody
                font.bold: true
              }
            }
          }
        }
      }

      RowLayout {
        Layout.fillWidth: true
        spacing: Style.spacing.sm
        Button { text: "Rotate (R)"; bordered: true; foreground: root.theme.fg; onClicked: root.rotatePart() }
        Button { text: "Delete (Del)"; bordered: true; foreground: root.theme.fg; onClicked: root.deletePart() }
      }
    }

    // ---------------------------------------------------- selected wire
    ColumnLayout {
      visible: root.part === null && root.selectedWire !== ""
      Layout.fillWidth: true
      spacing: Style.spacing.md
      Text {
        text: "Jumper wire"
        color: root.theme.fg
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSubtitle
        font.bold: true
      }
      Text {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        text: "Drag a straight run (blue bar) to slide it, or a bend (white square) to move the corner. Drag either end (blue ring) to plug it in somewhere else. Pick a color on the left to recolor it. Delete removes it.\n\nWire colors don't change how a circuit works, but a habit of red for + and black for − makes circuits much easier to follow."
        color: root.theme.fg
        opacity: 0.85
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSmall
      }
      RowLayout {
        spacing: Style.spacing.sm
        Button { text: "Auto-route"; bordered: true; foreground: root.theme.fg; tooltipText: "Forget the hand-made shape and let the wire find its own neat path"; onClicked: root.autoRoute() }
        Button { text: "Delete wire"; bordered: true; foreground: root.theme.fg; onClicked: root.deletePart() }
      }
    }

    // ---------------------------------------------------- nothing selected
    ColumnLayout {
      visible: root.part === null && root.selectedWire === ""
      Layout.fillWidth: true
      spacing: Style.spacing.md
      Text {
        text: "Your circuit"
        color: root.theme.fg
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSubtitle
        font.bold: true
      }
      Text {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        text: {
          var _ = root.revision
          if (!root.bench) return ""
          var s = root.bench.parts.length + " parts, " + root.bench.wires.length + " wires."
          if (!root.running) s += " Press Run to power it."
          return s
        }
        color: root.theme.fg
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSmall
      }
      Repeater {
        model: {
          var out = []
          if (root.netlist && root.netlist.issues) out = out.concat(root.netlist.issues.map(function (i) { return { level: "warn", message: i.message } }))
          if (root.running && root.result && root.result.warnings) out = out.concat(root.result.warnings)
          return out
        }
        delegate: Text {
          required property var modelData
          Layout.fillWidth: true
          wrapMode: Text.WordWrap
          text: (modelData.level === "danger" ? "⚠ " : modelData.level === "warn" ? "! " : "• ") + modelData.message
          color: modelData.level === "danger" ? "#ff6e5a" : modelData.level === "warn" ? "#ffca28" : root.theme.fg
          font.family: root.theme.fontFamily
          font.pixelSize: root.theme.fSmall
        }
      }
      // How it's connected: every node, its voltage and the legs on it.
      Text {
        visible: netRepeater.count > 0
        Layout.topMargin: Style.spacing.md
        text: "How it's connected"
        color: root.theme.fg
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fBody
        font.bold: true
      }
      Text {
        visible: netRepeater.count > 0
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        text: "Each group below is one connection point: everything in it is joined by the board's strips or by wires, so it all sits at the same voltage."
        color: root.theme.muted
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fCaption
      }
      Repeater {
        id: netRepeater
        model: {
          var _ = root.revision
          return root.netlist ? Bench.describeNets(root.bench, root.netlist) : []
        }
        delegate: Rectangle {
          required property var modelData
          Layout.fillWidth: true
          implicitHeight: netCol.implicitHeight + Style.spacing.md * 2
          radius: Style.cornerRadius
          color: Qt.rgba(0, 0, 0, 0.22)
          border.color: root.theme.lineColor
          ColumnLayout {
            id: netCol
            anchors.fill: parent
            anchors.margins: Style.spacing.md
            spacing: 2
            RowLayout {
              Layout.fillWidth: true
              Text {
                Layout.fillWidth: true
                text: modelData.node === 0 && root.netlist.ground === 0 ? "Ground (0 V reference)" : "Point " + modelData.node
                color: root.theme.fg
                font.family: root.theme.fontFamily
                font.pixelSize: root.theme.fSmall
                font.bold: true
              }
              Text {
                visible: root.running && root.result && root.result.nodeVolts !== undefined
                text: root.running && root.result && root.result.nodeVolts ? root.fmt(root.result.nodeVolts[modelData.node] || 0, "V") : ""
                color: root.theme.accent
                font.family: root.theme.fontFamily
                font.pixelSize: root.theme.fSmall
                font.bold: true
              }
            }
            Repeater {
              model: modelData.legs
              delegate: Text {
                required property var modelData
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: "  " + modelData
                color: root.theme.fg
                opacity: 0.85
                font.family: root.theme.fontFamily
                font.pixelSize: root.theme.fCaption
              }
            }
          }
        }
      }

      Text {
        Layout.fillWidth: true
        Layout.topMargin: Style.spacing.lg
        wrapMode: Text.WordWrap
        textFormat: Text.PlainText
        text: "How to build\n" +
              "• Pick a part on the left, click the bench to drop it.\n" +
              "• Drag from a hole to another hole to add a wire.\n" +
              "• Drag a part to move it. R or right-click turns it.\n" +
              "• Hover anything for an explanation.\n" +
              "• Space runs and stops the circuit.\n" +
              "• Click a switch to flip it; hold a button to press it.\n" +
              "• Scroll on a knob, light or temperature sensor to change it.\n" +
              "• Ctrl+Z undoes, Esc closes. Your bench saves itself."
        color: root.theme.muted
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSmall
      }
    }
  }
}
