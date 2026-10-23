# OmaCircuitLab: handoff for 2026-10-23 (Claude)

Read this and `docs/HANDOFF-GROK-TOMORROW.md` (Grok's), then `docs/BUGS.md`. Dank spent the evening building circuits and finding bugs; keep doing that loop with him.

## Rules (all sessions)

- **No AI attribution in any commit or PR, in any repo.** No Co-Authored-By, no "Generated with". This is now in `~/.claude/CLAUDE.md`.
- Never message Grok while it's working (queued prompts don't send). Check `herdr agent get gd-grok` for idle, review its work, then send one complete message. At about 165K context, have it write a handoff.
- Grok owns `Engine.js`, `EngineWorker.js`, `tests/engine.test.js`, `TryIt.js`. Claude owns QML, `Catalog.js`, `PartArt.js`, `Bench.js`, `Lessons.js`, `Guide.js`, `Clamp.js`, `Mcu.js`. Specs go in `docs/ENGINE_CONTRACT*.md`.
- **After `omarchy restart shell`, always reopen the app** (`omarchy-shell shell summon io.github.dankestrick.omacircuitlab '{}'`). Dank called this out.
- When Grok has uncommitted engine edits, install from the committed tree so the app never gets a half-finished engine: `git archive HEAD | tar -x -C <scratch>` and run that copy's `scripts/dev-install.sh`.
- Building a lesson with `summon {"lesson":N,"build":true}` replaces Dank's bench. Back up `~/.local/share/omacircuitlab.json` first, then restart the shell, copy it back, and reopen.
- Screenshot: window geometry from `hyprctl clients -j` (title `OmaCircuitLab`), then `grim -g`. Only keyboard input can be simulated; Dank does the mouse. Don't move his cursor.
- GitHub `Dankestrick/OmaCircuitLab` exists. Local is **24+ commits ahead and not pushed**. Ask Dank before pushing.

## State

Everything works in the shell and all 12 test files pass (`for t in tests/*.test.js; do node $t; done`).

- **46 parts**, including AC power & signals (function generator, AC adapter, transformer, bridge rectifier), an oscilloscope, inductor, relay, 7805, 555, op-amp, Schottky, fuse, tilt switch, IR LED, photodiode, OmaNano, and OmaTiny.
- **31 lessons**. Lessons 25–31 are new: AC on a scope, AC to DC, 555 blinker, relay, 7805, OmaNano, and OmaTiny. All 31 checks pass against the engine. 25–27 were also checked in the app by screenshot (scope reads Vpp 9.52 / 60 Hz; rectifier 14.24 V with 0.10 V ripple).
- **Guide**: step-by-step steps are generated from each lesson's `build()` (`qml/lib/Guide.js`): exact holes, which leg goes where, and wire ends. Steps tick off as the bench matches, the next step's holes pulse green, and Grok's "Try it" steps (`TryIt.js`) follow.
- **Up to 3 breadboards** (`bench.boards`, − / + in the left panel). Boards 2 and 3 sit to the right with their own strips, named `b2:` and `b3:`.
- **Clamp meter**: a separate meter with a lead and a jaw that clips onto any wire or leg. Wire currents are solved in `Clamp.js` from part leg currents.
- **Buzzer**: animated rings, a BZZZ tag, and real sound behind the "♪ Sound" toolbar toggle (off by default). It uses QtMultimedia `SoundEffect` in `SoundPlayer.qml`, loaded only while sound is on.
- **Hover** notes live in the left panel. The V= A= W= numbers show in a small strip at the bench's bottom left.

## Today's important fixes (know why)

- **Shell crashes on any sketch**: Qt's JS engine segfaults on nested `yield*`. `Mcu.js` now compiles functions to flat steps run on an explicit stack (no generators). A trace compare against the old interpreter matched to the microsecond. Don't reintroduce generators anywhere that runs in the shell.
- **Robot spun in circles**: the arena now moves by `result.simTime` (sim seconds per step reply), not wall time.
- **Stale replies after Reset/Stop** are dropped (`staleReplies` in `Overlay.qml`). Run and any edit made while something is burnt reset the engine, so the parts come back fresh.
- `Catalog.si` was dropping zeros from whole numbers (470 Ω showed as "47 Ω").
- `PartView` wrote the motor spin into `live.angle` and froze the servo arm. The spin is now `live.spinAngle`.

## Next steps

1. Grok fixed the open bug overnight (`6b1f97d`): servo, tone(), motor driver, and robot car now follow a driving pin through a pressed button, switch, closed relay, or resistor up to 10 kΩ. A digital HIGH or LOW, and a relay that closes on this solve, already move the motor in that same solve. Dank retried his D9 → pushButton → servo circuit in the app on 2026-10-23 and it works.
2. Let Dank keep building and log everything in `docs/BUGS.md`. Dank tested clamp clipping, board +/−, the scope's scroll-to-change time/div, the tilt switch click, and the code editor on OmaNano/OmaTiny on 2026-10-23, and all of them work.
3. Ideas not done yet: current-flow dots on wires (Clamp.js now gives every wire's current, so this is feasible); a proximity link from IR LED to photodiode; schematic symbols in Inspect (ask Dank first); CPU measurement on the robot and scope lessons.
4. Marketplace prep: `omarchy-plugin-review` skill, `preview.png`, README screenshots, and push to GitHub when Dank says.

## Where things live

- `qml/Overlay.qml`: window, engine messaging (`loadEngine`, `stepDt` picks finer steps for fast AC), Guide wiring, sound.
- `qml/BenchView.qml`: drawing and every mouse interaction (clamp clipping is `clipping`/`clipTarget`), wheel steps per notch (`wheelAcc`).
- `qml/lib/Bench.js`: board geometry (`setBoards`, `holeAt`, `boardOrigin`) and the netlist.
- `qml/lib/Catalog.js`: parts, boxes, `mcuPinNumber(index, type)`, `mcuProfile(type)`, and `groundPin`.
- `qml/lib/Mcu.js`: sketch compiler and step machine. `Mcu.create(program, profile)`.
- `scripts/build-worker.py`: regenerates `qml/lib/worker/*.mjs` (committed, since the marketplace has no build step).
