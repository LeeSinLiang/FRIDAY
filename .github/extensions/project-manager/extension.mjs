// Extension: project-manager
// A hackathon project-manager Kanban board: components (Frontend, Backend,
// AI/ML, Design, Pitch, etc.) form the horizontal axis (columns). Each
// column holds an ordered stack of task cards — the vertical axis manages
// stack order / priority within a component. Cards can be dragged between
// columns (reassign to a different component) or reordered up/down within
// a column. Each card carries a phase tag (ideation / mvp / development).
// Backed by a single committed JSON file (data/board.json) so the whole
// team and every agent session see the same plan.

import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { startServer } from "./server.mjs";
import {
    getBoard,
    addComponent,
    removeComponent,
    renameComponent,
    addTask,
    toggleTask,
    removeTask,
    setTaskPhase,
    moveTask,
    moveTaskStep,
    PHASES,
} from "./board.mjs";

// One local HTTP server per open canvas instance; all instances read/write
// the same board.json and are kept in sync live via SSE.
const servers = new Map();

function wrap(fn) {
    return async (ctx) => {
        try {
            return await fn(ctx.input || {});
        } catch (err) {
            throw new CanvasError("project_manager_error", String(err && err.message ? err.message : err));
        }
    };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "project-manager",
            displayName: "Project Manager",
            description:
                "Hackathon project-manager Kanban board. Columns are components (Frontend, Backend, AI/ML, Design, Pitch, etc.); each column holds an ordered stack of task cards tagged with a phase (ideation/mvp/development). Move cards up/down within a column to reorder priority, or between columns to reassign work.",
            inputSchema: { type: "object", properties: {} },
            actions: [
                {
                    name: "get_board",
                    description: "Read the current project board: all components (columns) and their ordered task stacks.",
                    handler: wrap(async () => getBoard()),
                },
                {
                    name: "add_component",
                    description: "Add a new component/column to the board (e.g. 'Frontend', 'Backend', 'ML Model').",
                    inputSchema: {
                        type: "object",
                        properties: { name: { type: "string" } },
                        required: ["name"],
                    },
                    handler: wrap(async ({ name }) => addComponent(name)),
                },
                {
                    name: "remove_component",
                    description: "Remove a component/column from the board by its id.",
                    inputSchema: {
                        type: "object",
                        properties: { componentId: { type: "string" } },
                        required: ["componentId"],
                    },
                    handler: wrap(async ({ componentId }) => {
                        await removeComponent(componentId);
                        return { ok: true };
                    }),
                },
                {
                    name: "rename_component",
                    description: "Rename an existing component/column.",
                    inputSchema: {
                        type: "object",
                        properties: { componentId: { type: "string" }, name: { type: "string" } },
                        required: ["componentId", "name"],
                    },
                    handler: wrap(async ({ componentId, name }) => {
                        await renameComponent(componentId, name);
                        return { ok: true };
                    }),
                },
                {
                    name: "add_task",
                    description:
                        "Add a task card to the bottom of a component's stack, tagged with a phase ('ideation', 'mvp', or 'development').",
                    inputSchema: {
                        type: "object",
                        properties: {
                            componentId: { type: "string" },
                            phase: { type: "string", enum: PHASES },
                            title: { type: "string" },
                        },
                        required: ["componentId", "phase", "title"],
                    },
                    handler: wrap(async ({ componentId, phase, title }) => addTask(componentId, phase, title)),
                },
                {
                    name: "toggle_task",
                    description: "Mark a task card done/not-done by id. Omit 'done' to flip its current state.",
                    inputSchema: {
                        type: "object",
                        properties: { taskId: { type: "string" }, done: { type: "boolean" } },
                        required: ["taskId"],
                    },
                    handler: wrap(async ({ taskId, done }) => toggleTask(taskId, done)),
                },
                {
                    name: "set_task_phase",
                    description: "Change a task card's phase tag ('ideation', 'mvp', or 'development').",
                    inputSchema: {
                        type: "object",
                        properties: {
                            taskId: { type: "string" },
                            phase: { type: "string", enum: PHASES },
                        },
                        required: ["taskId", "phase"],
                    },
                    handler: wrap(async ({ taskId, phase }) => setTaskPhase(taskId, phase)),
                },
                {
                    name: "move_task",
                    description:
                        "Move a task card to a specific component (column) and stack position (0 = top). Use for cross-column moves or precise reordering.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            taskId: { type: "string" },
                            componentId: { type: "string" },
                            index: { type: "integer", minimum: 0 },
                        },
                        required: ["taskId", "componentId", "index"],
                    },
                    handler: wrap(async ({ taskId, componentId, index }) => moveTask(taskId, componentId, index)),
                },
                {
                    name: "move_task_step",
                    description: "Move a task card one position up or down within its current column's stack.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            taskId: { type: "string" },
                            direction: { type: "string", enum: ["up", "down"] },
                        },
                        required: ["taskId", "direction"],
                    },
                    handler: wrap(async ({ taskId, direction }) => moveTaskStep(taskId, direction)),
                },
                {
                    name: "remove_task",
                    description: "Remove a task card by id.",
                    inputSchema: {
                        type: "object",
                        properties: { taskId: { type: "string" } },
                        required: ["taskId"],
                    },
                    handler: wrap(async ({ taskId }) => {
                        await removeTask(taskId);
                        return { ok: true };
                    }),
                },
            ],
            // Idempotent: re-opens with the same instanceId (after a provider
            // reconnect or extensions_reload) reuse the same loopback server;
            // the underlying board data lives in board.json, not in memory
            // keyed by instanceId.
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer();
                    servers.set(ctx.instanceId, entry);
                }
                return {
                    title: "Project Manager",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await entry.close();
                }
            },
        }),
    ],
});
