// server.mjs — loopback HTTP server that renders the project-manager Kanban
// board and exposes JSON endpoints the iframe uses. One server per open
// canvas instance; they all read/write the same underlying board.json, so
// any number of open panels stay in sync (pushed live via SSE).

import { createServer } from "node:http";
import {
    getBoard,
    addComponent,
    removeComponent,
    addOwnedTask as addTask,
    setTaskPhase,
    toggleTask,
    removeTask,
    setTaskOwner,
    renameComponent,
    moveTask,
    moveTaskStep,
    OWNERS,
} from "./board.mjs";
import { events, watchBoard } from "./board.mjs";

function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
        "Cache-Control": "no-store",
    });
    res.end(payload);
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        return {};
    }
}

export async function startServer() {
    await getBoard();
    const sseClients = new Set();

    const onChanged = (board) => {
        const payload = `data: ${JSON.stringify(board)}\n\n`;
        for (const res of sseClients) res.write(payload);
    };
    events.on("changed", onChanged);

    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://127.0.0.1");

            if (req.method === "GET" && url.pathname === "/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
                res.end(renderHtml());
                return;
            }

            if (req.method === "GET" && url.pathname === "/api/meta") {
                json(res, 200, { owners: OWNERS });
                return;
            }

            if (req.method === "GET" && url.pathname === "/api/board") {
                json(res, 200, await getBoard());
                return;
            }

            if (req.method === "GET" && url.pathname === "/events") {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                });
                res.write(`data: ${JSON.stringify(await getBoard())}\n\n`);
                sseClients.add(res);
                req.on("close", () => sseClients.delete(res));
                return;
            }

            if (req.method === "POST" && url.pathname === "/api/component") {
                const { name } = await readJsonBody(req);
                json(res, 200, await addComponent(name));
                return;
            }

            if (req.method === "DELETE" && url.pathname.startsWith("/api/component/")) {
                const componentId = url.pathname.split("/").pop();
                await removeComponent(componentId);
                json(res, 200, { ok: true });
                return;
            }

            if (
                req.method === "POST" &&
                url.pathname.startsWith("/api/component/") &&
                url.pathname.endsWith("/rename")
            ) {
                const componentId = url.pathname.split("/")[3];
                const { name } = await readJsonBody(req);
                await renameComponent(componentId, name);
                json(res, 200, { ok: true });
                return;
            }

            if (req.method === "POST" && url.pathname === "/api/task") {
                const { componentId, owner, title } = await readJsonBody(req);
                json(res, 200, await addTask(componentId, title, owner));
                return;
            }

            if (req.method === "POST" && url.pathname.startsWith("/api/task/") && url.pathname.endsWith("/toggle")) {
                const taskId = url.pathname.split("/")[3];
                const { done } = await readJsonBody(req);
                json(res, 200, await toggleTask(taskId, done));
                return;
            }

            if (req.method === "POST" && url.pathname.startsWith("/api/task/") && url.pathname.endsWith("/phase")) {
                const taskId = url.pathname.split("/")[3];
                const { phase } = await readJsonBody(req);
                json(res, 200, await setTaskPhase(taskId, phase));
                return;
            }

            if (req.method === "POST" && url.pathname.startsWith("/api/task/") && url.pathname.endsWith("/owner")) {
                const taskId = url.pathname.split("/")[3];
                const { owner } = await readJsonBody(req);
                json(res, 200, await setTaskOwner(taskId, owner));
                return;
            }

            if (req.method === "POST" && url.pathname.startsWith("/api/task/") && url.pathname.endsWith("/move")) {
                const taskId = url.pathname.split("/")[3];
                const { componentId, index } = await readJsonBody(req);
                json(res, 200, await moveTask(taskId, componentId, index));
                return;
            }

            if (req.method === "POST" && url.pathname.startsWith("/api/task/") && url.pathname.endsWith("/step")) {
                const taskId = url.pathname.split("/")[3];
                const { direction } = await readJsonBody(req);
                json(res, 200, await moveTaskStep(taskId, direction));
                return;
            }

            if (req.method === "DELETE" && url.pathname.startsWith("/api/task/")) {
                const taskId = url.pathname.split("/").pop();
                await removeTask(taskId);
                json(res, 200, { ok: true });
                return;
            }

            json(res, 404, { error: "not_found" });
        } catch (err) {
            json(res, 400, { error: String(err && err.message ? err.message : err) });
        }
    });

    try {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
    } catch (err) {
        events.off("changed", onChanged);
        throw err;
    }
    const stopWatching = watchBoard();
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const close = async () => {
        events.off("changed", onChanged);
        await stopWatching();
        for (const res of sseClients) res.end();
        await new Promise((resolve) => server.close(() => resolve()));
    };

    return { url: `http://127.0.0.1:${port}/`, close };
}

function renderHtml() {
    const ownerStyles = OWNERS.map(owner =>
        `[data-owner="${owner.id}"] { --owner-color: ${owner.color}; --owner-tint: ${owner.tint}; }`
    ).join("\n");
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Project Manager</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--background-color-default, #ffffff);
    color: var(--text-color-default, #1f2328);
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    font-size: var(--text-body-medium, 14px);
    line-height: var(--leading-body-medium, 20px);
  }
  header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color-default, #d0d7de);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h1 {
    font-size: var(--text-title-medium, 20px);
    font-weight: var(--font-weight-semibold, 600);
    margin: 0;
  }
  .owner-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 20px 0; }
  .legend-label { color: #59636e; font-size: 12px; margin-right: 4px; }
  .owner-key {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
    padding: 3px 9px; border-radius: 999px; background: var(--owner-tint); color: var(--owner-color);
  }
  .owner-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--owner-color); }
  ${ownerStyles}
  button.primary {
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--true-color-blue, #0969da);
    background: var(--true-color-blue, #0969da);
    color: var(--color-white, #fff);
    cursor: pointer;
  }
  main {
    padding: 16px 20px 40px;
    overflow-x: auto;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    min-height: 70vh;
  }
  .column {
    flex: 0 0 240px;
    width: 240px;
    background: var(--background-color-default, #f6f8fa);
    border: 1px solid var(--border-color-default, #d0d7de);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    max-height: 100%;
  }
  .column.drag-over { outline: 2px dashed var(--true-color-blue, #0969da); outline-offset: -2px; }
  .column-header {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-color-default, #d0d7de);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .column-header input.component-name {
    font-weight: var(--font-weight-semibold, 600);
    font-size: 13px;
    border: none;
    background: transparent;
    color: inherit;
    flex: 1;
    min-width: 0;
  }
  .column-header button.remove-component {
    background: none; border: none; color: var(--text-color-muted, #656d76);
    cursor: pointer; font-size: 13px; padding: 0 2px;
  }
  .column-count {
    font-size: 11px;
    color: var(--text-color-muted, #656d76);
    padding: 0 12px 6px;
  }
  .stack {
    flex: 1;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    min-height: 60px;
  }
  .card {
    background: var(--background-color-default, #fff);
    border: 1px solid var(--border-color-default, #d0d7de);
    border-radius: 8px;
    padding: 8px;
    cursor: grab;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card.dragging { opacity: 0.4; }
  .card:not([data-owner="unassigned"]) { background: var(--owner-tint); border-color: var(--owner-color); }
  .card.done .card-title { text-decoration: line-through; opacity: 0.6; }
  .card-top { display: flex; align-items: flex-start; gap: 6px; }
  .card-title { flex: 1; font-size: 13px; word-break: break-word; }
  .card-controls { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .stack-btns { display: flex; gap: 2px; }
  .stack-btns button {
    background: none; border: 1px solid var(--border-color-default, #d0d7de);
    color: inherit; cursor: pointer; font-size: 11px; padding: 1px 5px; border-radius: 4px;
  }
  select.owner-select {
    font-size: 12px;
    padding: 3px 7px;
    border-radius: 999px;
    border: 1px solid var(--owner-color);
    background: var(--owner-tint);
    color: var(--owner-color);
    font-weight: 600;
  }
  button.remove-task {
    background: none; border: none; color: var(--text-color-muted, #656d76);
    cursor: pointer; font-size: 12px; padding: 0 2px;
  }
  .move-select {
    width: 100%; font-size: 12px; padding: 4px;
    background: var(--background-color-default, #fff); color: inherit;
    border: 1px solid var(--border-color-default, #d0d7de); border-radius: 4px;
  }
  #board-status { margin: 8px 20px 0; min-height: 20px; font-size: 12px; }
  #board-status.error { color: #b42318; }
  .drop-slot { flex: 0 0 10px; border-radius: 3px; }
  .drop-slot.active { background: var(--true-color-blue-muted, #b6e3ff); }
  form.add-task { display: flex; gap: 4px; padding: 8px; border-top: 1px solid var(--border-color-default, #d0d7de); }
  form.add-task input {
    flex: 1;
    font-size: 12px;
    padding: 4px 6px;
    border: 1px solid var(--border-color-default, #d0d7de);
    border-radius: 6px;
    background: var(--background-color-default, #fff);
    color: inherit;
    min-width: 0;
  }
  form.add-task button {
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-color-default, #d0d7de);
    background: var(--background-color-default, #fff);
    color: inherit;
    cursor: pointer;
  }
  .add-column {
    flex: 0 0 200px;
    background: var(--background-color-default, #fff);
    border: 1px dashed var(--border-color-default, #d0d7de);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-color-muted, #656d76);
    cursor: pointer;
    min-height: 80px;
    font-size: 13px;
  }
</style>
</head>
<body>
<header>
  <h1 id="board-title">Project Manager</h1>
  <span style="font-size:12px;color:var(--text-color-muted,#656d76);">FRIDAY uses the OpenAI API · Built with Codex. Drag cards to change priority or component.</span>
</header>
<div id="owner-legend" class="owner-legend" aria-label="Task owners"></div>
<p id="board-status" role="status" aria-live="polite">Loading board…</p>
<main id="board-main"></main>
<script>
let META = { owners: [] };
let BOARD = { title: '', components: [] };
let dragTaskId = null;
const taskDrafts = new Map();
const pendingTasks = new Set();

function showStatus(message, failed = false) {
  const status = document.getElementById('board-status');
  status.textContent = message;
  status.className = failed ? 'error' : '';
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of (children || [])) {
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || ('Request failed: ' + res.status));
  }
  return res.json();
}

async function action(path, opts, onSaved) {
  try {
    await api(path, opts);
  } catch (error) {
    showStatus('Could not save: ' + error.message + '. Check the board server and try again.', true);
    render();
    return false;
  }
  if (onSaved) onSaved();
  try {
    BOARD = await api('/api/board');
    render();
    showStatus('Saved');
  } catch (error) {
    showStatus('Saved, but the view could not refresh. Reload when the server is available.', true);
  }
  return true;
}

function clearDrag() {
  dragTaskId = null;
  document.querySelectorAll('.dragging, .drag-over, .drop-slot.active').forEach(node => {
    node.classList.remove('dragging', 'drag-over', 'active');
  });
}

function dropTask(e, componentId, index) {
  if (!dragTaskId) return;
  e.preventDefault();
  e.stopPropagation();
  const taskId = dragTaskId;
  clearDrag();
  return action('/api/task/' + taskId + '/move', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ componentId, index }),
  });
}

function makeDropSlot(componentId, index) {
  const slot = el('div', { class: 'drop-slot' });
  slot.addEventListener('dragover', (e) => {
    if (!dragTaskId) return;
    e.preventDefault();
    slot.classList.add('active');
  });
  slot.addEventListener('dragleave', () => slot.classList.remove('active'));
  slot.addEventListener('drop', (e) => dropTask(e, componentId, index));
  return slot;
}

function renderCard(component, task, index) {
  const card = el('div', {
    class: 'card' + (task.done ? ' done' : ''), draggable: 'true', 'data-owner': task.owner,
  });
  card.addEventListener('dragstart', (e) => {
    if (e.target.closest('input, select, button')) { e.preventDefault(); return; }
    dragTaskId = task.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', clearDrag);
  card.addEventListener('drop', (e) => {
    const rect = card.getBoundingClientRect();
    return dropTask(e, component.id, index + (e.clientY >= rect.top + rect.height / 2 ? 1 : 0));
  });

  const checkbox = el('input', { type: 'checkbox', 'aria-label': 'Complete ' + task.title });
  checkbox.checked = task.done;
  checkbox.addEventListener('change', () => action('/api/task/' + task.id + '/toggle', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done: checkbox.checked }),
  }));

  const removeBtn = el('button', {
    class: 'remove-task', type: 'button', 'aria-label': 'Delete ' + task.title,
    onclick: () => action('/api/task/' + task.id, { method: 'DELETE' }),
  }, ['\\u2715']);

  const top = el('div', { class: 'card-top' }, [checkbox, el('span', { class: 'card-title' }, [task.title]), removeBtn]);

  const ownerSelect = el('select', {
    class: 'owner-select', 'data-owner': task.owner, 'aria-label': 'Owner for ' + task.title,
    onchange: (e) => action('/api/task/' + task.id + '/owner', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: e.target.value }),
    }),
  });
  for (const owner of META.owners) {
    ownerSelect.appendChild(el('option', {
      value: owner.id, ...(owner.id === task.owner ? { selected: 'selected' } : {}),
    }, [owner.label]));
  }

  const upBtn = el('button', {
    type: 'button', title: 'Move up',
    'aria-label': 'Move ' + task.title + ' up',
    onclick: () => action('/api/task/' + task.id + '/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'up' }),
    }),
  }, ['\\u2191']);
  const downBtn = el('button', {
    type: 'button', title: 'Move down',
    'aria-label': 'Move ' + task.title + ' down',
    onclick: () => action('/api/task/' + task.id + '/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'down' }),
    }),
  }, ['\\u2193']);
  const stackBtns = el('div', { class: 'stack-btns' }, [upBtn, downBtn]);

  const controls = el('div', { class: 'card-controls' }, [ownerSelect, stackBtns]);
  card.appendChild(top);
  card.appendChild(controls);
  const moveSelect = el('select', {
    class: 'move-select', 'aria-label': 'Move ' + task.title + ' to component',
    onchange: (e) => {
      const target = BOARD.components.find(c => c.id === e.target.value);
      if (target) return action('/api/task/' + task.id + '/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentId: target.id, index: target.tasks.length }),
      });
    },
  }, [el('option', { value: '' }, ['Move to component…'])]);
  for (const target of BOARD.components) {
    if (target.id !== component.id) moveSelect.appendChild(el('option', { value: target.id }, [target.name]));
  }
  card.appendChild(moveSelect);
  return card;
}

function renderColumn(component) {
  const column = el('div', { class: 'column' });
  column.addEventListener('dragover', (e) => {
    if (dragTaskId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; column.classList.add('drag-over'); }
  });
  column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
  column.addEventListener('drop', (e) => dropTask(e, component.id, component.tasks.length));

  const nameInput = el('input', {
    class: 'component-name',
    'aria-label': 'Component name: ' + component.name,
    value: component.name,
    onchange: (e) => action('/api/component/' + component.id + '/rename', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: e.target.value }),
    }),
  });
  const removeBtn = el('button', {
    class: 'remove-component', type: 'button', title: 'Remove component',
    'aria-label': 'Remove component ' + component.name,
    onclick: () => action('/api/component/' + component.id, { method: 'DELETE' }),
  }, ['\\u2715']);
  column.appendChild(el('div', { class: 'column-header' }, [nameInput, removeBtn]));
  column.appendChild(el('div', { class: 'column-count' }, [component.tasks.length + ' task' + (component.tasks.length === 1 ? '' : 's')]));

  const stack = el('div', { class: 'stack' });
  stack.appendChild(makeDropSlot(component.id, 0));
  component.tasks.forEach((task, index) => {
    stack.appendChild(renderCard(component, task, index));
    stack.appendChild(makeDropSlot(component.id, index + 1));
  });
  column.appendChild(stack);

  const form = el('form', {
    class: 'add-task',
    onsubmit: async (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const title = input.value.trim();
      if (!title) { showStatus('Enter a task title first.', true); input.focus(); return; }
      if (pendingTasks.has(component.id)) return;
      pendingTasks.add(component.id);
      const submit = e.target.querySelector('button');
      submit.disabled = true;
      await action('/api/task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentId: component.id, title }),
      }, () => {
        taskDrafts.delete(component.id);
        input.value = '';
      });
      pendingTasks.delete(component.id);
      render();
    },
  });
  const taskInput = el('input', {
    type: 'text', placeholder: 'Add task…', 'aria-label': 'New task in ' + component.name,
    'data-component': component.id, value: taskDrafts.get(component.id) || '',
    oninput: (e) => taskDrafts.set(component.id, e.target.value),
  });
  const addButton = el('button', { type: 'submit', 'aria-label': 'Add task to ' + component.name }, ['Add']);
  addButton.disabled = pendingTasks.has(component.id);
  form.appendChild(taskInput);
  form.appendChild(addButton);
  column.appendChild(form);

  return column;
}

function render() {
  const focused = document.activeElement;
  const focusComponent = focused && focused.getAttribute('data-component');
  const selection = focusComponent ? [focused.selectionStart, focused.selectionEnd] : null;
  document.getElementById('board-title').textContent = BOARD.title || 'Project Manager';
  const main = document.getElementById('board-main');
  main.innerHTML = '';
  for (const component of BOARD.components) main.appendChild(renderColumn(component));
  const addColumn = el('button', {
    class: 'add-column', type: 'button',
    onclick: async () => {
      const name = prompt('Component name (e.g. Frontend, Backend, ML Model):');
      if (name && name.trim()) await action('/api/component', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
    },
  }, ['+ Add component']);
  main.appendChild(addColumn);
  if (focusComponent) {
    const input = Array.from(main.querySelectorAll('input[data-component]')).find(node => node.dataset.component === focusComponent);
    if (input) { input.focus(); input.setSelectionRange(...selection); }
  }
}

async function init() {
  META = await api('/api/meta');
  const legend = document.getElementById('owner-legend');
  legend.appendChild(el('span', { class: 'legend-label' }, ['Owners']));
  for (const owner of META.owners) {
    legend.appendChild(el('span', { class: 'owner-key', 'data-owner': owner.id }, [
      el('span', { class: 'owner-dot', 'aria-hidden': 'true' }), owner.label,
    ]));
  }
  BOARD = await api('/api/board');
  render();
  showStatus('Ready — enter a title below a column to add a task.');
  const source = new EventSource('/events');
  source.onmessage = (e) => {
    BOARD = JSON.parse(e.data);
    render();
  };
  source.onerror = () => showStatus('Live connection lost. Check that the board server is running.', true);
}
init().catch(error => showStatus('Could not load the board: ' + error.message, true));
</script>
</body>
</html>`;
}
