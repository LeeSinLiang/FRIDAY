# Demo run of show

2026-09-20 · Saketh · What to click, in order, and what each beat proves. Rehearse from a tag, on the demo laptop, with a freshly restarted `./run-local.sh`.

## Set-up, on the presenting machine

- **Browser: Chrome.** Everything has been tested in Chrome only. Safari's WebGL and WebGPU paths differ, and its `getUserMedia` behaves differently. Do not present from Safari.
- **Room: the Cg Arch living room.** Put `VITE_DEFAULT_ROOM_ID=cg-arch-interior` in the root `.env` and start with **`./run-local.sh`**, which is what hands `.env` to Vite (verified: the bare URL then opens *Empty Interior Scene 2*). A bare `npm run dev` does not read the root `.env` and opens the empty room. Belt and braces: present from **`/?room=cg-arch-interior`**, which needs neither.
- **The room's 68 MB model is not in Git.** `./scripts/import-room.sh ~/Downloads/friday-cg-arch-room.zip` installs it; it writes only the gitignored `shared/rooms/cg-arch-interior/assets/room.glb` and checks every file's hash. Restart the stack afterwards.
- **Stale room cookie: only matters on `?legacy`.** The PlayCanvas editor names its room on every request (`?roomId=`), so a leftover `friday_room` cookie cannot send it to the wrong room. The legacy app does read that cookie; if you open `?legacy` as a fallback, pick the room explicitly or clear the cookie first.
- **Start from an empty room.** A layout is saved per browser session, so rehearsal furniture will still be there. Remove it (select, *Remove from room*) or use a fresh Chrome profile, then grant the microphone in that profile.
- Voice: see "Voice, on the demo machine" below.

## The 90 seconds

1. **Search.** In the catalogue panel (bottom left) type `an armchair`, press **Find**. The chip reads `armchair`; about a thousand matches.
2. **Hover the HERRÅKRA armchair.** It is the one armchair with a real 3D model. The floor lights up green with everywhere its centre can go.
3. **Click it, then click the lit floor.** It is placed at true scale (71 × 66 × 73 cm). **R** turns it before placing; **Esc** puts it down. A click on a wall, or on floor that is not lit, does nothing, on purpose.
4. **Ask for too much.** Type `a reading chair by the window, under $400, 5 feet from any wall`, hover HERRÅKRA: **"won't fit — needs 371 cm of width, this room has 334 cm."** (POÄNG says 373.) This is the beat no retailer can show: a store has to sell you something, and we can say your room cannot take it, and why.
5. **Say the real one, literally.** Press the microphone, say **"a reading chair by the window, under four hundred dollars, four feet from any wall"**, press again. Deepgram transcribes it on our server and it lands in the box as if typed. Chips: `armchair` · `under $400` · `near the window` · `4 ft from any wall`. Hover HERRÅKRA: the lit floor shrinks to a small patch in front of the big window, centred between the side walls: 75 positions in the best turn, against 265 without the window and thousands unconstrained. That patch is the whole pitch: the room, not the catalogue, answered. Or type it.
6. **Show it from above.** Press **Floor plan** (top left). The room becomes a plan: the pale rectangle is the floor we have verified, and the hero sentence's lit patch is a small green rectangle on the window's side of it, centred between the side walls. From above a green patch reads far better than from eye level, and the audience sees at a glance that the room, not the catalogue, produced it. Hover HERRÅKRA again if the patch is not showing.
7. **Place it in the patch**, in either view: click the card, then click the green. The chair lands in front of the window. Press **Explore** to go back to eye level and look at it. If the window wall is out of frame at eye level, drag to look right; closing the right-hand panel (×) uncovers the floor in front of it.

The room knows its window because we measured it from the room's own model (`shared/rooms/cg-arch-interior/openings.json`). Any other room says, under the panel, that it could not use the window clause, which is the honest answer for a room nobody has measured.

The Studio "EKTORP won't fit" beat lives in the legacy app (`?legacy`), which still works; beat 4 replaces it in the main editor. Everything without a model places as a true-scale stand-in in its listing's colour. That is fine, and honest: the pitch is about fit, not furniture photography.

## First real-GPU run: what to check (MacBook Pro, Chrome)

Everything so far has been seen only in headless Chrome on software WebGL. Report each of these, not "it works":

1. **The lit floor.** Hover HERRÅKRA in the Cg Arch room. Is the region **green**, readable at first-person eye level, steady? Not white or washed out, not shimmering or z-fighting with the floor as you look around. If it looks different from `.scratch`-style screenshots in the PRs (#36), **that is the top bug on the board**: tell Saketh at once, with a screenshot.
2. **Room load.** Does the Cg Arch room appear, and how many seconds from pressing Enter to a drawn room (68 MB from local disk)?
3. **The windows.** PlayCanvas supports the glass's transmission extension and the editor enables it. Does the big glazing read as a window from inside, or as a flat pale panel? (In software rendering it looks like a pale panel.)
4. **Frame rate** with the room and three or four placed items, looking around. Chrome: DevTools → Rendering → *Frame rendering stats*. Anything under 30 fps, say so. **If it is bad, transmission is the first lever to pull.** The glass costs one full-screen copy of the rendered scene per camera per frame (not one per pane): it is switched on by the single line `camera.camera!.requestSceneColorMap(true)` in `frontend/src/scene/playcanvas/runtime.ts`. Without it the windows go flat, which is a trade we would take over a stuttering demo. That file is Sin's; tell him and Saketh the number before anyone changes it. The 4.3 fps seen in headless testing was software rendering and means nothing.
5. **Microphone**, with permission already granted in that profile: press, speak, press. With `?dev=1` the panel must say `ANSWERED BY: deepgram`.
6. **A save.** Place a chair: header says *Saved*, reload the page, the chair is still there.
7. **Does the hero patch read from the back of a room?** Type the full hero sentence (four feet) and hover HERRÅKRA. The lit patch in front of the window is small on purpose: 75 positions in the best turn. Stand where the audience will be, or look at the projector from the far wall. **If it is not clearly visible at presenting distance, switch the sentence to three feet** (240 / 255 positions, a patch about three times the size) and say "three feet" on stage. Whoever is on that laptop makes this call; nobody needs to be asked.
8. **Click the green.** With the hero sentence typed, pick up HERRÅKRA and click **on the lit patch**, once at eye level and once in **Floor plan**. It must place, first time. Then click bare floor next to the patch: nothing must happen. Until 2026-09-20 01:20 the patch was drawn mirrored front to back, so the green did nothing and bare floor a metre away accepted the click; software rendering hid it for hours because big regions overlap their own mirror. If a click on green ever does nothing, stop and tell Saketh.

## If something goes wrong

- **The model is slow or down:** the sentence still returns a search of its content words, never an error. Browsing, hovering and placing need no model at all.
- **Deepgram is down, or the key is missing:** the microphone falls back to the browser's own speech recognition; typing always works.
- **Elasticsearch is down:** search falls back to the in-memory catalogue with identical results. `X-Search-Backend` says which answered.
- **A save hiccups:** the chair stays where it was dropped, as a plain box until the server accepts it, and the save is retried by itself. The header may read *Disconnected* for a second or two; do not press anything.
- **`?dev=1`** adds raw per-rotation counts to the panel, for us, not for judges.

## Voice, on the demo machine

- **Set `TRANSCRIBE_BACKEND=deepgram` and `DEEPGRAM_API_KEY` in the demo machine's `.env`.** The default is `browser`. If it is left at the default we demo the Web Speech API in front of the Deepgram judges.
- **Prove it on stage with `?dev=1`.** The panel then shows `voice configured: deepgram · last transcript ANSWERED BY: deepgram`. If Deepgram hiccups, that press is answered by the browser and says so; the next press goes back to Deepgram.
- **The microphone needs a secure context.** `getUserMedia` works on `localhost` / `127.0.0.1` and over HTTPS. It is **blocked on a plain-HTTP LAN address** such as `http://192.168.x.x:5173`. Present from the machine running the stack. If another machine must be the screen, tunnel with HTTPS or mirror the display; do not browse to the demo laptop's IP.
- Accept the microphone permission prompt once, ahead of time, in the browser profile you will present from.

## Before going on

**Once this run has been rehearsed end to end on this machine, `main` is frozen** (see `AGENTS.md`). `git status` clean on the tag; `./setup.sh`; both suites and `npm run build` green; **`(cd backend && uv run python -m catalogue.index_check)` says `AGREE`** (if not, `uv run python -m catalogue.ingest`, restart the API, check again: a stale index hands back listings without their models); `python3 scripts/hammer_storage.py http://127.0.0.1:<port>` reports no server errors.
