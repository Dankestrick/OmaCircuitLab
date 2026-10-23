# Engine contract v2

Done. Not pushed. The shell was not restarted. `Engine.js` stayed ES5. `Catalog.js`, `PartArt.js`, `Mcu.js`, `Lessons.js`, and QML were not edited. Every `tests/*.test.js` passed before each commit below. `python scripts/build-worker.py` regenerated `qml/lib/worker/Engine.mjs` whenever `Engine.js` changed. `EngineWorker.js` did not need a logic change. New state sits on the engine state, and `reset` calls `createState()`.

| step | commit | what |
| --- | --- | --- |
| 1 | `e17e699` | `state.t`. `acSource` is 50 Ω, sine, square, or triangle, 1–5000 Hz. `acAdapter` is 1 Ω and the peak is `vrms·√2`. Bench ground wins. Otherwise a DC supply's minus wins, then the generator's − or the adapter's ~2. |
| 2 | `c271279` | Scope, 10 MΩ from each channel to the GND clip. A 5 V 60 Hz sine into 1 kΩ reads vpp 9.524, freq 60.00, rms 3.353. Frequency is interpolated rising crossings. |
| 3 | `7353db5` | Bridge plus 1000 µF on a 12 V adapter: 14.24 V, ripple 0.101 V. Schottky about 0.25 V at 10 mA. Fuse blows at 3× immediately, holds for 40 ms, blows at 60 ms. The blow text is exactly `The fuse blew: too much current. Fix the short, then press Reset.` Tilt switch, IR LED, photodiode. |
| 4 | `3fb93ae` | Inductor current 0.0804 A at 1 ms and 0.4471 A at 8 ms (continuous 0.4628 A). Transformer, 10 V in, ratio 10, 1 kΩ on the secondary: 0.999 V. |
| 5 | `42948b7` | Relay coil 8.78 V, LED 0.0143 A, contact on. Pull-in 3.5 V, drop-out 1.5 V. Flyback −25.1 V at dt = 5e-5, with the exact spike warning. |
| 6 | `b8f5360` | 7805 from 9 V is 5.000 V. Battery current is Iout + 5 mA (0.010 A on 1 kΩ). 6 V in is 3.999 V, dropout, and warns that it needs at least 7 V. A 2 Ω load passes 2.381 A and warns that it will get hot. |
| 7 | `e598973` | Op-amp follower. + input at 2 V gives 2.000 V, not saturated. At 8 V the output sits at 7.500 V, saturated. Grounded + input sits at 0.050 V, saturated. |
| 8 | `18a869b` | 555 astable, 1 kΩ, 10 kΩ, 10 µF, measured 6.803 Hz. RESET under 0.7 V forces the output low. One flip per solve, so the lesson's DC solve does not chatter. |
| 9 | `8797dd3` | OmaNano blinks D13 for 500 ms on and 500 ms off. Its 5 V pin into 100 Ω is 4.990 V and its 3.3 V pin is 3.267 V, same as the OmaDuino. OmaTiny blinks PB0 from a 5 V supply, same timing. A forced HIGH sources 13.1 mA out of PB0 and that current enters VCC. At 9 V it stays off, the LED stays dark, and the warning is `This OmaTiny needs between 2.7 V and 5.5 V on VCC. Above 6 V it stays off.` Two boards at once keep two different VMs. Sketch pin numbers come from `Catalog.mcuPinNumber(index, type)`. |

`docs/BUGS.md` is still open and was not part of this contract. A servo signal, `tone()`, the motor driver, and the robot car still only see a board pin that sits on the same node. A closed switch or a resistor in that wire does not pass the signal.

## Earlier report

Built `qml/lib/Engine.js`, `qml/lib/EngineWorker.js`, and `tests/engine.test.js`. There is no `ENGINE_API.md` in the repo, so the solver follows `docs/ENGINE_CONTRACT.md` and the part table in `docs/HANDOFF-GROK.md`.

`node tests/engine.test.js`, `node tests/bench.test.js`, and `node tests/lessons.test.js` all pass. Nothing outside `qml/lib/Engine.js`, `qml/lib/EngineWorker.js`, `tests/engine.test.js`, and `docs/` was edited.

## What the solver is

Modified nodal analysis, dense Gaussian elimination with partial pivoting, Newton-Raphson (100 iterations) with SPICE `pnjlim` on diodes, LEDs, zeners, and BJT junctions, and a 1e-9 S gmin from every non-reference node to the reference. A settled hard clamp does not keep the iteration alive: an off NPN with Vbc near −8 V used to sit at `converged: false` forever because the base-collector junction is clamped at −5 V. Capacitors use a backward-Euler companion when `dt > 0` and are open at DC. The solver never throws. If it cannot converge it returns `ok: true` with the last finite voltages, `converged: false`, and a warning. A real failure (singular solve, non-finite voltages, an exception) returns `ok: false`.

The worker keeps one netlist and one state. `load` does a DC solve, or one 1 ms step when a capacitor still holds more than 50 mV, so an edit does not wipe charge or a burnt part. `step` runs the requested steps, stops after about 25 ms, and replies once. `reset` clears state and does not reply. A request for a million steps returned after 3422 steps in 26 ms.

## Checked numbers

- 9 V, 470 Ω, red LED: 15.3 mA, brightness 0.76, Vf 1.79 V.
- Same LED with 10 Ω: 0.61 A and burnt. The next solve with that state is open.
- Divider meter: 4.50 V (the 1.5 Ω battery sags a little).
- NPN switch: about 1 µA unpressed, 19 mA and saturated when pressed.
- 100 µF / 1 kΩ: first 10 ms step 0.82 V, 8.92 V after 0.5 s, then 0.52 V after a 0.3 s discharge with the battery removed.
- Battery short: danger warning, 5.8 A (the 1.5 Ω inside the battery).
- Bench supply 5 V / 0.1 A into 1 Ω: limited, 0.10 V. Into 10 kΩ: 5.00 V, not limited.
- Unpowered ohm meter on 470 Ω: 470 Ω. Powered: reading `Power on!` plus a warn.
- TMP36 at 25 °C: 0.750 V. Zener 5.1 V from 9 V through 1 kΩ: 5.16 V.
- NMOS into 100 Ω from 5 V: 49 mA, state `saturated` (triode, the switch-on name). Gate at the source: off.
- PNP: collector current −19 mA when on. Lessons already use `Math.abs`. The UI should too.
- Motor across 9 V: spin 1. Buzzer across 9 V: on.

Every `Lessons.lessons` build solves and converges, including the newer MCU lessons (22 lessons, not 10). At the built circuit, with nothing pressed, these checks already pass: led, meter (1.79 V), pot (yellow LED brightness 0.67), ldr (2.16 V), tmp36 (0.750 V), rc (cap at 1.13 V), parallel, switch2, rgb, zener (5.19 V). These correctly wait for a press or a scroll: button, ohm, npn, motor, mosfet, heatalarm. Pressing the button on the built NPN lesson gives 12.7 mA collector current. Pressing it on the motor lesson gives spin 1.

## Contract choices

- `ground === -1` still means "no ground rail", but an unpowered ohm meter is solved anyway, with the black probe as the reference. Otherwise Ω mode could never work. A powered netlist that still says `ground: -1` uses the first supply's minus pin. `ground >= 0` always uses node 0, including an RC discharge that has no battery. That is the case the discharge test uses.
- The ammeter is 0.1 Ω, as in the handoff table. The contract's one line says 0 Ω. A true short would need an extra unknown, and 0.1 Ω is enough for a beginner meter. Bridging a supply in A mode raises a danger warning.
- Ohm mode injects 1 µA. Readings above 20 MΩ are `OL`.
- The motor is a plain 10 Ω resistor. `spin = I / 0.25 A`, clamped to −1..1. No back-EMF in v1. `isTimeDependent` is still true for a motor or a buzzer, matching Overlay's `timeTypes`.
- The bench supply starts every solve in voltage mode, then switches to a current source if the load would exceed `currentLimit`. The limit flag is not kept across solves, because a sticky current source into an open circuit charges the gmin and the node voltage explodes.
- An LED reverse warning fires below −2 V. Companion conductance for a capacitor is capped at 1e7 S. Newton will not move any node more than 2 V in one iteration. The NMOS channel equation is extended 0.2 V below Vds = 0 so a small overshoot does not turn the device off and fling the drain back to the rail. Past that, the channel is off and the body diode carries reverse current. K is 0.1 A/V² and Vth is 2 V, as specified.
- The diode is Is 1e-12, n 1.9. That is about 0.7 V at a tiny current and closer to 1 V at 10 mA. It was not forced to 0.7 V.
- Supply `current` is the current entering pin 0, so a supply that is powering something reports a negative current. Brightness, meters, and the short check use magnitudes. `hot` on a resistor is 0 at 0.25 W and 1 at 0.5 W.

## For the UI side

The banner hides info warnings. Parts the solver still does not model keep the info warning "This part isn't in the simulator yet." The board parts below are modeled now. The older note that said they were left open is out of date.

A DC solve puts capacitors at their DC voltage immediately. Lesson 9's built circuit sits at 1.13 V with the button up, and the lesson check already accepts that. Closing the charge path and pressing Run again DC-solves, so the cap jumps instead of animating the charge. The visible motion is the later discharge while the step timer runs. A charge animation would mean the UI stepping from the previous capacitor voltage when a switch closes, instead of asking for a fresh DC solution.

`resetSim` in `qml/Overlay.qml` sets `engineBusy = false` and sends `load` without waiting. `reset` itself does not reply. A step reply already in flight can land in that window, and the step timer can queue another step because `engineBusy` is false. The worker is single-threaded, so the messages still run in order, but Reset can flash the pre-reset result. Worth a wait-for-reply if it shows up in live testing. I did not edit Overlay.

First Run on a circuit that is only resistors, LEDs, and a capacitor will not fade in. The fade is the discharge after the button opens, or any later `step`.

## Worker modules (2026-10-22)

Quickshell's WorkerScript ignores `.import` in a plain script, which is why the shell logged `Engine is not defined`. An `.mjs` file is an ES module and can import. `scripts/build-worker.py` writes `qml/lib/worker/Catalog.mjs`, `Mcu.mjs`, `Engine.mjs`, and `EngineWorker.mjs` from the `.js` sources: the `.pragma library` line is dropped, `.import "X.js" as X` becomes `import * as X from "./X.mjs"`, and each top-level `function` and `var` is exported. `scripts/dev-install.sh` regenerates them before it copies. The `.js` files stay the source of truth.

`Overlay.qml` now sets `WorkerScript.source` to `lib/worker/EngineWorker.mjs`. That is the only QML line this pass changed. `resetSim` already drops an in-flight reply (`staleReplies`); that edit was in the working tree already. The shell was not restarted.

Checked: `node tests/engine.test.js` (including a strict-mode solve of every lesson build through `Engine.mjs`), `node tests/bench.test.js`, and `node tests/lessons.test.js`. A standalone `qml6` WorkerScript, not the Omarchy shell, loaded the generated worker. A 9 V / 470 Ω red LED came back at 15.3 mA, brightness 0.76, not burnt. The same worker then solved 10 Ω at 0.611 A and burnt. Qt printed `QObject::connect(QJSEngine, QtObject): invalid nullptr parameter` once while the worker started. The solve still returned. Lesson 1 has since been seen lit in the shell. The board work is the next section.

## Board coupling (2026-10-22)

Done, in the handoff order. Not pushed. QML was not edited. The shell was not restarted.

1. `sevenSeg` (`2c80acb`). Eight red LEDs, common cathode last. 9 V through 470 Ω into a and b: brightness 0.76. A segment on 9 V with no resistor burns and stays open.
2. OmaDuino rails, GPIO, cached VM (`826d604`). 5 V pin into 100 Ω is 4.990 V. 3.3 V into 100 Ω is 3.267 V. A shorted HIGH pin is 200 mA, with the warn and the danger line. The same sketch text keeps the same VM. Empty code clears it. Bad code sets `error` and `errorLine`. `Mcu.js` is in `scripts/build-worker.py`.
3. Step order (`8085c7d`). Each `dt > 0` solve stamps the current pins, solves, then `vm.run`. New levels show up on the next step. Blink is on for 500 ms and off for 500 ms (`0x1 1x500 0x500 1x499`). Button lesson: released brightness 0, pressed 0.597. Knob at turn 0.5 prints `A0 = 511  (2.50 V)`. 1000 blink steps took 56 ms.
4. `hcsr04` / `pulseIn` (`41bf4ae`). About 15 mA. Echo sits at 0 V. A powered sensor whose TRIG is a board pin returns `distance * 58` µs. Distance example at 30 cm prints `30 cm`. The sonar lesson prints `40 cm`. `pinging` is true on that frame. Unpowered: "The distance sensor needs 5V and GND."
5. Servo, in `6afae6f` with the driver. About 50 mA when powered. Angle starts at 90, the sweep writes 0, then 2. It keeps the last angle when the signal wire leaves. Unpowered: "The servo needs 5V and GND." The 100 Ω load turns on through the same Newton `changed` flag as the TMP36.
6. `motorDriver` (`6afae6f`). OUTn is VM or 0 V through 1 Ω, scaled by `pwm/255` when the driving pin has PWM. Full forward `motorA` is 0.833 with a 10 Ω motor and a 6 V pack. PWM 128 gives 0.418. No VM while an input is HIGH: "Motor driver has no motor power (VM)" and `motorA` 0.
7. `robotCar` and `setProp` (`0489b3f`). Two 10 Ω motors and the same sonar. Lesson car at 100 cm: both spins 1 by step 7, serial `100`. Distance set to 10 cm: both spins −1, serial `10`. `setProp` writes the prop, does not solve, and does not reply. After it, the distance example prints `12 cm`.

`node tests/engine.test.js`, `lessons.test.js`, `bench.test.js`, `mcu.test.js`, and `clamp.test.js` pass. A headless `qml6` WorkerScript loaded the worker with `Mcu.mjs` in it and solved the 470 Ω LED at 15.3 mA, brightness 0.76. Same one-time `QObject::connect` warning as before. That was not the Omarchy shell.

## Buzzer and leg currents (2026-10-22)

Done. Not pushed. QML was not edited. The shell was not restarted. Claude's Overlay, PartView, PartArt, and SoundPlayer edits were left unstaged.

1. Backwards buzzer (`a5a7505`). When V(−) − V(+) is over 2.5 V, `reversed` is true, `on` stays false, and the warn is "This buzzer is in backwards: its + leg (marked +) needs the higher voltage. Turn it around (R)." A 9 V battery backwards still pushes about 45 mA.
2. Pitch (`02e50a3`). Every buzzer result has `freq`. A tone on the + pin uses that hertz, including `tone()` at pwm 127, which averages under 2.5 V so `on` stays false. Otherwise an on buzzer is 2300 Hz and an off one is 0. A tone on the minus pin does not count.
3. `pinCurrents` (`03f1a7c`). Amps into each pin, summing to about 0, on the pot, slide switch, NPN, PNP, NMOS, TMP36, RGB LED, 7-segment, OmaDuino, servo, HC-SR04, motor driver, and robot car. The OmaDuino closes the sum on the first GND pin. A pull-up's current leaves the GPIO pin, not the 5V pin. `node tests/engine.test.js` and `node tests/clamp.test.js` pass.
4. Sound files (`e7df517`). `scripts/make-tones.py` writes `qml/sounds/tone-<hz>.wav` and `qml/sounds/tones.json`. 50 files, 16-bit mono, 22050 Hz, about 0.25 s, quiet. C3 (131) through C7 (2093) plus 2300. Each buffer is a whole number of cycles. The folder is 554 KB.

The player in Overlay currently sounds a buzzer only when `on` is true. `tone()` sets `freq` and leaves `on` false, so a sketch tone will stay silent until the player also accepts `freq > 0`.

## Left

- Claude: the buzzer drawing, the BZZZ tag, the speaker toggle, and the player. Play when `freq > 0`. Lessons 18–24 and the robot arena are still untested in the app. I did not restart the shell.
- Motor current does not come out of the driver's VM pin. Each output is a source to driver GND, so the battery on VM does not sag. The output voltages and `motorA` / `motorB` are the ones the tests check.
- Pin writes, servo angle, and PWM show up one step after the sketch sets them. The echo pin stays at 0 V. The travel time is only what `pulseIn` returns.
- The 25 ms worker cap is unchanged. 1000 blink steps are 56 ms in Node, so a 33-step frame should fit. If the shell blinks in slow motion, the warm step is the thing to cheapen.
- Not pushed.

## Worker crash (2026-10-22)

The shell was not restarted by me. QML was not edited. Sound was off, and the tone files are not on this path.

Two Quickshell cores today, both the worker thread (`QQuickWorkerScr`), command `quickshell -n -p /usr/share/omarchy/shell`:

- 937302 at 21:49:40 EDT. SIGSEGV. `si_code` is SI_TKILL because Quickshell's handler calls `raise`. Under that: `MarkStack::drain` ← `GCStateMachine::transition` ← `MemoryManager::allocData` ← `ArrayData::realloc` ← `SimpleArrayData::putArray` ← `CallPropertyLookup` ← `libQt6QmlWorkerScript`.
- 965280 at 21:52:00 EDT. Same signal and the same re-raise. The trace stops at the handler, so the original fault is not in that dump.

Headless repro, before `e033253`, while `Mcu.mjs` was still the generator interpreter. `QT_QPA_PLATFORM=offscreen qml6`, a window-less `Item` with `WorkerScript` on `qml/lib/worker/EngineWorker.mjs`, lesson 24's build, `{ cmd: "step", dt: 0.001, steps: 33 }` every 33 ms, and `setProp` when the car's rounded distance changes. It died both times, in about a second, on the worker thread, `SEGV_MAPERR` at address 0:

- 978496 at 21:52:43
- 980742 at 21:52:55

The stack is `IteratorNextForYieldStar::call` four deep, then a null call, then `CallPropertyLookup`, then the WorkerScript message handler. A tiny `yield*` worker in the same harness exits 0. The crash was Mcu's nested generators.

`e033253` already compiles each function to a flat list of steps and runs that on an explicit stack. `delay()` stops between steps. No `function*` is left in `qml/lib`. The installed plugin `Mcu.mjs` matches the repo. I did not write that commit. The Quickshell process running now started at 22:00:51, the same second those files were written, and it has not dumped core since.

Soaks of that interpreter, same harness. None crashed. About 30 ticks a second, so the 33 ms timer was keeping up.

| Worker | Lesson | Time | Result |
| --- | --- | --- | --- |
| `EngineWorker.mjs` | robot (24) | 240 s | exit 0, 7273 ticks, `ok` true |
| `EngineWorker.mjs` | blink (18) | 180 s | exit 0, 5455 ticks |
| `EngineWorker.mjs` | clamp (12) | 180 s | exit 0, 5455 ticks |
| `EngineWorkerClassic.js` | robot | 240 s | exit 0, 7273 ticks |
| `EngineWorkerClassic.js` | blink | 180 s | exit 0, 5455 ticks |
| `EngineWorkerClassic.js` | clamp | 180 s | exit 0, 5455 ticks |

A 20 s classic robot run on its own (606 ticks) and a 40 s module robot and blink also exited 0.

Leave `WorkerScript.source` on `lib/worker/EngineWorker.mjs`. The module holds, and the classic script holds too. The crash was the generators, and those are already gone.

`scripts/build-worker.py` also writes `qml/lib/worker/EngineWorkerClassic.js`: Catalog, Mcu, and Engine each wrapped in a closure, no imports. Those two files are in the working tree, not committed.

On the long robot runs the serial settles (25 cm on the classic run, 82 cm on the module run) and then keeps printing that number. The worker still returns `ok: true` every tick. Once the rounded distance stops changing, `setProp` stops. The sketch's backup test is `cm < 25`.

Nothing in the step loop needed a new cap. `vm.serial` still trims at 4000 characters down to the last 3000. Call frames are popped on return. `nodeVolts` is replaced each solve. `STEP_BUDGET` is still 400. The worker still gives up a batch after about 25 ms (Node did 3406 steps in 26 ms). Over the 4 minute module robot run, RSS stayed between 128 MB and 141 MB. Blink moved between 134 MB and 154 MB and came back down. That is the collector.

`node tests/mcu.test.js`, `node tests/engine.test.js`, and `node tests/clamp.test.js` pass. The one-time `QObject::connect(QJSEngine, QtObject): invalid nullptr parameter` line is still there. It does not take the worker down.

`e033253` has a `Co-Authored-By` trailer. Commits stay under your name only.
