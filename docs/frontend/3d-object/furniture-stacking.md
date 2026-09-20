# Furniture stacking

The editor allows a non-flat piece on one table or desk. A catalogue `table` or `desk` listing is explicitly marked `supportSurface`; the visual `Product.kind` is insufficient because decor and rugs can share its silhouette. The server re-derives the flag from the catalogue and rejects a forged carried value.

The supported piece's entire rotated footprint must lie inside the rotated support footprint, with a shared 0.000001 cm tolerance. Both pieces must be non-flat, the supported piece cannot itself be a support, and their combined heights must fit the room. This one-level rule lets the same 2D pose determine support consistently in the region solver, frontend validator, Python validator, and renderer. Pose remains `{xCm,zCm,yawRad}`. The renderer places the supported model's centre at support height plus half its own height; floor pieces still use half their own height.

The green placement mask uses the validator's support rule and is drawn at the table top for an explicit `on` clause. An unresolved `on` target lights no floor. The compiler currently has mock room references; the catalogue panel resolves the explicit “on the table” or “on the desk” phrase against a single matching support already in the live room. If there is no unique support, placement is unavailable. Other searches keep their compiled floor behavior.

The stageable pair is LISABO dining table (`ikea-702.211.42`, 140 × 78 × 74 cm) and Stone & Beam Modern Ombre 8 Inch vase (`abo-B07B8NVHX1`, 10.8 × 10.8 × 20.3 cm), both with deployed GLBs. `frontend/src/region/region.test.ts` compares lit and accepted stacked grid poses in both directions; `frontend/src/scene/stackingAgreement.test.ts` compares the actual catalogue pair with the Python validator. Eye-level manual verification uses `/?room=empty-room` and a private local stack.

This is a rectangular support-profile MVP. It does not infer usable tabletops or interior shelves from arbitrary meshes; the support flag and catalogue dimensions are the contract. Moving a support after placing a child can make the scene invalid and requires separate attachment semantics for more general furniture hierarchies.
