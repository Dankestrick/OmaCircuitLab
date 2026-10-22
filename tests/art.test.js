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
