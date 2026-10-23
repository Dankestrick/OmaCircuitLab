// Every part draws without throwing, stopped and with live data.
const load = require("./load")
const A = load("PartArt.js"), C = load("Catalog.js")
const ctx = new Proxy({}, { get: (t, k) => k in t ? t[k] : (typeof k === "string" ? (k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}) : undefined), set: (t, k, v) => { t[k] = v; return true } })
const live = { brightness: 0.8, burnt: false, current: 0.01, pinVolts: [5, 0, 0, 0], angle: 1, spin: 0.5, on: true, reading: "4.97 V", segments: { a: 1, b: 1, c: 1 }, pins: [{ level: 1 }], running: true, volts: 5 }
let n = 0
for (const type in C.parts) {
  const part = { id: "x", type, x: 0, y: 0, rot: 0, props: C.defaults(type) }
  A.draw(ctx, part, {}, false); A.draw(ctx, part, live, true); n++
  if (!C.boxes[type]) throw new Error("no box for " + type)
}
console.log("art ok:", n, "parts")
// A servo's arm follows the engine's angle (a motor's spin has its own field).
const assert = require("assert")
{
  const calls = []
  const ctx = new Proxy({}, { get: (t, k) => k === "lineTo" ? (x, y) => calls.push([x, y]) : (typeof k === "string" && /Style|Width|Cap|Join|Align|Baseline|font|globalAlpha/.test(k) ? undefined : () => ({ width: 1 })), set: () => true })
  const A = load("PartArt.js")
  const arm = ang => { calls.length = 0; A.draw(ctx, { type: "servo", props: {} }, { angle: ang, spinAngle: 0 }, true); return calls[calls.length - 1] }
  const a0 = arm(0), a180 = arm(180)
  assert.ok(Math.abs(a0[0] - a180[0]) > 2, "servo arm moves with angle: " + JSON.stringify([a0, a180]))
  console.log("servo arm ok")
}
