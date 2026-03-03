const translateBtn = document.getElementById('translateBtn');
const removeBtn = document.getElementById('removeBtn');
const manageBtn = document.getElementById('manageBtn');
const targetLangSelect = document.getElementById('targetLang');
const engineSelect = document.getElementById('engine');
const status = document.getElementById('status');
const serverList = document.getElementById('serverList');
const addServerBtn = document.getElementById('addServerBtn');
const saveServerBtn = document.getElementById('saveServerBtn');
const formTitle = document.getElementById('formTitle');

const serverNameInput = document.getElementById('serverName');
const serverEndpointInput = document.getElementById('serverEndpoint');
const serverModelInput = document.getElementById('serverModel');
const serverApiKeyInput = document.getElementById('serverApiKey');

let aiServers = [];
let editingServerId = null;

// --- 뷰 전환 ---

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.querySelectorAll('.btn-back').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.target));
});

manageBtn.addEventListener('click', () => {
  renderServerList();
  showView('viewServers');
});

// --- 마이그레이션 + 초기 로드 ---

chrome.storage.local.get(['targetLang', 'engine', 'aiEndpoint', 'aiModel', 'aiApiKey', 'aiServers'], (result) => {
  // 기존 flat 키 → aiServers 배열 마이그레이션
  if (result.aiEndpoint && !result.aiServers) {
    const migrated = {
      id: crypto.randomUUID(),
      name: result.aiModel || 'AI Server',
      endpoint: result.aiEndpoint,
      model: result.aiModel || '',
      apiKey: result.aiApiKey || '',
    };
    aiServers = [migrated];
    const newEngine = result.engine === 'ai' ? `ai:${migrated.id}` : (result.engine || 'google');
    chrome.storage.local.set({ aiServers, engine: newEngine });
    chrome.storage.local.remove(['aiEndpoint', 'aiModel', 'aiApiKey']);
  } else {
    aiServers = result.aiServers || [];
  }

  if (result.targetLang) targetLangSelect.value = result.targetLang;

  renderEngineOptions();

  const engine = result.engine || 'google';
  // 선택된 서버가 삭제된 경우 google로 폴백
  if (engine.startsWith('ai:')) {
    const serverId = engine.slice(3);
    if (!aiServers.find((s) => s.id === serverId)) {
      engineSelect.value = 'google';
      chrome.storage.local.set({ engine: 'google' });
    } else {
      engineSelect.value = engine;
    }
  } else {
    engineSelect.value = engine;
  }
});

// --- 엔진 드롭다운 ---

function renderEngineOptions() {
  const current = engineSelect.value;
  engineSelect.innerHTML = '';

  const googleOpt = document.createElement('option');
  googleOpt.value = 'google';
  googleOpt.textContent = 'Google 번역';
  engineSelect.appendChild(googleOpt);

  for (const server of aiServers) {
    const opt = document.createElement('option');
    opt.value = `ai:${server.id}`;
    opt.textContent = server.name;
    engineSelect.appendChild(opt);
  }

  // 이전 선택 복원 시도
  if (current && [...engineSelect.options].some((o) => o.value === current)) {
    engineSelect.value = current;
  }
}

engineSelect.addEventListener('change', () => {
  chrome.storage.local.set({ engine: engineSelect.value });
});

// --- 언어 변경 ---

targetLangSelect.addEventListener('change', () => {
  chrome.storage.local.set({ targetLang: targetLangSelect.value });
});

// --- 서버 목록 (View 2) ---

function renderServerList() {
  serverList.innerHTML = '';

  if (aiServers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'server-empty';
    empty.textContent = '등록된 서버가 없습니다';
    serverList.appendChild(empty);
    return;
  }

  for (const server of aiServers) {
    const item = document.createElement('div');
    item.className = 'server-item';

    const name = document.createElement('span');
    name.className = 'server-item-name';
    name.textContent = server.name;

    const actions = document.createElement('div');
    actions.className = 'server-item-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = '편집';
    editBtn.addEventListener('click', () => openEditForm(server));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = '삭제';
    deleteBtn.addEventListener('click', () => deleteServer(server.id));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(name);
    item.appendChild(actions);
    serverList.appendChild(item);
  }
}

// --- 서버 추가/편집 (View 3) ---

addServerBtn.addEventListener('click', () => {
  editingServerId = null;
  formTitle.textContent = '서버 추가';
  serverNameInput.value = '';
  serverEndpointInput.value = '';
  serverModelInput.value = '';
  serverApiKeyInput.value = '';
  showView('viewServerForm');
});

function openEditForm(server) {
  editingServerId = server.id;
  formTitle.textContent = '서버 편집';
  serverNameInput.value = server.name;
  serverEndpointInput.value = server.endpoint;
  serverModelInput.value = server.model;
  serverApiKeyInput.value = server.apiKey;
  showView('viewServerForm');
}

saveServerBtn.addEventListener('click', () => {
  const name = serverNameInput.value.trim();
  const endpoint = serverEndpointInput.value.trim();
  const model = serverModelInput.value.trim();
  const apiKey = serverApiKeyInput.value.trim();

  if (!name || !endpoint || !model) return;

  if (editingServerId) {
    // 편집
    const idx = aiServers.findIndex((s) => s.id === editingServerId);
    if (idx !== -1) {
      aiServers[idx] = { ...aiServers[idx], name, endpoint, model, apiKey };
    }
  } else {
    // 추가
    aiServers.push({ id: crypto.randomUUID(), name, endpoint, model, apiKey });
  }

  chrome.storage.local.set({ aiServers }, () => {
    renderEngineOptions();
    renderServerList();
    showView('viewServers');
  });
});

// --- 서버 삭제 ---

function deleteServer(id) {
  if (!confirm('이 서버를 삭제하시겠습니까?')) return;

  aiServers = aiServers.filter((s) => s.id !== id);

  // 선택된 서버가 삭제되면 google으로 폴백
  if (engineSelect.value === `ai:${id}`) {
    engineSelect.value = 'google';
    chrome.storage.local.set({ engine: 'google' });
  }

  chrome.storage.local.set({ aiServers }, () => {
    renderEngineOptions();
    renderServerList();
  });
}

// --- 번역 ---

translateBtn.addEventListener('click', async () => {
  const targetLang = targetLangSelect.value;
  const engine = engineSelect.value;

  translateBtn.disabled = true;
  translateBtn.textContent = '번역 중...';
  setStatus('페이지를 번역하고 있습니다...', '');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }).catch(() => {});

    const msg = { action: 'translate', targetLang, engine };

    if (engine.startsWith('ai:')) {
      const serverId = engine.slice(3);
      const server = aiServers.find((s) => s.id === serverId);
      if (server) {
        msg.engine = 'ai';
        msg.aiConfig = {
          endpoint: server.endpoint.replace(/\/+$/, ''),
          model: server.model,
          apiKey: server.apiKey,
        };
      }
    }

    chrome.tabs.sendMessage(tab.id, msg, (response) => {
      if (chrome.runtime.lastError) {
        setStatus('페이지에 접근할 수 없습니다.', 'error');
      } else if (response?.success) {
        setStatus(`번역 완료! (${response.count}개 블록)`, 'success');
      } else {
        setStatus(response?.error || '번역에 실패했습니다.', 'error');
      }
      translateBtn.disabled = false;
      translateBtn.textContent = '번역';
    });
  } catch (err) {
    setStatus('오류가 발생했습니다.', 'error');
    translateBtn.disabled = false;
    translateBtn.textContent = '번역';
  }
});

// --- 번역 제거 ---

removeBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'remove' }, (response) => {
      if (response?.success) {
        setStatus('번역이 제거되었습니다.', '');
      }
    });
  } catch (err) {
    // ignore
  }
});

function setStatus(message, type) {
  status.textContent = message;
  status.className = 'status' + (type ? ` ${type}` : '');
}
