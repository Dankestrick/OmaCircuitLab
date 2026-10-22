import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "lib/Catalog.js" as Catalog
import "lib/Learn.js" as Learn

// Tools tab: the calculators people reach for while building, plus a
// glossary of the words the lessons use.
Flickable {
  id: root
  clip: true
  contentHeight: col.implicitHeight
  boundsBehavior: Flickable.StopAtBounds

  property var theme: null
  property string tool: "ohm"

  function fmt(v, unit) { return isFinite(v) ? Catalog.si(v, unit) : "∞ " + unit }

  ColumnLayout {
    id: col
    width: root.width
    spacing: Style.spacing.md

    Dropdown {
      Layout.fillWidth: true
      label: "Tool"
      foreground: root.theme.fg
      background: root.theme.cardBg
      value: root.tool
      options: [
        { value: "ohm", label: "Ohm's law" },
        { value: "led", label: "LED resistor" },
        { value: "bands", label: "Resistor color code" },
        { value: "divider", label: "Voltage divider" },
        { value: "combine", label: "Series & parallel" },
        { value: "rc", label: "Capacitor timing (RC)" },
        { value: "glossary", label: "Glossary" }
      ]
      onChanged: function (v) { root.tool = v }
    }

    // ------------------------------------------------ Ohm's law
    ColumnLayout {
      visible: root.tool === "ohm"
      Layout.fillWidth: true
      spacing: Style.spacing.sm
      Para { text: "Fill in any two and leave one empty. Units are optional: 4.7k, 20m (milliamps), 1M." }
      Field { id: ohmV; label: "Voltage (V)"; placeholder: "9" }
      Field { id: ohmI; label: "Current (A)"; placeholder: "20m" }
      Field { id: ohmR; label: "Resistance (Ω)"; placeholder: "" }
      Answer {
        text: {
          var v = Learn.parseSI(ohmV.text), i = Learn.parseSI(ohmI.text), r = Learn.parseSI(ohmR.text)
          var given = (v !== null) + (i !== null) + (r !== null)
          if (given !== 2) return "Enter exactly two values."
          var o = Learn.ohm(v, i, r)
          return "V = " + root.fmt(o.v, "V") + "\nI = " + root.fmt(o.i, "A") + "\nR = " + root.fmt(o.r, "Ω") + "\nPower = " + root.fmt(o.p, "W") +
                 (o.p > 0.25 ? "\nThat's more than a common ¼ W resistor can handle." : "")
        }
      }
    }

    // ------------------------------------------------ LED resistor
    ColumnLayout {
      visible: root.tool === "led"
      Layout.fillWidth: true
      spacing: Style.spacing.sm
      Para { text: "Which resistor keeps an LED safe? R = (supply − LED voltage) ÷ current." }
      Field { id: ledV; label: "Supply (V)"; text: "9" }
      Dropdown {
        id: ledColor
        Layout.fillWidth: true
        label: "LED color"
        foreground: root.theme.fg
        background: root.theme.cardBg
        value: "red"
        options: Object.keys(Catalog.ledColors).map(function (k) { return { value: k, label: Catalog.ledColors[k].label + " (" + Catalog.ledColors[k].vf + " V)" } })
        onChanged: function (v) { value = v }
      }
      Field { id: ledI; label: "Current (mA)"; text: "15" }
      Answer {
        text: {
          var v = Learn.parseSI(ledV.text), i = Learn.parseSI(ledI.text)
          if (v === null || i === null || i <= 0) return "Enter the supply voltage and a current like 15."
          var r = Learn.ledResistor(v, ledColor.value, i)
          if (!r.ok) return r.message
          return "Exact: " + root.fmt(r.exact, "Ω") + "\nUse: " + root.fmt(r.pick, "Ω") + " (next standard value up)\nLED current: " + r.actualMilliamps.toFixed(1) + " mA\nResistor heat: " + root.fmt(r.watts, "W")
        }
      }
    }

    // ------------------------------------------------ color bands
    ColumnLayout {
      visible: root.tool === "bands"
      Layout.fillWidth: true
      spacing: Style.spacing.sm
      Para { text: "Bands 1 and 2 are digits, band 3 is how many zeros follow. A gold 4th band means ±5%. Type a value to see its colors, or pick colors to read a resistor." }
      Field { id: bandValue; label: "Value (Ω)"; text: "4.7k" }
      Row {
        spacing: Style.spacing.sm
        Repeater {
          model: {
            var b = Learn.bandsFor(Learn.parseSI(bandValue.text) || 0)
            return b ? [b[0], b[1], b[2], -1] : []
          }
          delegate: Column {
            required property var modelData
            spacing: 2
            Rectangle {
              width: Style.space(52); height: Style.space(52); radius: 6
              color: modelData < 0 ? "#c9a227" : Catalog.bandColors[modelData]
              border.color: "#000000"; border.width: 1
            }
            Text {
              width: Style.space(52)
              horizontalAlignment: Text.AlignHCenter
              text: modelData < 0 ? "Gold" : Learn.bandLabel[modelData]
              color: root.theme.fg
              font.family: root.theme.fontFamily
              font.pixelSize: root.theme.fCaption
            }
          }
        }
      }
      RowLayout {
        Layout.fillWidth: true
        spacing: Style.spacing.sm
        BandPick { id: b1; label: "1st"; value: 4 }
        BandPick { id: b2; label: "2nd"; value: 7 }
        BandPick { id: b3; label: "×"; value: 2 }
      }
      Answer { text: "Those colors read " + root.fmt(Learn.fromBands(b1.value, b2.value, b3.value), "Ω") }
    }

    // ------------------------------------------------ divider
    ColumnLayout {
      visible: root.tool === "divider"
      Layout.fillWidth: true
      spacing: Style.spacing.sm
      Para { text: "Two resistors in series from Vin to ground. The middle point sits at Vin × R2 ÷ (R1 + R2)." }
      Field { id: dvIn; label: "Vin (V)"; text: "9" }
      Field { id: dvR1; label: "R1, top (Ω)"; text: "10k" }
      Field { id: dvR2; label: "R2, bottom (Ω)"; text: "10k" }
      Answer {
        text: {
          var v = Learn.parseSI(dvIn.text), a = Learn.parseSI(dvR1.text), b = Learn.parseSI(dvR2.text)
          if (v === null || !a || !b) return "Enter Vin and both resistors."
          var d = Learn.divider(v, a, b)
          return "Vout = " + root.fmt(d.vout, "V") + "\nCurrent through both = " + root.fmt(d.current, "A")
        }
      }
    }

    // ------------------------------------------------ series & parallel
    ColumnLayout {
      visible: root.tool === "combine"
      Layout.fillWidth: true
      spacing: Style.spacing.sm
      Para { text: "List resistors separated by commas, like 220, 1k, 4.7k." }
      Field { id: combo; label: "Resistors"; text: "220, 220" }
      Answer {
        text: {
          var parts = combo.text.split(","), vals = []
          for (var i = 0; i < parts.length; i++) { var v = Learn.parseSI(parts[i]); if (v !== null && v > 0) vals.push(v) }
          if (vals.length < 2) return "Enter at least two values."
          return "In series: " + root.fmt(Learn.series(vals), "Ω") + " (they add up)\nIn parallel: " + root.fmt(Learn.parallel(vals), "Ω") + " (always less than the smallest)"
        }
      }
    }

    // ------------------------------------------------ RC timing
    ColumnLayout {
      visible: root.tool === "rc"
      Layout.fillWidth: true
      spacing: Style.spacing.sm
      Para { text: "A capacitor charges through a resistor to about 63% in one time constant (τ = R × C) and is practically full after 5τ." }
      Field { id: rcR; label: "Resistance (Ω)"; text: "470" }
      Field { id: rcC; label: "Capacitance (F)"; text: "1000u" }
      Answer {
        text: {
          var r = Learn.parseSI(rcR.text), c = Learn.parseSI(rcC.text)
          if (!r || !c) return "Enter R and C (like 1000u for 1000 µF)."
          var t = Learn.rc(r, c)
          return "τ = " + root.fmt(t.tau, "s") + "\nFull (5τ) ≈ " + root.fmt(t.full, "s")
        }
      }
    }

    // ------------------------------------------------ glossary
    Repeater {
      model: root.tool === "glossary" ? Learn.glossary : []
      delegate: ColumnLayout {
        required property var modelData
        Layout.fillWidth: true
        spacing: 2
        Text {
          text: modelData[0]
          color: root.theme.accent
          font.family: root.theme.fontFamily
          font.pixelSize: root.theme.fBody
          font.bold: true
        }
        Para { text: modelData[1] }
      }
    }
  }

  // ------------------------------------------------ pieces
  component Para: Text {
    Layout.fillWidth: true
    wrapMode: Text.WordWrap
    color: root.theme.fg
    opacity: 0.88
    font.family: root.theme.fontFamily
    font.pixelSize: root.theme.fSmall
  }

  component Answer: Rectangle {
    property alias text: answerText.text
    Layout.fillWidth: true
    Layout.topMargin: Style.spacing.sm
    implicitHeight: answerText.implicitHeight + Style.spacing.lg * 2
    radius: Style.cornerRadius
    color: Qt.rgba(0, 0, 0, 0.3)
    border.color: root.theme.accent
    Text {
      id: answerText
      anchors.fill: parent
      anchors.margins: Style.spacing.lg
      wrapMode: Text.WordWrap
      color: root.theme.fg
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fBody
      font.bold: true
    }
  }

  component Field: ColumnLayout {
    property string label: ""
    property alias text: input.text
    property string placeholder: ""
    Layout.fillWidth: true
    spacing: 2
    Text {
      text: parent.label
      color: root.theme.muted
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fCaption
      font.bold: true
    }
    TextField {
      id: input
      Layout.fillWidth: true
      foreground: root.theme.fg
      accent: root.theme.accent
      placeholderText: parent.placeholder
      font.pixelSize: root.theme.fBody
    }
  }

  component BandPick: ColumnLayout {
    property string label: ""
    property int value: 0
    Layout.fillWidth: true
    spacing: 2
    Text {
      text: parent.label
      color: root.theme.muted
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fCaption
    }
    Dropdown {
      Layout.fillWidth: true
      showLabel: false
      foreground: root.theme.fg
      background: root.theme.cardBg
      value: String(parent.value)
      options: Learn.bandLabel.map(function (n, i) { return { value: String(i), label: n } })
      onChanged: function (v) { parent.value = Number(v) }
    }
  }
}
