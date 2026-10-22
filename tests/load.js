// Load the QML .pragma library JS files in Node for tests.
const fs = require("fs"), path = require("path"), vm = require("vm")
const lib = path.join(__dirname, "..", "qml", "lib")
const cache = {}
function load(name) {
  if (cache[name]) return cache[name]
  let src = fs.readFileSync(path.join(lib, name), "utf8")
  const Qt = { color: c => ({ r: 0.5, g: 0.5, b: 0.5, a: 1 }), rgba: (r, g, b, a) => "rgba(" + [r, g, b, a] + ")" }
  const ctx = { Math, JSON, console, Object, Array, Number, String, isFinite, isNaN, Float64Array, Int32Array, Qt, Date }
  src = src.replace(/^\.pragma.*$/m, "").replace(/^\.import\s+"([^"]+)"\s+as\s+(\w+)\s*$/mg, (m, f, as) => { ctx[as] = load(f); return "" })
  vm.createContext(ctx)
  vm.runInContext(src, ctx, { filename: name })
  cache[name] = ctx
  return ctx
}
module.exports = load
