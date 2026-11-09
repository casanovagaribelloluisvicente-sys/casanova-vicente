// =============================================================
//  Chat Local — cliente
// =============================================================
const $ = (s) => document.querySelector(s);

const state = {
  token: localStorage.getItem('chat_token'),
  me: null,
  users: new Map(),     // id -> usuario (con .online)
  room: 'general',
  unread: {},           // room -> número
  last: {},             // room -> último mensaje
  typing: {},           // room -> Map(userId -> username)
  messages: [],         // mensajes de la sala abierta
  socket: null,
};

// ---------- Utilidades ----------
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2800);
}
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (state.token || '') },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de conexión');
  return data;
}
const dmRoom = (a, b) => 'dm:' + [a, b].sort().join(':');
const otherInRoom = (room) => room.split(':').slice(1).find((id) => id !== state.me.id);
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function fmtDay(ts) {
  const d = new Date(ts), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === y.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function avatarEl(user, cls = 'avatar', withDot = false) {
  const a = el('div', cls);
  if (user && user.avatar) a.style.backgroundImage = `url(${user.avatar})`;
  else {
    a.style.background = user ? user.color : '#334';
    a.textContent = user ? user.username[0].toUpperCase() : '?';
  }
  if (withDot) a.appendChild(el('span', 'dot' + (user.online ? ' on' : '')));
  return a;
}
function paintAvatar(node, user) {
  node.style.background = '';
  node.style.backgroundImage = '';
  node.textContent = '';
  if (user.avatar) node.style.backgroundImage = `url(${user.avatar})`;
  else { node.style.background = user.color; node.textContent = user.username[0].toUpperCase(); }
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; o.type = 'sine';
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch (e) { /* sin sonido */ }
}
function updateTitle() {
  const n = Object.values(state.unread).reduce((a, b) => a + b, 0);
  document.title = n ? `(${n}) Chat Local` : 'Chat Local';
}

// Convierte archivo/blob a data URL, reduciendo imágenes grandes
function blobToDataUrl(blob) {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = fail;
    r.readAsDataURL(blob);
  });
}
async function imageToDataUrl(file, max = 1600) {
  if (file.type === 'image/gif') return blobToDataUrl(file);
  const url = URL.createObjectURL(file);
  const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', 0.85);
}
async function upload(dataUrl) {
  return (await api('/api/upload', { dataUrl })).url;
}

// =============================================================
//  ACCESO (login / registro)
// =============================================================
let mode = 'login';
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    mode = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('.tabs').classList.toggle('register', mode === 'register');
    $('#confirmWrap').classList.toggle('hidden', mode === 'login');
    $('#authBtn span').textContent = mode === 'login' ? 'Entrar al chat' : 'Crear mi cuenta';
    $('#authSubtitle').textContent = mode === 'login' ? 'Inicia sesión para entrar a la sala.' : 'Crea tu cuenta en segundos.';
    $('#password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#authError').textContent = '';
  });
});
$('#togglePass').addEventListener('click', () => {
  const p = $('#password');
  p.type = p.type === 'password' ? 'text' : 'password';
});

function authError(msg) {
  const e = $('#authError');
  e.textContent = msg;
  e.classList.remove('shake'); void e.offsetWidth; e.classList.add('shake');
}

$('#authForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const username = $('#username').value.trim();
  const password = $('#password').value;
  if (password.length < 8) return authError('La contraseña debe tener mínimo 8 caracteres');
  if (mode === 'register' && password !== $('#password2').value) return authError('Las contraseñas no coinciden');
  const btn = $('#authBtn');
  btn.classList.add('loading'); btn.disabled = true;
  try {
    const data = await api('/api/' + (mode === 'login' ? 'login' : 'register'), { username, password });
    state.token = data.token;
    localStorage.setItem('chat_token', data.token);
    startApp(data.user);
    if (mode === 'register') toast(`¡Bienvenido, ${data.user.username}! 🎉`);
  } catch (e) {
    authError(e.message);
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
});

async function logout() {
  try { await api('/api/logout', {}); } catch (e) { /* nada */ }
  localStorage.removeItem('chat_token');
  location.reload();
}
$('#logoutBtn').addEventListener('click', logout);

// =============================================================
//  APP
// =============================================================
function startApp(user) {
  state.me = user;
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#myName').textContent = user.username;
  paintAvatar($('#myAvatar'), user);

  const socket = io({ auth: { token: state.token } });
  state.socket = socket;

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') { localStorage.removeItem('chat_token'); location.reload(); }
  });
  socket.on('connect', () => openRoom(state.room));

  socket.on('presence', (list) => {
    list.forEach((u) => state.users.set(u.id, u));
    renderList();
    renderHeader();
  });
  socket.on('user:new', (u) => { state.users.set(u.id, { ...u, online: false }); renderList(); });
  socket.on('user:update', (u) => {
    const prev = state.users.get(u.id) || {};
    state.users.set(u.id, { ...prev, ...u });
    if (u.id === state.me.id) { state.me = { ...state.me, ...u }; paintAvatar($('#myAvatar'), state.me); }
    renderList(); renderHeader(); renderMessages();
  });

  socket.on('message', (msg) => {
    state.last[msg.room] = msg;
    clearTyping(msg.room, msg.from);
    if (msg.room === state.room) {
      state.messages.push(msg);
      appendMessage(msg, true);
      if (msg.room !== 'general' && msg.from !== state.me.id) socket.emit('read', { room: msg.room });
    } else if (msg.from !== state.me.id) {
      state.unread[msg.room] = (state.unread[msg.room] || 0) + 1;
      const who = state.users.get(msg.from);
      toast(`💬 ${who ? who.username : 'Alguien'}${msg.room === 'general' ? ' en la sala general' : ''}: ${preview(msg)}`);
    }
    if (msg.from !== state.me.id && (document.hidden || msg.room !== state.room)) beep();
    updateTitle();
    renderList();
  });

  socket.on('read', ({ room, by }) => {
    if (room !== state.room || by === state.me.id) return;
    state.messages.forEach((m) => { if (!m.readBy.includes(by)) m.readBy.push(by); });
    document.querySelectorAll('.ticks').forEach((t) => { t.textContent = '✓✓'; t.classList.add('read'); });
  });

  socket.on('typing', ({ room, userId, username, typing }) => {
    if (!state.typing[room]) state.typing[room] = new Map();
    if (typing) state.typing[room].set(userId, username);
    else state.typing[room].delete(userId);
    renderTyping();
  });
}

function clearTyping(room, userId) {
  if (state.typing[room]) { state.typing[room].delete(userId); renderTyping(); }
}
function renderTyping() {
  const map = state.typing[state.room];
  const names = map ? [...map.values()] : [];
  $('#typing').classList.toggle('hidden', !names.length);
  if (!names.length) return;
  $('#typingText').textContent = state.room === 'general'
    ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ' y otros' : ''} ${names.length > 1 ? 'están' : 'está'} escribiendo...`
    : 'escribiendo...';
}

function preview(msg) {
  if (!msg) return '';
  if (msg.type === 'image') return '📷 Foto' + (msg.text ? ': ' + msg.text : '');
  if (msg.type === 'audio') return '🎤 Nota de voz';
  return msg.text;
}

// ---------- Lista de chats ----------
function renderList() {
  const list = $('#chatList');
  const q = $('#searchInput').value.trim().toLowerCase();
  list.innerHTML = '';

  const general = { room: 'general', name: 'Sala general', sub: preview(state.last.general) || 'Habla con todos 🌍' };
  if (!q || general.name.toLowerCase().includes(q)) {
    list.appendChild(el('div', 'section-title', 'Salas'));
    const item = chatItem(general.room, general.name, general.sub);
    const av = el('div', 'avatar', '🌍');
    av.style.background = 'linear-gradient(135deg,#06b6d4,#3b82f6)';
    item.prepend(av);
    list.appendChild(item);
  }

  const users = [...state.users.values()]
    .filter((u) => u.id !== state.me.id && u.username.toLowerCase().includes(q))
    .sort((a, b) => (b.online - a.online) || a.username.localeCompare(b.username));
  const onlineCount = users.filter((u) => u.online).length;
  list.appendChild(el('div', 'section-title', `Personas · ${onlineCount} en línea`));
  if (!users.length) list.appendChild(el('div', 'section-title', q ? 'Sin resultados' : 'Aún no hay más usuarios. ¡Crea otra cuenta en otra pestaña!'));
  users.forEach((u, i) => {
    const room = dmRoom(state.me.id, u.id);
    const item = chatItem(room, u.username, preview(state.last[room]) || (u.online ? '🟢 En línea' : 'Desconectado'));
    item.prepend(avatarEl(u, 'avatar', true));
    item.style.animationDelay = i * 0.03 + 's';
    list.appendChild(item);
  });
}
function chatItem(room, name, sub) {
  const b = el('button', 'chat-item' + (room === state.room ? ' active' : ''));
  const info = el('div', 'info');
  info.append(el('strong', '', name), el('span', '', sub));
  b.appendChild(info);
  if (state.unread[room]) b.appendChild(el('span', 'badge', state.unread[room]));
  b.addEventListener('click', () => openRoom(room));
  return b;
}
$('#searchInput').addEventListener('input', renderList);

// ---------- Abrir conversación ----------
function openRoom(room) {
  if (state.room !== room) stopTyping();
  state.room = room;
  state.unread[room] = 0;
  updateTitle();
  $('#app').classList.add('in-chat');
  renderHeader();
  renderList();
  renderTyping();
  $('#messages').innerHTML = '';
  state.socket.emit('history', { room }, (msgs) => {
    if (state.room !== room) return;
    state.messages = msgs;
    if (msgs.length) state.last[room] = msgs[msgs.length - 1];
    renderMessages();
    if (room !== 'general') state.socket.emit('read', { room });
  });
  if (window.innerWidth > 800) $('#msgInput').focus();
}
$('#backBtn').addEventListener('click', () => $('#app').classList.remove('in-chat'));

function renderHeader() {
  if (!state.me) return;
  const av = $('#chatAvatar');
  if (state.room === 'general') {
    av.style.backgroundImage = '';
    av.style.background = 'linear-gradient(135deg,#06b6d4,#3b82f6)';
    av.textContent = '🌍';
    $('#chatName').textContent = 'Sala general';
    const n = [...state.users.values()].filter((u) => u.online).length;
    $('#chatStatus').textContent = `${state.users.size} miembros · ${n} en línea`;
  } else {
    const u = state.users.get(otherInRoom(state.room));
    if (!u) return;
    paintAvatar(av, u);
    $('#chatName').textContent = u.username;
    $('#chatStatus').textContent = u.online ? '🟢 En línea' : 'Desconectado';
  }
}

// ---------- Mensajes ----------
function renderMessages() {
  const box = $('#messages');
  box.innerHTML = '';
  if (!state.messages.length) {
    const e = el('div', 'empty');
    e.append(el('span', 'big-emoji', '👋'), el('div', '', state.room === 'general'
      ? '¡Sé el primero en saludar a todos!' : 'Aún no hay mensajes. ¡Di hola!'));
    box.appendChild(e);
    return;
  }
  state.messages.forEach((m, i) => appendMessage(m, false, state.messages[i - 1]));
  box.scrollTop = box.scrollHeight;
}

function appendMessage(msg, animate, prevMsg) {
  const box = $('#messages');
  const empty = box.querySelector('.empty');
  if (empty) empty.remove();
  const prev = prevMsg !== undefined ? prevMsg : state.messages[state.messages.indexOf(msg) - 1];

  if (!prev || new Date(prev.ts).toDateString() !== new Date(msg.ts).toDateString())
    box.appendChild(el('div', 'day-sep', fmtDay(msg.ts)));

  const mine = msg.from === state.me.id;
  const grouped = prev && prev.from === msg.from && msg.ts - prev.ts < 5 * 60 * 1000;
  const user = state.users.get(msg.from) || { username: '???', color: '#555' };

  const row = el('div', 'msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : ''));
  if (!animate) row.style.animation = 'none';
  if (!mine) row.appendChild(avatarEl(user));

  const bubble = el('div', 'bubble');
  if (!mine && !grouped && state.room === 'general') {
    const a = el('div', 'author', user.username);
    a.style.color = user.color;
    bubble.appendChild(a);
  }

  if (msg.type === 'image') {
    const img = el('img', 'photo');
    img.src = msg.url;
    img.loading = 'lazy';
    img.alt = 'Foto';
    img.addEventListener('click', () => { $('#lightboxImg').src = msg.url; $('#lightbox').classList.remove('hidden'); });
    img.addEventListener('load', () => { if (animate) box.scrollTop = box.scrollHeight; });
    bubble.appendChild(img);
    if (msg.text) bubble.appendChild(el('div', 'text', msg.text));
  } else if (msg.type === 'audio') {
    bubble.appendChild(audioPlayer(msg));
  } else {
    bubble.appendChild(el('div', 'text', msg.text));
  }

  const meta = el('div', 'meta');
  meta.appendChild(el('span', '', fmtTime(msg.ts)));
  if (mine && state.room !== 'general') {
    const other = otherInRoom(state.room);
    const read = msg.readBy && msg.readBy.includes(other);
    meta.appendChild(el('span', 'ticks' + (read ? ' read' : ''), read ? '✓✓' : '✓'));
  }
  bubble.appendChild(meta);
  row.appendChild(bubble);
  box.appendChild(row);

  if (animate) {
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 250;
    if (nearBottom || mine) box.scrollTop = box.scrollHeight;
  }
}

// Reproductor de notas de voz con barras animadas
let currentAudio = null;
function audioPlayer(msg) {
  const wrap = el('div', 'audio');
  const play = el('button', 'play', '▶');
  const track = el('div', 'track');
  const dur = el('span', 'dur', fmtDur(msg.duration || 0));
  // barras "aleatorias" pero siempre iguales para el mismo mensaje
  let seed = [...msg.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const bars = [];
  for (let i = 0; i < 30; i++) {
    seed = (seed * 9301 + 49297) % 233280;
    const b = el('i');
    b.style.height = 20 + (seed / 233280) * 80 + '%';
    bars.push(b); track.appendChild(b);
  }
  const audio = new Audio(msg.url);
  audio.preload = 'metadata';
  const total = () => (isFinite(audio.duration) && audio.duration) || msg.duration || 1;

  play.addEventListener('click', () => {
    if (audio.paused) {
      if (currentAudio && currentAudio !== audio) currentAudio.pause();
      currentAudio = audio;
      audio.play();
    } else audio.pause();
  });
  audio.addEventListener('play', () => (play.textContent = '⏸'));
  audio.addEventListener('pause', () => (play.textContent = '▶'));
  audio.addEventListener('ended', () => {
    play.textContent = '▶';
    bars.forEach((b) => b.classList.remove('on'));
    dur.textContent = fmtDur(msg.duration || 0);
  });
  audio.addEventListener('timeupdate', () => {
    const p = audio.currentTime / total();
    bars.forEach((b, i) => b.classList.toggle('on', i / bars.length < p));
    dur.textContent = fmtDur(audio.currentTime);
  });
  track.addEventListener('click', (e) => {
    const r = track.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * total();
  });
  wrap.append(play, track, dur);
  return wrap;
}

$('#lightbox').addEventListener('click', () => $('#lightbox').classList.add('hidden'));

// ---------- Enviar texto ----------
function send(data) {
  state.socket.emit('message', { room: state.room, ...data });
}
const msgInput = $('#msgInput');
function toggleSendMic() {
  const has = msgInput.value.trim().length > 0;
  $('#sendBtn').classList.toggle('hidden', !has);
  $('#micBtn').classList.toggle('hidden', has);
}
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text) return;
  send({ type: 'text', text });
  msgInput.value = '';
  toggleSendMic();
  stopTyping();
  $('#emojiPanel').classList.add('hidden');
});

// Indicador "escribiendo..."
let typingTimer = null, isTyping = false;
msgInput.addEventListener('input', () => {
  toggleSendMic();
  if (!isTyping) { isTyping = true; state.socket.emit('typing', { room: state.room, typing: true }); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 1500);
});
function stopTyping() {
  clearTimeout(typingTimer);
  if (isTyping && state.socket) state.socket.emit('typing', { room: state.room, typing: false });
  isTyping = false;
}

// ---------- Emojis ----------
const EMOJIS = '😀 😂 🤣 😊 😍 🥰 😘 😎 🤩 🥳 😇 🤔 🤨 😐 🙄 😏 😴 🤤 😜 🤪 😢 😭 😡 🤯 😱 🥶 🥵 🤗 🤭 🫡 👍 👎 👏 🙌 🙏 💪 👋 🤝 ✌️ 🤞 👌 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 🔥 ✨ ⭐ 🎉 🎂 🎁 💯 ✅ ❌ ⚽ 🎮 🎵 📷 🍕 🍔 🍟 🌮 ☕ 🍺 🐶 🐱 🌹 🌞 🌙 🌈 🚀 💬'.split(' ');
const panel = $('#emojiPanel');
EMOJIS.forEach((em) => {
  const b = el('button', '', em);
  b.type = 'button';
  b.addEventListener('click', () => {
    msgInput.value += em;
    toggleSendMic();
    msgInput.focus();
  });
  panel.appendChild(b);
});
$('#emojiBtn').addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('hidden'); });
document.addEventListener('click', (e) => { if (!e.target.closest('.emoji-wrap')) panel.classList.add('hidden'); });

// ---------- Fotos: galería + vista previa ----------
let pendingImage = null;
function showPreview(dataUrl) {
  pendingImage = dataUrl;
  $('#previewImg').src = dataUrl;
  $('#previewCaption').value = '';
  $('#preview').classList.remove('hidden');
  $('#previewCaption').focus();
}
function hidePreview() { pendingImage = null; $('#preview').classList.add('hidden'); }

$('#attachBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Solo se pueden enviar imágenes');
  try { showPreview(await imageToDataUrl(file)); } catch (err) { toast('No se pudo leer la imagen'); }
});
$('#previewCancel').addEventListener('click', hidePreview);
async function sendPreview() {
  if (!pendingImage) return;
  const dataUrl = pendingImage, text = $('#previewCaption').value.trim();
  hidePreview();
  try {
    toast('Enviando foto... 📤');
    send({ type: 'image', url: await upload(dataUrl), text });
  } catch (e) { toast('Error: ' + e.message); }
}
$('#previewSend').addEventListener('click', sendPreview);
$('#previewCaption').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendPreview(); });

// Pegar imágenes con Ctrl+V
document.addEventListener('paste', async (e) => {
  if (!state.me) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) showPreview(await imageToDataUrl(item.getAsFile()));
});

// ---------- Cámara ----------
let camStream = null, facing = 'user';
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia)
    return toast('Tu navegador no permite usar la cámara aquí (usa http://localhost)');
  try {
    closeStream();
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
    const v = $('#video');
    v.srcObject = camStream;
    v.classList.toggle('back', facing === 'environment');
    $('#cameraModal').classList.remove('hidden');
  } catch (e) {
    toast('No se pudo abrir la cámara: ' + (e.name === 'NotAllowedError' ? 'permiso denegado' : e.message));
  }
}
function closeStream() { if (camStream) camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
function closeCamera() { closeStream(); $('#cameraModal').classList.add('hidden'); }

$('#cameraBtn').addEventListener('click', openCamera);
$('#camClose').addEventListener('click', closeCamera);
$('#camSwitch').addEventListener('click', () => { facing = facing === 'user' ? 'environment' : 'user'; openCamera(); });
$('#shutter').addEventListener('click', () => {
  const v = $('#video'), c = $('#canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d');
  if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); } // efecto espejo
  ctx.drawImage(v, 0, 0);
  const f = $('#flash');
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  const dataUrl = c.toDataURL('image/jpeg', 0.88);
  setTimeout(() => { closeCamera(); showPreview(dataUrl); }, 250);
});

// ---------- Notas de voz ----------
let recorder = null, recChunks = [], recStart = 0, recTimer = null, recCancelled = false, audioCtx = null, waveRAF = null;

$('#micBtn').addEventListener('click', startRecording);
async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    return toast('Tu navegador no permite grabar audio aquí');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { return toast('No se pudo usar el micrófono: ' + (e.name === 'NotAllowedError' ? 'permiso denegado' : e.message)); }

  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    .find((t) => MediaRecorder.isTypeSupported(t)) || '';
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recChunks = []; recCancelled = false;
  recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    cancelAnimationFrame(waveRAF);
    if (audioCtx) audioCtx.close();
    clearInterval(recTimer);
    $('#recorder').classList.add('hidden');
    $('#composer').classList.remove('hidden');
    const duration = (Date.now() - recStart) / 1000;
    if (recCancelled || duration < 0.5) return;
    const type = (recorder.mimeType || 'audio/webm').split(';')[0];
    const blob = new Blob(recChunks, { type });
    try {
      const url = await upload(await blobToDataUrl(blob));
      send({ type: 'audio', url, duration: Math.round(duration) });
    } catch (e) { toast('Error al enviar audio: ' + e.message); }
  };
  recorder.start();
  recStart = Date.now();

  $('#composer').classList.add('hidden');
  $('#recorder').classList.remove('hidden');
  $('#recTime').textContent = '0:00';
  recTimer = setInterval(() => {
    const s = (Date.now() - recStart) / 1000;
    $('#recTime').textContent = fmtDur(s);
    if (s >= 300) stopRecording(false); // máximo 5 minutos
  }, 250);

  // Onda animada en vivo
  const wave = $('#wave');
  wave.innerHTML = '';
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  audioCtx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let last = 0;
  const draw = (t) => {
    waveRAF = requestAnimationFrame(draw);
    if (t - last < 70) return;
    last = t;
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    const bar = el('i');
    bar.style.height = Math.max(8, Math.min(100, peak * 1.6)) + '%';
    wave.appendChild(bar);
    if (wave.children.length > 120) wave.firstChild.remove();
  };
  waveRAF = requestAnimationFrame(draw);
}
function stopRecording(cancel) {
  recCancelled = cancel;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}
$('#recSend').addEventListener('click', () => stopRecording(false));
$('#recCancel').addEventListener('click', () => { stopRecording(true); toast('Audio descartado'); });

// ---------- Foto de perfil ----------
$('#myAvatar').addEventListener('click', () => $('#avatarInput').click());
$('#avatarInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const url = await upload(await imageToDataUrl(file, 400));
    await api('/api/avatar', { url });
    toast('Foto de perfil actualizada ✨');
  } catch (err) { toast('Error: ' + err.message); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('#lightbox').classList.add('hidden');
    if (!$('#cameraModal').classList.contains('hidden')) closeCamera();
    panel.classList.add('hidden');
  }
});

// ---------- Inicio: ¿ya hay sesión guardada? ----------
(async () => {
  if (!state.token) return;
  try {
    const { user } = await api('/api/me');
    startApp(user);
  } catch (e) {
    localStorage.removeItem('chat_token');
    state.token = null;
  }
})();
