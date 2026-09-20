# Demo run of show

2026-09-20 · Saketh · What to click, in order, and what each beat proves. Rehearse from a tag, on the demo laptop, with a freshly restarted `./run-local.sh`.

## The 90 seconds

1. **Search.** In the catalogue panel (bottom left) type `an armchair`, press **Find**. The chip reads `armchair`; about a thousand matches.
2. **Hover the HERRÅKRA armchair.** Not the POÄNG: HERRÅKRA is the one listing with a real 3D model, so it is the one that looks like a chair in the room. The floor lights up with everywhere its centre can go.
3. **Click it, then click the lit floor.** It is placed at true scale (71 × 66 × 73 cm) and the Objects panel says *3D model loaded*. **R** turns it before placing; **Esc** puts it down. A click outside the lit floor does nothing, on purpose.
4. **Say it, literally.** Press the microphone in the panel, say the sentence, press again. Deepgram transcribes it on our server and it lands in the box exactly as if typed. Use it for one line, then go back to typing. **Test the microphone permission on the demo laptop beforehand.**
5. **Or type it.** `a reading chair by the window, under $400, 5 feet from any wall` → chips appear, the catalogue narrows, and the lit floor narrows with it. (The fixture room has no windows yet, so "by the window" is listed under the panel as a clause it could not use. That is the honest behaviour; say so or pick a sentence without a window.)
6. **Switch to the Studio** (one click, top of the panel): 260 × 200 cm with a table and a chair already in it. Search `a 3-seat sofa`, hover the EKTORP: **"EKTORP 3-seat sofa won't fit — there is no free floor big enough for its 218 × 88 cm footprint."** This is the beat no retailer can show: a store has to sell you something, and we can say your room cannot take it.

Everything else in the catalogue places as a true-scale box or cylinder in its listing's colour. That is fine, and honest: the pitch is about fit, not furniture photography.

## If something goes wrong

- **The model is slow or down:** the sentence still returns a search of its content words, never an error. Browsing, hovering and placing need no model at all.
- **Deepgram is down, or the key is missing:** the microphone falls back to the browser's own speech recognition; typing always works.
- **Elasticsearch is down:** search falls back to the in-memory catalogue with identical results. `X-Search-Backend` says which answered.
- **A save hiccups:** the chair stays where it was dropped and the status line says it is saving. Nothing is shown over the room, and room switching reopens after two failed saves.
- **`?dev=1`** adds raw per-rotation counts to the panel, for us, not for judges.

## Before going on

`git status` clean on the tag; `./setup.sh`; both suites and `npm run build` green; `python3 scripts/hammer_storage.py http://127.0.0.1:<port>` reports no server errors.
