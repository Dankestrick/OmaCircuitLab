# Engine contract v2: AC, scope, new parts, more boards

Claude owns `Catalog.js`, the drawings, QML, and lessons. Grok owns `Engine.js`, `EngineWorker.js`, and their tests. Pin order below is the order of `el.nodes`. "Current" means `current` into pin 0, as before. Every new part with 3 or more pins reports `pinCurrents`. Anything not listed here keeps the v1 contract.

## Time

- `state.t` is simulated seconds. It starts at 0 on `createState`, advances by `dt` on every solve with `dt > 0`, and doesn't change on a DC solve (`dt = 0`).
- `isTimeDependent` is true for `acSource`, `acAdapter`, `transformer`, `inductor`, `relay`, `timer555`, `oscilloscope`, `omaNano`, and `omaTiny`.
- The worker's `step` keeps `{dt, steps}`. The UI now picks `dt` from the fastest AC source: `dt = min(0.001, 1 / (40 * fmax))`. `steps` is as many as fit 33 ms of sim time, still capped by the 25 ms wall-clock rule. A 1 kHz signal therefore runs in slow motion, which is fine for a scope. `result.simTime` stays as it is.

## AC sources

| type | pins | props | model |
| --- | --- | --- | --- |
| `acSource` (function generator) | `+`, `−` | `wave`: "sine" \| "square" \| "triangle"; `freq` Hz (default 60, range 1–5000); `amplitude` V peak (default 5, 0–30); `offset` V (default 0) | Ideal source with 50 Ω in series. v(t) = offset + amplitude·w(2π·freq·t). Square is ±1, triangle is ±1 linear. |
| `acAdapter` (wall adapter) | `~1`, `~2` | `vrms` (default 12), `freq` (default 60) | Sine with peak `vrms·√2`, 1 Ω in series. Floating: neither pin is ground unless wired. |
| `transformer` | `P1`, `P2`, `S1`, `S2` | `ratio` (default 10, primary:secondary turns) | Ideal-ish coupled pair: `V(S1−S2) = V(P1−P2) / ratio` and `I_P = I_S / ratio`. Add 0.5 Ω on the secondary and 1 MΩ magnetizing on the primary, so an open secondary still solves. The two sides are isolated, with no DC path between them. |

Result fields: `volts` (instantaneous terminal voltage), `current`. For `acSource` and `acAdapter`, add `vpeak` and `freq`.

### Ground when the only power is AC

The reference rules from v1 still apply, with this addition: if the only power is an `acSource`, its `−` is the reference. If it's an `acAdapter` alone, `~2` is the reference. `ground >= 0` from the netlist always wins. `Catalog.groundPin` will return 1 for `acSource` and `acAdapter`.

## Oscilloscope

`oscilloscope`, pins `CH1`, `CH2`, `GND`. Inputs are 10 MΩ to `GND`, and it doesn't load the circuit otherwise. Props: `timePerDiv` s (default 0.005), `voltsPerDiv` V (default 2), `trigger` "auto" \| "none", `ch2` true/false.

The engine keeps a sample ring per scope in `state.scope[id] = { t: [], ch1: [], ch2: [] }`. On each `dt > 0` solve it pushes `V(CH1)−V(GND)` and `V(CH2)−V(GND)`. Keep at most 2000 samples, dropping the oldest. On a DC solve, push one sample.

Result: `{ samples: { t: [...], ch1: [...], ch2: [...] } }` with only the last `10 · timePerDiv` seconds, and no more than 600 points (decimate evenly). Also `vpp1`, `vpp2`, `freq1` (zero-crossing estimate, or 0), and `vrms1`. Trigger "auto": the UI aligns the trace to a rising crossing of the mean. The engine doesn't need to trigger.

## New parts

| type | pins | props | model |
| --- | --- | --- | --- |
| `inductor` | `1`, `2` | `henries` (default 0.01) | Backward Euler companion (`g = dt/L`, history current), 0.5 Ω DC resistance, short at DC. Store `state.indI[id]`. Result `current`. Time-dependent. |
| `relay` | `coil+`, `coil−`, `COM`, `NO`, `NC` | `coilOhms` 70, `pullIn` 3.5 V, `dropOut` 1.5 V | Coil is a resistor plus a 10 mH inductor. The contact is COM–NO closed (0.05 Ω) when the coil voltage is ≥ pullIn, stays closed until it's < dropOut, and COM–NC is the opposite. Open is 1e9 Ω. Result `on` and `coilV`. Warn when there's no flyback diode and the coil voltage spikes below −20 V at turn-off. |
| `regulator7805` | `IN`, `GND`, `OUT` | none | Behavioral: OUT = min(5, V(IN)−V(GND)−2) relative to GND, behind 0.1 Ω, 5 mA quiescent. Warn above 1 A or when IN is under 7 V ("needs at least 7 V in to make 5 V"). Result `volts` and `dropout`. |
| `timer555` | `GND`, `TRIG`, `OUT`, `RESET`, `CTRL`, `THR`, `DIS`, `VCC` (DIP-8 order) | none | Behavioral: internal divider 5k/5k/5k from VCC (CTRL is the 2/3 node). Flip-flop set when TRIG < ⅓VCC, reset when THR > ⅔VCC, forced low when RESET < 0.7 V. OUT is VCC−1.5 V high or 0.1 V low, behind 10 Ω. DIS is 10 Ω to GND when low, open when high. Keep the flip-flop in `state`. This has to make the classic astable blink with R1, R2, and C. Result `out` (0/1), `freq` estimate. |
| `opamp` (LM358 single) | `−in`, `+in`, `V−`, `V+`, `OUT` | none | Gain 1e5 with output clamped to [V−+0.05, V+−1.5], 50 Ω output, inputs 10 MΩ. Result `out`, `saturated`. |
| `schottky` | `anode`, `cathode` | none | Diode with Is 1e-6, n 1.05 (about 0.3 V at 10 mA). |
| `fuse` | `1`, `2` | `amps` (default 0.5) | 0.1 Ω. Blows (open, `burnt`) once \|I\| > amps for more than 50 ms of sim time, or right away at 3× amps. Reset fixes it. Warning: "The fuse blew: too much current. Fix the short, then press Reset." |
| `bridgeRectifier` | `~1`, `~2`, `+`, `−` | none | Four standard diodes (Is 1e-12, n 1.9) in a bridge. `pinCurrents`. |
| `tiltSwitch` | `1`, `2` | `tilted` false | Like a push button: closed when `tilted`. The UI toggles it on click. |
| `irLed` | `anode (+)`, `cathode (−)` | none | Like an LED with Vf 1.2 and brightness reported, but `invisible: true`. Burns over 50 mA. |
| `photodiode` | `anode`, `cathode` | `light` 0..1 | Reverse-biased current source `I = 50 µA · light` from cathode to anode, plus a normal diode. Also responds to any lit `irLed` on the bench: add `0.5 · max irLed brightness` to `light`. Proximity is a later job. |

## More microcontrollers

`omaNano` and `omaTiny` run the same `Mcu` VM as `omaduino`, each with its own VM in `state` keyed by element id. Several boards at once must work: each keeps its own `vm`, `code`, and serial.

- `omaNano` pins, in order: `D2`…`D13`, then `A0`…`A5`, `5V`, `3.3V`, `GND`, `GND2`. It plugs into the breadboard straddling the channel. Same electrical rules as `omaduino`.
- `omaTiny` pins, in DIP-8 order: `RESET(PB5)`, `PB3`, `PB4`, `GND`, `PB0`, `PB1`, `PB2`, `VCC`. Sketch pin numbers: PB0–PB4 are 0–4. PB3 and PB4 are also `A3`/`A2` (analogRead 3 and 2), and PB2 is `A1`. PWM is on PB0, PB1, and PB4. It has **no** on-board regulator: it runs only when VCC−GND is between 2.7 V and 5.5 V, warns above 6 V and doesn't run, and outputs drive to VCC through 25 Ω. No serial: `Serial` prints go nowhere, which isn't an error.
- `Catalog.mcuPinNumber(index, type)` now takes the board type and returns the sketch pin number, or `"gnd"`, `"5v"`, `"3v3"`, `"vcc"`. The old one-argument call means `omaduino`. Use the type everywhere the engine maps pins today.
- `Mcu.create` takes an optional `{ pins: N, pwm: {3:true,…} }` profile. Claude adds that to `Mcu.js`. Until it lands, use the defaults.

## Tests

For each part, add to `tests/engine.test.js`: a 60 Hz sine across 1 kΩ (scope `vpp1` about 2× amplitude, `freq1` about 60); a bridge plus 1000 µF smoothing on a 12 V adapter (DC about 15 V with ripple under 1.5 V); the 555 astable at R1 = 1 kΩ, R2 = 10 kΩ, C = 10 µF (about 6.9 Hz); a relay switching an LED; the 7805 from 9 V (5.0 V out); a fuse blowing on a short; an inductor's current rising with L/R; Nano blink; and a Tiny blink powered from 5 V.
