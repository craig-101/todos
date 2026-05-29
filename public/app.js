const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const form = document.getElementById('add-form');
const input = document.getElementById('new-text');

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

function render(todos) {
  listEl.innerHTML = '';
  emptyEl.hidden = todos.length > 0;
  for (const t of todos) {
    const li = document.createElement('li');
    li.className = 'item' + (t.done ? ' done' : '');
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

    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = 'Delete';
    del.addEventListener('click', () => remove(t.id));

    li.append(check, text, del);
    listEl.append(li);
  }
}

async function load() {
  const todos = await api('/api/todos');
  render(todos || []);
}

async function add(text) {
  await api('/api/todos', {
    method: 'POST',
    body: JSON.stringify({ text }),
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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await add(text);
  input.focus();
});

load().catch(console.error);
