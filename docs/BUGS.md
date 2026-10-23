# Bugs Dank found while building

Open items first. Each one says who fixes it.

## Open

- **Servo signal doesn't pass through a button or switch** (Grok, engine). `servoDriveAngle` only matches a board pin on the same node as the servo's signal leg. Wire D9 → pushButton → servo signal and the servo stays at 90° even with the button held down. The signal should follow through anything closed right now: a pressed button, a slide switch, a tilted tilt switch, a closed relay contact, and resistors up to about 10 kΩ. The same applies to `tone()` reaching a buzzer and to motorDriver/robotCar inputs, so check every place that looks up a "driving pin".

## Fixed

- Inspect cut off text on the right for long part names like the HC-SR04 (title now wraps).

- Robot spun in circles: the arena moved in wall-clock time while sketches count sim time (e033253).
- Shell crashed running sketches: nested `yield*` in the interpreter (e033253).
- LED stayed burnt after turning the resistor back up (e223a8d).
- One scroll notch skipped values such as 470 Ω (e223a8d).
- 470 Ω showed as "47 Ω" (2210351).
- Servo arm stuck at 0° in the drawing (57b7c93).
- Buzzer in backwards gave no warning (a5a7505).
