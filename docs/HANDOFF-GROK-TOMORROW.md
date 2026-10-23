# Engine handoff for 2026-10-24

Read this with `docs/HANDOFF-TOMORROW.md` and `docs/BUGS.md`. Contract v2 and the open driving-pin bug are done. Not pushed. The shell was not restarted. Repo is `/home/dank/GitDank/OmaCircuitLab`. Run tests from that directory. `~/GitDank` is not the repo.

The long step-by-step note this file used to hold is in git at `e5de97d`. The measured numbers are in `docs/GROK-REPORT.md`. One sentence there is stale: it still says the driving-pin bug is open. That fix is `6b1f97d`, and `docs/BUGS.md` has no open items.

## Done

| commit | what |
| --- | --- |
| `e17e699` | `state.t`, `acSource`, `acAdapter`, ground rules |
| `c271279` | oscilloscope samples, vpp, rms, rising-crossing frequency |
| `7353db5` | bridge, Schottky, fuse, tilt switch, IR LED, photodiode |
| `3fb93ae` | inductor, transformer |
| `42948b7` | relay |
| `b8f5360` | 7805 |
| `e598973` | op-amp |
| `18a869b` | 555 astable |
| `8797dd3` | OmaNano and OmaTiny, two VMs |
| `e5de97d` | v2 report |
| `6b1f97d` | driving pin follows a closed path, four hops |

`EngineWorker.js` did not change. `python scripts/build-worker.py` regenerated `qml/lib/worker/Engine.mjs` for `6b1f97d`. Every `tests/*.test.js` passed, including the strict-mode lesson compare (31 lessons).

Checked on `6b1f97d`: D9 through a pressed button follows the servo sweep (angle 2 after 30 ms) and holds that angle when the button opens. `tone(440)` through 220 Ω reaches the buzzer. 10 kΩ still carries it, 47 kΩ does not. Four resistors reach the pin, a fifth does not. A tilted tilt switch, the selected side of a slide switch, and a closed relay NO contact pass a tone. PWM 128 through a pressed button gives motor A about 0.42, and the output drops once the button has been open for a solve. TRIG through a button reads 30 cm and reads 0 cm once the button opens. Nano D9 and Tiny PB0 use the same search.

## How a driving pin is found

`nearestDrive` in `Engine.js` is the only lookup. `buzzerTone`, `servoDriveAngle`, `pwmOnNode`, and `trigOnBoard` all call it. The robot car has no separate pin search: its motors are 10 Ω and already conduct, and its TRIG goes through `trigOnBoard`.

Breadth-first over nodes, at most 4 hops. Hop 0 is the same node, so every old direct-wire test still matches. The nearest pin that has the field wins. A closer pin with no servo, tone, or PWM does not block a farther pin that has one. At the same distance, netlist order wins. OmaDuino, OmaNano, and OmaTiny all count, through `boardMap`.

A hop is only one of these, and only while it is conducting:

- resistor, `ohms <= 10000` (a missing value is 220 Ω; a non-positive value is treated as 1 mΩ)
- `pushButton` with `pressed === true` or `1`
- `tiltSwitch` with `tilted === true` or `1`
- `slideSwitch` common (pin 1) to A (pin 0) when `position < 0.5`, else to B (pin 2)
- relay COM–NO when `state.relayOn` is true, otherwise COM–NC

Pots, LDRs, thermistors, capacitors, fuses, buzzers, motors, and the relay coil are not hops. A wire is already one node.

Servo angle 0 and PWM duty 0 are real values. A missing servo angle leaves `state.servoAngle` alone, which is why a released button holds. Tone must be a finite number above 0. TRIG matches any sketch pin, and it does not care about mode.

`seedDriver` runs before Newton, and `noteRelays` runs inside Newton. Servo, tone, and TRIG are read in `assemble`, after the relay has updated, so they see a contact that closed on this solve. The motor-driver scale is the snapshot from the start of the solve. A relay that closes now changes the driver on the next solve. A plain `digitalWrite` HIGH has no PWM number, so the driver falls back to "input more than 2.5 V above GND". That voltage is the previous solution. Opening a button can leave the motor output on for one step. The test solves once more before it asserts the drop. PWM through the graph does not need the voltage, so a 10 kΩ series resistor still passes a duty even when the pin sags under 2.5 V. A digital HIGH through 10 kΩ into the driver's 100 kΩ input still sits near 4.5 V, so the voltage fallback accepts it.

`pulseIn` lives in `Mcu.js`. When the engine returns 0 µs, the VM waits the timeout before the sketch continues. The distance example's default timeout is 1 s. The robot sketch passes 30 ms. The new test uses `pulseIn(..., 2000)` so the open-button read shows up in a few steps. Do not edit `Mcu.js` for this.

## Internals that are easy to break

Do not re-derive the solver. Newton takes at most a 2 V step and sets `work.hitLimit`. Converged means the step is small, `hitLimit` is false, and `work.changed` is false. `noteModes` clears `changed` at the start of every iteration. History (capacitor voltage, inductor current) updates in `assemble`, not inside Newton.

- 555: one flip per solve (`work.timerHold`). Removing it makes the lesson's DC solve chatter. Open CTRL sits at ⅔ VCC because of 5 kΩ over 10 kΩ. RESET has a 100 kΩ pull-up to VCC. Without it, gmin holds RESET low and the timer never runs. The 1 kΩ / 10 kΩ / 10 µF astable measured 6.803 Hz. The lesson uses 100 µF. Leave the lesson alone.
- Op-amp: gain 1e5, 50 Ω out, rails at V−+0.05 and V+−1.5. If `hitLimit` is set, keep the mode that was stamped. Re-deciding the region while the supply walks up in 2 V steps latches a follower to the rail.
- Transformer: one extra unknown. Secondary current leaves S1 and returns into S2. Both off-diagonals get the ratio. Series resistance on the extra unknown is `0.5 * ratio²`. No conductance between windings. Ratio 0 means 10. Bench 10 V, ratio 10, 1 kΩ secondary: 0.999 V.
- Inductor: 0.5 Ω plus backward Euler, history in `state.indI`. `dt = 0` stamps the 0.5 Ω and overwrites `indI`.
- Relay: coil is 70 Ω plus 10 mH. Contact is 0.05 Ω closed and 1e9 Ω open. Pull-in 3.5 V, drop-out 1.5 V. The spike warning is coil voltage under −20 V. At `dt = 5e-5` the kick is −25.1 V. At the UI step of 0.001 s the kick is about −1.3 V and does not warn.
- 7805 and the op-amp are DC. The 555, both new boards, the relay, the inductor, and the transformer are time-dependent.
- OmaNano is electrically an OmaDuino. Its ground pin is header 20, not header 0. Header 0 is D2. D9 is header 7, sketch pin 9. D13 is header 11, sketch pin 13. `Catalog.mcuPinNumber(index, type)` is the only pin map. A one-argument call means OmaDuino.
- OmaTiny is not a power source. It runs when VCC−GND is from 2.7 V to 5.5 V. Above 6 V it stays off and the warning text is exactly `This OmaTiny needs between 2.7 V and 5.5 V on VCC. Above 6 V it stays off.` A HIGH output is a 25 Ω source to VCC, and that current enters the VCC pin. The first solve from 0 V sees the Tiny off. The next warm step sees VCC. If it is not running, `stampBoard` adds 10 MΩ on the connected pins and must not add a voltage source, or `nExtra` will not match.
- Ground: bench ground wins. Otherwise a DC supply's minus wins, even when an AC source is present. The scope is not a supply.
- AC phase is the fractional part of `freq * t`. Square is +1 for the first half and −1 after. Scope frequency uses interpolated rising crossings only.
- Parts with 3 or more pins get `pinCurrents` that sum to about 0. Two-pin parts do not.
- `Engine.js` stays ES5. No `const`, `let`, arrows, template strings, or trailing commas in object literals. The node tests can use modern JS.
- The worker API is `load`, `step {dt, steps}`, `reset`, `setProp`. The UI picks `dt`. The worker stops a burst after about 25 ms. Leave `STEP_BUDGET` at 400. Do not switch `WorkerScript.source`. Do not bring generators back. Nested `yield*` segfaults the shell.
- `tests/engine.test.js` prints `engine tests ok` before the async `.mjs` compare. Trust the exit code. `sameSolve` only checks `current`, `brightness`, `spin`, and `volts`, so a stale `Engine.mjs` can pass until an old lesson field moves. Regenerate and commit the `.mjs` with every `Engine.js` change.

## Left

- Nothing open in `docs/BUGS.md`. The app check of Dank's real D9 → button → servo circuit is Claude's, after a dev install from a committed tree. Do not restart the shell from here.
- The plugin is local and ahead of GitHub. Do not push until Dank says so.
- A signal through a pot wiper, an LDR, or a capacitor is not a hop. People will try the pot.
- Motor back-EMF is still absent. Driver current is not taken from the VM pin. Pin writes show up on the next solve, because `fill` runs before `runBoards`.
- `docs/GROK-REPORT.md` still describes the driving-pin bug as open.

## What I would change

- Build the closed-path graph once per solve. Each buzzer, servo, driver input, and sonar rebuilds it today. Breadboards are small enough that it does not show up.
- Count a digital output in the driver lookup: HIGH as duty 255, LOW as 0, when `pwm` is null. The motor output would follow the pin on the same solve, including the moment a button opens, and it would stop depending on the previous voltage.
- Take the driver snapshot after `noteRelays`, so a contact that closes this solve drives the motor this solve. Servo, tone, and TRIG already work that way.
- Leave the 2 V Newton cap, the junction `hitLimit` rule, the −0.2 V NMOS hold, the missing motor back-EMF, and the 25 ms worker cap where they are.
