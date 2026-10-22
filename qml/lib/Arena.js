.pragma library

// The robot arena: a top-down room in centimeters where the Robot car part
// drives. Wheel speeds come from the engine (leftSpin/rightSpin, -1..1); the
// arena moves the car, stops it at walls, and measures what its sonar sees.

var W = 300, H = 200          // room size in cm
var TOP_SPEED = 45            // cm/s at full wheel speed
var WHEELBASE = 14            // cm between wheels
var BODY = 9                  // collision radius in cm
var SONAR_MAX = 400

var layouts = {
  empty: { label: "Empty room", boxes: [] },
  boxes: { label: "Obstacles", boxes: [[90, 50, 40, 40], [190, 110, 50, 30], [60, 140, 30, 30], [230, 30, 25, 45]] },
  maze: { label: "Maze", boxes: [[70, 0, 12, 130], [150, 70, 12, 130], [230, 0, 12, 130]] },
  hall: { label: "Hallway", boxes: [[0, 0, 300, 70], [0, 130, 300, 70]] }
}

function startPose(layout) {
  if (layout === "hall") return { x: 30, y: 100, a: 0 }
  if (layout === "maze") return { x: 30, y: 170, a: -Math.PI / 2 }
  return { x: 40, y: 100, a: 0 }
}

function createState(layout) {
  var p = startPose(layout)
  return { layout: layout, x: p.x, y: p.y, a: p.a, trail: [], bumped: false, distance: SONAR_MAX }
}

function boxesOf(layout) { return (layouts[layout] || layouts.empty).boxes }

function hitsBox(x, y, r, b) {
  var cx = Math.max(b[0], Math.min(x, b[0] + b[2]))
  var cy = Math.max(b[1], Math.min(y, b[1] + b[3]))
  var dx = x - cx, dy = y - cy
  return dx * dx + dy * dy < r * r
}

function blocked(layout, x, y) {
  if (x < BODY || y < BODY || x > W - BODY || y > H - BODY) return true
  var bs = boxesOf(layout)
  for (var i = 0; i < bs.length; i++) if (hitsBox(x, y, BODY, bs[i])) return true
  return false
}

// Distance from the car's nose straight ahead to the nearest wall or box.
function sonar(state) {
  var ox = state.x + Math.cos(state.a) * BODY, oy = state.y + Math.sin(state.a) * BODY
  var dx = Math.cos(state.a), dy = Math.sin(state.a)
  var best = SONAR_MAX
  function ray(t) { if (t > 0 && t < best) best = t }
  // Room walls.
  if (dx > 1e-9) ray((W - ox) / dx); if (dx < -1e-9) ray(-ox / dx)
  if (dy > 1e-9) ray((H - oy) / dy); if (dy < -1e-9) ray(-oy / dy)
  // Boxes (slab test).
  var bs = boxesOf(state.layout)
  for (var i = 0; i < bs.length; i++) {
    var b = bs[i], tmin = -Infinity, tmax = Infinity
    var lo = [b[0], b[1]], hi = [b[0] + b[2], b[1] + b[3]], o = [ox, oy], d = [dx, dy], ok = true
    for (var k = 0; k < 2; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) ok = false; continue }
      var t1 = (lo[k] - o[k]) / d[k], t2 = (hi[k] - o[k]) / d[k]
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2))
    }
    if (ok && tmax >= Math.max(0, tmin)) ray(Math.max(0, tmin))
  }
  return Math.max(2, Math.min(SONAR_MAX, best))
}

// Advance dt seconds with wheel speeds -1..1. Returns the new state.
function step(state, left, right, dt) {
  var vl = Math.max(-1, Math.min(1, left || 0)) * TOP_SPEED
  var vr = Math.max(-1, Math.min(1, right || 0)) * TOP_SPEED
  // Screen y points down, so left-forward/right-back turns clockwise (angle grows).
  var v = (vl + vr) / 2, w = (vl - vr) / WHEELBASE
  var s = { layout: state.layout, x: state.x, y: state.y, a: state.a, trail: state.trail, bumped: false, distance: state.distance }
  s.a = state.a + w * dt
  var nx = state.x + Math.cos(s.a) * v * dt, ny = state.y + Math.sin(s.a) * v * dt
  if (!blocked(s.layout, nx, ny)) { s.x = nx; s.y = ny }
  else if (!blocked(s.layout, nx, state.y)) { s.x = nx; s.bumped = true }
  else if (!blocked(s.layout, state.x, ny)) { s.y = ny; s.bumped = true }
  else s.bumped = true
  var last = s.trail.length ? s.trail[s.trail.length - 1] : null
  if (!last || Math.abs(last[0] - s.x) + Math.abs(last[1] - s.y) > 3) {
    s.trail = s.trail.concat([[s.x, s.y]])
    if (s.trail.length > 300) s.trail = s.trail.slice(s.trail.length - 300)
  }
  s.distance = sonar(s)
  return s
}
