# Bugs Dank found while building

Open items first. Each one says who fixes it.

## Open

None.

## Fixed

- Servo, tone(), motor-driver PWM, and a sonar or robot TRIG only saw a board pin on the same node. They now follow a pressed button, the selected side of a slide switch, a tilted tilt switch, a closed relay contact, or a resistor up to 10 kΩ, for up to four hops. The nearest OmaDuino, OmaNano, or OmaTiny pin wins. Letting the button go holds the servo angle (6b1f97d).
- Inspect cut off text on the right for long part names like the HC-SR04 (title now wraps).

- Robot spun in circles: the arena moved in wall-clock time while sketches count sim time (e033253).
- Shell crashed running sketches: nested `yield*` in the interpreter (e033253).
- LED stayed burnt after turning the resistor back up (e223a8d).
- One scroll notch skipped values such as 470 Ω (e223a8d).
- 470 Ω showed as "47 Ω" (2210351).
- Servo arm stuck at 0° in the drawing (57b7c93).
- Buzzer in backwards gave no warning (a5a7505).
