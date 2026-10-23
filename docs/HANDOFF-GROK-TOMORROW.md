# Handoff for the next Grok session (engine)

**2026-10-22:** The worker module build is done. Do not rebuild the solver and do not start the MCU parts until Claude has seen lesson 1 light in the shell.

`scripts/build-worker.py` writes `qml/lib/worker/Catalog.mjs`, `Engine.mjs`, and `EngineWorker.mjs`. `scripts/dev-install.sh` regenerates them. `Overlay.qml` points `WorkerScript.source` at `lib/worker/EngineWorker.mjs`. A standalone `qml6` WorkerScript lit a 470 Ω red LED (15.3 mA, brightness 0.76) and burnt a 10 Ω one. That was not the Omarchy shell. The shell restart and the screenshot are still Claude's.

Read this, then `docs/HANDOFF-TOMORROW.md`, `docs/GROK-REPORT.md`, and `docs/ENGINE_CONTRACT_MCU.md`. Do not re-derive the solver. The electrical engine is done and the Node tests pass.

Dank and Claude are stopped for the night. No code was changed after `docs/GROK-REPORT.md`.

## Where things actually are

These exist and are green:

- `qml/lib/Engine.js` — MNA solver.
- `qml/lib/EngineWorker.js` — load / step / reset. Node smoke test passes.
- `tests/engine.test.js` — `node tests/engine.test.js` passes. So do `tests/bench.test.js` and `tests/lessons.test.js`.
- `docs/GROK-REPORT.md` — numbers, contract choices, UI notes.

`node tests/engine.test.js` from `~/GitDank` fails with `MODULE_NOT_FOUND`. Run it from `~/GitDank/OmaCircuitLab`.

The shell does not light an LED yet. Quickshell's log is `ReferenceError: Engine is not defined` from `EngineWorker.js`. The worker file is loaded. `.import "Engine.js" as Engine` is ignored inside `WorkerScript`, so the name `Engine` never appears. Node tests hide this: `tests/engine.test.js` strips the import and injects `Engine` into the vm.

Claude's "still missing worker / tests / report" section and next-step 1 are stale. The later "Grok's result" section is the right status. Do not rebuild the solver and do not hunt the old failing assertion. That was the off-NPN convergence bug, and it is fixed.

## Tomorrow's first job: make Run work in the shell

Goal: lesson 1 lights after Claude installs and restarts the shell. No MCU work in that change.

Claude tested this in a standalone `qml` app, not in Quickshell: `WorkerScript` ignores `.import`, and a `.mjs` worker with `import * as A from "./A.mjs"` (nested imports included) runs. I agree with that fix. I would not spend time trying to make `.import` work.

### Do it this way

Keep `qml/lib/*.js` as the source of truth. `tests/load.js` and the QML UI import those. Add `scripts/build-worker.py` that writes:

- `qml/lib/worker/Catalog.mjs` from `Catalog.js`
- `qml/lib/worker/Engine.mjs` from `Engine.js`
- `qml/lib/worker/EngineWorker.mjs` from `EngineWorker.js`

Transforms:

- Delete the `.pragma library` line.
- Replace a leading `.import "X.js" as X` with `import * as X from "./X.mjs"`.
- Prefix top-level `function` and `var` declarations with `export`. Only lines that start a declaration. `Catalog.js` has `var resistorValues = (function () {` on one line; exporting that `var` is enough. Do not export nested functions.

`Engine.js` imports only `Catalog.js` (for `Catalog.ledColors`). `EngineWorker.js` imports only `Engine.js`. Leave `Mcu.js` out of this build. The lesson 1 worker should not parse the interpreter.

Generated files have to sit in the tree. There is no git repo yet, so "commit them" waits for `git init`. `dev-install.sh` should regenerate them before copying, and a marketplace pack has no build step, so the generated `.mjs` files must already be on disk when that day comes.

`Overlay.qml` line 158 is `source: "lib/EngineWorker.js"`. It has to become `source: "lib/worker/EngineWorker.mjs"`. That is the one QML edit. Ownership so far is that Claude owns QML. Flag it and let Claude change it, unless the task text says to make the shell path match. Do not restyle Overlay. Do not run `omarchy restart shell`.

After generating, check the modules in Node as well as the old vm tests:

```
node tests/engine.test.js
node --check qml/lib/worker/Engine.mjs
node -e 'import("./qml/lib/worker/Engine.mjs").then(m => console.log(typeof m.solve))'
```

ES modules are strict mode. The Node vm tests are sloppy mode. A strict-mode throw will show up only in the `.mjs` import. `Engine.js`, `Catalog.js`, and `Mcu.js` were written as sloppy scripts (`var` / `function`). I did not see a sloppy-only feature, but this is the check that would catch one.

### Where I would bend Claude's plan

- Exporting every top-level name is fine. The worker only needs `createState`, `solve`, and `isTimeDependent` on `Engine`, and `ledColors` on `Catalog`. Exporting the rest is the simple transformer. Do it.
- Do not generate or import `Mcu.mjs` until the board task. Claude's script list includes it. Parsing `Mcu.js` on every lesson 1 Run is wasted work, and the worker does not call it yet.
- `setProp` is not required to light lesson 1. The arena already sends `{cmd:"setProp", id, key:"distance", value}` and does not wait for a reply (`Overlay.qml` around line 102). Today's worker ignores unknown commands and does not reply, so that message is dropped and nothing hangs. Add `setProp` with the robot work. Contract: write `netlist.elements` prop by id, do not clear state, do not solve, do not reply.
- The standalone `qml` test is not Quickshell. If the shell still fails to load the module, stop extending the ESM build. Fall back to one generated classic script, `qml/lib/worker/EngineWorker.js`, with no import: wrap Catalog and Engine in closures, assign `var Catalog` and `var Engine`, then the same `WorkerScript.onMessage`. WorkerScript already runs a plain script. That fallback is uglier and more reliable. Keep the `.js` originals either way.
- `Qt.include` is a five-minute experiment only if `.mjs` fails in the shell. Do not start there. Claude already showed `.import` is a dead end.

### Worker behavior to preserve

`EngineWorker.js` is the behavior the tests lock in:

- Top-level `netlist` and `state` survive between messages. `state` starts as `Engine.createState()`.
- `load` stores the netlist. If any non-burnt capacitor or electrolytic has `state.capV[id]` with abs above 0.05 V, solve with `dt = 0.001`. Otherwise DC (`dt = 0`). Reply once `{kind:"result", result}`.
- `step` runs `steps` (default 1, cap 1e6) at `dt` (default 0.001). Reply once with the last result. Stop early if `result.ok === false` or `Date.now()` is more than 25 ms in. Do not stop just because `converged` is false.
- `reset` replaces state, sets `netlist = null`, and does not reply.
- Missing netlist on load or step still replies `ok: false`, so the UI cannot stick on `engineBusy`.
- No timer in the worker. The UI timer is in Overlay: 33 ms, `{dt:0.001, steps:33}`, only while running, shown, and time-dependent.

The test loader only strips one `.import` line. Keep the worker at one import.

## Engine internals (do not rediscover these)

Public API, all on the library object: `createState()`, `solve(netlist, state, dt)`, `isTimeDependent(netlist)`. Nothing throws. `solve` wraps the body in try/catch and returns `fail(...)`.

`createState()` is `{ capV, burnt, burnWhy, spin, nodeVolts: null, nodeCount: -1 }`. `solve` mutates it. `dt` missing or negative becomes 0. Supply voltage/current mode is not stored. Every solve starts the bench supply in voltage mode. A sticky current limit into an open circuit was driving nodes to ~1e9 V through gmin.

### Reference node

- `ground >= 0`: node 0 is 0 V. This includes a discharge netlist that has ground 0 and no battery. Do not early-return those.
- `ground < 0` and no power source and no ohm meter: `{ok:true}` zeros plus an info warning. Power means a `battery9v`, `aaPack`, or `benchSupply` is present, not merely `ground === 0`.
- `ground < 0` and an unpowered ohm meter: still solve. The black probe is the reference.
- `ground < 0` and a power source is present: reference is that source's minus pin.

Index map with `ref` removed: `ui = -1` on the reference, `node - 1` when `node > ref`, else `node`. Unknown count is `nodeCount - 1` plus one extra current per ideal voltage source. gmin is 1e-9 S from every non-ref node to ref.

### Newton

Dense GE with partial pivoting. 100 iterations. Stamp uses voltages from the previous iterate.

Convergence is `max|dv| < 1e-5 * (1 + max|v|)` and no junction move and no supply-mode or TMP36 on/off change this iteration. Non-convergence returns `ok: true`, the last finite `nodeVolts`, `converged: false`, and a warning. The UI keeps showing voltages. `ok: false` is only for a singular matrix, non-finite voltages, or a thrown error. The toolbar text "Can't solve this circuit" is that path.

`limitJunction` sets `work.hitLimit` only when the accepted junction voltage moved by more than 1e-4 V from the previous accepted value. Comparing against the raw node voltage is wrong: a reverse junction sits on the clamp forever (NPN Vbc about −8 V, clamp −5 V) and `converged` never becomes true. First visit seeds `prev` to the clamped raw voltage.

Each iteration also refuses a node step bigger than 2 V and sets `hitLimit`. The MOSFET saturation Jacobian has `gds = 0`, so an ungarded step proposed about −80 V on the drain and the body diode then reported tens of amps. Linear circuits still converge. They just take a few extra iterations on the way up from 0. Do not delete this cap.

Warm start copies `state.nodeVolts` only when `dt > 0` and `nodeCount` matches. DC always starts from 0. After a finite solve, store `nodeVolts` and `nodeCount`.

### Stamps

`G * v = z`. `z` is current injected into the node.

- Conductance `g` between a and b: standard stamp. No-op if a === b.
- `stampI(into, outof, amps)`: `z[into] += amps`, `z[outof] -= amps`.
- Voltage source: extra unknown `i` is current leaving the + node into the source. Load current out of the + pin is `-i`. With series R: `(v+ − v−) − R*i = V`.
- Diode: `I = gd*vd + ieq` from anode to cathode, `ieq = id - gd*vd` at the limited `vd`.
- Capacitor, backward Euler, `g = min(C/dt, 1e7)`: conductance plus `z[n0] += g*vprev`, `z[n1] -= g*vprev`, where `vprev` is the stored `v(pin0) - v(pin1)`. After every solve, including DC, store `capV` when the voltage is finite and under 200 V. A fresh DC load therefore jumps a cap to its DC voltage. The step timer is what animates a discharge.
- BJT is full injection Ebers-Moll. `Is = 1e-14`, `Vt = 0.02585`, `BF = beta` (default 150), `BR = 5`. Evaluate at the limited Vbe/Vbc. Stamp `I(Vlimited) + J*(Vnode - Vlimited)`, not `I(Vraw)`. Exp arguments are clamped to ±40. PNP is `I_pnp = −I_npn(Veb, Vcb)` with the NPN derivatives left un-negated and the junction arguments flipped when stamping. Negating both was a bug. NPN `collectorCurrent` is into the collector (positive when on). PNP's is negative when on. Lessons use `Math.abs`. The Inspector already does.
- NMOS: K = 0.1 A/V², Vth = 2 V. Pins S, G, D. Triode maps to result state `"saturated"`, saturation region to `"active"`, cutoff to `"off"`. `collectorCurrent` is drain current. Channel is off for `Vds <= -0.2` or `Vgs < Vth`. Between −0.2 V and 0 V the triode slope at `Vds = 0` is extended, so a small overshoot does not snap the device off. Body diode is anode at the source, cathode at the drain (`Is 1e-12`, `n 1.9`). Do not also run `pnjlim` on Vgs/Vds. Vgs is hard-clamped to −5..20 and Vds to −5..40, and that clamp only counts as limiting while the clamped value is still moving. `fillMos` must use `idDrain`. An earlier typo read a bare `id` and the whole solve returned `ok: false`.

### Part details that are easy to "fix" and shouldn't

- `battery9v`: 9 V, 1.5 Ω. `aaPack`: `cells * 1.5` V and 0.3 Ω per cell. Ignore `props.volts`.
- `benchSupply`: `volts` behind 0.05 Ω, clamped 0..30. Switch to a current source of `currentLimit` only after a voltage-mode iteration exceeds the limit and the terminal voltage is below the set point. Switch back when `Vout` reaches the set point. Report actual `volts`, `current` (negative when sourcing), and `limited`.
- LED: Shockley, `nVt = 0.05`. `Is = 0.02 / (exp(vf/0.05) - 1)` from `Catalog.ledColors`. Do not cap the exp at 40. A blue LED at Vf 3 V needs it, and the vd clamp is `vf + 0.45`. Brightness is `I/0.02` clamped 0..1. Burn above 40 mA on that result (report the killing current, `burnt: true`, brightness 0). Next solve is open until `reset`. Reverse warning when `vd < -2`. RGB shares the cathode on pin 1 (pins red, cathode, green, blue). Burnt RGB reports brightness `{r:0,g:0,b:0}` because the painter ignores `burnt`.
- Diode: `Is 1e-12`, `n 1.9`. About 0.7 V at tiny current and about 1.1 V at 10 mA. Do not force 0.7 V.
- Zener: forward diode minus a reverse Shockley of `(-vd - vz)` with `Is = 1.565e-3`, `nVt = 0.05`.
- Electrolytic burns when reversed by more than 1 V or above `ratedVolts` (default 16), and only when `|V| < 200`. `burnWhy` picks the warning text.
- Button: 0.05 Ω pressed, else 1e9 Ω. Slide switch: common is pin 1, A is pin 0 at position 0, B is pin 2 at position 1. Pot: `ohms * turn` from end 1 to wiper, minimum 1 Ω on each side.
- LDR: `1e6 * (1e3/1e6)^light`. Thermistor: 10 kΩ NTC, B = 3950.
- TMP36: pins +V, out, GND. On above 2.7 V, off below 2.5 V, 50 µA from +V to GND, output `0.5 + 0.01*°C` behind 100 Ω. Cold start is off for the first stamp. The 5 V rail turns it on. Lesson 8 at 25 °C is 0.75 V.
- Meter: V is open. A is 0.1 Ω, not an ideal 0 Ω source. The contract's one-liner says 0 Ω. The handoff table says 0.1 Ω. Keep 0.1 Ω. Ω mode injects 1 µA only when no battery, pack, or bench supply is present. Powered Ω reads exactly `Power on!` and warns. `value` may be NaN then. `OL` above 20 MΩ.
- Motor v1: 10 Ω, no back-EMF. `spin = I/0.25` clamped −1..1. Buzzer: 200 Ω, `on` when V > 2.5. Both still make `isTimeDependent` true. Overlay does not call `isTimeDependent`. It has its own `timeTypes`, which also lists `omaduino`, `servo`, and `hcsr04`.
- Resistor `hot` is 0 at or under 0.25 W, else `min(1, (P-0.25)/0.25)`.
- Unknown types get pin volts, no stamp, and an info warning. The banner hides `level === "info"`. The inspector shows it. Unknown today: `omaduino`, `servo`, `hcsr04`, `sevenSeg`, `motorDriver`, `robotCar`.
- Short detection: the two pins are the same node, or `|I| > 0.2` and `|V/I| < 1` Ω. The battery's own 1.5 Ω does not count as the short. A dead short of the 9 V battery is about 5.8 A and a danger warning.
- `current` on every part is into pin 0. Supplies that are powering a load report a negative current. Callers that display current should use `Math.abs`.

Result arrays are plain arrays, not typed arrays. The worker clones the message.

## MCU contract: what I would do differently

`docs/ENGINE_CONTRACT_MCU.md` is the right electrical model. I would follow it, with this order and these limits.

Do not start it until lesson 1 has been seen running in the shell. Then one chunk at a time, each with tests in `tests/engine.test.js`, still ES5 in the `.js` sources:

1. `sevenSeg`: eight red LEDs, Vf 1.8, common cathode on the last pin, `segments` brightness, same burn rule as an LED. No VM. This is the pattern for "several Shockley devices in one part."
2. `omaduino` pins only, with a cached `Mcu` VM. 5 V pin: 5 V, 0.2 Ω, 0.5 A. 3.3 V pin: 3.3 V, 1 Ω, 0.05 A. Both GND pins are already one node (`Catalog.groundPin`). Output pin: 5 V or 0 V through 25 Ω, or `5 * pwm/255` average. Do not simulate the PWM square wave. Input: 10 MΩ to GND. Pullup: 35 kΩ to the 5 V rail. Warn above 40 mA. Do not reuse the bench supply's current-source mode for a pin. A shorted HIGH pin should still show ~200 mA and the warning, not fold quietly to 40 mA.
3. Step order, once per `dt`: stamp the current `vm.pins`, solve, then `vm.run(stepEndMicros, io)`. `io.volts(pin)` is the solved pin voltage versus board GND. Compile with `Mcu.compile` on load and when `code` changes. Keep the VM on `state` across `load` when the code text is the same. `reset` drops it. Empty code: all pins inputs, no `error`.
4. `hcsr04` and `io.pulseIn`. Do not model sound as a transient. If the sensor is powered (VCC − GND > 4) and TRIG is a board pin, `pulseIn` returns `distance * 58` microseconds. Otherwise 0.
5. Servo: 100 Ω across 5 V when powered, signal pin 1 MΩ to GND, `angle` from the driving pin's `servo` value, held when the wire goes away, start at 90.
6. `motorDriver`, then `robotCar` (two 10 Ω motors plus an on-board HC-SR04), then `setProp` for `distance`. `leftSpin` / `rightSpin` use the same 0.25 A scale as the plain motor, sign included.

`Mcu.js` API to call, not rewrite: `Mcu.compile(src)`, `Mcu.create(program)`, `vm.run(untilMicros, io)`, `vm.reset()`, `vm.pins`, `vm.serial`, `vm.error`, `vm.errorLine`. `STEP_BUDGET` is 400 statements per `run`. A sketch with no `delay` will not finish a wall-clock second inside one solve. Leave the budget alone until Claude measures the shell.

Timing expectation: Overlay asks for 33 ms of sim time every 33 ms of wall time, and the worker gives up after 25 ms. On the tiny LED circuit, thousands of steps fit in that window (the test logged 3422 steps in 26 ms). A 23-node board plus `Mcu.run` may not. Blink would then run in slow motion in the app while the Node test, which does not use the 25 ms cap, still passes. If that happens, make the warm-started step cheaper. Do not raise the 25 ms cap, and do not take the timer out of the UI.

Result fields the lessons already read: `pins`, `serial`, `error`, `errorLine`, servo `angle`, sensor distance text in `serial`. Match the contract's names. Add `mcu` state without renaming `capV` / `burnt`.

## Other disagreements with `HANDOFF-TOMORROW.md`

- Next step 1 (finish the worker, get tests passing, write the report) is done, except the `WorkerScript` module bug above. Tomorrow is that bug, then Claude's shell check, then the MCU chunks.
- "14 of 16 basic lessons pass" can stand. Claude ran the checks after me. My run was the unmodified build: led, meter, pot, ldr, tmp36, rc, parallel, switch2, rgb, and zener already pass; button, ohm, npn, motor, mosfet, and the heat alarm stay unfinished until a press or a scroll. That is the lesson logic, not a solver miss. Pressing the built NPN lesson gives about 12.7 mA. Pressing the motor lesson gives spin 1. Pot brightness at the built `turn` is about 0.67, so it does count as lit.
- Current-flow dots need a current per wire. The solver has branch currents inside parts and does not return wire currents. A later field, not part of making Run work. Wires are ideal shorts inside one node, so two wires on the same node do not have a unique current unless the netlist grows an extra unknown per wire. I would not do that for v1.
- `resetSim` clears `engineBusy` and sends `load` immediately. `reset` does not reply. A step reply already in flight can flash the pre-reset result. Claude's note to wait for the next reply is right. That is an Overlay change, Claude's.

## Leave alone

- Do not edit QML, Catalog, Bench, Lessons, Mcu, or Overlay except the one `WorkerScript.source` line if the task assigns it.
- Do not `omarchy restart shell`, do not push, do not `git init`.
- Do not put a back-EMF on the motor while chasing convergence.
- Do not remove the 2 V Newton cap, the junction-move `hitLimit` rule, or the −0.2 V NMOS extension.
- Node tests may use modern JS. `Engine.js` and `EngineWorker.js` stay ES5.
