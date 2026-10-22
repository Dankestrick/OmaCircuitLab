# OmaCircuitLab: handoff for 2026-10-22 (Claude + Grok)

Read this first, both of you. It covers where things stand at the end of 2026-10-21 and what to do next.

## What it is

A breadboard circuit simulator and electronics learning tool. It's an Omarchy shell plugin (`io.github.dankestrick.omacircuitlab`, kind `overlay`, no bar icon) opened from the app menu.

- Source: `/home/dank/GitDank/OmaCircuitLab`, a git repo (branch master). Commit after each working step. No GitHub remote yet.
- Installed copy: `~/.config/omarchy/plugins/io.github.dankestrick.omacircuitlab`.
- Plan: `PLAN.md`. Engine specs: `docs/ENGINE_CONTRACT.md` and `docs/ENGINE_CONTRACT_MCU.md`.

## Dank's rules for working together

- Never message Grok while it's working: queued prompts don't send themselves. Wait for idle, check its work, then send one complete message.
- When Grok passes about 65% context (166K of 256K) and is idle, have it write a handoff, then `/new` and point it at the handoff.
- Keep the load on the PC light. The app must stay easy to see on dark, see-through themes. It must work well inside Omarchy.
- Dank wants it "fuckin awesome": lots of learning features, everything tested.

## How to test in the shell (important)

The shell caches plugin QML in memory. Saved edits do NOT reload, and `rescanPlugins` is not enough. After editing:

```
cd ~/GitDank/OmaCircuitLab && ./scripts/dev-install.sh && omarchy restart shell
omarchy-shell shell summon io.github.dankestrick.omacircuitlab '{"lesson":1,"build":true}'   # optional "run": true
```

- Screenshot it with `grim -g "<x>,<y> <w>x<h>"`, using the geometry from `hyprctl clients -j` (title `OmaCircuitLab`).
- Logs: `qs log -p /usr/share/omarchy/shell --tail 80 | grep -i omacircuit`.
- Only keyboard input can be simulated here (`wtype`). Dank does the mouse testing.
- Node tests, which run without the shell: `for t in tests/*.test.js; do node $t; done`.

## Done and working (Claude, all in the shell)

- **Window:**
  - Large centered window with a parts picker, the bench, and Inspect / Guide / Tools tabs.
  - Solid / Theme / Custom opacity, using Hyprland `hl.dsp.window.set_prop` (`opacity`, `opacity_inactive`, `opacity_override`). Measured: no wallpaper bleed-through in Solid.
- **Breadboard and wires:**
  - Full-size breadboard: rails, a–j strips, center channel.
  - Square wire routing in the lanes between holes. Wires dodge each other and part bodies.
  - **Hand-shaped wires:** drag a run (blue bar) or a bend (white square). Auto-route resets the shape. The shape is saved in `wire.path`.
- **Parts:** 28 types in `qml/lib/Catalog.js` with drawings in `PartArt.js`. That includes the OmaDuino board, servo, HC-SR04, 7-segment display, motor driver and robot car.
- **Changing values:** clicking a part opens Inspect, which has dropdowns and sliders. Scrolling on a part changes its main value (resistor E12 values, LED color, capacitance, knob, sensors, supply voltage). Resistors show their value printed on the bench.
- **Learning:**
  - 23 lessons in `Lessons.js`, auto-numbered. Each has "Build it for me" and a live check.
  - Tools tab (`Learn.js`): Ohm's law, LED resistor, color code, divider, series/parallel, RC timing and a glossary.
  - Inspect shows "How it's connected": every connection point with its legs and voltage.
- **Programming:**
  - OmaDuino interpreter in `Mcu.js`: Arduino C subset, no eval, step budget. Covers setup/loop, functions, arrays, for/while/switch, Servo, Serial, analogRead/Write, tone, pulseIn and millis.
  - 11 examples. Code editor overlay with line numbers, Upload, friendly errors and a Serial Monitor (`CodeEditor.qml`).
- **Robot arena:** `Arena.js` and `RobotArena.qml` with physics, walls, sonar raycast and 4 room layouts. While running it sends `{cmd:"setProp", id, key:"distance"}` to the worker.
- **Saving and launching:**
  - Autosave to `~/.local/share/omacircuitlab.json`.
  - "My circuits" saves named projects to `~/.local/share/omacircuitlab-projects.json`.
  - Undo/redo.
  - On first open the app writes its own app-menu entry to `~/.local/share/applications/omacircuitlab.desktop`.
- **Light on the PC:** nothing loads while the window is closed. Time-stepping only runs for circuits that need it, and only while the window is shown and running. The wire canvas is the size of the view.

## Grok's engine (written before Grok finished; see "Grok's result" below for the final status)

- `qml/lib/Engine.js` exists (40 KB, MNA + Newton). Claude ran it in Node: **14 of the 16 basic lessons pass their checks**. The other two (lesson 3, temperature alarm) need user action. LED current and brightness, the meter, NPN, MOSFET, zener, RC and motor are all right.
- **Still missing:**
  - `qml/lib/EngineWorker.js`. Without it, **Run does nothing in the app**, so Dank hasn't seen an LED light yet. This is the top priority.
  - `tests/engine.test.js` and `docs/GROK-REPORT.md`.
  - The board and robotics coupling in `docs/ENGINE_CONTRACT_MCU.md`: OmaDuino pins driving and reading the circuit, servo, hcsr04 pulseIn, sevenSeg, motorDriver, robotCar, and the `setProp` worker command. Lessons 17–23 depend on it.
- Grok ended the night at 182K context, still working. Next session: if it's idle, ask for its handoff, `/new`, and point the fresh session at its handoff plus this file.

## Found at the end of the night: the worker can't load the engine

Grok's `EngineWorker.js` exists, but in the shell it fails with `ReferenceError: Engine is not defined`.

- **Cause (tested in a standalone `qml` app):** WorkerScript ignores `.import "X.js" as X`. ES modules work: a `.mjs` worker with `import * as A from "./A.mjs"` (and nested imports) ran fine.
- **Fix:** add `scripts/build-worker.py`, which writes `qml/lib/worker/Catalog.mjs`, `Engine.mjs` and `Mcu.mjs` from the `.pragma library` files:
  - Strip `.pragma`.
  - Turn `.import "X.js" as X` into `import * as X from "./X.mjs"`.
  - `export` every top-level function and var.
- Then make the worker `qml/lib/worker/EngineWorker.mjs` (`import * as Engine from "./Engine.mjs"`) and point `Overlay.qml`'s `WorkerScript.source` at it.
- Commit the generated files (marketplace installs run no build step) and have `dev-install.sh` regenerate them.
- Keep the `.js` versions as the source of truth: the QML UI and the Node tests use them.
- Grok's `tests/engine.test.js` (19 KB) was failing one assertion while Grok was still mid-task. Check `docs/GROK-REPORT.md` for its status.

## Grok's result (finished 00:08)

- `docs/GROK-REPORT.md` says `node tests/engine.test.js` passes; Claude confirmed. Every lesson build solves and converges.
- The board parts (`omaduino`, `servo`, `hcsr04`, `sevenSeg`, `motorDriver`, `robotCar`) are left open with an info warning: that's the next engine task (`ENGINE_CONTRACT_MCU.md`).
- UI notes from Grok for Claude:
  - `resetSim` in Overlay sets `engineBusy = false` and sends `load` right away, so a step reply already in flight can flash the old result. Make reset wait for the next reply.
  - PNP and supply currents can be negative. Use `Math.abs` wherever the UI shows current; the Inspector already does.
  - Capacitors jump to their DC value on a fresh load. For a visible charge animation, step from the last capacitor voltage when a switch closes.
- Grok's own handoff: `docs/HANDOFF-GROK-TOMORROW.md`.

## Next steps, in order

1. **Make Run work in the shell:** the `.mjs` worker build described above. Grok's handoff (`docs/HANDOFF-GROK-TOMORROW.md`, "Tomorrow's first job") has the exact steps:
   - Generate only Catalog, Engine and EngineWorker; leave `Mcu` out until the board task.
   - If `.mjs` fails inside Quickshell, fall back to one generated classic script.
   - Claude changes the one `WorkerScript.source` line in Overlay.qml and makes `resetSim` wait for the next reply.
2. **Claude:** install, restart the shell, open lesson 1 with `"run": true`, screenshot. Confirm the LEDs glow, the warnings show, and a burnt LED smokes (try a 10 Ω resistor). Have Dank try it.
3. **Grok:** the board coupling from `ENGINE_CONTRACT_MCU.md`, one part at a time in the order in Grok's handoff (sevenSeg → omaduino pins → step order → hcsr04 → servo → motorDriver/robotCar/setProp). **Claude:** test lessons 17–23 in the app, including the robot arena.
4. **Claude:** schematic symbols in Inspect. Dank stopped this mid-write; confirm he still wants it before doing it.
5. Measure CPU in the shell while running (blink and robot lessons) and tune `Mcu.STEP_BUDGET` and the step timer if needed.
6. Marketplace prep: `omarchy-plugin-review` skill, GitHub repo `Dankestrick/OmaCircuitLab`, `preview.png`, README screenshots.

## Known gaps and ideas

- Current-flow animation (dots moving along wires) isn't done. Wires are ideal, so the engine would need branch currents per wire.
- Mouse interactions are untested by Claude: place, drag, wire, bend drag, button hold, scroll. Ask Dank what feels off.
- The slider in Inspect pushes undo steps through a 400 ms timer; check that it feels right.
- "OmaCircuit" is taken on the marketplace (labrat-0's puzzle game), so the name stays OmaCircuitLab.
