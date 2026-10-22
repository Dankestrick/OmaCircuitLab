import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "lib/Mcu.js" as Mcu

// The OmaDuino code editor, laid over the right side of the bench. Write a
// sketch, press Upload, and watch the Serial Monitor. Errors point at the
// line and say what to fix in plain words.
Rectangle {
  id: root

  property var theme: null
  property var part: null
  property var live: null
  property bool running: false

  signal upload(string code)
  signal closed()

  property var errors: []
  property string status: ""

  color: Qt.rgba(0.07, 0.08, 0.10, 0.98)
  radius: Style.cornerRadius
  border.color: root.theme ? root.theme.accent : "#888888"
  border.width: 1

  function load() {
    var code = part && part.props && part.props.code ? part.props.code : Mcu.example("blink")
    editor.text = code
    errors = []
    status = part && part.props.code ? "This is the sketch on the board." : "Example loaded. Press Upload to put it on the board."
  }

  onPartChanged: if (visible) load()
  onVisibleChanged: if (visible) { load(); editor.forceActiveFocus() }

  function doUpload() {
    var c = Mcu.compile(editor.text)
    errors = c.errors
    if (c.ok) {
      status = running ? "Uploaded. The board restarted with your sketch." : "Uploaded. Press Run to start the board."
      root.upload(editor.text)
    } else {
      status = "Fix the error" + (c.errors.length > 1 ? "s" : "") + " below, then Upload again."
    }
  }

  ColumnLayout {
    anchors.fill: parent
    anchors.margins: Style.spacing.lg
    spacing: Style.spacing.md

    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.md
      Text {
        text: "OmaDuino code"
        color: "#ffffff"
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSubtitle
        font.bold: true
      }
      Item { Layout.fillWidth: true }
      Dropdown {
        Layout.preferredWidth: Style.space(220)
        showLabel: false
        foreground: "#ffffff"
        background: "#1d2126"
        value: ""
        options: [{ value: "", label: "Load an example…" }].concat(Mcu.examples.map(function (e) { return { value: e.id, label: e.title } }))
        onChanged: function (v) {
          if (!v) return
          editor.text = Mcu.example(v)
          root.errors = []
          root.status = "Example loaded. Press Upload to put it on the board."
          value = ""
        }
      }
      Button {
        text: "⬆  Upload"
        bordered: true
        foreground: "#ffffff"
        tooltipText: "Check the sketch and put it on the board (Ctrl+U)"
        onClicked: root.doUpload()
      }
      Button {
        text: "✕"
        bordered: true
        foreground: "#ffffff"
        tooltipText: "Close the editor (Esc)"
        onClicked: root.closed()
      }
    }

    Text {
      Layout.fillWidth: true
      text: root.status
      wrapMode: Text.WordWrap
      color: root.errors.length ? "#ff8a80" : "#a5d6a7"
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fSmall
    }

    // Editor with line numbers.
    Rectangle {
      Layout.fillWidth: true
      Layout.fillHeight: true
      color: "#0d1013"
      radius: Style.cornerRadius
      border.color: "#2c3239"

      ScrollView {
        id: scroller
        anchors.fill: parent
        anchors.margins: 1
        clip: true

        Row {
          width: scroller.availableWidth
          Column {
            id: gutter
            width: Style.space(44)
            topPadding: editor.topPadding
            Repeater {
              model: editor.lineCount
              delegate: Text {
                required property int index
                width: gutter.width - Style.spacing.md
                horizontalAlignment: Text.AlignRight
                height: editor.contentHeight / Math.max(1, editor.lineCount)
                text: String(index + 1)
                color: root.errorLines[index + 1] ? "#ff5252" : "#56606b"
                font.family: "monospace"
                font.pixelSize: editor.font.pixelSize
                font.bold: root.errorLines[index + 1] === true
              }
            }
          }
          TextArea {
            id: editor
            width: parent.width - gutter.width
            wrapMode: TextEdit.NoWrap
            selectByMouse: true
            persistentSelection: true
            color: "#e6edf3"
            selectionColor: "#264f78"
            selectedTextColor: "#ffffff"
            font.family: "monospace"
            font.pixelSize: root.theme.fBody
            background: null
            leftPadding: Style.spacing.md
            Keys.onPressed: function (event) {
              if (event.key === Qt.Key_Tab) { editor.insert(editor.cursorPosition, "  "); event.accepted = true }
              else if (event.key === Qt.Key_Escape) { root.closed(); event.accepted = true }
              else if (event.key === Qt.Key_U && (event.modifiers & Qt.ControlModifier)) { root.doUpload(); event.accepted = true }
              else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                // Keep the indent of the line above, one more after "{".
                var before = editor.text.substring(0, editor.cursorPosition)
                var lineStart = before.lastIndexOf("\n") + 1
                var indent = /^[ \t]*/.exec(before.substring(lineStart))[0]
                if (/\{\s*$/.test(before)) indent += "  "
                editor.insert(editor.cursorPosition, "\n" + indent)
                event.accepted = true
              }
            }
          }
        }
      }
    }

    // Errors.
    Repeater {
      model: root.errors
      delegate: Rectangle {
        required property var modelData
        Layout.fillWidth: true
        implicitHeight: errText.implicitHeight + Style.spacing.md * 2
        radius: Style.cornerRadius
        color: "#4a1414"
        Text {
          id: errText
          anchors.fill: parent
          anchors.margins: Style.spacing.md
          wrapMode: Text.WordWrap
          text: "Line " + modelData.line + ": " + modelData.message
          color: "#ffcdd2"
          font.family: root.theme.fontFamily
          font.pixelSize: root.theme.fSmall
        }
      }
    }

    // Runtime error from the board.
    Rectangle {
      visible: root.running && root.live && root.live.error
      Layout.fillWidth: true
      implicitHeight: rtText.implicitHeight + Style.spacing.md * 2
      radius: Style.cornerRadius
      color: "#4a1414"
      Text {
        id: rtText
        anchors.fill: parent
        anchors.margins: Style.spacing.md
        wrapMode: Text.WordWrap
        text: root.live && root.live.error ? "The board stopped" + (root.live.errorLine ? " at line " + root.live.errorLine : "") + ": " + root.live.error : ""
        color: "#ffcdd2"
        font.family: root.theme.fontFamily
        font.pixelSize: root.theme.fSmall
      }
    }

    // Serial Monitor.
    Text {
      text: "Serial Monitor"
      color: "#b0bec5"
      font.family: root.theme.fontFamily
      font.pixelSize: root.theme.fCaption
      font.bold: true
    }
    Rectangle {
      Layout.fillWidth: true
      Layout.preferredHeight: Style.space(130)
      color: "#000000"
      radius: Style.cornerRadius
      border.color: "#2c3239"
      clip: true
      Text {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: Style.spacing.md
        text: {
          var s = root.running && root.live && root.live.serial ? root.live.serial : (root.running ? "" : "Press Run to start the board. Serial.print() output shows here.")
          var lines = s.split("\n")
          return lines.slice(Math.max(0, lines.length - 8)).join("\n")
        }
        color: "#7CFC7C"
        font.family: "monospace"
        font.pixelSize: root.theme.fSmall
        wrapMode: Text.NoWrap
        elide: Text.ElideRight
      }
    }
  }

  readonly property var errorLines: {
    var m = ({})
    for (var i = 0; i < errors.length; i++) m[errors[i].line] = true
    if (running && live && live.errorLine) m[live.errorLine] = true
    return m
  }
}
