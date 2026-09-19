// server.mjs — loopback HTTP server that renders the project-manager Kanban
// board and exposes JSON endpoints the iframe uses. One server per open
// canvas instance; they all read/write the same underlying board.json, so
// any number of open panels stay in sync (pushed live via SSE).

import { createServer } from "node:http";
import {
    getBoard,
    addComponent,
    removeComponent,
    addTask,
    toggleTask,
    removeTask,
    setTaskPhase,
    renameComponent,
    moveTask,
    moveTaskStep,
    PHASES,
    PHASE_LABELS,
} from "./board.mjs";
import { events } from "./board.mjs";

function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
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
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(renderHtml());
                return;
            }

            if (req.method === "GET" && url.pathname === "/api/meta") {
                json(res, 200, { phases: PHASES, phaseLabels: PHASE_LABELS });
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
                const { componentId, phase, title } = await readJsonBody(req);
                json(res, 200, await addTask(componentId, phase, title));
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

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const close = async () => {
        events.off("changed", onChanged);
        for (const res of sseClients) res.end();
        await new Promise((resolve) => server.close(() => resolve()));
    };

    return { url: `http://127.0.0.1:${port}/`, close };
}

function renderHtml() {
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
  .card.done .card-title { text-decoration: line-through; opacity: 0.6; }
  .card-top { display: flex; align-items: flex-start; gap: 6px; }
  .card-title { flex: 1; font-size: 13px; word-break: break-word; }
  .card-controls { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .stack-btns { display: flex; gap: 2px; }
  .stack-btns button {
    background: none; border: 1px solid var(--border-color-default, #d0d7de);
    color: inherit; cursor: pointer; font-size: 11px; padding: 1px 5px; border-radius: 4px;
  }
  select.phase-select {
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 999px;
    border: 1px solid var(--border-color-default, #d0d7de);
    background: var(--background-color-default, #fff);
    color: inherit;
  }
  select.phase-select[data-phase="ideation"] { border-color: var(--true-color-orange, #bc4c00); color: var(--true-color-orange, #bc4c00); }
  select.phase-select[data-phase="mvp"] { border-color: var(--true-color-blue, #0969da); color: var(--true-color-blue, #0969da); }
  select.phase-select[data-phase="development"] { border-color: var(--true-color-green, #1a7f37); color: var(--true-color-green, #1a7f37); }
  button.remove-task {
    background: none; border: none; color: var(--text-color-muted, #656d76);
    cursor: pointer; font-size: 12px; padding: 0 2px;
  }
  .drop-slot { height: 6px; border-radius: 3px; }
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
  <span style="font-size:11px;color:var(--text-color-muted,#656d76);">Drag cards to reorder (↕ within column) or move between components (↔)</span>
</header>
<main id="board-main"></main>
<script>
let META = { phases: [], phaseLabels: {} };
let BOARD = { title: '', components: [] };
let dragTaskId = null;

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

function makeDropSlot(componentId, index) {
  const slot = el('div', { class: 'drop-slot' });
  slot.addEventListener('dragover', (e) => {
    if (!dragTaskId) return;
    e.preventDefault();
    slot.classList.add('active');
  });
  slot.addEventListener('dragleave', () => slot.classList.remove('active'));
  slot.addEventListener('drop', async (e) => {
    e.preventDefault();
    slot.classList.remove('active');
    const taskId = dragTaskId;
    dragTaskId = null;
    if (!taskId) return;
    await api('/api/task/' + taskId + '/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentId, index }),
    });
  });
  return slot;
}

function renderCard(component, task, index) {
  const card = el('div', { class: 'card' + (task.done ? ' done' : ''), draggable: 'true' });
  card.addEventListener('dragstart', () => { dragTaskId = task.id; card.classList.add('dragging'); });
  card.addEventListener('dragend', () => { dragTaskId = null; card.classList.remove('dragging'); });

  const checkbox = el('input', { type: 'checkbox' });
  checkbox.checked = task.done;
  checkbox.addEventListener('change', () => api('/api/task/' + task.id + '/toggle', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done: checkbox.checked }),
  }));

  const removeBtn = el('button', {
    class: 'remove-task', type: 'button',
    onclick: () => api('/api/task/' + task.id, { method: 'DELETE' }),
  }, ['\\u2715']);

  const top = el('div', { class: 'card-top' }, [checkbox, el('span', { class: 'card-title' }, [task.title]), removeBtn]);

  const phaseSelect = el('select', {
    class: 'phase-select', 'data-phase': task.phase,
    onchange: (e) => api('/api/task/' + task.id + '/phase', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: e.target.value }),
    }),
  });
  for (const phase of META.phases) {
    phaseSelect.appendChild(el('option', {
      value: phase, ...(phase === task.phase ? { selected: 'selected' } : {}),
    }, [META.phaseLabels[phase] || phase]));
  }

  const upBtn = el('button', {
    type: 'button', title: 'Move up',
    onclick: () => api('/api/task/' + task.id + '/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'up' }),
    }),
  }, ['\\u2191']);
  const downBtn = el('button', {
    type: 'button', title: 'Move down',
    onclick: () => api('/api/task/' + task.id + '/step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'down' }),
    }),
  }, ['\\u2193']);
  const stackBtns = el('div', { class: 'stack-btns' }, [upBtn, downBtn]);

  const controls = el('div', { class: 'card-controls' }, [phaseSelect, stackBtns]);
  card.appendChild(top);
  card.appendChild(controls);
  return card;
}

function renderColumn(component) {
  const column = el('div', { class: 'column' });
  column.addEventListener('dragover', (e) => { if (dragTaskId) { e.preventDefault(); column.classList.add('drag-over'); } });
  column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
  column.addEventListener('drop', () => column.classList.remove('drag-over'));

  const nameInput = el('input', {
    class: 'component-name',
    value: component.name,
    onchange: (e) => api('/api/component/' + component.id + '/rename', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: e.target.value }),
    }),
  });
  const removeBtn = el('button', {
    class: 'remove-component', type: 'button', title: 'Remove component',
    onclick: () => api('/api/component/' + component.id, { method: 'DELETE' }),
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
    onsubmit: (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      api('/api/task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentId: component.id, phase: META.phases[0], title }),
      });
    },
  });
  form.appendChild(el('input', { type: 'text', placeholder: 'Add task…' }));
  form.appendChild(el('button', { type: 'submit' }, ['Add']));
  column.appendChild(form);

  return column;
}

function render() {
  document.getElementById('board-title').textContent = BOARD.title || 'Project Manager';
  const main = document.getElementById('board-main');
  main.innerHTML = '';
  for (const component of BOARD.components) main.appendChild(renderColumn(component));
  const addColumn = el('div', {
    class: 'add-column',
    onclick: async () => {
      const name = prompt('Component name (e.g. Frontend, Backend, ML Model):');
      if (name && name.trim()) await api('/api/component', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
    },
  }, ['+ Add component']);
  main.appendChild(addColumn);
}

async function init() {
  META = await api('/api/meta');
  BOARD = await api('/api/board');
  render();
  const source = new EventSource('/events');
  source.onmessage = (e) => {
    BOARD = JSON.parse(e.data);
    render();
  };
}
init();
</script>
</body>
</html>`;
}
