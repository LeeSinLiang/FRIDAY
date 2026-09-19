import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

let directory;
let board;
let server;
let clientScript;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'project-manager-test-'));
    for (const file of ['board.mjs', 'server.mjs']) {
        await copyFile(new URL(file, import.meta.url), join(directory, file));
    }
    board = await import(pathToFileURL(join(directory, 'board.mjs')));
    const { startServer } = await import(pathToFileURL(join(directory, 'server.mjs')));
    server = await startServer();
    const html = await (await fetch(server.url)).text();
    clientScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
});

after(async () => {
    if (server) await server.close();
    if (directory) await rm(directory, { recursive: true, force: true });
});

test('moving the first card to the final drop slot preserves the intended order on disk', async () => {
    const component = await board.addComponent('Final-slot regression');
    const tasks = [];
    for (const title of ['A', 'B', 'C']) tasks.push(await board.addTask(component.id, title));
    await board.moveTask(tasks[0].id, component.id, 3);
    assert.deepEqual(component.tasks.map(task => task.title), ['B', 'C', 'A']);
    const saved = JSON.parse(await readFile(join(directory, 'data/board.json'), 'utf8'));
    assert.deepEqual(saved.components.find(c => c.id === component.id).tasks.map(t => t.title), ['B', 'C', 'A']);
});

test('moving the first of two cards to the final slot swaps them', async () => {
    const component = await board.addComponent('Two-card regression');
    const first = await board.addTask(component.id, 'First');
    await board.addTask(component.id, 'Second');
    await board.moveTask(first.id, component.id, 2);
    assert.deepEqual(component.tasks.map(task => task.title), ['Second', 'First']);
});

test('cross-column moves preserve task fields and remove the source entry', async () => {
    const source = await board.addComponent('Source');
    const destination = await board.addComponent('Destination');
    const task = await board.addTask(source.id, 'Move me', 'william');
    await board.toggleTask(task.id, true);
    await board.moveTask(task.id, destination.id, 0);
    assert.equal(source.tasks.length, 0);
    assert.deepEqual(destination.tasks, [task]);
    assert.equal(destination.tasks[0].owner, 'william');
    assert.equal(destination.tasks[0].done, true);
});

// Exercise the shipped inline client's actual event wiring. Real pointer
// dragging is additionally verified in Chrome; this catches inert targets.
function clientContext() {
    const context = vm.createContext({
        document: {
            createElement() {
                return {
                    listeners: {}, children: [],
                    classList: { add() {}, remove() {} },
                    setAttribute() {},
                    addEventListener(name, handler) { this.listeners[name] = handler; },
                    appendChild(child) { this.children.push(child); },
                };
            },
            createTextNode(text) { return { text }; },
            querySelectorAll() { return []; },
        },
    });
    new vm.Script(clientScript); // Compile the emitted client, not just server.mjs.
    vm.runInContext(clientScript.slice(0, clientScript.lastIndexOf('\ninit(')), context);
    return context;
}

test('dropping onto the column body calls the move API exactly once', async () => {
    const context = clientContext();
    const result = await vm.runInContext(`
        (async () => {
            const calls = [];
            action = async (path, options) => calls.push({ path, body: JSON.parse(options.body) });
            dragTaskId = 'dragged-task';
            const column = renderColumn({ id: 'destination', name: 'Destination', tasks: [] });
            await column.listeners.drop({ preventDefault() {}, stopPropagation() {} });
            return JSON.stringify(calls);
        })()
    `, context);
    assert.deepEqual(JSON.parse(result), [{
        path: '/api/task/dragged-task/move', body: { componentId: 'destination', index: 0 },
    }]);
});

test('failed saves report an error without running the draft-clearing callback', async () => {
    const context = clientContext();
    const result = await vm.runInContext(`
        (async () => {
            let message = '';
            let cleared = false;
            api = async () => { throw new Error('Server unavailable'); };
            showStatus = text => { message = text; };
            render = () => {};
            const saved = await action('/api/task', { method: 'POST' }, () => { cleared = true; });
            return JSON.stringify({ saved, cleared, message });
        })()
    `, context);
    const { saved, cleared, message } = JSON.parse(result);
    assert.equal(saved, false);
    assert.equal(cleared, false);
    assert.match(message, /Could not save: Server unavailable/);
});

test('successful actions refresh the board even without event-stream delivery', async () => {
    const context = clientContext();
    const result = await vm.runInContext(`
        (async () => {
            const paths = [];
            let rendered = false;
            api = async path => { paths.push(path); return { title: 'Updated', components: [] }; };
            showStatus = () => {};
            render = () => { rendered = BOARD.title === 'Updated'; };
            await action('/api/task', { method: 'POST' });
            return JSON.stringify({ paths, rendered });
        })()
    `, context);
    assert.deepEqual(JSON.parse(result), { paths: ['/api/task', '/api/board'], rendered: true });
});

async function legacyFixture(data) {
    const fixture = await mkdtemp(join(directory, 'migration-'));
    await copyFile(new URL('board.mjs', import.meta.url), join(fixture, 'board.mjs'));
    await mkdir(join(fixture, 'data'));
    await writeFile(join(fixture, 'data/board.json'), JSON.stringify(data));
    const url = pathToFileURL(join(fixture, 'board.mjs')).href;
    const model = await import(url);
    return { model, url, state: await model.getBoard() };
}

test('legacy migration preserves cards and custom columns without deriving people from phases', async () => {
    const original = [
        { id: 'a', title: 'Existing task', phase: 'development', done: true, notes: 'Keep this' },
        { id: 'b', title: 'User task', phase: 'ideation', done: false },
        { id: 'c', title: 'Design task', phase: 'mvp', done: false },
    ];
    const { state } = await legacyFixture({
        title: 'My team plan',
        components: [
            { id: 'frontend', name: 'Frontend', tasks: original.slice(0, 2) },
            { id: 'design', name: 'Design / UX', tasks: original.slice(2) },
            { id: 'custom', name: 'Custom research', tasks: [] },
        ],
    });
    assert.equal(state.schemaVersion, 2);
    assert.equal(state.title, 'My team plan');
    assert.deepEqual(state.components.slice(0, 8).map(c => c.name), board.PROJECT_COMPONENTS.map(c => c.name));
    const frontend = state.components.find(c => c.name === 'Frontend & UX');
    assert.equal(frontend.id, 'frontend');
    assert.deepEqual(frontend.tasks, original.map(({ phase, ...task }) => ({ ...task, owner: 'unassigned' })));
    assert.equal(state.components.at(-1).id, 'custom');
});

test('phase-grid migration keeps all tasks and versioned boards retain later customisation', async () => {
    const { model, state, url } = await legacyFixture({
        title: 'Hackathon Project Plan',
        components: [{
            id: 'legacy-grid', name: 'Backend / API',
            phases: {
                ideation: { tasks: [{ id: 'one', title: 'One', done: false }] },
                mvp: { tasks: [{ id: 'two', title: 'Two', done: true }] },
            },
        }],
    });
    const api = state.components.find(c => c.name === 'Backend & API');
    assert.deepEqual(api.tasks.map(t => [t.id, t.owner, t.done]), [
        ['one', 'unassigned', false], ['two', 'unassigned', true],
    ]);
    assert.equal('phases' in api, false);
    await model.renameComponent(api.id, 'Team-specific API');
    await model.setTaskOwner('two', 'adelle');
    const removed = state.components.find(c => c.name === 'Spatial Solver');
    await model.removeComponent(removed.id);
    const reloaded = await (await import(url + '?reload')).getBoard();
    assert.equal(reloaded.components.some(c => c.name === 'Spatial Solver'), false);
    assert.equal(reloaded.components.find(c => c.id === api.id).name, 'Team-specific API');
    assert.equal(reloaded.components.find(c => c.id === api.id).tasks[1].owner, 'adelle');
});

test('owner API defaults to unassigned, persists assignment, and rejects phase names', async () => {
    const component = await board.addComponent('Owner API');
    const post = (path, body) => fetch(server.url + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const created = await (await post('api/task', { componentId: component.id, title: 'Assign me' })).json();
    assert.equal(created.owner, 'unassigned');
    await board.toggleTask(created.id, true);
    for (const owner of ['william', 'sin', 'saketh', 'adelle', 'unassigned']) {
        const response = await post(`api/task/${created.id}/owner`, { owner });
        assert.equal(response.status, 200);
        const task = await response.json();
        assert.equal(task.owner, owner);
        assert.equal(task.done, true);
    }
    const invalid = await post(`api/task/${created.id}/owner`, { owner: 'mvp' });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Unknown owner/);
    const saved = JSON.parse(await readFile(join(directory, 'data/board.json'), 'utf8'));
    assert.equal(saved.components.find(c => c.id === component.id).tasks[0].owner, 'unassigned');
    const meta = await (await fetch(server.url + 'api/meta')).json();
    assert.deepEqual(meta.owners.map(owner => owner.label), ['Unassigned', 'William', 'Sin', 'Saketh', 'Adelle']);
    assert.equal('phases' in meta, false);
});
