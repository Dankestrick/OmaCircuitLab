# OmaCircuitLab — Plan (draft v0, Claude)

Breadboard circuit simulator and learning tool for Omarchy. Name note: "OmaCircuit"
is already on the marketplace (io.github.labrat-0.omacircuit, a puzzle game), so this
project is **OmaCircuitLab** (id `io.github.dankestrick.omacircuitlab`).

## Goals
- Large, centered app window (about 80% of the screen), calm solid background, high-contrast parts.
- Pick a part from a grouped dropdown, drop it on the breadboard, wire it, press Run.
- Wires snap to the hole grid and route as neat square (Manhattan) paths that shift aside to make room.
- Change supply voltage, wire colors, part values (resistance, LED color, etc.) live.
- Teach: hover tips on every part/pin/hole, plus a step-by-step Learner's Guide from LEDs to small robots.

## Form factor
Omarchy Quattro plugin (QML/Quickshell), **no bar icon**. Same pattern as OmaRT100 / OmaCanon:
- kind `panel` (or `overlay`, whichever OmaRT100 uses best) with a large centered FloatingWindow.
- Launched from the **app menu** through `omacircuitlab.desktop`
  (`Exec=omarchy-shell shell toggle io.github.dankestrick.omacircuitlab`, Categories=Education;Electronics;).
- Layout: left = parts dropdown + parts tray, center = breadboard canvas (zoom/pan), right = Inspector
  (selected part properties, meters), bottom = toolbar (Run/Pause/Reset, supply voltage, wire color,
  undo/redo, save/load, **opacity toggle**).
- Pure QML + JS simulation engine (in a WorkerScript) (no Python needed for v1) so it stays light and passes review.
  Projects save as JSON in ~/.local/share/omacircuitlab/.

## Omarchy fit (hard requirement)
This runs inside omarchy-shell and must stay a good citizen there.
- Built the official Quattro way (omarchy-plugins skill / plugins.omarchy.org/develop.html), no bar widget,
  app-menu desktop entry installed by the plugin.
- **Readable on see-through dark themes.** Dank runs window transparency with dark themes, so:
  - Window opens **solid by default** (our own opaque background, ignoring Hyprland's global opacity
    via a window rule / `opacity 1.0 override` if the shell allows, else a fully opaque root rect).
  - Toolbar **Opacity toggle**: Solid / Theme (follow the user's transparency) / custom slider; remembered.
  - Theme colors drive chrome only (accent, fonts, panel tones). The board area always sits on a solid,
    slightly lighter "workbench" surface with enforced contrast (WCAG AA for text, outlined parts and
    wires, a dark outline on black wires, glow halos on LEDs) so nothing disappears into a dark theme.
- Esc closes, focus returns to the previous window, works on any monitor size and scale, no stray
  layer-shell surfaces left behind.
- Light on the shell: the simulation pauses when the panel is hidden, the solver runs in a WorkerScript
  so the shell UI never stalls, and a runaway circuit or MCU loop gets cut off by a step budget.
- No root, no network, no extra system packages for v1. Saves only under ~/.local/share/omacircuitlab
  and settings via the plugin settings API.
- Runs omarchy-plugin-review before every release so the marketplace security bot passes.

## Simulation engine (JS, `qml/engine/`)
- Netlist built from breadboard connectivity (rails + 5-hole strips + wires + part pins).
- Modified Nodal Analysis (MNA) solver, dense Gaussian elimination (circuits are small).
- Nonlinear parts (diodes, LEDs, transistors) via Newton-Raphson with damping.
- Transient stepping (fixed dt, ~1 ms) for capacitors, inductors, motors, 555 timers, MCU code.
- Safety teaching: detect short circuits, LED over-current (LED "burns out" with a puff),
  reversed polarity electrolytics, over-voltage on parts; show a friendly warning bubble.

## Parts catalog (phased)
**Phase 1 basics:** breadboard (full/half), battery packs (3V/4.5V/9V), bench supply (0–15V adjustable),
resistors (E12 values, color bands drawn correctly), LEDs (red/green/blue/yellow/white, RGB),
push button, slide switch, potentiometer, wires/jumpers, multimeter (V/A/Ω probes).
**Phase 2 analog:** capacitors (ceramic/electrolytic), diodes, zener, NPN/PNP transistors, MOSFET,
photoresistor (LDR) with light slider, thermistor/temperature probe with temp slider, buzzer,
7-segment display, 555 timer, op-amp, voltage regulator (7805).
**Phase 3 robotics:** microcontroller board (Arduino-Uno-like "OmaDuino"), DC motor + L298N/H-bridge,
servo (animated horn), stepper + driver, ultrasonic distance sensor (HC-SR04 with distance slider),
IR obstacle sensor, DHT temp/humidity, relay, OLED/LCD 16x2, NeoPixel strip.
MCU code: small Arduino-flavored JS dialect (setup/loop, pinMode, digitalWrite, analogRead, delay,
servo.write) running in a sandboxed interpreter stepped by the sim clock.
**Phase 4:** a mini robot playground (2-wheel bot driven by the sim'd MCU, sensors read a simple 2D arena).

## Wiring UX
- Click a hole -> drag -> release on another hole. Path auto-routes orthogonally on the grid.
- Router: A* on the hole grid with turn penalty, avoids part bodies, then nudges parallel wires
  apart by one lane so they never overlap. Drag a wire segment to re-route manually.
- Wire color picker (red/black/blue/green/yellow/orange/white) with a convention hint (red = +, black = GND).
- Hovering a hole highlights its whole connected strip.

## Learning features
- Hover tips: what a part is, how its pins work, typical values, safety note.
- Learner's Guide panel: lessons with a goal, a parts list, a ghost overlay showing where pieces go,
  and an auto-check ("Your LED is lit, current 12 mA — nice!").
  Track: 1 LED+resistor, 2 Ohm's law with multimeter, 3 series/parallel, 4 buttons, 5 pot dimmer,
  6 capacitor RC fade, 7 transistor switch, 8 LDR night light, 9 temp alarm, 10 555 blinker,
  11 first MCU blink, 12 servo sweep, 13 motor + H-bridge, 14 obstacle-avoiding robot.

## Milestones
M0 scaffold plugin, panel window, breadboard grid render, part dropdown.
M1 place/move/rotate/delete parts, wire drawing with snap + router, save/load.
M2 DC MNA solver + Phase 1 parts + multimeter + LED glow + warnings. (First playable.)
M3 transient + Phase 2 parts + hover tips.
M4 Learner's Guide lessons 1–10.
M5 OmaDuino MCU + Phase 3 parts + lessons 11–14.
M6 robot playground, polish, marketplace review.

## Split between Claude and Grok (proposal)
- Claude: plugin scaffold, Panel UI, breadboard canvas, part rendering, wiring/router UX, Inspector, guide UI.
- Grok: simulation engine (netlist, MNA, Newton, transient), component electrical models,
  MCU interpreter, engine unit tests (qmltestrunner or node), lesson auto-check logic.
- Shared contract: `docs/ENGINE_API.md` (netlist JSON in, node voltages/branch currents/part states out).

## Open questions
- Engine in QML JS (simplest) vs a WASM/ngspice backend (more accurate, heavier, harder review)?
- MCU language: Arduino-like JS dialect vs real C++ subset?

## Status (end of 2026-10-21)
Built and running in the shell: M0, M1, most of M3–M6 UI (parts, wiring, inspector, 23 lessons, tools, OmaDuino language + editor, robot arena, projects).
Engine (Grok): `qml/lib/Engine.js` solves 14/16 basic lessons; `EngineWorker.js`, engine tests and the board coupling are still to do.
See `docs/HANDOFF-TOMORROW.md` for the full state and next steps.
