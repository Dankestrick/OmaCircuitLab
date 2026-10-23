import QtQuick
import QtMultimedia

// Loops one short tone file while `playing`. Loaded through a Loader in
// Overlay, so a shell without QtMultimedia just stays quiet.
Item {
  id: root
  property url source
  property bool playing: false

  SoundEffect {
    id: fx
    source: root.source
    loops: SoundEffect.Infinite
    volume: 0.3
    onStatusChanged: root.sync()
  }

  function sync() {
    if (root.playing && fx.status === SoundEffect.Ready) { if (!fx.playing) fx.play() }
    else if (fx.playing) fx.stop()
  }
  onPlayingChanged: sync()
  // A new pitch: stop so the next file starts cleanly.
  onSourceChanged: { fx.stop(); sync() }
  Component.onDestruction: fx.stop()
}
