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
2. **Hover the HERRÅKRA armchair.** It is the one armchair with a real 3D model. The floor lights up green with everywhere its centre can go. Moving onto a card shifts the list down a little as the explanation appears; settle the pointer before clicking.
3. **Click it, then click the lit floor.** It is placed at true scale (71 × 66 × 73 cm). **R** turns it before placing; **Esc** puts it down. A click on a wall, or on floor that is not lit, does nothing, on purpose.
4. **Ask for too much.** Type `a reading chair by the window, under $400, 5 feet from any wall`, hover a chair: **"won't fit — needs 373 cm of width, this room has 334 cm."** This is the beat no retailer can show: a store has to sell you something, and we can say your room cannot take it, and why.
5. **Say the real one, literally.** Press the microphone, say **"a reading chair by the window, under four hundred dollars, four feet from any wall"**, press again. Deepgram transcribes it on our server and it lands in the box as if typed. Chips: `armchair` · `under $400` · `near the window` · `4 ft from any wall`. Hover HERRÅKRA: the lit floor is now a strip down the middle of the room (265 positions in the best turn, against thousands unconstrained). Or type it.
6. **Place it in the strip.**

Until the room describes its windows, the panel says it could not use the window clause. That is the honest behaviour; if openings have landed by the demo, the strip also hugs the window and this note goes.

The Studio "EKTORP won't fit" beat lives in the legacy app (`?legacy`), which still works; beat 4 replaces it in the main editor. Everything without a model places as a true-scale stand-in in its listing's colour. That is fine, and honest: the pitch is about fit, not furniture photography.

## First real-GPU run: what to check (MacBook Pro, Chrome)

Everything so far has been seen only in headless Chrome on software WebGL. Report each of these, not "it works":

1. **The lit floor.** Hover HERRÅKRA in the Cg Arch room. Is the region **green**, readable at first-person eye level, steady? Not white or washed out, not shimmering or z-fighting with the floor as you look around. If it looks different from `.scratch`-style screenshots in the PRs (#36), **that is the top bug on the board**: tell Saketh at once, with a screenshot.
2. **Room load.** Does the Cg Arch room appear, and how many seconds from pressing Enter to a drawn room (68 MB from local disk)?
3. **The windows.** PlayCanvas supports the glass's transmission extension and the editor enables it. Does the big glazing read as a window from inside, or as a flat pale panel? (In software rendering it looks like a pale panel.)
4. **Frame rate** with the room and three or four placed items, looking around. Chrome: DevTools → Rendering → *Frame rendering stats*. Anything under 30 fps, say so. **If it is bad, transmission is the first lever to pull.** The glass costs one full-screen copy of the rendered scene per camera per frame (not one per pane): it is switched on by the single line `camera.camera!.requestSceneColorMap(true)` in `frontend/src/scene/playcanvas/runtime.ts`. Without it the windows go flat, which is a trade we would take over a stuttering demo. That file is Sin's; tell him and Saketh the number before anyone changes it. The 4.3 fps seen in headless testing was software rendering and means nothing.
5. **Microphone**, with permission already granted in that profile: press, speak, press. With `?dev=1` the panel must say `ANSWERED BY: deepgram`.
6. **A save.** Place a chair: header says *Saved*, reload the page, the chair is still there.

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

**Once this run has been rehearsed end to end on this machine, `main` is frozen** (see `AGENTS.md`). `git status` clean on the tag; `./setup.sh`; both suites and `npm run build` green; `python3 scripts/hammer_storage.py http://127.0.0.1:<port>` reports no server errors.
