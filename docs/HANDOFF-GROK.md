# Handoff for Grok: OmaCircuitLab engine (read this first)

You are gd-grok in the GitDank Herdr workspace, working with Claude (gd-claude). Your previous session filled its context window before writing any files, so this note gets you back on track. You do not need to re-read the whole project.

## What OmaCircuitLab is

A breadboard circuit simulator and learning tool for Omarchy, written as an omarchy-shell (Quickshell/QML) plugin at `/home/dank/GitDank/OmaCircuitLab`. Plugin id `io.github.dankestrick.omacircuitlab`, kind `overlay`, opened from the app menu. Dank wants it light on the PC, easy to see on dark see-through themes, and a real teaching tool from LEDs up to small robots.

## Status

Claude has built and tested the UI side, and it runs in the shell:

- `qml/Overlay.qml` is the window: toolbar, parts picker, bench, inspector, guide, autosave, undo, and Solid/Theme/Custom opacity via Hyprland set_prop.
- `qml/BenchView.qml` and `qml/PartView.qml` draw the breadboard, parts and wires and handle the mouse.
- `qml/Inspector.qml` and `qml/GuidePanel.qml` are the right-hand panels.
- `qml/lib/Catalog.js` holds every part type, its pins (in order), props and tips.
- `qml/lib/Bench.js` holds the breadboard geometry and `buildNetlist(bench)`.
- `qml/lib/Router.js` routes square wires.
- `qml/lib/Lessons.js` has 10 lessons; `lesson.build()` returns a full bench, and `lesson.check(ctx)` reads engine results.
- Tests: `node tests/bench.test.js` and `node tests/lessons.test.js` both pass. `tests/load.js` loads `.pragma library` files in Node.

**Missing (your job):** `qml/lib/Engine.js`, `qml/lib/EngineWorker.js` and `tests/engine.test.js`. Until they exist the app shows circuits but Run does nothing.

## Your task

Build the engine exactly to `docs/ENGINE_CONTRACT.md`. Read that file and `qml/lib/Catalog.js`; skim `Lessons.js` for the result fields its checks read. Keep it small and fast.

1. `qml/lib/Engine.js`
   - Start it with `.pragma library` (optionally `.import "Catalog.js" as Catalog`). Use plain JS with no Qt APIs, so it runs in Node through `tests/load.js` and inside a WorkerScript.
   - Use Modified Nodal Analysis with dense Gaussian elimination and partial pivoting. Node 0 is ground; `netlist.ground === -1` means there is no power source, so return `ok: true` with zero volts and an info warning.
   - Nonlinear parts use Newton-Raphson with voltage-step limiting, plus gmin (about 1e-9 S from every node to ground) so floating nodes stay solvable. Cap iterations (for example 100); if it doesn't converge, return the last good result with `converged: false` and a warning.
   - `dt > 0` is one backward-Euler transient step for capacitors. Motors are a resistor plus a back-EMF that follows a spin state; a plain resistor is acceptable for v1.
   - The functions must never throw: wrap everything and return `{ ok: false, warnings: [...] }` on error.
   - Export `createState()`, `solve(netlist, state, dt)` and `isTimeDependent(netlist)`.
2. `qml/lib/EngineWorker.js`
   - Use the WorkerScript handler `WorkerScript.onMessage = function (msg) { ... }` and `.import "Engine.js" as Engine`.
   - `{cmd:"load", netlist}` stores the netlist, keeps per-id state (capacitor charge, burnt parts), runs a DC solve (or a single `dt` step if the circuit holds charged capacitors), and replies `WorkerScript.sendMessage({ kind: "result", result })`.
   - `{cmd:"step", dt, steps}` runs `steps` transient steps and replies once with the last result. Stop early if the steps take more than about 25 ms.
   - `{cmd:"reset"}` clears state and does not reply.
   - The worker has no timers. The UI sends one request at a time and waits for the reply before sending the next.
3. `tests/engine.test.js` (runs with `node tests/engine.test.js`)
   - A 9 V battery with 470 Ω and a red LED gives about 15 mA and the LED lit.
   - The same circuit with 10 Ω burns the LED out.
   - A voltage divider reads correctly on the multimeter in V mode.
   - The NPN switch passes collector current only when the button is pressed.
   - The RC circuit charges and discharges over steps.
   - A supply short gives a danger warning.
   - All 10 `Lessons.lessons[i].build()` circuits solve without throwing. Build their netlists with `Bench.buildNetlist`.

## Part models (pin order is the Catalog `pins` order)

| Part | Model |
|---|---|
| battery9v | 9 V source with 1.5 Ω internal resistance |
| aaPack | `cells` × 1.5 V, 0.3 Ω per cell |
| benchSupply | `volts` with 0.05 Ω; when the current would exceed `currentLimit`, switch to a current source and set `limited` |
| resistor | `ohms`; `hot` when power is over 0.25 W |
| led | Shockley diode; color Vf from `Catalog.ledColors[color].vf` at 20 mA (n·Vt about 0.05 V works); brightness = I / 20 mA clamped to 0..1; burnt over 40 mA, then open until reset |
| rgbLed | three LEDs (R: red Vf, G: green, B: blue) sharing the cathode on pin 1 |
| capacitor / electrolytic | `farads`; open at DC (gmin); companion model when `dt > 0`; electrolytic burnt if reversed by more than 1 V or above `ratedVolts` |
| pushButton | 0.05 Ω when `pressed`, else 1e9 Ω |
| slideSwitch | common (pin 1) to A (pin 0) at `position` 0, to B (pin 2) at 1 |
| potentiometer | end1 to wiper is `ohms·turn` (minimum 1 Ω), wiper to end2 is the rest |
| ldr | R = 1e6 · (1e3/1e6)^light |
| thermistor | 10k NTC, B = 3950 |
| tmp36 | Vout = 0.5 + 0.01·°C when +V − GND is above 2.7 V, out through about 100 Ω; draws about 50 µA |
| diode | Is 1e-12, n 1.9 (about 0.7 V) |
| zener | diode forward; reverse breakdown at `zenerVolts` |
| npn / pnp | Ebers-Moll with beta 150; report `collectorCurrent` and `state` |
| nmos | square law, Vth 2 V, K 0.1 A/V²; report drain current as `collectorCurrent` |
| buzzer | about 200 Ω; `on` above 2.5 V |
| motor | about 10 Ω; `spin` = I / 0.25 A clamped to −1..1 |
| multimeter | V: open, `value` = V(red) − V(black); A: 0.1 Ω, `value` = current; Ω: test current, `reading` "Power on!" plus a warning if the circuit is powered |

Every part also reports `current` (through pin 0), `power` and `pinVolts`. Warnings use friendly beginner language and include `part` (id) and `level` ("info", "warn" or "danger").

## How to work with Claude

- Only touch `qml/lib/Engine.js`, `qml/lib/EngineWorker.js`, `tests/engine.test.js` and `docs/`. Claude owns the QML and the other lib files. If you need something changed there, write it in your report.
- When the engine tests pass, write a short report to `docs/GROK-REPORT.md`: what you built, test results, anything in the contract you changed, and any problems you noticed in the plan or UI. Then stop. Claude will wire it into the app and test it live.
- Don't run `omarchy restart shell` yourself. Claude tests in the live shell.
