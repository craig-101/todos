require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (!AUTH_USER || !AUTH_PASS) {
  console.error('AUTH_USER and AUTH_PASS must be set in environment.');
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'todos.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

const CATEGORIES = ['home', 'work'];
const DEFAULT_CATEGORY = 'home';

function loadTodos() {
  try {
    const todos = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return todos.map(t => ({
      parentId: null,
      deletedAt: null,
      category: t.parentId ? null : DEFAULT_CATEGORY,
      dueDate: null,
      ...t,
    }));
  } catch {
    return [];
  }
}

function normalizeDueDate(v) {
  if (v === null || v === '') return null;
  if (typeof v !== 'string') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(v + 'T00:00:00Z');
  if (isNaN(d.getTime())) return undefined;
  return v;
}

function saveTodos(todos) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2));
}

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  res.redirect('/login');
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/login', (req, res) => {
  if (req.session.authed) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const userOk = safeEqual(username || '', AUTH_USER);
  const passOk = safeEqual(password || '', AUTH_PASS);
  if (userOk && passOk) {
    req.session.authed = true;
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/todos', requireAuth, (req, res) => {
  const todos = loadTodos().filter(t => !t.deletedAt);
  const cat = req.query.category;
  if (!cat || cat === 'all') return res.json(todos);
  if (!CATEGORIES.includes(cat)) return res.status(400).json({ error: 'invalid category' });
  const topIds = new Set(todos.filter(t => !t.parentId && t.category === cat).map(t => t.id));
  res.json(todos.filter(t => topIds.has(t.id) || topIds.has(t.parentId)));
});

app.get('/api/trash', requireAuth, (req, res) => {
  const trashed = loadTodos()
    .filter(t => t.deletedAt)
    .sort((a, b) => b.deletedAt - a.deletedAt);
  res.json(trashed);
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.post('/api/todos', requireAuth, (req, res) => {
  const text = (req.body.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 500) return res.status(400).json({ error: 'too long' });
  const todos = loadTodos();
  let id = req.body.id;
  if (id !== undefined) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return res.status(400).json({ error: 'invalid id' });
    const existing = todos.find(t => t.id === id);
    if (existing) return res.status(200).json(existing);
  } else {
    id = crypto.randomUUID();
  }
  let parentId = null;
  if (req.body.parentId) {
    const parent = todos.find(t => t.id === req.body.parentId && !t.deletedAt);
    if (!parent) return res.status(400).json({ error: 'invalid parentId' });
    if (parent.parentId) return res.status(400).json({ error: 'only one level of nesting' });
    parentId = parent.id;
  }
  let category = null;
  if (!parentId) {
    category = (req.body.category || DEFAULT_CATEGORY).toString();
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'invalid category' });
  }
  let dueDate = null;
  if (req.body.dueDate !== undefined) {
    dueDate = normalizeDueDate(req.body.dueDate);
    if (dueDate === undefined) return res.status(400).json({ error: 'invalid dueDate' });
  }
  const todo = {
    id,
    text,
    done: false,
    parentId,
    category,
    dueDate,
    createdAt: Date.now(),
    deletedAt: null,
  };
  todos.unshift(todo);
  saveTodos(todos);
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', requireAuth, (req, res) => {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === req.params.id && !t.deletedAt);
  if (!todo) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.done === 'boolean') todo.done = req.body.done;
  if (typeof req.body.text === 'string') {
    const text = req.body.text.trim();
    if (text) todo.text = text.slice(0, 500);
  }
  if (typeof req.body.category === 'string' && !todo.parentId) {
    if (!CATEGORIES.includes(req.body.category)) return res.status(400).json({ error: 'invalid category' });
    todo.category = req.body.category;
  }
  if (req.body.dueDate !== undefined) {
    const d = normalizeDueDate(req.body.dueDate);
    if (d === undefined) return res.status(400).json({ error: 'invalid dueDate' });
    todo.dueDate = d;
  }
  saveTodos(todos);
  res.json(todo);
});

app.delete('/api/todos/:id', requireAuth, (req, res) => {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === req.params.id && !t.deletedAt);
  if (!todo) return res.status(404).json({ error: 'not found' });
  const now = Date.now();
  todo.deletedAt = now;
  for (const t of todos) {
    if (t.parentId === todo.id && !t.deletedAt) t.deletedAt = now;
  }
  saveTodos(todos);
  res.status(204).end();
});

app.post('/api/todos/:id/restore', requireAuth, (req, res) => {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === req.params.id && t.deletedAt);
  if (!todo) return res.status(404).json({ error: 'not found' });
  todo.deletedAt = null;
  saveTodos(todos);
  res.json(todo);
});

app.delete('/api/trash/:id', requireAuth, (req, res) => {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === req.params.id && t.deletedAt);
  if (!todo) return res.status(404).json({ error: 'not found' });
  const next = todos.filter(t => t.id !== req.params.id);
  saveTodos(next);
  res.status(204).end();
});

app.delete('/api/trash', requireAuth, (req, res) => {
  const todos = loadTodos();
  saveTodos(todos.filter(t => !t.deletedAt));
  res.status(204).end();
});

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

app.listen(PORT, () => {
  console.log(`Todos app listening on :${PORT}`);
});
