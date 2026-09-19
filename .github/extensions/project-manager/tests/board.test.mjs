import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-manager-'));
    const boardPath = path.join(directory, 'board.json');
    const children = [];
    t.after(async () => {
        await Promise.all(children.map(async (child) => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }));
        await fs.rm(directory, { recursive: true, force: true });
    });
    async function worker() {
        const child = fork(new URL('./worker.mjs', import.meta.url), [], {
            env: { ...process.env, PROJECT_MANAGER_BOARD_PATH: boardPath },
            stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
        children.push(child);
        await once(child, 'message');
        let nextId = 0;
        const waiting = new Map();
        child.on('message', ({ id, result, error }) => {
            const pending = waiting.get(id);
            if (!pending) return;
            waiting.delete(id);
            clearTimeout(pending.timer);
            if (error) pending.reject(new Error(error));
            else pending.resolve(result);
        });
        return (action, ...args) => new Promise((resolve, reject) => {
            const id = nextId++;
            const timer = setTimeout(() => {
                waiting.delete(id);
                reject(new Error(`Worker timed out: ${action}`));
            }, 10000);
            waiting.set(id, { resolve, reject, timer });
            child.send({ id, action, args });
        });
    }
    return { boardPath, directory, worker };
}

test('concurrent initialization and same/cross-process writes preserve every task', { timeout: 15000 }, async (t) => {
    const f = await fixture(t);
    const workers = await Promise.all(Array.from({ length: 4 }, () => f.worker()));
    const initial = await Promise.all(workers.map((call) => call('getBoard')));
    initial.forEach((board) => assert.deepEqual(board, initial[0]));
    const componentId = initial[0].components[0].id;
    let reading = true;
    const reader = (async () => {
        while (reading) {
            JSON.parse(await fs.readFile(f.boardPath, 'utf8'));
            await delay(1);
        }
    })();
    try {
        await Promise.all(workers.map((call, index) => call('batch', componentId, `writer-${index}`, 20)));
    } finally {
        reading = false;
        await reader;
    }
    const latest = await Promise.all(workers.map((call) => call('getBoard')));
    latest.forEach((board) => assert.deepEqual(board, latest[0]));
    const tasks = latest[0].components[0].tasks;
    assert.equal(tasks.length, 80);
    assert.equal(new Set(tasks.map((task) => task.title)).size, 80);
    assert.deepEqual(await fs.readdir(f.directory), ['board.json']);
});

test('fresh reads, failed operations and legacy migration do not corrupt disk', async (t) => {
    const f = await fixture(t);
    await fs.writeFile(f.boardPath, JSON.stringify({ title: 'Legacy', components: [
        { id: 'column', name: 'Column', phases: { mvp: { tasks: [{ id: 'task', title: 'Original', done: false }] } } },
    ] }));
    const call = await f.worker();
    const board = await call('getBoard');
    assert.equal(board.components[0].tasks[0].phase, 'mvp');
    assert.equal(board.components[0].phases, undefined);
    assert.deepEqual(await call('detached'), board);
    const before = await fs.readFile(f.boardPath, 'utf8');
    await assert.rejects(call('moveTask', 'task', 'missing', 0), /Unknown component/);
    assert.equal(await fs.readFile(f.boardPath, 'utf8'), before);
    await fs.writeFile(f.boardPath, '{broken');
    await assert.rejects(call('addComponent', 'Do not overwrite'));
    assert.equal(await fs.readFile(f.boardPath, 'utf8'), '{broken');
    await fs.writeFile(f.boardPath, before);
    await call('addComponent', 'Recovered');
    assert.equal((await call('getBoard')).components.length, 2);
});

test('an open SSE stream receives another process and external file replacements', { timeout: 15000 }, async (t) => {
    const f = await fixture(t);
    const observer = await f.worker();
    const writer = await f.worker();
    const url = await observer('start');
    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await fetch(new URL('events', url), { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    let buffer = '';
    async function nextBoard() {
        while (!buffer.includes('\n\n')) {
            const { value, done } = await reader.read();
            assert.equal(done, false);
            buffer += new TextDecoder().decode(value);
        }
        const boundary = buffer.indexOf('\n\n');
        const message = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        return JSON.parse(message.slice('data: '.length));
    }
    const initial = await nextBoard();
    await writer('addTask', initial.components[0].id, 'mvp', 'Other process');
    let changed = await nextBoard();
    assert.equal(changed.components[0].tasks[0].title, 'Other process');
    changed.title = 'External replacement';
    await fs.writeFile(`${f.boardPath}.replacement`, JSON.stringify(changed));
    await fs.rename(`${f.boardPath}.replacement`, f.boardPath);
    assert.equal((await nextBoard()).title, 'External replacement');
    await fs.writeFile(f.boardPath, '{temporarily invalid');
    await delay(650);
    changed.title = 'Recovered after invalid JSON';
    await fs.writeFile(`${f.boardPath}.replacement`, JSON.stringify(changed));
    await fs.rename(`${f.boardPath}.replacement`, f.boardPath);
    assert.equal((await nextBoard()).title, 'Recovered after invalid JSON');
    assert.equal(await observer('close'), 0);
    assert.equal((await reader.read()).done, true);
});

test('an occupied lock times out without stealing it or changing board data', { timeout: 10000 }, async (t) => {
    const f = await fixture(t);
    const call = await f.worker();
    await call('getBoard');
    const before = await fs.readFile(f.boardPath, 'utf8');
    await fs.writeFile(`${f.boardPath}.lock`, 'another owner');
    await assert.rejects(call('addComponent', 'Blocked'), /Board is locked/);
    assert.equal(await fs.readFile(`${f.boardPath}.lock`, 'utf8'), 'another owner');
    assert.equal(await fs.readFile(f.boardPath, 'utf8'), before);
    await fs.unlink(`${f.boardPath}.lock`);
    await call('addComponent', 'Recovered');
});
