#!/usr/bin/env node
// bin.mjs — standalone runner for the project-manager board, independent of
// the Copilot canvas/extension host. Anyone (a teammate without Copilot CLI,
// Codex, CI, a plain browser) can run:
//
//   node .github/extensions/project-manager/bin.mjs
//
// This shares board.mjs and server.mjs with the canvas extension and reads
// the same data/board.json, so this view and the Copilot canvas stay in
// sync automatically — there is only one source of truth.

import { startServer } from "./server.mjs";

async function main() {
    const { url, close } = await startServer();

    console.log(`Project Manager board running at: ${url}`);
    console.log("Reading/writing data/board.json — the same file the Copilot canvas uses.");
    console.log("Press Ctrl+C to stop.");

    const shutdown = async () => {
        console.log("\nShutting down...");
        await close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    console.error("Failed to start project-manager board:", err);
    process.exit(1);
});
