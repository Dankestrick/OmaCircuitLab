// Every lesson's circuit is valid: no legs between holes, no double holes,
// every part leg on a net with something else.
const load = require("./load"), assert = require("assert")
const L = load("Lessons.js"), B = load("Bench.js")
for (const lesson of L.lessons) {
  const bench = lesson.build()
  const nl = B.buildNetlist(bench)
  assert.strictEqual(nl.issues.length, 0, lesson.id + ": " + JSON.stringify(nl.issues))
  const uses = {}
  for (const e of nl.elements) for (const n of e.nodes) uses[n] = (uses[n] || 0) + 1
  for (const e of nl.elements) if (!{ omaduino: 1, potentiometer: 1, timer555: 1, omaNano: 1, omaTiny: 1, relay: 1, oscilloscope: 1 }[e.type]) e.nodes.forEach((n, i) => assert(uses[n] >= 2, lesson.id + ": " + e.id + " pin " + i + " dangles"))
  console.log("ok", lesson.id, "nodes", nl.nodeCount)
}
