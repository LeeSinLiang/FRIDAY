// board.mjs — durable data model for the hackathon project-manager Kanban
// board. Columns = components (horizontal axis). Each column holds an
// ordered stack of task cards (vertical axis = stack order / priority).
// Cards can move within a column (reorder up/down) or across columns
// (reassign to a different component). Each card carries a named owner;
// completion is tracked separately. Unassigned is an explicit default.
//
// The board is stored as a single committed JSON file so the whole team
// (and any agent/session) can share the plan through Git. Panels within
// one process share live state; restart after external board-file edits.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const BOARD_PATH = path.join(DATA_DIR, "board.json");

export const OWNERS = [
    { id: "unassigned", label: "Unassigned", color: "#59636e", tint: "#f5f6f8" },
    { id: "william", label: "William", color: "#2458c6", tint: "#eef3ff" },
    { id: "sin", label: "Sin", color: "#915500", tint: "#fff5df" },
    { id: "saketh", label: "Saketh", color: "#086a5e", tint: "#e8f7f1" },
    { id: "adelle", label: "Adelle", color: "#793fa4", tint: "#f7eefb" },
];

// Grounded in proposal.md and README.md; these describe scope, not progress
// or ownership. Named owners must be agreed with the team.
export const PROJECT_COMPONENTS = [
    { name: "Room & 3D Models", description: "Floor plans, room editor, GLB assets, and Three.js scene controls." },
    { name: "Spatial Solver", description: "Fit, collisions, clearance zones, and the valid-space overlay." },
    { name: "Catalogue & Elasticsearch", description: "Product records, dimensions, prices, assets, and filtered search." },
    { name: "AI Agent & Voice", description: "OpenAI agent tools, scene commands, and Deepgram voice input." },
    { name: "Frontend & UX", description: "React app shell, product browsing, constraint chips, and conversation." },
    { name: "Backend & API", description: "Django routes, shared data contracts, configuration, and persistence." },
    { name: "Cart & Visa IDX", description: "Cart review, explicit approval, and the IDX sandbox Match Key." },
    { name: "Integration & Demo", description: "End-to-end checks, deployment, documentation, and the demo journey." },
];

export const events = new EventEmitter();

function defaultBoard() {
    return {
        schemaVersion: 2,
        title: "FRIDAY · Project Plan",
        components: PROJECT_COMPONENTS.map((component) => ({
            id: randomUUID(),
            ...component,
            tasks: [],
        })),
    };
}

// Migrate both earlier board formats once. A phase never implies a person.
// Keep custom columns and all task data except the intentionally retired
// phase field. Subsequent user renames/removals are not reset on startup.
function migrateIfNeeded(board) {
    if (board.schemaVersion >= 2) return false;
    for (const component of board.components) {
        if (!Array.isArray(component.tasks) && component.phases) {
            const tasks = [];
            for (const phaseData of Object.values(component.phases)) {
                for (const task of phaseData.tasks || []) {
                    tasks.push({ ...task, done: !!task.done });
                }
            }
            component.tasks = tasks;
            delete component.phases;
        }
        for (const task of component.tasks) {
            if (!OWNERS.some(owner => owner.id === task.owner)) task.owner = "unassigned";
            delete task.phase;
        }
    }
    const legacyNames = {
        "Problem & Idea": "Integration & Demo",
        "Frontend": "Frontend & UX",
        "Design / UX": "Frontend & UX",
        "Backend / API": "Backend & API",
        "Data / AI-ML": "Catalogue & Elasticsearch",
        "Pitch & Demo": "Integration & Demo",
    };
    const original = board.components;
    const used = new Set();
    board.components = PROJECT_COMPONENTS.map(definition => {
        const matches = original.filter(component =>
            (legacyNames[component.name] || component.name) === definition.name);
        for (const component of matches) used.add(component);
        return {
            ...(matches[0] || { id: randomUUID() }),
            ...definition,
            tasks: matches.flatMap(component => component.tasks),
        };
    });
    board.components.push(...original.filter(component => !used.has(component)));
    if (board.title === "Hackathon Project Plan") board.title = "FRIDAY · Project Plan";
    board.schemaVersion = 2;
    return true;
}

let boardCache = null;

async function ensureLoaded() {
    if (boardCache) return boardCache;
    try {
        const raw = await fs.readFile(BOARD_PATH, "utf8");
        boardCache = JSON.parse(raw);
        if (migrateIfNeeded(boardCache)) await persist();
    } catch (err) {
        if (err.code !== "ENOENT") throw err;
        boardCache = defaultBoard();
        await persist();
    }
    return boardCache;
}

async function persist() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(BOARD_PATH, JSON.stringify(boardCache, null, 2) + "\n", "utf8");
}

function findComponent(board, componentId) {
    const component = board.components.find((c) => c.id === componentId);
    if (!component) throw new Error(`Unknown component: ${componentId}`);
    return component;
}

function findTask(board, taskId) {
    for (const component of board.components) {
        const index = component.tasks.findIndex((t) => t.id === taskId);
        if (index !== -1) return { component, index, task: component.tasks[index] };
    }
    throw new Error(`Unknown task: ${taskId}`);
}

function assertOwner(owner) {
    if (!OWNERS.some(person => person.id === owner)) throw new Error(`Unknown owner: ${owner}`);
}

function clampIndex(index, length) {
    if (typeof index !== "number" || Number.isNaN(index)) return length;
    return Math.max(0, Math.min(index, length));
}

async function mutate(fn) {
    const board = await ensureLoaded();
    const result = fn(board);
    await persist();
    events.emit("changed", board);
    return result ?? board;
}

export async function getBoard() {
    return ensureLoaded();
}

export async function addComponent(name) {
    if (!name || !name.trim()) throw new Error("Component name is required");
    return mutate((board) => {
        const component = { id: randomUUID(), name: name.trim(), tasks: [] };
        board.components.push(component);
        return component;
    });
}

export async function removeComponent(componentId) {
    return mutate((board) => {
        const idx = board.components.findIndex((c) => c.id === componentId);
        if (idx === -1) throw new Error(`Unknown component: ${componentId}`);
        board.components.splice(idx, 1);
    });
}

export async function renameComponent(componentId, name) {
    if (!name || !name.trim()) throw new Error("Component name is required");
    return mutate((board) => {
        const component = findComponent(board, componentId);
        component.name = name.trim();
    });
}

// Adds a task to the bottom of a column's stack.
export async function addTask(componentId, title, owner = "unassigned") {
    assertOwner(owner);
    if (!title || !title.trim()) throw new Error("Task title is required");
    return mutate((board) => {
        const component = findComponent(board, componentId);
        const task = { id: randomUUID(), title: title.trim(), done: false, owner };
        component.tasks.push(task);
        return task;
    });
}

export async function toggleTask(taskId, done) {
    return mutate((board) => {
        const { task } = findTask(board, taskId);
        task.done = typeof done === "boolean" ? done : !task.done;
        return task;
    });
}

export async function setTaskOwner(taskId, owner) {
    assertOwner(owner);
    return mutate((board) => {
        const { task } = findTask(board, taskId);
        task.owner = owner;
        return task;
    });
}

export async function removeTask(taskId) {
    return mutate((board) => {
        const { component, index } = findTask(board, taskId);
        component.tasks.splice(index, 1);
    });
}

// Moves a task card to `targetComponentId` at `targetIndex` in that column's
// stack. Works for both cross-column moves (drag between components) and
// same-column reordering (drag/up/down within the stack).
export async function moveTask(taskId, targetComponentId, targetIndex) {
    return mutate((board) => {
        const { component: sourceComponent, index: sourceIndex, task } = findTask(board, taskId);
        const targetComponent = findComponent(board, targetComponentId);
        const sameColumn = sourceComponent.id === targetComponent.id;
        // Drop slots refer to the original stack, including its final slot.
        let insertAt = clampIndex(targetIndex, targetComponent.tasks.length);
        sourceComponent.tasks.splice(sourceIndex, 1);
        // If we just removed the card from earlier in the same column, later
        // target indexes shift left by one to land in the intended slot.
        if (sameColumn && sourceIndex < insertAt) insertAt = Math.max(0, insertAt - 1);
        targetComponent.tasks.splice(insertAt, 0, task);
        return task;
    });
}

// Convenience swap-with-neighbor helpers for up/down controls.
export async function moveTaskStep(taskId, direction) {
    return mutate((board) => {
        const { component, index } = findTask(board, taskId);
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= component.tasks.length) return component.tasks[index];
        const [task] = component.tasks.splice(index, 1);
        component.tasks.splice(targetIndex, 0, task);
        return task;
    });
}
