import QtQuick
import "lib/Catalog.js" as Catalog
import "lib/PartArt.js" as PartArt

// One part on the bench. Positioned at its first pin and rotated about it;
// the Canvas only repaints when something it shows actually changed.
Item {
  id: root

  property var part: null
  property int revision: 0      // parts change in place; this makes bindings re-read them
  property real cell: 20
  property var live: null
  property bool running: false
  property real angle: 0
  property bool selected: false
  property string warning: ""

  // A sounding buzzer's waves move outward. Ticks only while it is on.
  property real phase: 0
  Timer {
    interval: 50
    repeat: true
    running: root.running && root.part !== null && root.part.type === "buzzer" && root.live !== null && !root.live.reversed && (root.live.on === true || Number(root.live.freq) > 0)
    onTriggered: root.phase = (root.phase + 0.08) % 1
  }

  readonly property var box: (revision >= 0 && part) ? Catalog.box(part.type, part.props) : [0, 0, 1, 1]
  readonly property real pad: 2.2   // room for glows and smoke outside the body

  x: (revision >= 0 && part) ? part.x * cell : 0
  y: (revision >= 0 && part) ? part.y * cell : 0
  rotation: (revision >= 0 && part) ? part.rot * 90 : 0
  transformOrigin: Item.TopLeft

  // Selection and warning frames sit behind the art.
  Rectangle {
    visible: root.selected || root.warning !== ""
    x: (root.box[0] - 0.25) * root.cell
    y: (root.box[1] - 0.25) * root.cell
    width: (root.box[2] - root.box[0] + 0.5) * root.cell
    height: (root.box[3] - root.box[1] + 0.5) * root.cell
    radius: root.cell * 0.3
    color: root.warning === "danger" ? Qt.rgba(1, 0.2, 0.1, 0.22) : root.warning === "warn" ? Qt.rgba(1, 0.75, 0, 0.18) : Qt.rgba(0, 0.69, 1, 0.12)
    border.color: root.warning === "danger" ? "#ff3d00" : root.warning === "warn" ? "#ffb300" : "#00b0ff"
    border.width: Math.max(2, root.cell * 0.1)
  }

  Canvas {
    id: art
    x: (root.box[0] - root.pad) * root.cell
    y: (root.box[1] - root.pad) * root.cell
    width: (root.box[2] - root.box[0] + 2 * root.pad) * root.cell
    height: (root.box[3] - root.box[1] + 2 * root.pad) * root.cell

    property string paintedKey: ""
    readonly property string key: (root.revision >= 0 && root.part)
      ? JSON.stringify([root.part.type, root.part.rot, root.part.props, root.live, root.angle, root.phase, root.cell, root.running])
      : ""
    onKeyChanged: if (key !== paintedKey) requestPaint()

    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      if (!root.part) return
      paintedKey = key
      ctx.save()
      ctx.scale(root.cell, root.cell)
      ctx.translate(root.pad - root.box[0], root.pad - root.box[1])
      var live = root.live ? JSON.parse(JSON.stringify(root.live)) : {}
      live.spinAngle = root.angle   // the motor's turning animation; a servo's own angle comes from the engine
      live.phase = root.phase
      PartArt.draw(ctx, root.part, live, root.running)
      ctx.restore()
    }
  }

  // Warning badge, kept upright whatever the rotation.
  Rectangle {
    visible: root.warning !== ""
    x: (root.box[2] + 0.05) * root.cell
    y: (root.box[1] - 0.6) * root.cell
    width: root.cell * 0.9; height: width; radius: width / 2
    rotation: -root.rotation
    color: root.warning === "danger" ? "#ff3d00" : "#ffb300"
    border.color: "#1a1a1a"; border.width: 1
    Text {
      textFormat: Text.PlainText
      anchors.centerIn: parent
      text: "!"
      color: "#1a1a1a"
      font.bold: true
      font.pixelSize: parent.width * 0.75
    }
  }
}
