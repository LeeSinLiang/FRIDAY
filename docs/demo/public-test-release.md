# Public test release — 20 September 2026

## Release scope

The isolated `codex/friday-demo-release` branch combines the in-app scene designer, reviewed surface and compartment attachments, PC workspace demo GLBs, current room-gallery previews, and Cg Arch boundary corrections. It preserves the established editor and shopping routes. The new detailed workstation models and the separate lighting/sidebar branches are not included.

Public targets: https://friday-hackmit.vercel.app and https://friday-hackmit-api.vercel.app. Both services are published from release commit `5afe3929723fa2e129b96d47a208e35001728244` (PR #103). Use the stable public URL: immutable frontend deployment URLs are not trusted CSRF origins.

## Tester workflow

1. Open `/rooms` and choose Empty room, or open `/room/empty-room` directly.
2. Open catalogue search and enter: “Place a PC workspace desk near the center with a monitor on its desktop. Add an open support demo cabinet beside it with a box inside its middle compartment.”
3. Keep the room open while the designer reads images and checks a preview. The saved result should place the monitor on the desktop and the box inside the cabinet.
4. Move or rotate the desk, then undo, redo and reload. Attached items should follow their parent and remain elevated.
5. Open `/room/london-skyscraper`; use the existing floor arrows to move through reviewed levels. Floor layouts are independent.

This is a test release. Support targets are reviewed metadata, not arbitrary mesh inference; nested attachments and closed-door insertion are unsupported. Current workstation models are generic demo proxies. Cg Arch remains unavailable publicly unless its licensed model is separately provisioned. Purchases still require the existing explicit sandbox checkout flow.

## Verification before publication

- Fresh main: backend 281 tests, OK (skipped=5); frontend 181+25 passed; build 4.15s.
- Combined release: backend `Ran 390 tests in 14.199s / OK (skipped=5)`; frontend 195+25 passed; build 3.52s.
- Fresh merged main: `uv run python manage.py test` → `Ran 390 tests in 12.545s / OK (skipped=5)`; `npm test` → 195+25 passed; `VERCEL=1 npm run build` → `built in 2.55s`; board 6 passed.
- Local browser: real AI support placement, desk drag/90-degree rotation, undo/redo and reload passed at revision5.
- Hosted `/room/london-skyscraper?floor=C32`: real designer job `f8e872a6-f2a4-41ac-b801-9c94ff1498fa` saved four objects using reviewed supports, monitor Y75 cm and cabinet box Y51.5 cm. Drag and rotation carried the monitor, undo/redo persisted correctly, and the floor was restored to its original empty state at revision8. Existing cart was unchanged.
- The AI final report disclosed a partially cropped desk in its capture. The subsequent human-directed browser framing shows the complete desk, monitor, cabinet and contained box. This is not a claim of automatically complete visual validation.
- Live frontend DOM build and direct/rewritten API health match source identity `778d7e434fa26ce392a6a4179af5ed496bac83053f345e6cd119173e9664b1bd`. Hosted GLB bytes for desk, monitor, cabinet and full building match source hashes.

## Published pair

| Service | Deployment |
| --- | --- |
| Frontend | `dpl_J8y7o8sywLSzK59oxbvH1wa66ytn` |
| API | `dpl_2nECz4rWZ7SwT5voZTj6NgNuxht9` |

Both are READY and identify source commit `5afe392`. Production migration `api.0005_scenedesignjob` is applied. Production API provider credentials were configured without committing or exposing them.

Main subsequently advanced to lighting merge `46930f6`. This release does not claim that later merge is deployed or verified; the parent integrator was notified. The detailed workstation replacement and voice follow-up remain separate tasks.

## Recording and cleanup

The 1920x1080 H.264 demo is `.scratch/demo-release/FRIDAY-public-demo.mp4` in the release worktree. It shows the hosted prompt, supported result, drag/rotate/undo/redo and floor navigation. AI waiting time is removed and labelled; generic prototype assets remain. Credits identify 99.Miles (London, CC BY 4.0, furniture removed by William Xu) and Kenney Furniture Kit (CC0). No microphone audio or private account screens were captured.

The source frames, structured acceptance evidence, SHA-256 checks and build logs are under `.scratch/demo-release/`. The task-owned canonical servers on 5286/8286 were stopped; the public gallery is left ready for testers. The temporary credential copies used for deployment/migration were removed after verification.
