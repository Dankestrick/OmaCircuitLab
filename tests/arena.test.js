const load = require("./load"), assert = require("assert")
const A = load("Arena.js")
let s = A.createState("empty")
assert(Math.abs(A.sonar(s) - (300 - 40 - 9)) < 0.01, "sonar to far wall " + A.sonar(s))
for (let i = 0; i < 300; i++) s = A.step(s, 1, 1, 0.033)       // ~10 s full ahead
assert(s.x < 300 - 9 + 0.01 && s.x > 250, "stopped at the wall, x=" + s.x)
assert(s.bumped)
let t = A.createState("empty"); const a0 = t.a
for (let i = 0; i < 10; i++) t = A.step(t, 1, -1, 0.033)
assert(t.a > a0, "left forward + right back turns right (clockwise on screen)")
assert(Math.abs(t.x - 40) < 0.5, "spinning in place doesn't move")
let b = A.createState("boxes"); b.x = 60; b.y = 70; b.a = 0
assert(Math.abs(A.sonar(b) - (90 - 69)) < 0.5, "sees the box: " + A.sonar(b))
console.log("arena ok")
