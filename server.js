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

function loadTodos() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
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
  res.json(loadTodos());
});

app.post('/api/todos', requireAuth, (req, res) => {
  const text = (req.body.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 500) return res.status(400).json({ error: 'too long' });
  const todos = loadTodos();
  const todo = {
    id: crypto.randomUUID(),
    text,
    done: false,
    createdAt: Date.now(),
  };
  todos.unshift(todo);
  saveTodos(todos);
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', requireAuth, (req, res) => {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.done === 'boolean') todo.done = req.body.done;
  if (typeof req.body.text === 'string') {
    const text = req.body.text.trim();
    if (text) todo.text = text.slice(0, 500);
  }
  saveTodos(todos);
  res.json(todo);
});

app.delete('/api/todos/:id', requireAuth, (req, res) => {
  const todos = loadTodos();
  const next = todos.filter(t => t.id !== req.params.id);
  if (next.length === todos.length) return res.status(404).json({ error: 'not found' });
  saveTodos(next);
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
