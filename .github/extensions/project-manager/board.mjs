// board.mjs — durable data model for the hackathon project-manager Kanban
// board. Columns = components (horizontal axis). Each column holds an
// ordered stack of task cards (vertical axis = stack order / priority).
// Cards can move within a column (reorder up/down) or across columns
// (reassign to a different component). Each card carries a `phase` tag
// (ideation / mvp / development) so phase is visible without constraining
// where the card lives.
//
// The board is stored as a single committed JSON file so the whole team
// (and any agent/session) sees the same state. It is keyed by nothing but
// its own file path — never by instanceId — so multiple open canvas panels
// always reflect the same underlying project plan.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const BOARD_PATH = path.join(DATA_DIR, "board.json");

export const PHASES = ["ideation", "mvp", "development"];
export const PHASE_LABELS = {
    ideation: "Ideation",
    mvp: "MVP",
    development: "Development",
};

export const events = new EventEmitter();

function defaultBoard() {
    const seedComponents = [
        "Problem & Idea",
        "Frontend",
        "Backend / API",
        "Data / AI-ML",
        "Design / UX",
        "Pitch & Demo",
    ];
    return {
        title: "Hackathon Project Plan",
        components: seedComponents.map((name) => ({
            id: randomUUID(),
            name,
            tasks: [],
        })),
    };
}

// Migrate the earlier phase-grid schema (component.phases.{phase}.tasks) to
// the flat, ordered task-stack schema (component.tasks[], each tagged with
// a `phase`). Runs once on load if the old shape is detected.
function migrateIfNeeded(board) {
    let migrated = false;
    for (const component of board.components) {
        if (!Array.isArray(component.tasks) && component.phases) {
            const tasks = [];
            for (const phase of PHASES) {
                const phaseData = component.phases[phase];
                if (!phaseData) continue;
                for (const task of phaseData.tasks || []) {
                    tasks.push({ id: task.id, title: task.title, done: !!task.done, phase });
                }
            }
            component.tasks = tasks;
            delete component.phases;
            migrated = true;
        }
    }
    return migrated;
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

function assertPhase(phase) {
    if (!PHASES.includes(phase)) throw new Error(`Unknown phase: ${phase}`);
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
export async function addTask(componentId, phase, title) {
    assertPhase(phase);
    if (!title || !title.trim()) throw new Error("Task title is required");
    return mutate((board) => {
        const component = findComponent(board, componentId);
        const task = { id: randomUUID(), title: title.trim(), done: false, phase };
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

export async function setTaskPhase(taskId, phase) {
    assertPhase(phase);
    return mutate((board) => {
        const { task } = findTask(board, taskId);
        task.phase = phase;
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
        sourceComponent.tasks.splice(sourceIndex, 1);
        const sameColumn = sourceComponent.id === targetComponent.id;
        let insertAt = clampIndex(targetIndex, targetComponent.tasks.length);
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
