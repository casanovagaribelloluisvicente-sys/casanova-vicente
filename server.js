// =============================================================
//  Chat Local — servidor (Express + Socket.IO)
//  Guarda usuarios y mensajes en data/db.json y archivos en uploads/
// =============================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- "Base de datos" en un archivo JSON ----------
let db = { users: [], sessions: {}, messages: [] };
if (fs.existsSync(DB_FILE)) {
  try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; }
  catch (e) { console.error('No se pudo leer db.json, se crea uno nuevo.'); }
}
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), (err) => {
      if (err) console.error('Error guardando db:', err);
    });
  }, 300);
}

// ---------- Utilidades ----------
const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#eab308', '#ef4444'];
const newId = () => crypto.randomBytes(8).toString('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function checkPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
function publicUser(u) {
  return { id: u.id, username: u.username, color: u.color, avatar: u.avatar || null, createdAt: u.createdAt };
}
function userFromToken(token) {
  const userId = token && db.sessions[token];
  return userId ? db.users.find((u) => u.id === userId) : null;
}
function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = user.id;
  saveDB();
  return token;
}
function canAccessRoom(userId, room) {
  if (room === 'general') return true;
  if (room.startsWith('dm:')) return room.split(':').slice(1).includes(userId);
  return false;
}

// ---------- App HTTP ----------
const app = express();
app.use(express.json({ limit: '25mb' })); // fotos y audios llegan en base64
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Sesión no válida' });
  req.user = user;
  next();
}

app.post('/api/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_.áéíóúñÁÉÍÓÚÑ]{3,20}$/.test(username))
    return res.status(400).json({ error: 'El usuario debe tener 3 a 20 caracteres (letras, números, _ o .)' });
  if (password.length < 8)
    return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres' });
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });

  const { salt, hash } = hashPassword(password);
  const user = {
    id: newId(),
    username,
    salt,
    hash,
    color: COLORS[db.users.length % COLORS.length],
    avatar: null,
    createdAt: Date.now(),
  };
  db.users.push(user);
  const token = createSession(user);
  io.emit('user:new', publicUser(user));
  res.json({ token, user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !checkPassword(password, user.salt, user.hash))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  res.json({ token: createSession(user), user: publicUser(user) });
});

app.post('/api/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  delete db.sessions[token];
  saveDB();
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

// Subida de archivos (foto, audio, avatar) como data URL base64
const ALLOWED = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
};
app.post('/api/upload', auth, (req, res) => {
  const match = /^data:([\w/+.-]+)(;[^,]*)?;base64,(.+)$/.exec(req.body.dataUrl || '');
  if (!match) return res.status(400).json({ error: 'Archivo inválido' });
  const mime = match[1].split(';')[0];
  const ext = ALLOWED[mime];
  if (!ext) return res.status(400).json({ error: 'Tipo de archivo no permitido: ' + mime });
  const buffer = Buffer.from(match[3], 'base64');
  if (buffer.length > 15 * 1024 * 1024) return res.status(413).json({ error: 'Archivo muy grande (máx 15 MB)' });
  const name = `${Date.now()}-${newId()}.${ext}`;
  fs.writeFile(path.join(UPLOADS_DIR, name), buffer, (err) => {
    if (err) return res.status(500).json({ error: 'No se pudo guardar el archivo' });
    res.json({ url: '/uploads/' + name });
  });
});

app.post('/api/avatar', auth, (req, res) => {
  const url = String(req.body.url || '');
  if (!url.startsWith('/uploads/')) return res.status(400).json({ error: 'URL inválida' });
  req.user.avatar = url;
  saveDB();
  io.emit('user:update', publicUser(req.user));
  res.json({ user: publicUser(req.user) });
});

// ---------- Tiempo real ----------
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
const online = new Map(); // userId -> número de pestañas conectadas

function presenceList() {
  return db.users.map((u) => ({ ...publicUser(u), online: online.has(u.id) }));
}

io.use((socket, next) => {
  const user = userFromToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!user) return next(new Error('unauthorized'));
  socket.user = user;
  next();
});

io.on('connection', (socket) => {
  const me = socket.user;
  socket.join('general');
  socket.join('user:' + me.id);
  online.set(me.id, (online.get(me.id) || 0) + 1);
  io.emit('presence', presenceList());

  socket.on('history', ({ room }, cb) => {
    if (typeof cb !== 'function' || !canAccessRoom(me.id, room)) return;
    cb(db.messages.filter((m) => m.room === room).slice(-150));
  });

  socket.on('message', (data, cb) => {
    const room = String(data.room || '');
    if (!canAccessRoom(me.id, room)) return;
    const type = ['text', 'image', 'audio'].includes(data.type) ? data.type : 'text';
    const text = String(data.text || '').slice(0, 4000);
    const url = typeof data.url === 'string' && data.url.startsWith('/uploads/') ? data.url : null;
    if (type === 'text' && !text.trim()) return;
    if (type !== 'text' && !url) return;

    const msg = {
      id: newId(),
      room,
      from: me.id,
      type,
      text,
      url,
      duration: Number(data.duration) || 0,
      ts: Date.now(),
      readBy: [me.id],
    };
    db.messages.push(msg);
    if (db.messages.length > 5000) db.messages.splice(0, db.messages.length - 5000);
    saveDB();

    if (room === 'general') io.to('general').emit('message', msg);
    else room.split(':').slice(1).forEach((id) => io.to('user:' + id).emit('message', msg));
    if (typeof cb === 'function') cb({ ok: true, id: msg.id });
  });

  socket.on('read', ({ room }) => {
    if (!room || !room.startsWith('dm:') || !canAccessRoom(me.id, room)) return;
    let changed = false;
    db.messages.forEach((m) => {
      if (m.room === room && !m.readBy.includes(me.id)) { m.readBy.push(me.id); changed = true; }
    });
    if (changed) {
      saveDB();
      room.split(':').slice(1).forEach((id) => io.to('user:' + id).emit('read', { room, by: me.id }));
    }
  });

  socket.on('typing', ({ room, typing }) => {
    if (!room || !canAccessRoom(me.id, room)) return;
    const payload = { room, userId: me.id, username: me.username, typing: !!typing };
    if (room === 'general') socket.to('general').emit('typing', payload);
    else room.split(':').slice(1).filter((id) => id !== me.id)
      .forEach((id) => io.to('user:' + id).emit('typing', payload));
  });

  socket.on('disconnect', () => {
    const n = (online.get(me.id) || 1) - 1;
    if (n <= 0) online.delete(me.id); else online.set(me.id, n);
    io.emit('presence', presenceList());
  });
});

server.listen(PORT, () => {
  console.log(`\n  💬 Chat corriendo en  http://localhost:${PORT}\n`);
  const nets = require('os').networkInterfaces();
  Object.values(nets).flat().filter((n) => n && n.family === 'IPv4' && !n.internal)
    .forEach((n) => console.log(`  🌐 En tu red local:   http://${n.address}:${PORT}`));
  console.log('');
});
