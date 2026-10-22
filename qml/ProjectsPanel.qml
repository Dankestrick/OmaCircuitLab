import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui

// "My circuits": save the bench under a name and open it again later.
Rectangle {
  id: root

  property var theme: null
  property var projects: ({})        // name -> { bench, saved }

  signal save(string name)
  signal openProject(string name)
  signal remove(string name)
  signal closed()

  color: Qt.rgba(0.07, 0.08, 0.10, 0.98)
  radius: Style.cornerRadius
  border.color: root.theme ? root.theme.accent : "#888888"
  border.width: 1
  implicitHeight: col.implicitHeight + Style.spacing.lg * 2

  readonly property var names: {
    var out = []
    for (var k in projects) out.push(k)
    out.sort(function (a, b) { return String(projects[b].saved).localeCompare(String(projects[a].saved)) })
    return out
  }

  onVisibleChanged: if (visible) { nameField.text = ""; nameField.forceActiveFocus() }

  ColumnLayout {
    id: col
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.margins: Style.spacing.lg
    spacing: Style.spacing.md

    RowLayout {
      Layout.fillWidth: true
      Text {
        Layout.fillWidth: true
        text: "My circuits"
        color: "#ffffff"
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSubtitle
        font.bold: true
      }
      Button { text: "✕"; bordered: true; foreground: "#ffffff"; onClicked: root.closed() }
    }

    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.sm
      TextField {
        id: nameField
        Layout.fillWidth: true
        foreground: "#ffffff"
        accent: root.theme.accent
        placeholderText: "Name this circuit"
        font.pixelSize: root.theme.fBody
        Keys.onReturnPressed: if (text.trim() !== "") root.save(text.trim())
        Keys.onEscapePressed: root.closed()
      }
      Button {
        text: "Save"
        bordered: true
        foreground: "#ffffff"
        tooltipText: "Save the bench under this name (the same name replaces it)"
        onClicked: if (nameField.text.trim() !== "") root.save(nameField.text.trim())
      }
    }

    Text {
      visible: root.names.length === 0
      text: "Nothing saved yet. Your current bench always saves itself too."
      color: "#90a4ae"
      wrapMode: Text.WordWrap
      Layout.fillWidth: true
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fSmall
    }

    Repeater {
      model: root.names
      delegate: RowLayout {
        required property var modelData
        Layout.fillWidth: true
        spacing: Style.spacing.sm
        Column {
          Layout.fillWidth: true
          Text {
            text: modelData
            color: "#ffffff"
            elide: Text.ElideRight
            width: parent.width
            font.family: root.theme.fontFamily
            font.pixelSize: root.theme.fBody
            font.bold: true
          }
          Text {
            text: {
              var p = root.projects[modelData]
              var n = p && p.bench ? p.bench.parts.length + " parts · " + p.bench.wires.length + " wires" : ""
              var d = p && p.saved ? new Date(p.saved).toLocaleString(Qt.locale(), Locale.ShortFormat) : ""
              return n + (d ? " · " + d : "")
            }
            color: "#90a4ae"
            font.family: root.theme.fontFamily
            font.pixelSize: root.theme.fCaption
          }
        }
        Button { text: "Open"; bordered: true; foreground: "#ffffff"; tooltipText: "Replace the bench with this circuit (Ctrl+Z undoes)"; onClicked: root.openProject(modelData) }
        Button { text: "Delete"; bordered: true; foreground: "#ff8a80"; onClicked: root.remove(modelData) }
      }
    }
  }
}
