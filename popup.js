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
const formStatus = document.getElementById('formStatus');

const summarizeBtn = document.getElementById('summarizeBtn');
const captureHideSelect = document.getElementById('captureHide');
const settingsBtn = document.getElementById('settingsBtn');
const settingsStatus = document.getElementById('settingsStatus');

const LANG_NAMES = {
  ko: 'Korean', en: 'English', ja: 'Japanese',
  'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
  es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', vi: 'Vietnamese', th: 'Thai', ru: 'Russian',
};

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

settingsBtn.addEventListener('click', () => {
  showView('viewSettings');
});

manageBtn.addEventListener('click', () => {
  renderServerList();
  showView('viewServers');
});

document.getElementById('clearCacheBtn').addEventListener('click', () => {
  chrome.storage.local.remove('hotdogCache', () => {
    settingsStatus.textContent = '번역 캐시가 삭제되었습니다.';
    settingsStatus.className = 'status success';
  });
});

// --- 요약 기능 ---

function updateSummarizeBtn() {
  summarizeBtn.disabled = !engineSelect.value.startsWith('ai:');
}

engineSelect.addEventListener('change', updateSummarizeBtn);

summarizeBtn.addEventListener('click', async () => {
  const engine = engineSelect.value;
  if (!engine.startsWith('ai:')) return;

  const serverId = engine.slice(3);
  const server = aiServers.find(s => s.id === serverId);
  if (!server) return;

  summarizeBtn.disabled = true;
  summarizeBtn.textContent = '요약 중...';
  setStatus('페이지를 요약하고 있습니다...', '');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});

    // content.js의 캐시 확인
    const cacheResult = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: 'summarize' }, (res) => resolve(res));
    });

    if (cacheResult?.cached) {
      setStatus('요약 완료 (캐시)', 'success');
      summarizeBtn.textContent = '요약';
      updateSummarizeBtn();
      return;
    }

    // 캐시 없으면 AI 호출
    const pageText = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'getSummaryText' }, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (res?.success) resolve(res.text);
        else reject(new Error('텍스트 수집 실패'));
      });
    });

    if (!pageText || pageText.trim().length < 10) throw new Error('요약할 텍스트가 부족합니다.');

    const targetLang = targetLangSelect.value;
    const langName = LANG_NAMES[targetLang] || targetLang;
    const aiConfig = { endpoint: server.endpoint.replace(/\/+$/, ''), model: server.model, apiKey: server.apiKey };

    // 혼합 콘텐츠/CORS 우회를 위해 background 서비스워커 경유로 호출
    const resp = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'aiChat',
        endpoint: aiConfig.endpoint,
        model: aiConfig.model,
        apiKey: aiConfig.apiKey,
        messages: [
          { role: 'system', content: `You are a summarizer. Summarize the following page content concisely in ${langName}. Format your response in markdown: use "- " for bullet points, "**bold**" for emphasis, and "## " for section headers if needed. Be specific, not generic.` },
          { role: 'user', content: pageText },
        ],
      }, (r) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(r);
      });
    });

    if (!resp?.success) {
      const redacted = String(resp?.error || '알 수 없는 오류').slice(0, 200).replace(
        /sk-[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_]+|gh[pous]_[A-Za-z0-9_]+|Bearer\s+\S+/gi,
        '[REDACTED]'
      );
      throw new Error(resp?.status ? `AI API error: ${resp.status} ${redacted}` : `AI 요청 실패: ${redacted}`);
    }

    const summary = resp.content || '요약 결과 없음';

    // content.js의 슬라이드 카드로 표시 + 캐시 저장
    chrome.tabs.sendMessage(tab.id, { action: 'showSummaryCard', text: summary });
    setStatus('요약 완료', 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    summarizeBtn.textContent = '요약';
    updateSummarizeBtn();
  }
});


// --- 마이그레이션 + 초기 로드 ---

chrome.storage.local.get(['targetLang', 'engine', 'aiEndpoint', 'aiModel', 'aiApiKey', 'aiServers', 'captureHideSec'], (result) => {
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

  captureHideSelect.value = String(result.captureHideSec ?? 3);

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
  updateSummarizeBtn();
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
  updateSummarizeBtn();
}

engineSelect.addEventListener('change', () => {
  chrome.storage.local.set({ engine: engineSelect.value });
});

// --- 언어 변경 ---

targetLangSelect.addEventListener('change', () => {
  chrome.storage.local.set({ targetLang: targetLangSelect.value });
});

// --- 캡처 숨김 시간 ---

captureHideSelect.addEventListener('change', () => {
  chrome.storage.local.set({ captureHideSec: parseInt(captureHideSelect.value, 10) });
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

function setFormStatus(message, type) {
  formStatus.textContent = message;
  formStatus.className = 'status' + (type ? ` ${type}` : '');
}

addServerBtn.addEventListener('click', () => {
  editingServerId = null;
  formTitle.textContent = '서버 추가';
  serverNameInput.value = '';
  serverEndpointInput.value = '';
  serverModelInput.value = '';
  serverApiKeyInput.value = '';
  serverApiKeyInput.placeholder = 'sk-...';
  patGuide.style.display = 'none';
  setFormStatus('', '');
  showView('viewServerForm');
});

// --- GitHub Models 프리셋 ---

const presetGithub = document.getElementById('presetGithub');
const patGuide = document.getElementById('patGuide');

presetGithub.addEventListener('click', () => {
  serverNameInput.value = 'GitHub GPT-4o-mini';
  serverEndpointInput.value = 'https://models.github.ai/inference';
  serverModelInput.value = 'gpt-4o-mini';
  serverApiKeyInput.value = '';
  serverApiKeyInput.placeholder = 'github_pat_...';
  patGuide.style.display = 'block';
  serverApiKeyInput.focus();
});

// --- OpenAI 프리셋 ---

document.getElementById('presetOpenAI4o').addEventListener('click', () => {
  serverNameInput.value = 'OpenAI GPT-4o-mini';
  serverEndpointInput.value = 'https://api.openai.com/v1';
  serverModelInput.value = 'gpt-4o-mini';
  serverApiKeyInput.value = '';
  serverApiKeyInput.placeholder = 'sk-...';
  patGuide.style.display = 'none';
  serverApiKeyInput.focus();
});

document.getElementById('presetOpenAI5').addEventListener('click', () => {
  serverNameInput.value = 'OpenAI GPT-5-mini';
  serverEndpointInput.value = 'https://api.openai.com/v1';
  serverModelInput.value = 'gpt-5-mini';
  serverApiKeyInput.value = '';
  serverApiKeyInput.placeholder = 'sk-...';
  patGuide.style.display = 'none';
  serverApiKeyInput.focus();
});

document.getElementById('patGuideLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://github.com/settings/tokens?type=beta' });
});

function openEditForm(server) {
  editingServerId = server.id;
  formTitle.textContent = '서버 편집';
  serverNameInput.value = server.name;
  serverEndpointInput.value = server.endpoint;
  serverModelInput.value = server.model;
  serverApiKeyInput.value = server.apiKey;
  serverApiKeyInput.placeholder = 'sk-...';
  patGuide.style.display = 'none';
  setFormStatus('', '');
  showView('viewServerForm');
}

function isValidEndpoint(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

saveServerBtn.addEventListener('click', () => {
  const name = serverNameInput.value.trim();
  const endpoint = serverEndpointInput.value.trim();
  const model = serverModelInput.value.trim();
  const apiKey = serverApiKeyInput.value.trim();

  if (!name || !endpoint || !model) {
    const missing = [];
    if (!name) missing.push('서버 이름');
    if (!endpoint) missing.push('Endpoint URL');
    if (!model) missing.push('Model');
    setFormStatus(`${missing.join(', ')}을(를) 입력해 주세요.`, 'error');
    return;
  }

  if (!isValidEndpoint(endpoint)) {
    setFormStatus('Endpoint는 http:// 또는 https:// 로 시작해야 합니다.', 'error');
    return;
  }

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

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css']
    }).catch(() => {});

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
        const parts = [];
        if (response.count > 0) parts.push(`${response.count}개 블록`);
        if (response.subtitleCount > 0) parts.push(`${response.subtitleCount}개 자막`);
        setStatus(parts.length > 0 ? `번역 완료! (${parts.join(', ')})` : '번역 완료!', 'success');
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
