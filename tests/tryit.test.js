// Every lesson has Try it text, and nothing else is in that list.
const load = require("./load"), assert = require("assert")
const L = load("Lessons.js")
const T = load("TryIt.js")
const ids = L.lessons.map(function (l) { return l.id })
const keys = Object.keys(T.steps)
assert.strictEqual(keys.length, ids.length)
for (const id of ids) {
  const list = T.steps[id]
  assert.ok(Array.isArray(list), id)
  assert.ok(list.length >= 3 && list.length <= 5, id + " " + list.length)
  for (const s of list) {
    assert.strictEqual(typeof s, "string", id)
    assert.ok(s.length > 0, id)
  }
}
for (const k of keys) assert.ok(ids.includes(k), "extra " + k)
console.log("tryit ok", ids.length)
