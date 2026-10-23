#!/usr/bin/env python3
"""Write the buzzer tone loops into qml/sounds.

Stdlib only. Each file is 16-bit mono at 22050 Hz, quiet, and about a
quarter second. The length is a whole number of cycles so a loop has no
click. Names are integer hertz: 2300, plus every semitone from C3 (131)
to C7 (2093). tones.json is the list the player uses to pick the nearest.
"""

import json
import math
import pathlib
import wave

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "qml" / "sounds"
RATE = 22050
AMP = 0.2
TARGET = 0.25


def frequencies():
    found = []
    for n in range(49):
        found.append(int(round(440.0 * math.pow(2.0, (n - 21) / 12.0))))
    found.append(2300)
    return sorted(set(found))


def samples_for(freq):
    cycles = max(1, int(round(TARGET * freq)))
    count = max(1, int(round(RATE * cycles / float(freq))))
    return cycles, count


def write_tone(path, freq):
    cycles, count = samples_for(freq)
    peak = int(AMP * 32767)
    frames = bytearray()
    for i in range(count):
        sample = int(round(peak * math.sin(2.0 * math.pi * cycles * i / count)))
        if sample > 32767:
            sample = 32767
        if sample < -32768:
            sample = -32768
        frames += sample.to_bytes(2, "little", signed=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(frames)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    freqs = frequencies()
    if freqs[0] != 131 or 2093 not in freqs or 2300 not in freqs:
        raise SystemExit("tone list is missing C3, C7, or 2300: %s" % freqs[:3])
    for hz in freqs:
        write_tone(OUT / ("tone-%d.wav" % hz), hz)
    (OUT / "tones.json").write_text(json.dumps(freqs, indent=2) + "\n")
    total = sum(p.stat().st_size for p in OUT.iterdir())
    print("%d tones, %d bytes" % (len(freqs), total))
    if total > 1000 * 1000:
        raise SystemExit("sounds are over 1 MB")


if __name__ == "__main__":
    main()
