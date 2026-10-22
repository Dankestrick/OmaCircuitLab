# Engine contract, part 2: OmaDuino and robotics parts

This builds on `docs/ENGINE_CONTRACT.md`. Claude built the microcontroller itself in `qml/lib/Mcu.js` (tests: `node tests/mcu.test.js`). The engine's job is to couple it to the circuit.

## New part types (see `qml/lib/Catalog.js`)

| Type | Pins (Catalog order) | Props |
|---|---|---|
| omaduino | 22 header pins: GND, 5V, 3.3V, A0–A5, D2–D13, GND | `code` (sketch text, "" = nothing uploaded) |
| servo | GND, +5V, signal | — |
| hcsr04 | VCC, TRIG, ECHO, GND | `distance` (cm) |
| sevenSeg | a, b, c, d, e, f, g, dp, common (−) | — |

`Catalog.mcuPinNumber(index)` maps a pin index to a sketch pin number (2–13, A0 = 14 … A5 = 19), or to `"gnd"`, `"5v"` or `"3v3"`. Bench.buildNetlist now grounds node 0 at OmaDuino GND when there is no battery or supply first (`Catalog.groundPin(type)`).

## OmaDuino model

- The board is its own USB-powered supply. Its **5V** pin is 5 V with 0.2 Ω and a 0.5 A limit. **3.3V** is 3.3 V with 1 Ω and a 0.05 A limit. Both are referenced to its **GND** pins; both GND pins are the same node.
- Every sketch pin follows `vm.pins[n]`:
  - `mode "out"`: a source at 5 V (`level` 1) or 0 V, through 25 Ω (about 40 mA max; warn above 40 mA). With `pwm` 0–255 the source is `5 × pwm / 255` (the average); report `pwm` so LEDs dim.
  - `mode "in"`: 10 MΩ to GND.
  - `mode "pullup"`: 35 kΩ to the 5V rail.
- Every time step (dt = 1 ms):
  1. Solve the circuit with the current pin outputs.
  2. Call `vm.run(stepEndMicros, io)`, where `io.volts(pin)` returns the solved voltage at that pin's node relative to board GND.
  3. Read the new outputs for the next step.

  `io.pulseIn(pin, level, timeout)`: if the pin's node is the ECHO node of a powered `hcsr04` (VCC − GND > 4 V) whose TRIG node is driven by any board pin, return `distance × 58` µs; otherwise return 0.
- Compile with `Mcu.compile(props.code)` on load and only when `code` changes (cache by text). Create the VM with `Mcu.create(program)`. **Keep the VM across `load`** when the code is unchanged, so editing wires doesn't restart the sketch; `reset` restarts it.
- Empty code means no program: all pins are inputs.
- A circuit with an OmaDuino is time-dependent. The UI already counts it: add `omaduino: true` to `timeTypes` in Overlay if you need to; Claude will do it.
- Result for the board:
  - `pins`: `vm.pins`, for the "L" LED on D13 and the inspector.
  - `serial`: `vm.serial`, the last 4000 characters.
  - `serialActive`: true when serial grew this frame.
  - `running`: true while it has a program and no error.
  - `error` and `errorLine`: from `vm.error` / `vm.errorLine`.
  - Plus a compile error as `error` with `errorLine` when the code doesn't compile.
- Warnings: a pin sourcing or sinking more than 40 mA gives "Pin D13 is giving 120 mA; add a resistor (220 Ω for an LED)." A pin shorted straight to 5V or GND while it's an output gives a danger warning.

## Robotics parts

- **servo:** about 100 Ω between +5V and GND while powered (VCC − GND > 4 V); the signal pin is 1 MΩ to GND. `angle` = the `servo` value of the board pin that drives its signal node. Otherwise keep the last angle (start at 90). Not powered: `angle` stays, plus a warn "The servo needs 5V and GND."
- **hcsr04:** about 330 Ω between VCC and GND (15 mA). ECHO is a high-impedance output: 0 V through 1 kΩ. Report `pinging: true` while TRIG is HIGH or a pulseIn was answered this frame. No power: warn.
- **sevenSeg:** eight red LEDs (Vf 1.8 V), each from a segment pin (anode) to `common` (cathode). Report `segments: { a, b, c, d, e, f, g, dp }` with brightness 0–1, the same as a single LED. Burnt-out rules per segment are the same as for LEDs.

## Tests to add to tests/engine.test.js

- Blink on the board with a 220 Ω resistor and an LED from D13 to GND: the LED is on for about 500 ms, then off for about 500 ms (step through 1500 × 1 ms).
- A button from D2 to GND with INPUT_PULLUP makes `digitalRead` follow the button (use Mcu's button example and check D13).
- A pot on A0 (5V and GND on its ends) gives an `analogRead` near 512 at `turn` 0.5 (check the serial text from the knob example).
- Servo sweep: the angle changes over time.
- HC-SR04 at 30 cm with the distance example: serial shows "30 cm".
- 7-segment: pins driven HIGH through resistors light the matching segments.
- Performance: 1 second of the blink circuit (1000 steps) runs in well under 1 second in Node.

## Motor driver, robot car, live prop updates (added after the first draft)

- **motorDriver** pins: VM, GND, IN1, IN2, IN3, IN4, OUT1, OUT2, OUT3, OUT4.
  - Inputs are 100 kΩ to GND. Logic HIGH is more than 2.5 V above driver GND.
  - Each OUTn is a source switched to VM (input HIGH) or GND (input LOW) through 1 Ω. If the driving board pin has `pwm`, scale that output's voltage by pwm/255 (average model).
  - Report `motorA` = (V(OUT1) − V(OUT2)) / V(VM−GND) and `motorB` = (V(OUT3) − V(OUT4)) / V(VM−GND), both −1..1.
  - Warn "Motor driver has no motor power (VM)" when VM − GND < 3 V and an input is HIGH.
- **robotCar** pins: left +, left −, right +, right −, sonar VCC, TRIG, ECHO, GND.
  - Each motor is about 10 Ω. Report `leftSpin` = I(left + → left −) / 0.25 A and `rightSpin` the same way, clamped to −1..1. The sign follows the current direction.
  - The sonar is an hcsr04 using the same rules as above, with distance = `props.distance`.
- **Worker command** `{cmd:"setProp", id, key, value}` sets `netlist.elements[id].props[key] = value` without resetting anything, and does not reply. The arena sends `distance` to the robot car up to about 30 times a second.
