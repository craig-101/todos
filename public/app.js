const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const form = document.getElementById('add-form');
const input = document.getElementById('new-text');
const tabs = document.querySelectorAll('.tab');
const trashToolbar = document.getElementById('trash-toolbar');
const emptyTrashBtn = document.getElementById('empty-trash');

let view = 'active';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    location.href = '/login';
    return;
  }
  if (!res.ok && res.status !== 204) throw new Error('request failed');
  if (res.status === 204) return null;
  return res.json();
}

function renderActive(todos) {
  const byParent = new Map();
  for (const t of todos) {
    const key = t.parentId || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t);
  }
  const top = byParent.get(null) || [];
  // Children whose parent is missing — render as top-level (orphans).
  const validIds = new Set(todos.map(t => t.id));
  for (const t of todos) {
    if (t.parentId && !validIds.has(t.parentId) && !top.includes(t)) top.push(t);
  }

  listEl.innerHTML = '';
  emptyEl.hidden = top.length > 0;

  for (const t of top) {
    listEl.append(renderItem(t, false));
    const subs = byParent.get(t.id) || [];
    for (const s of subs) listEl.append(renderItem(s, true));
  }
}

function renderItem(t, isSub) {
  const li = document.createElement('li');
  li.className = 'item' + (t.done ? ' done' : '') + (isSub ? ' sub' : '');
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
  del.addEventListener('click', () => remove(t.id));
  li.append(del);

  return li;
}

function renderTrash(todos) {
  listEl.innerHTML = '';
  emptyEl.hidden = todos.length > 0;
  emptyEl.textContent = 'Trash is empty.';

  for (const t of todos) {
    const li = document.createElement('li');
    li.className = 'item trashed' + (t.parentId ? ' sub' : '');
    li.dataset.id = t.id;

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = t.text;

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

    li.append(text, when, restore, del);
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

async function load() {
  if (view === 'active') {
    emptyEl.textContent = 'Nothing here yet.';
    const todos = await api('/api/todos');
    renderActive(todos || []);
  } else {
    const todos = await api('/api/trash');
    renderTrash(todos || []);
  }
}

async function add(text, parentId = null) {
  await api('/api/todos', {
    method: 'POST',
    body: JSON.stringify({ text, parentId }),
  });
  await load();
}

async function toggle(t) {
  await api(`/api/todos/${t.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ done: !t.done }),
  });
  await load();
}

async function remove(id) {
  await api(`/api/todos/${id}`, { method: 'DELETE' });
  await load();
}

async function restoreItem(id) {
  await api(`/api/todos/${id}/restore`, { method: 'POST' });
  await load();
}

async function purge(id) {
  if (!confirm('Delete this permanently? This cannot be undone.')) return;
  await api(`/api/trash/${id}`, { method: 'DELETE' });
  await load();
}

async function saveText(id, text) {
  await api(`/api/todos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  });
  await load();
}

function startEdit(li, t) {
  if (li.querySelector('.edit-input')) return;
  const textEl = li.querySelector('.text');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input';
  input.value = t.text;
  input.maxLength = 500;
  textEl.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  let settled = false;
  const finish = async (commit) => {
    if (settled) return;
    settled = true;
    const next = input.value.trim();
    if (commit && next && next !== t.text) {
      await saveText(t.id, next);
    } else {
      await load();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
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
  const finish = async (commit) => {
    if (settled) return;
    settled = true;
    const text = inp.value.trim();
    if (commit && text) await add(text, parent.id);
    else row.remove();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await add(text);
  input.focus();
});

tabs.forEach(t => {
  t.addEventListener('click', () => {
    view = t.dataset.view;
    tabs.forEach(x => x.classList.toggle('active', x === t));
    form.hidden = view !== 'active';
    trashToolbar.hidden = view !== 'trash';
    load().catch(console.error);
  });
});

emptyTrashBtn.addEventListener('click', async () => {
  if (!confirm('Permanently delete everything in trash?')) return;
  await api('/api/trash', { method: 'DELETE' });
  await load();
});

load().catch(console.error);
