# Engine contract (Claude's UI side, already built). Grok: adapt ENGINE_API.md to this or tell me what to change.

Netlist input comes from qml/lib/Bench.js buildNetlist(bench):
  { nodeCount, ground: 0 | -1 (no power source), elements: [{ id, type, nodes: [n per pin, Catalog pin order], props }], issues: [...] }
Types and props are in qml/lib/Catalog.js (`parts`). Node 0 is ground.

Engine file: qml/lib/Engine.js, `.pragma library`, pure JS, no Qt APIs (so it runs in Node tests via tests/load.js and in a WorkerScript).
  Engine.createState()                         -> state (capacitor voltages, burnt LEDs, MCU later)
  Engine.solve(netlist, state, dt)             -> result. dt = 0 means DC operating point; dt > 0 is one transient step that updates state.
  Engine.isTimeDependent(netlist)              -> true when capacitors/motors/buzzers need stepping (UI only runs a timer then)
Result:
  { ok, converged, nodeVolts: [..], parts: { [id]: { current, power, pinVolts: [..], brightness (LED 0..1 per color for RGB: {r,g,b}),
    burnt, on (buzzer), spin (motor -1..1), reading (meter text like "4.97 V") } },
    warnings: [{ part, level: "info"|"warn"|"danger", message (friendly, beginner words) }] }
Must: Newton with damping and gmin for floating nodes, step/iteration budget so it can never hang, never throw (return ok:false + a warning).
Shorts (supply +/− joined through ~0 Ω) -> danger warning, cap current. LED over ~40 mA -> burnt (open after that) until reset. Bench supply honors currentLimit.
Multimeter: V = ideal voltmeter, A = 0 Ω ammeter (warn if across a supply), Ω = resistance between probes only when unpowered.
Worker wrapper: qml/lib/EngineWorker.js using WorkerScript.onMessage:
  in  {cmd:"load", netlist} | {cmd:"step", dt, steps} | {cmd:"reset"}      out {kind:"result", result}
Tests: tests/engine.test.js run with `node tests/engine.test.js` (see tests/bench.test.js for the loader).

## Extra per-part result fields the UI reads (added by Claude)
- multimeter: `value` (number, in V / A / Ω for its mode) besides `reading` text. Ω mode with power on -> reading "Power on!" plus a warn.
- npn/pnp/nmos: `collectorCurrent` (drain current for nmos), `state`: "off" | "active" | "saturated" (for hover text).
- benchSupply: `volts` (actual output), `current`, `limited` (true while current limiting).
- battery9v / aaPack: `current`. aaPack volts = cells * 1.5 (props.volts may be stale).
- resistor: `hot` 0..1 when power exceeds 0.25 W (glow).
- led: `brightness` 0..1 (1 at 20 mA), `burnt`. rgbLed: `brightness: {r,g,b}`.
- motor: `spin` -1..1 (1 at ~ full rated current); buzzer: `on`.
- electrolytic: `burnt` when reversed by more than 1 V or above ratedVolts.
- pushButton props.pressed, slideSwitch props.position (0 = common-A, 1 = common-B), potentiometer props.turn (0..1, wiper near end 1 at 0).
- "load" keeps per-id state (capacitor charge, burnt parts) across edits; only "reset" clears it.
