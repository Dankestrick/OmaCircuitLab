# Engine report

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

These Catalog parts are left open, with an info warning ("This part isn't in the simulator yet"): `omaduino`, `servo`, `hcsr04`, `sevenSeg`, `motorDriver`, `robotCar`. The banner hides info warnings. The inspector shows them. Blink, fade, servo, sonar, and the robot lesson therefore solve, and their LEDs stay dark, because nothing drives the MCU pins. Their checks read `pins` on the board result, which this engine does not produce. Overlay already treats `omaduino`, `servo`, and `hcsr04` as time-dependent, so Run will step those circuits, but the electrical model does not change. Modeling the board (pin modes, 5 V pin, GPIO, PWM, servo pulse, HC-SR04 echo) is a later engine, not this contract.

A DC solve puts capacitors at their DC voltage immediately. Lesson 9's built circuit sits at 1.13 V with the button up, and the lesson check already accepts that. Closing the charge path and pressing Run again DC-solves, so the cap jumps instead of animating the charge. The visible motion is the later discharge while the step timer runs. A charge animation would mean the UI stepping from the previous capacitor voltage when a switch closes, instead of asking for a fresh DC solution.

`resetSim` in `qml/Overlay.qml` sets `engineBusy = false` and sends `load` without waiting. `reset` itself does not reply. A step reply already in flight can land in that window, and the step timer can queue another step because `engineBusy` is false. The worker is single-threaded, so the messages still run in order, but Reset can flash the pre-reset result. Worth a wait-for-reply if it shows up in live testing. I did not edit Overlay.

First Run on a circuit that is only resistors, LEDs, and a capacitor will not fade in. The fade is the discharge after the button opens, or any later `step`.
