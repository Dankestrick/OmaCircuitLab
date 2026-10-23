// Every lesson's step-by-step guide: readable, and it ticks off exactly when
// the bench matches.
const load = require("./load"), assert = require("assert")
const G = load("Guide.js"), L = load("Lessons.js"), B = load("Bench.js")
for (const lesson of L.lessons) {
  const steps = G.steps(lesson)
  assert.ok(steps.length >= 3, lesson.id + ": too few steps")
  for (const s of steps) {
    assert.ok(!/undefined|null|NaN|the point at/.test(s.text), lesson.id + ": " + s.text)
    assert.ok(!/\b(Put|Add|Drag) a [aeiou]/i.test(s.text), lesson.id + ": article: " + s.text)
  }
  assert.strictEqual(steps[steps.length - 1].group, "run")
  const built = lesson.build()
  const done = G.progress(steps, built, B.buildNetlist(built), false)
  assert.deepStrictEqual(done.map(String), steps.map(s => String(s.group !== "run")), lesson.id + ": built bench should tick every step but Run")
  assert.ok(G.progress(steps, built, B.buildNetlist(built), true).every(Boolean))
  const empty = { parts: [], wires: [] }
  assert.ok(G.progress(steps, empty, B.buildNetlist(empty), false).every(d => !d), lesson.id + ": empty bench ticks nothing")
  assert.strictEqual(G.current(done), steps.length - 1)
}
// A backwards LED doesn't count; a resistor either way round does.
{
  const lesson = L.lessons[0], steps = G.steps(lesson), b = lesson.build()
  const led = b.parts.find(p => p.type === "led"), r = b.parts.find(p => p.type === "resistor")
  led.rot = 2; led.x += 1
  r.rot = 2; r.x += 4
  const d = G.progress(steps, b, B.buildNetlist(b), false)
  const ledStep = steps.findIndex(s => s.part && s.part.type === "led"), rStep = steps.findIndex(s => s.part && s.part.type === "resistor")
  assert.strictEqual(d[ledStep], false, "reversed LED")
  assert.strictEqual(d[rStep], true, "reversed resistor")
  assert.strictEqual(G.current(d), ledStep)
}
// Wires to the battery follow the learner's battery when it sits elsewhere.
{
  const lesson = L.lessons[0], steps = G.steps(lesson), b = lesson.build()
  const bat = b.parts.find(p => p.type === "battery9v")
  bat.y += 6
  for (const w of b.wires) for (const e of ["a", "b"]) if (w[e].x <= 4 && w[e].y === 10) w[e] = { x: w[e].x, y: 16 }
  const d = G.progress(steps, b, B.buildNetlist(b), false)
  assert.ok(d.slice(0, -1).every(Boolean), "moved battery still ticks: " + JSON.stringify(d))
  const m = G.marks(steps.find(s => s.group === "wires"), b)
  assert.strictEqual(m[0].y, 16)
}
console.log("guide ok:", L.lessons.length, "lessons")
