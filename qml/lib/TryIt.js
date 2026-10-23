.pragma library

// What to try after the circuit is built and Run is on. One small action
// each, with the numbers the bench really shows.

var steps = {
  led: [
    "Hover the resistor. The bottom of the bench shows A= 15.3 mA.",
    "Hover the LED. The bottom of the bench shows V= 1.79 V.",
    "Click the LED. Inspect says Brightness 76 %.",
    "Hover the battery. The bottom of the bench shows V= 8.98 V."
  ],
  meter: [
    "Look at the multimeter. Its screen says 1.79 V.",
    "Hover the resistor. The bottom of the bench shows V= 7.19 V.",
    "Click the multimeter once. Its screen says 19.1 mA, and the LED goes dark.",
    "Click the multimeter again. Its screen says Power on!, and the LED lights again.",
    "Click the multimeter once more. Its screen says 1.79 V."
  ],
  ohm: [
    "Hover the resistor. The bottom of the bench shows A= 15.3 mA.",
    "Click the resistor and scroll down until Resistance says 220 Ω. The LED gets brighter.",
    "Hover the resistor. The bottom of the bench shows A= 32.4 mA.",
    "Scroll up on the resistor until Resistance says 10 kΩ. The LED gets very dim.",
    "Hover the resistor. The bottom of the bench shows A= 736 µA."
  ],
  button: [
    "Hover the green LED. It stays dark.",
    "Click and hold the button. The LED lights, and Inspect says Current 14.7 mA.",
    "Let go of the button. The LED goes dark."
  ],
  pot: [
    "Hover the LED. The bottom of the bench shows A= 13.5 mA.",
    "Scroll down on the knob. The LED gets brighter.",
    "Keep scrolling down until the knob stops. Hover the LED. The bottom of the bench shows A= 31.4 mA.",
    "Scroll up on the knob until it stops. The LED gets dimmer.",
    "Hover the LED. The bottom of the bench shows A= 5.78 mA."
  ],
  ldr: [
    "Look at the multimeter. Its screen says 2.16 V.",
    "Scroll up on the light sensor. The meter number climbs.",
    "Keep scrolling up until the meter says 8.18 V.",
    "Scroll down on the light sensor until the meter says 89.1 mV."
  ],
  npn: [
    "Hover the LED. It stays dark.",
    "Click and hold the button. The blue LED lights, and Inspect says Current 825 µA.",
    "Let go of the button. The LED goes dark."
  ],
  tmp36: [
    "Look at the multimeter. Its screen says 750 mV.",
    "Click the temperature probe. Inspect says Temperature 25 °C.",
    "Scroll up on the probe until Temperature says 41 °C. The meter says 910 mV.",
    "Scroll down on the probe until Temperature says 25 °C. The meter says 750 mV."
  ],
  rc: [
    "Look at the LED. It is dark.",
    "Click and hold the button. The orange LED lights, and Inspect says Current 12.5 mA.",
    "Let go of the button. The LED stays lit, then slowly fades out."
  ],
  motor: [
    "Hover the bench power supply. The bottom of the bench shows V= 6 V.",
    "Look at the motor. Its red line is still.",
    "Click and hold the button. The red line spins.",
    "Let go of the button. The red line stops."
  ],
  parallel: [
    "Look at the two LEDs. Both are lit.",
    "Hover the resistor next to the red LED. The bottom of the bench shows A= 15.3 mA.",
    "Hover the resistor next to the green LED. The bottom of the bench shows A= 14.6 mA.",
    "Hover the battery. The bottom of the bench shows A= 29.9 mA. That is 15.3 and 14.6 added together."
  ],
  clamp: [
    "Look at the clamp meter. It shows 22.2 mA. Its jaw is already on the battery's red wire.",
    "Click the jaw, then click the wire going to the brighter LED. The clamp meter shows 15.3 mA.",
    "Click the jaw, then click the wire going to the dimmer LED. The clamp meter shows 6.92 mA.",
    "Click the jaw, then click the battery's red wire again. The clamp meter shows 22.2 mA."
  ],
  switch2: [
    "Look at the LEDs. The red one is lit and the green one is dark.",
    "Click the slide switch. The red LED goes dark and the green LED lights.",
    "Hover the green LED. The bottom of the bench shows A= 14.7 mA.",
    "Click the slide switch again. The red LED lights and the green one goes dark."
  ],
  rgb: [
    "Look at the RGB LED. Red, green and blue are all glowing.",
    "Hover the left resistor, on the red leg. The bottom of the bench shows A= 15.2 mA.",
    "Hover the next resistor, on the green leg. The bottom of the bench shows A= 6.9 mA.",
    "Click that resistor and scroll up until Resistance says 10 kΩ. The green fades and the light looks more purple.",
    "Hover that resistor. The bottom of the bench shows A= 702 µA."
  ],
  zener: [
    "Look at the multimeter. Its screen says 5.19 V.",
    "Hover the resistor. The bottom of the bench shows V= 3.8 V.",
    "Scroll up once on the zener diode. The meter says 9.09 V.",
    "Scroll down on the zener diode until the meter says 3.41 V."
  ],
  mosfet: [
    "Hover the yellow LED. The bottom of the bench shows A= 7.74 nA, and the LED stays dark.",
    "Click and hold the button. The LED lights, and Inspect says Current 89.8 µA.",
    "Let go of the button. The LED goes dark."
  ],
  heatalarm: [
    "Look at the buzzer. It is quiet. No rings, and it does not say BZZZ.",
    "Click the Sound button so it says Sound on.",
    "Scroll up on the thermistor until it shows 45°. Rings move and it says BZZZ.",
    "Hover the buzzer. The bottom of the bench shows A= 13.3 mA.",
    "Scroll down on the thermistor until it shows 25°. The rings stop."
  ],
  blink: [
    "Watch the LED. It stays on for about half a second, then off for about half a second. The L light on the OmaDuino blinks with it.",
    "Hover the LED while it is lit. The bottom of the bench shows A= 13.1 mA.",
    "Click the OmaDuino and press Open code editor.",
    "Change both delay(500) to delay(100) and press Upload. The LED blinks much faster."
  ],
  mcubutton: [
    "Watch the green LED. It stays dark.",
    "Click and hold the button. The green LED lights.",
    "Let go of the button. The LED goes dark."
  ],
  fade: [
    "Watch the blue LED. It stays dark, then glows, then goes dark again.",
    "Hover the LED while it is glowing brightest. The bottom of the bench shows A= about 8.3 mA.",
    "Click the OmaDuino and press Open code editor.",
    "Change int step = 5; to int step = 1; and press Upload. The glow takes longer."
  ],
  mcunight: [
    "Click the OmaDuino and press Open code editor. The Serial Monitor prints 396, and the white LED is already on.",
    "Hover the LED. The bottom of the bench shows A= 8.34 mA.",
    "Scroll up on the light sensor until the Serial Monitor shows a number bigger than 400. The LED goes out.",
    "Scroll down on the light sensor until the Serial Monitor shows 396 or less. The LED comes back on."
  ],
  servo: [
    "Watch the servo. Its horn jumps near 0°, and the number on it starts to climb.",
    "Hover the servo. The bottom of the bench shows A= 49.9 mA.",
    "Keep watching. The number climbs, turns back down, and climbs again."
  ],
  sonar: [
    "Look at the distance sensor. It says 40 cm, and the LED is dark.",
    "Click the OmaDuino and press Open code editor. The Serial Monitor prints 40 cm.",
    "Scroll down on the distance sensor until it says 18 cm. The Serial Monitor prints 18 cm, and the LED lights.",
    "Hover the LED. The bottom of the bench shows A= 13.1 mA."
  ],
  robot: [
    "Click the OmaDuino and press Open code editor. The Serial Monitor prints 100.",
    "Look at the robot car. It says 100 cm ahead, and L 100% and R 100% are both green.",
    "Click the robot car and press Open robot arena. The car drives forward. The top of the Robot arena shows Sonar, L and R.",
    "Press ✕ to close the Robot arena.",
    "Scroll down on the robot car until it says 10 cm ahead. The Serial Monitor prints 10. L and R both go red, then L goes green and R stays red."
  ],
  acscope: [
    "Look at the oscilloscope. The trace is a sine wave that crosses the middle line.",
    "Scroll on the function generator until Frequency says 100 Hz. The wave gets tighter.",
    "Click the function generator and set Wave to square. The trace gets flat tops and bottoms.",
    "Set Wave back to sine."
  ],
  rectifier: [
    "Look at the oscilloscope. The trace sits up high and barely wiggles.",
    "Click the capacitor and delete it. The trace starts bumping up and down.",
    "Put the 1000 µF capacitor back across the rails. The line goes almost flat again."
  ],
  timer555: [
    "Watch the yellow LED. It blinks on its own, a little faster than once a second.",
    "Click the 10 kΩ resistor and scroll down until Resistance says 1 kΩ. The blink speeds up.",
    "Scroll that resistor back up to 10 kΩ. The blink slows down."
  ],
  relay: [
    "Look at the green LED. It stays dark.",
    "Click and hold the button. The LED lights.",
    "Let go of the button. The LED goes dark."
  ],
  reg7805: [
    "Look at the multimeter. Its screen says 5.00 V.",
    "Look at the blue LED. It is lit.",
    "Hover the regulator. The bottom of the bench shows about 5 V out."
  ],
  nano: [
    "Watch the red LED. It stays on for about half a second, then off for about half a second.",
    "Click the OmaNano and press Open code editor.",
    "Change both delay(500) to delay(100) and press Upload. The LED blinks much faster."
  ],
  tiny: [
    "Watch the green LED. It blinks on its own, about once a second.",
    "Click the OmaTiny and press Open code editor.",
    "Change both delay(500) to delay(100) and press Upload. The LED blinks much faster."
  ]
}
