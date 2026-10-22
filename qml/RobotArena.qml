import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "lib/Arena.js" as Arena

// Top-down robot arena. The Overlay steps the car with the wheel speeds the
// engine reports; this only draws it and offers the room layouts.
Rectangle {
  id: root

  property var theme: null
  property var arenaState: null
  property bool running: false
  property real leftSpin: 0
  property real rightSpin: 0

  signal layoutPicked(string layout)
  signal resetCar()
  signal closed()

  color: Qt.rgba(0.07, 0.08, 0.10, 0.98)
  radius: Style.cornerRadius
  border.color: root.theme ? root.theme.accent : "#888888"
  border.width: 1

  onArenaStateChanged: room.requestPaint()

  ColumnLayout {
    anchors.fill: parent
    anchors.margins: Style.spacing.md
    spacing: Style.spacing.sm

    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.md
      Text {
        text: "Robot arena"
        color: "#ffffff"
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSubtitle
        font.bold: true
      }
      Text {
        Layout.fillWidth: true
        text: root.arenaState ? "Sonar " + Math.round(root.arenaState.distance) + " cm · L " + Math.round(root.leftSpin * 100) + "% · R " + Math.round(root.rightSpin * 100) + "%" + (root.arenaState.bumped ? " · bump!" : "") : ""
        color: root.arenaState && root.arenaState.bumped ? "#ffab91" : "#b0bec5"
        elide: Text.ElideRight
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSmall
      }
      Dropdown {
        Layout.preferredWidth: Style.space(150)
        showLabel: false
        foreground: "#ffffff"
        background: "#1d2126"
        value: root.arenaState ? root.arenaState.layout : "boxes"
        options: Object.keys(Arena.layouts).map(function (k) { return { value: k, label: Arena.layouts[k].label } })
        onChanged: function (v) { root.layoutPicked(v) }
      }
      Button { text: "↺"; bordered: true; foreground: "#ffffff"; tooltipText: "Put the robot back at the start"; onClicked: root.resetCar() }
      Button { text: "✕"; bordered: true; foreground: "#ffffff"; tooltipText: "Close the arena"; onClicked: root.closed() }
    }

    Canvas {
      id: room
      Layout.fillWidth: true
      Layout.fillHeight: true
      onWidthChanged: requestPaint()
      onHeightChanged: requestPaint()
      onPaint: {
        var ctx = getContext("2d")
        ctx.reset()
        var st = root.arenaState
        if (!st) return
        var k = Math.min(width / Arena.W, height / Arena.H)
        var ox = (width - Arena.W * k) / 2, oy = (height - Arena.H * k) / 2
        ctx.save()
        ctx.translate(ox, oy)
        ctx.scale(k, k)
        // Floor with a 25 cm grid.
        ctx.fillStyle = "#e8e4d8"; ctx.fillRect(0, 0, Arena.W, Arena.H)
        ctx.strokeStyle = "rgba(0,0,0,0.08)"; ctx.lineWidth = 0.6
        for (var gx = 25; gx < Arena.W; gx += 25) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, Arena.H); ctx.stroke() }
        for (var gy = 25; gy < Arena.H; gy += 25) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(Arena.W, gy); ctx.stroke() }
        ctx.strokeStyle = "#37474f"; ctx.lineWidth = 3; ctx.strokeRect(0, 0, Arena.W, Arena.H)
        var bs = Arena.boxesOf(st.layout)
        for (var i = 0; i < bs.length; i++) { ctx.fillStyle = "#795548"; ctx.fillRect(bs[i][0], bs[i][1], bs[i][2], bs[i][3]) }
        // Trail.
        if (st.trail.length > 1) {
          ctx.strokeStyle = "rgba(30,136,229,0.45)"; ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.moveTo(st.trail[0][0], st.trail[0][1])
          for (var t = 1; t < st.trail.length; t++) ctx.lineTo(st.trail[t][0], st.trail[t][1])
          ctx.stroke()
        }
        // Sonar beam.
        var nx = st.x + Math.cos(st.a) * Arena.BODY, ny = st.y + Math.sin(st.a) * Arena.BODY
        ctx.strokeStyle = st.distance < 25 ? "rgba(229,57,53,0.8)" : "rgba(3,169,244,0.6)"; ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx + Math.cos(st.a) * st.distance, ny + Math.sin(st.a) * st.distance); ctx.stroke()
        // The car.
        ctx.save()
        ctx.translate(st.x, st.y); ctx.rotate(st.a)
        ctx.fillStyle = "#212121"; ctx.fillRect(-5, -10, 9, 3); ctx.fillRect(-5, 7, 9, 3)
        ctx.fillStyle = st.bumped ? "#e53935" : "#455a64"
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = "#1e88e5"; ctx.fillRect(5, -4, 4, 8)
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(1, -3); ctx.lineTo(1, 3); ctx.closePath(); ctx.fill()
        ctx.restore()
        ctx.restore()
      }
    }
    Text {
      Layout.fillWidth: true
      wrapMode: Text.WordWrap
      text: root.running ? "Room is 3 m × 2 m. The blue line is what the sonar sees." : "Press Run to start the robot. Load the Wall-dodging robot example on the board."
      color: "#90a4ae"
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fCaption
    }
  }
}
