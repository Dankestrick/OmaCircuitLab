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

  signal pick(int i)
  signal build()

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
      Layout.fillWidth: true
      text: root.lesson ? root.lesson.title : ""
      color: root.theme.fg
      wrapMode: Text.WordWrap
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fTitle
      font.bold: true
    }

    Text {
      Layout.fillWidth: true
      text: root.lesson ? root.lesson.idea : ""
      wrapMode: Text.WordWrap
      color: root.theme.fg
      opacity: 0.9
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fSmall
      lineHeight: 1.15
    }

    Text {
      text: "Steps"
      color: root.theme.muted
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fCaption
      font.bold: true
    }

    Repeater {
      model: root.lesson ? root.lesson.steps : []
      delegate: RowLayout {
        required property var modelData
        required property int index
        Layout.fillWidth: true
        spacing: Style.spacing.md
        Rectangle {
          Layout.alignment: Qt.AlignTop
          Layout.preferredWidth: root.theme.fBody * 1.6
          Layout.preferredHeight: root.theme.fBody * 1.6
          radius: width / 2
          color: root.theme.accent
          Text {
            anchors.centerIn: parent
            text: String(index + 1)
            color: root.theme.textOn(root.theme.accent)
            font.family: root.theme.fontFamily
            font.pixelSize: root.theme.fCaption
            font.bold: true
          }
        }
        Text {
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
