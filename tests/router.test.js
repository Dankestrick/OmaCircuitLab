const load = require("./load"), assert = require("assert")
const R = load("Router.js")
const sq = p => { for (let i = 1; i < p.length; i++) assert(p[i].x === p[i-1].x || p[i].y === p[i-1].y, "square " + JSON.stringify(p)) }
const ends = (p, a, b) => assert(p[0].x === a.x && p[0].y === a.y && p[p.length-1].x === b.x && p[p.length-1].y === b.y, "ends kept " + JSON.stringify(p))
const a = { x: 2, y: 2 }, b = { x: 10, y: 6 }
const path = [a, { x: 2.5, y: 2 }, { x: 2.5, y: 5.5 }, { x: 10, y: 5.5 }, { x: 10, y: 6 }]
// slide the long horizontal run up
let p = R.moveSegment(path, 2, 3.5); sq(p); ends(p, a, b); assert(p.some(q => q.y === 3.5))
// slide the first (end-touching) segment: dog-leg keeps the end in its hole
p = R.moveSegment(path, 0, 1.5); sq(p); ends(p, a, b)
// straight two-point wire gets a dog-leg
p = R.moveSegment([{ x: 0, y: 0 }, { x: 5, y: 0 }], 0, 1.5); sq(p); ends(p, { x: 0, y: 0 }, { x: 5, y: 0 }); assert(p.length === 4)
// move a corner
p = R.moveCorner(path, 2, 6.5, 4.5); sq(p); ends(p, a, b); assert(p.some(q => q.x === 6.5 && q.y === 4.5), JSON.stringify(p))
// routeAll keeps a valid hand path and routes the rest around it
const w1 = { id: "w1", a, b, path }, w2 = { id: "w2", a: { x: 2, y: 8 }, b: { x: 10, y: 8 } }
const r = R.routeAll([w1, w2], () => false, { w: 20, h: 20 })
assert.strictEqual(r.w1, path); sq(r.w2)
// an invalid path (end moved) is re-routed
const r2 = R.routeAll([{ id: "w", a, b: { x: 9, y: 9 }, path }], () => false, { w: 20, h: 20 }); ends(r2.w, a, { x: 9, y: 9 })
console.log("router ok")
