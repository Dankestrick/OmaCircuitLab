const load = require("./load"), assert = require("assert")
const M = load("Mcu.js")
function run(src, ms, io) {
  const c = M.compile(src)
  assert(c.ok, JSON.stringify(c.errors))
  const vm = M.create(c.program)
  const samples = []
  for (let t = 1; t <= ms; t++) { vm.run(t * 1000, io || {}); samples.push(vm.pins.map(p => ({ ...p }))) }
  assert.strictEqual(vm.error, "", vm.error + " line " + vm.errorLine)
  return { vm, samples }
}
// every example compiles and runs 3 s without a runtime error
for (const ex of M.examples) {
  const io = { volts: p => (p === 14 ? 2.5 : p === 15 ? 0.75 : p === 2 ? 5 : 0), pulseIn: () => 580 }
  const { vm } = run(ex.text, 3000, io)
  console.log("example ok:", ex.id, JSON.stringify(vm.serial.slice(0, 40)))
}
// blink toggles pin 13 every 500 ms
{
  const { samples } = run(M.example("blink"), 2100)
  assert.strictEqual(samples[100][13].level, 1)
  assert.strictEqual(samples[600][13].level, 0)
  assert.strictEqual(samples[1100][13].level, 1)
}
// int division and float math
{
  const { vm } = run("int a; float f; void setup(){ a = 7/2; f = 7/2.0; Serial.println(a); Serial.println(f); } void loop(){ delay(1000); }", 5)
  assert.strictEqual(vm.serial, "3\n3.50\n")
}
// arrays, functions, for, switch, while/break
{
  const src = `int vals[] = {3, 1, 4};
int sum(int n) { int s = 0; for (int i = 0; i < n; i++) s += vals[i]; return s; }
void setup() { Serial.begin(9600); int k = 0; while (true) { k++; if (k > 4) break; }
  switch (k) { case 5: Serial.println("five"); break; default: Serial.println("other"); }
  Serial.println(sum(3)); }
void loop() { delay(10); }`
  const { vm } = run(src, 5)
  assert.strictEqual(vm.serial, "five\n8\n")
}
// a tight loop without delay doesn't hang and time still moves
{
  const c = M.compile("void setup(){} void loop(){ int x = 0; x++; }")
  const vm = M.create(c.program); const t0 = Date.now(); vm.run(1000, {}); assert(Date.now() - t0 < 2000); assert(vm.time >= 1000)
}
// friendly compile errors
{
  const c = M.compile("void setup() {\n  pinMode(13, OUTPUT)\n}\nvoid loop() {}")
  assert(!c.ok); assert.strictEqual(c.errors[0].line, 3); assert(/semicolon/.test(c.errors[0].message))
  assert(/loop/.test(M.compile("void setup(){}").errors[0].message))
}
// runtime error: undeclared variable
{
  const c = M.compile("void setup(){ x = 3; } void loop(){}"); const vm = M.create(c.program); vm.run(1000, {})
  assert(/never declared/.test(vm.error))
}
// servo and pwm
{
  const { samples } = run(M.example("servo"), 400)
  assert(samples[399][9].servo > 20, "servo moved")
  const f = run(M.example("fade"), 300).samples
  assert(f[299][9].pwm > 0)
}
// a global that calls an endless loop stops with an error instead of hanging
{
  const c = M.compile("int spin(){ while (1) {} return 0; } int x = spin(); void setup(){} void loop(){}")
  assert(c.ok, JSON.stringify(c.errors))
  const vm = M.create(c.program), t0 = Date.now(); vm.run(1000, {})
  assert(/never finishes/.test(vm.error), vm.error)
  assert(Date.now() - t0 < 1000, "global set-up was cut off quickly")
}
// a huge Servo array is refused
{
  const c = M.compile("#include <Servo.h>\nServo s[200000]; void setup(){} void loop(){}"); const vm = M.create(c.program); vm.run(1000, {})
  assert(/too big/.test(vm.error), vm.error)
}
// a sketch that ends in the middle of a token returns quickly with ok or an error (HANCORE #12712)
{
  const body = "void setup(){} void loop(){}\n"
  const endings = ["5", "5u", "5UL", "5.0f", "0x", "0x1F", "0b", "0b101", "1e", "1e+", "1e-3", ".5", "\"abc", "'a", "\"ab\\", "/* never closed", "// last line", "#", "#define", "#define X"]
  for (const end of endings) {
    for (const src of [end, body + end, body + "int v = " + end]) {
      const t0 = Date.now(), c = M.compile(src)
      assert(Date.now() - t0 < 1000, "compile of " + JSON.stringify(src) + " was quick")
      assert(c.ok || (c.errors.length && c.errors[0].message), JSON.stringify(src) + " gives ok or an error")
    }
  }
  for (const bad of ["0x", "0b", "1e", "1e+", "\"abc", "'a", "/* never closed"]) assert(!M.compile(body + bad).ok, bad + " is an error")
  for (const good of ["int v = 0x1F;", "long v = 5UL;", "float v = 5.0f;", "float v = 1e-3;", "int v = 0b101;", "// last line"]) {
    const c = M.compile(body + good); assert(c.ok, good + " " + JSON.stringify(c.errors))
  }
  assert(/never closed/.test(M.compile(body + "char c = 'a").errors[0].message))
}
// runaway #defines and deep nesting stop with an error instead of hanging
{
  let grow = "#define A0 1\n"
  for (let k = 1; k <= 40; k++) grow += "#define A" + k + " (A" + (k - 1) + "+A" + (k - 1) + ")\n"
  const cases = [
    "#define A A\nint v = A; void setup(){} void loop(){}",
    "#define A B\n#define B A\nint v = A; void setup(){} void loop(){}",
    grow + "int v = A40; void setup(){} void loop(){}",
    "int v = " + "(".repeat(5000) + "1" + ")".repeat(5000) + "; void setup(){} void loop(){}",
    "void setup(){" + "{".repeat(5000) + "}".repeat(5000) + "} void loop(){}",
    "int v = " + "-".repeat(5000) + "1; void setup(){} void loop(){}"
  ]
  for (const src of cases) {
    const t0 = Date.now(), c = M.compile(src)
    assert(Date.now() - t0 < 1000, "compile was quick: " + src.slice(0, 40))
    assert(!c.ok && c.errors[0].message, src.slice(0, 40) + " is an error")
  }
  assert(M.compile("#define LED 13\n#define TWICE (LED*2)\nint v = TWICE; void setup(){} void loop(){}").ok)
}
console.log("mcu ok")
