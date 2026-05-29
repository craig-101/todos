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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await add(text);
  input.focus();
});

load().catch(console.error);
