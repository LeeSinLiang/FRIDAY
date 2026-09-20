# Public test release — 20 September 2026

## Release scope

The isolated `codex/friday-demo-release` branch combines the in-app scene designer, reviewed surface and compartment attachments, PC workspace demo GLBs, current room-gallery previews, and Cg Arch boundary corrections. It preserves the established editor and shopping routes. The new detailed workstation models and the separate lighting/sidebar branches are not included.

Public targets: https://friday-hackmit.vercel.app and https://friday-hackmit-api.vercel.app. Publication and hosted verification are pending until recorded below. The existing production is an older release.

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
- Browser, merged-main, deployment identity and demo recording evidence pending. Logs and recordings belong in `.scratch/demo-release/`.
