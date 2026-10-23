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
console.log("mcu ok")
