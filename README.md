# OmaCircuitLab

A breadboard circuit simulator for learning electronics on Omarchy. Drop parts onto a full-size breadboard, wire them with neat square jumpers, press **Run**, and watch LEDs light, meters read and motors spin. Hover anything for a plain-language explanation, and follow the **Learner's Guide** from a first LED to driving a motor.

## Parts

- **Power:** 9 V battery, AA battery pack (2–4 cells), adjustable bench supply (0–15 V with current limit)
- **Basics:** resistors (E12 values with correct color bands), LEDs in six colors, RGB LED, ceramic and electrolytic capacitors
- **Inputs:** push button, slide switch, potentiometer
- **Sensors:** light sensor (LDR), thermistor, TMP36 temperature probe
- **Semiconductors:** diode, zener, NPN and PNP transistors, N-MOSFET
- **Outputs:** buzzer, DC motor
- **Meters:** multimeter (volts, amps, ohms)

## Using it

Open **OmaCircuitLab** from the app menu.

| Do this | How |
|---|---|
| Add a part | Pick a kind of part, click a part, click the bench |
| Turn a part | `R`, or right-click it |
| Add a wire | Drag from one hole to another |
| Recolor a wire | Select it, click a color (or press `1`–`8` before drawing) |
| Move a wire end | Select the wire, drag one of its blue rings |
| Run / stop | `Space` |
| Press a button | Click and hold it while running |
| Flip a switch / change meter mode | Click it |
| Turn a knob, change light or temperature | Scroll on the part |
| Zoom / move the view | Scroll on empty space / drag empty space |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Close | `Esc` (your bench saves itself) |

The bench saves to `~/.local/share/omacircuitlab.json`.

## Easy to see on any theme

The window opens **Solid**: OmaCircuitLab asks Hyprland to draw its own window fully opaque, so a see-through dark theme never bleeds into the circuit. The toolbar's **Window** buttons switch between Solid, **Theme** (normal Omarchy transparency) and **Custom** (your own opacity). The breadboard itself is always light with outlined parts and wires.

## Light on your PC

Nothing runs while the window is closed: the shell only loads OmaCircuitLab when you open it. While open, the circuit solver runs on its own thread, only when something changes. Circuits that change over time (capacitors, motors) step about 30 times a second, and only while the window is open and running.

## Install

```
omarchy plugin add https://github.com/Dankestrick/OmaCircuitLab --enable
omarchy-shell shell toggle io.github.dankestrick.omacircuitlab
```

The first time it opens, OmaCircuitLab adds its own entry to the app menu (`~/.local/share/applications/omacircuitlab.desktop`), so after that you can open it from the launcher.

For development, `scripts/dev-install.sh` copies the checkout into `~/.config/omarchy/plugins/` and adds the app menu entry. Run the tests with `node tests/bench.test.js && node tests/lessons.test.js && node tests/engine.test.js`.

## Coming next

A programmable microcontroller board, servos, distance and IR sensors, H-bridge motor drivers, displays, and a small robot playground.

## License

MIT
