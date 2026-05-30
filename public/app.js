const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const form = document.getElementById('add-form');
const input = document.getElementById('new-text');
const categorySelect = document.getElementById('new-category');
const filtersEl = document.getElementById('filters');
const toolbarEl = document.getElementById('toolbar');
const searchEl = document.getElementById('search');
const hideDoneEl = document.getElementById('hide-done');
const tabs = document.querySelectorAll('.tab');
const trashToolbar = document.getElementById('trash-toolbar');
const emptyTrashBtn = document.getElementById('empty-trash');
const toastEl = document.getElementById('toast');
const toastMsg = document.getElementById('toast-msg');
const toastAction = document.getElementById('toast-action');
const statusEl = document.getElementById('status');

const STATE_KEY = 'todosState.v1';
const HIDE_DONE_KEY = 'hideDone';

const state = loadState();

let view = 'active';
let filter = 'all';
let search = '';
let hideDone = localStorage.getItem(HIDE_DONE_KEY) === '1';
hideDoneEl.checked = hideDone;

const CATEGORY_LABELS = { home: 'Home', work: 'Work' };

let online = navigator.onLine;
let syncing = false;

// ---------- state persistence ----------

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { todos: [], outbox: [] };
    const parsed = JSON.parse(raw);
    return { todos: parsed.todos || [], outbox: parsed.outbox || [] };
  } catch {
    return { todos: [], outbox: [] };
  }
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

// ---------- network ----------

async function rawFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('unauthorized');
  }
  if (!res.ok && res.status !== 204) throw new Error('http ' + res.status);
  if (res.status === 204) return null;
  return res.json();
}

async function pull() {
  const [a, tr] = await Promise.all([
    rawFetch('/api/todos'),
    rawFetch('/api/trash'),
  ]);
  state.todos = [...(a || []), ...(tr || [])];
  saveState();
}

function enqueue(op) {
  state.outbox.push(op);
  saveState();
  updateStatus();
  flush();
}

async function flush() {
  if (syncing || state.outbox.length === 0) return;
  syncing = true;
  updateStatus();
  try {
    while (state.outbox.length) {
      const op = state.outbox[0];
      try {
        await rawFetch(op.path, {
          method: op.method,
          body: op.body ? JSON.stringify(op.body) : undefined,
        });
      } catch (err) {
        if (err.message === 'unauthorized') return;
        online = false;
        updateStatus();
        return;
      }
      state.outbox.shift();
      saveState();
      updateStatus();
    }
    try {
      await pull();
      render();
    } catch {
      online = false;
    }
    online = true;
  } finally {
    syncing = false;
    updateStatus();
  }
}

// ---------- status indicator ----------

function updateStatus() {
  const pending = state.outbox.length;
  if (syncing) {
    statusEl.hidden = false;
    statusEl.className = 'status syncing';
    statusEl.textContent = pending ? `Syncing ${pending}…` : 'Syncing…';
    return;
  }
  if (!online) {
    statusEl.hidden = false;
    statusEl.className = 'status offline';
    statusEl.textContent = pending ? `Offline · ${pending} pending` : 'Offline';
    return;
  }
  if (pending) {
    statusEl.hidden = false;
    statusEl.className = 'status pending';
    statusEl.textContent = `${pending} pending`;
    return;
  }
  statusEl.hidden = true;
  statusEl.className = 'status';
  statusEl.textContent = '';
}

// ---------- date helpers ----------

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDue(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date - today) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isOverdue(t) {
  return t.dueDate && !t.done && t.dueDate < todayISO();
}

// ---------- selectors ----------

function activeTodos() { return state.todos.filter(t => !t.deletedAt); }
function trashTodos() {
  return state.todos.filter(t => t.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
}

function matchesSearch(t) {
  if (!search) return true;
  return t.text.toLowerCase().includes(search);
}

function visibleActive() {
  const active = activeTodos();
  const top = active.filter(t => !t.parentId);
  const subsByParent = new Map();
  for (const s of active) {
    if (!s.parentId) continue;
    if (!subsByParent.has(s.parentId)) subsByParent.set(s.parentId, []);
    subsByParent.get(s.parentId).push(s);
  }

  const result = [];
  for (const p of top) {
    if (filter !== 'all' && p.category !== filter) continue;
    const children = subsByParent.get(p.id) || [];
    const parentMatchesSearch = matchesSearch(p);
    const matchingChildren = children.filter(matchesSearch);
    if (search && !parentMatchesSearch && matchingChildren.length === 0) continue;
    const visibleChildren = search ? matchingChildren : children;
    const showParent = !hideDone || !p.done;
    if (showParent) result.push({ todo: p, isSub: false });
    for (const c of visibleChildren) {
      if (hideDone && c.done) continue;
      result.push({ todo: c, isSub: true });
    }
  }
  return result;
}

// ---------- rendering ----------

function render() {
  updateCounts();
  if (view === 'active') renderActive();
  else renderTrash();
}

function renderActive() {
  const items = visibleActive();
  listEl.innerHTML = '';
  emptyEl.hidden = items.length > 0;
  emptyEl.textContent = activeTodos().length === 0
    ? 'Nothing here yet.'
    : 'No tasks match.';
  for (const { todo, isSub } of items) {
    listEl.append(renderItem(todo, isSub));
  }
}

function renderItem(t, isSub) {
  const li = document.createElement('li');
  li.className = 'item' + (t.done ? ' done' : '') + (isSub ? ' sub' : '') + (isOverdue(t) ? ' overdue' : '');
  li.dataset.id = t.id;

  const check = document.createElement('button');
  check.className = 'check' + (t.done ? ' checked' : '');
  check.setAttribute('aria-label', t.done ? 'Mark as not done' : 'Mark as done');
  check.addEventListener('click', () => toggle(t));

  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = t.text;
  text.title = 'Click to edit';
  text.addEventListener('click', () => startEdit(li, t));

  li.append(check, text);

  if (!isSub) {
    const subs = state.todos.filter(c => c.parentId === t.id && !c.deletedAt);
    if (subs.length > 0) {
      const done = subs.filter(c => c.done).length;
      const pct = Math.round((done / subs.length) * 100);
      const prog = document.createElement('span');
      prog.className = 'progress' + (done === subs.length ? ' complete' : '');
      prog.style.setProperty('--p', pct);
      prog.textContent = `${done}/${subs.length}`;
      prog.title = `${pct}% complete`;
      li.append(prog);
    }
  }

  const due = document.createElement('label');
  due.className = 'due' + (t.dueDate ? ' set' : '') + (isOverdue(t) ? ' overdue' : '');
  const dueInput = document.createElement('input');
  dueInput.type = 'date';
  dueInput.value = t.dueDate || '';
  dueInput.title = t.dueDate ? 'Change due date' : 'Set due date';
  dueInput.addEventListener('change', () => setDue(t.id, dueInput.value || null));
  const dueLabel = document.createElement('span');
  dueLabel.className = 'due-label';
  dueLabel.textContent = t.dueDate ? formatDue(t.dueDate) : 'Due';
  due.append(dueInput, dueLabel);
  if (t.dueDate) {
    const clear = document.createElement('button');
    clear.className = 'due-clear';
    clear.type = 'button';
    clear.title = 'Clear due date';
    clear.textContent = '×';
    clear.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDue(t.id, null);
    });
    due.append(clear);
  }
  li.append(due);

  if (!isSub && t.category) {
    const badge = document.createElement('button');
    badge.className = `badge badge-${t.category}`;
    badge.textContent = CATEGORY_LABELS[t.category] || t.category;
    badge.title = 'Click to change category';
    badge.addEventListener('click', () => cycleCategory(t));
    li.append(badge);
  }

  if (!isSub) {
    const addSub = document.createElement('button');
    addSub.className = 'icon-btn';
    addSub.title = 'Add subtask';
    addSub.setAttribute('aria-label', 'Add subtask');
    addSub.textContent = '+';
    addSub.addEventListener('click', () => startAddSub(li, t));
    li.append(addSub);
  }

  const del = document.createElement('button');
  del.className = 'delete';
  del.textContent = 'Delete';
  del.addEventListener('click', () => remove(t));
  li.append(del);

  return li;
}

function renderTrash() {
  const items = trashTodos().filter(t => !search || matchesSearch(t));
  listEl.innerHTML = '';
  emptyEl.hidden = items.length > 0;
  emptyEl.textContent = trashTodos().length === 0 ? 'Trash is empty.' : 'No matches in trash.';

  for (const t of items) {
    const li = document.createElement('li');
    li.className = 'item trashed' + (t.parentId ? ' sub' : '');
    li.dataset.id = t.id;

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = t.text;

    li.append(text);

    if (!t.parentId && t.category) {
      const badge = document.createElement('span');
      badge.className = `badge badge-${t.category} static`;
      badge.textContent = CATEGORY_LABELS[t.category] || t.category;
      li.append(badge);
    }

    const when = document.createElement('span');
    when.className = 'muted when';
    when.textContent = timeAgo(t.deletedAt);

    const restore = document.createElement('button');
    restore.className = 'ghost';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => restoreItem(t.id));

    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = 'Delete forever';
    del.addEventListener('click', () => purge(t.id));

    li.append(when, restore, del);
    listEl.append(li);
  }
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function updateCounts() {
  const active = activeTodos();
  const topActive = active.filter(t => !t.parentId);
  const counts = {
    active: active.length,
    trash: trashTodos().length,
    'cat-all': topActive.length,
    'cat-home': topActive.filter(t => t.category === 'home').length,
    'cat-work': topActive.filter(t => t.category === 'work').length,
  };
  document.querySelectorAll('.count').forEach(el => {
    const v = counts[el.dataset.count];
    el.textContent = v ? `(${v})` : '';
  });
}

// ---------- mutations (local-first) ----------

function add(text, parentId = null, category = null) {
  const id = crypto.randomUUID();
  let cat = null;
  if (!parentId) {
    cat = category || 'home';
  } else {
    const parent = state.todos.find(t => t.id === parentId);
    if (!parent || parent.deletedAt) return;
    if (parent.parentId) return;
  }
  const todo = {
    id,
    text,
    done: false,
    parentId: parentId || null,
    category: cat,
    dueDate: null,
    createdAt: Date.now(),
    deletedAt: null,
  };
  state.todos.unshift(todo);
  saveState();
  render();
  enqueue({
    method: 'POST',
    path: '/api/todos',
    body: { id, text, parentId: parentId || undefined, category: cat || undefined },
  });
}

function cycleCategory(t) {
  const order = ['home', 'work'];
  const next = order[(order.indexOf(t.category) + 1) % order.length];
  t.category = next;
  saveState();
  render();
  enqueue({ method: 'PATCH', path: `/api/todos/${t.id}`, body: { category: next } });
}

function setDue(id, dueDate) {
  const t = state.todos.find(x => x.id === id);
  if (!t) return;
  t.dueDate = dueDate;
  saveState();
  render();
  enqueue({ method: 'PATCH', path: `/api/todos/${id}`, body: { dueDate } });
}

function toggle(t) {
  t.done = !t.done;
  saveState();
  render();
  enqueue({ method: 'PATCH', path: `/api/todos/${t.id}`, body: { done: t.done } });
}

function remove(t) {
  const now = Date.now();
  t.deletedAt = now;
  for (const c of state.todos) {
    if (c.parentId === t.id && !c.deletedAt) c.deletedAt = now;
  }
  saveState();
  render();
  enqueue({ method: 'DELETE', path: `/api/todos/${t.id}` });
  showToast(`Deleted "${truncate(t.text, 40)}"`, () => restoreItem(t.id));
}

function restoreItem(id) {
  const t = state.todos.find(x => x.id === id);
  if (!t) return;
  t.deletedAt = null;
  saveState();
  render();
  enqueue({ method: 'POST', path: `/api/todos/${id}/restore` });
}

function purge(id) {
  if (!confirm('Delete this permanently? This cannot be undone.')) return;
  state.todos = state.todos.filter(t => t.id !== id);
  saveState();
  render();
  enqueue({ method: 'DELETE', path: `/api/trash/${id}` });
}

function emptyTrashLocal() {
  if (!confirm('Permanently delete everything in trash?')) return;
  state.todos = state.todos.filter(t => !t.deletedAt);
  saveState();
  render();
  enqueue({ method: 'DELETE', path: '/api/trash' });
}

function saveText(id, text) {
  const t = state.todos.find(x => x.id === id);
  if (!t) return;
  t.text = text;
  saveState();
  render();
  enqueue({ method: 'PATCH', path: `/api/todos/${id}`, body: { text } });
}

// ---------- inline editing ----------

function startEdit(li, t) {
  if (li.querySelector('.edit-input')) return;
  const textEl = li.querySelector('.text');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'edit-input';
  inp.value = t.text;
  inp.maxLength = 500;
  textEl.replaceWith(inp);
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);

  let settled = false;
  const finish = (commit) => {
    if (settled) return;
    settled = true;
    const next = inp.value.trim();
    if (commit && next && next !== t.text) saveText(t.id, next);
    else render();
  };

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
}

function startAddSub(parentLi, parent) {
  if (parentLi.nextElementSibling && parentLi.nextElementSibling.classList.contains('subtask-input-row')) {
    parentLi.nextElementSibling.querySelector('input').focus();
    return;
  }
  const row = document.createElement('li');
  row.className = 'item sub subtask-input-row';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'edit-input';
  inp.placeholder = 'New subtask';
  inp.maxLength = 500;
  row.append(inp);
  parentLi.after(row);
  inp.focus();

  let settled = false;
  const finish = (commit) => {
    if (settled) return;
    settled = true;
    const text = inp.value.trim();
    if (commit && text) add(text, parent.id);
    else row.remove();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- toast ----------

let toastTimer = null;
function showToast(msg, onUndo) {
  toastMsg.textContent = msg;
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add('show'));
  if (toastTimer) clearTimeout(toastTimer);
  const dismiss = () => {
    toastEl.classList.remove('show');
    setTimeout(() => { toastEl.hidden = true; }, 200);
  };
  toastTimer = setTimeout(dismiss, 6000);
  toastAction.onclick = () => {
    if (toastTimer) clearTimeout(toastTimer);
    dismiss();
    if (onUndo) onUndo();
  };
}

// ---------- events ----------

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const category = categorySelect.value;
  input.value = '';
  add(text, null, category);
  input.focus();
});

filtersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.pill');
  if (!btn) return;
  filter = btn.dataset.cat;
  filtersEl.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p === btn));
  if (filter !== 'all') categorySelect.value = filter;
  renderActive();
});

searchEl.addEventListener('input', () => {
  search = searchEl.value.trim().toLowerCase();
  if (view === 'active') renderActive();
  else renderTrash();
});

hideDoneEl.addEventListener('change', () => {
  hideDone = hideDoneEl.checked;
  localStorage.setItem(HIDE_DONE_KEY, hideDone ? '1' : '0');
  renderActive();
});

tabs.forEach(t => {
  t.addEventListener('click', () => {
    view = t.dataset.view;
    tabs.forEach(x => x.classList.toggle('active', x === t));
    form.hidden = view !== 'active';
    filtersEl.hidden = view !== 'active';
    hideDoneEl.parentElement.hidden = view !== 'active';
    trashToolbar.hidden = view !== 'trash';
    render();
  });
});

emptyTrashBtn.addEventListener('click', () => emptyTrashLocal());

window.addEventListener('online', () => {
  online = true;
  updateStatus();
  flush();
});
window.addEventListener('offline', () => {
  online = false;
  updateStatus();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---------- boot ----------

render();
updateStatus();

(async () => {
  await flush();
  if (state.outbox.length === 0) {
    try {
      await pull();
      online = true;
      render();
    } catch {
      online = false;
    }
    updateStatus();
  }
})();
