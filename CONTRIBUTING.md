# Contributing

`scripts/dev-install.sh` copies the checkout into `~/.config/omarchy/plugins/` and adds the app menu entry. Run the tests with `for t in tests/*.test.js; do node "$t" || break; done`. After any change to `qml/lib/Engine.js`, `Catalog.js`, `Mcu.js` or `EngineWorker.js`, run `python3 scripts/build-worker.py` and commit the regenerated `qml/lib/worker/*.mjs`.

Bugs found while building circuits are tracked in `docs/BUGS.md`.
