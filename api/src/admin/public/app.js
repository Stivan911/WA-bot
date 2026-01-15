let state = {
  users: [],
  selectedWa: null,
  polling: null,
};

function $(id) { return document.getElementById(id); }

function fmtTime(ms) {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString();
  } catch {
    return '-';
  }
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function loadMeta() {
  const meta = await fetchJson('./api/meta');
  $('meta-timeout').textContent = `AUTO_TIMEOUT: ${meta.autoTimeoutHours} jam`;
  $('meta-cs').textContent = `CS_NUMBER: ${meta.csNumber}`;
}

async function loadUsers() {
  const data = await fetchJson('./api/users?limit=200&offset=0');
  state.users = data.rows;
  renderUsers();
}

function renderUsers() {
  const q = ($('search').value || '').trim();
  const list = $('user-list');
  list.innerHTML = '';

  const filtered = state.users.filter(u => !q || String(u.wa_number).includes(q));
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = 'Belum ada conversation.';
    list.appendChild(empty);
    return;
  }

  for (const u of filtered) {
    const el = document.createElement('div');
    el.className = 'user';
    el.onclick = () => selectUser(u.wa_number);

    const top = document.createElement('div');
    top.className = 'top';

    const wa = document.createElement('div');
    wa.className = 'wa';
    wa.textContent = u.wa_number;

    const badge = document.createElement('div');
    badge.className = `badge ${u.mode === 'HUMAN' ? 'human' : 'bot'}`;
    badge.textContent = u.mode;

    top.appendChild(wa);
    top.appendChild(badge);

    const bottom = document.createElement('div');
    bottom.className = 'bottom';
    bottom.innerHTML = `<span>last: ${fmtTime(u.last_interaction_at)}</span><span>${u.selected_menu ? 'menu:' + u.selected_menu : ''}</span>`;

    el.appendChild(top);
    el.appendChild(bottom);

    list.appendChild(el);
  }
}

async function selectUser(wa) {
  state.selectedWa = wa;
  $('empty').classList.add('hidden');
  $('chat').classList.remove('hidden');

  $('chat-wa').textContent = wa;

  await loadMessages();

  // polling every 3s
  if (state.polling) clearInterval(state.polling);
  state.polling = setInterval(loadMessages, 3000);
}

async function loadMessages() {
  if (!state.selectedWa) return;
  const wa = state.selectedWa;
  const data = await fetchJson(`./api/users/${encodeURIComponent(wa)}/messages?limit=20&offset=0`);

  if (!data.user) return;

  $('chat-mode').textContent = data.user.mode;
  $('chat-mode').className = 'pill';
  $('chat-last').textContent = fmtTime(data.user.last_interaction_at);

  const box = $('messages');
  box.innerHTML = '';

  // API returns newest first, reverse for timeline
  const msgs = (data.messages || []).slice().reverse();
  for (const m of msgs) {
    const wrap = document.createElement('div');
    const direction = (m.direction || 'SYS').toLowerCase();
    wrap.className = `msg ${direction}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<span>${m.direction}</span><span>${fmtTime(m.created_at)}</span>`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.text;

    wrap.appendChild(meta);
    wrap.appendChild(bubble);
    box.appendChild(wrap);
  }

  // auto scroll to bottom
  box.scrollTop = box.scrollHeight;
}

async function setMode(mode) {
  if (!state.selectedWa) return;
  const notifyUser = $('notifyUser').checked;

  await fetchJson(`./api/users/${encodeURIComponent(state.selectedWa)}/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, notifyUser }),
  });

  await loadUsers();
  await loadMessages();
}

async function sendManual(text) {
  if (!state.selectedWa) return;
  await fetchJson(`./api/users/${encodeURIComponent(state.selectedWa)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  $('send-text').value = '';
  await loadMessages();
}

function bind() {
  $('btn-refresh').onclick = loadUsers;
  $('search').oninput = renderUsers;

  $('btn-takeover').onclick = () => setMode('HUMAN');
  $('btn-release').onclick = () => setMode('BOT');

  $('send-form').onsubmit = async (e) => {
    e.preventDefault();
    const text = ($('send-text').value || '').trim();
    if (!text) return;
    await sendManual(text);
  };
}

(async function main() {
  bind();
  await loadMeta();
  await loadUsers();
})();
