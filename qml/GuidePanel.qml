import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui

// The Learner's Guide: pick a lesson, read the idea, follow the steps, and
// watch the check line turn green when the circuit works.
Flickable {
  id: root
  clip: true
  contentHeight: col.implicitHeight
  boundsBehavior: Flickable.StopAtBounds

  property var theme: null
  property var lessons: []
  property int index: 0
  property var status: ({ done: false, hint: "" })
  property var steps: []          // Guide.steps(lesson)
  property var done: []           // Guide.progress(...)
  property var tryIt: []          // what to do once it runs
  property int hovered: -1

  signal pick(int i)
  signal build()
  signal preview(int step)        // -1 when the pointer leaves the steps

  readonly property int doneCount: done.filter(function (d) { return d }).length
  readonly property int currentStep: {
    for (var i = 0; i < done.length; i++) if (!done[i]) return i
    return -1
  }

  readonly property var lesson: lessons[index] || null

  ColumnLayout {
    id: col
    width: root.width
    spacing: Style.spacing.md

    Dropdown {
      Layout.fillWidth: true
      label: "Lesson"
      foreground: root.theme.fg
      background: root.theme.cardBg
      value: String(root.index)
      options: root.lessons.map(function (l, i) { return { value: String(i), label: l.title } })
      onChanged: function (v) { root.pick(Number(v)) }
    }

    Text {
      textFormat: Text.PlainText
      Layout.fillWidth: true
      text: root.lesson ? root.lesson.title : ""
      color: root.theme.fg
      wrapMode: Text.WordWrap
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fTitle
      font.bold: true
    }

    Text {
      textFormat: Text.PlainText
      Layout.fillWidth: true
      text: root.lesson ? root.lesson.idea : ""
      wrapMode: Text.WordWrap
      color: root.theme.fg
      opacity: 0.9
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fSmall
      lineHeight: 1.15
    }

    // The short plan, then every step spelled out.
    Text {
      textFormat: Text.PlainText
      Layout.fillWidth: true
      visible: root.lesson !== null && root.lesson.steps.length > 0 && root.tryIt.length === 0
      text: root.lesson ? "In short: " + root.lesson.steps.join(" ") : ""
      wrapMode: Text.WordWrap
      color: root.theme.muted
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fCaption
    }

    RowLayout {
      Layout.fillWidth: true
      Layout.topMargin: Style.spacing.sm
      Text {
        textFormat: Text.PlainText
        text: "Step by step"
        color: root.theme.fg
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fBody
        font.bold: true
      }
      Item { Layout.fillWidth: true }
      Text {
        textFormat: Text.PlainText
        text: root.doneCount + " of " + root.steps.length + " done"
        color: root.doneCount === root.steps.length && root.steps.length > 0 ? "#66bb6a" : root.theme.muted
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fCaption
        font.bold: true
      }
    }

    // Progress bar.
    Rectangle {
      Layout.fillWidth: true
      Layout.preferredHeight: 4
      radius: 2
      color: Qt.rgba(root.theme.fg.r, root.theme.fg.g, root.theme.fg.b, 0.12)
      Rectangle {
        width: root.steps.length ? parent.width * root.doneCount / root.steps.length : 0
        height: parent.height
        radius: 2
        color: "#66bb6a"
      }
    }

    Text {
      textFormat: Text.PlainText
      Layout.fillWidth: true
      text: "Point at a step to see where it goes on the bench. Steps tick themselves off as you build."
      wrapMode: Text.WordWrap
      color: root.theme.muted
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fCaption
    }

    Repeater {
      model: root.steps
      delegate: Rectangle {
        id: stepRow
        required property var modelData
        required property int index
        readonly property bool isDone: root.done[index] === true
        readonly property bool isCurrent: index === root.currentStep
        Layout.fillWidth: true
        implicitHeight: stepLine.implicitHeight + Style.spacing.sm * 2
        radius: Style.cornerRadius
        color: isCurrent ? Qt.rgba(root.theme.accent.r, root.theme.accent.g, root.theme.accent.b, 0.16)
          : stepMouse.containsMouse ? Qt.rgba(root.theme.fg.r, root.theme.fg.g, root.theme.fg.b, 0.06) : "transparent"
        border.color: isCurrent ? root.theme.accent : "transparent"
        border.width: 1

        RowLayout {
          id: stepLine
          anchors.left: parent.left; anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          anchors.margins: Style.spacing.sm
          spacing: Style.spacing.md
          Rectangle {
            Layout.alignment: Qt.AlignTop
            Layout.preferredWidth: root.theme.fBody * 1.6
            Layout.preferredHeight: root.theme.fBody * 1.6
            radius: width / 2
            color: stepRow.isDone ? "#2e7d32" : stepRow.isCurrent ? root.theme.accent : "transparent"
            border.color: stepRow.isDone ? "#66bb6a" : root.theme.accent
            border.width: 1
            Text {
              textFormat: Text.PlainText
              anchors.centerIn: parent
              text: stepRow.isDone ? "✓" : String(stepRow.index + 1)
              color: stepRow.isDone || stepRow.isCurrent ? "#ffffff" : root.theme.fg
              font.family: root.theme.fontFamily
              font.pixelSize: root.theme.fCaption
              font.bold: true
            }
          }
          Text {
            textFormat: Text.PlainText
            Layout.fillWidth: true
            text: stepRow.modelData.text
            wrapMode: Text.WordWrap
            color: root.theme.fg
            opacity: stepRow.isDone ? 0.55 : 1
            font.family: root.theme.fontFamily
            font.pixelSize: root.theme.fSmall
            font.bold: stepRow.isCurrent
          }
        }
        MouseArea {
          id: stepMouse
          anchors.fill: parent
          hoverEnabled: true
          onContainsMouseChanged: root.preview(containsMouse ? stepRow.index : -1)
        }
      }
    }

    Text {
      textFormat: Text.PlainText
      visible: root.tryIt.length > 0
      Layout.topMargin: Style.spacing.md
      text: "Try it"
      color: root.theme.fg
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fBody
      font.bold: true
    }

    Repeater {
      model: root.tryIt
      delegate: RowLayout {
        required property var modelData
        required property int index
        Layout.fillWidth: true
        spacing: Style.spacing.md
        Text {
          textFormat: Text.PlainText
          Layout.alignment: Qt.AlignTop
          text: "▸"
          color: root.theme.accent
          font.family: root.theme.fontFamily
          font.pixelSize: root.theme.fSmall
          font.bold: true
        }
        Text {
          textFormat: Text.PlainText
          Layout.fillWidth: true
          text: modelData
          wrapMode: Text.WordWrap
          color: root.theme.fg
          font.family: root.theme.fontFamily
          font.pixelSize: root.theme.fSmall
        }
      }
    }

    Rectangle {
      Layout.fillWidth: true
      Layout.topMargin: Style.spacing.md
      implicitHeight: statusText.implicitHeight + Style.spacing.lg * 2
      radius: Style.cornerRadius
      color: root.status.done ? "#1b5e20" : Qt.rgba(0, 0, 0, 0.28)
      border.color: root.status.done ? "#66bb6a" : root.theme.lineColor
      Text {
        textFormat: Text.PlainText
        id: statusText
        anchors.fill: parent
        anchors.margins: Style.spacing.lg
        text: (root.status.done ? "✓  " : "…  ") + (root.status.hint || "")
        wrapMode: Text.WordWrap
        color: "#ffffff"
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSmall
        font.bold: root.status.done
      }
    }

    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.sm
      Button {
        text: "Build it for me"
        bordered: true
        foreground: root.theme.fg
        tooltipText: "Replaces the bench with this lesson's circuit (Ctrl+Z brings yours back)"
        onClicked: root.build()
      }
      Item { Layout.fillWidth: true }
      Button {
        text: "‹"
        bordered: true
        foreground: root.theme.fg
        onClicked: if (root.index > 0) root.pick(root.index - 1)
      }
      Button {
        text: "Next ›"
        bordered: true
        foreground: root.theme.fg
        onClicked: if (root.index < root.lessons.length - 1) root.pick(root.index + 1)
      }
    }

    Text {
      textFormat: Text.PlainText
      Layout.fillWidth: true
      Layout.topMargin: Style.spacing.lg
      wrapMode: Text.WordWrap
      text: "The first lessons use batteries and parts. Then you program the OmaDuino board, and the last lesson builds a robot that drives around the arena."
      color: root.theme.muted
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fCaption
    }
  }
}
