const translateBtn = document.getElementById('translateBtn');
const removeBtn = document.getElementById('removeBtn');
const targetLangSelect = document.getElementById('targetLang');
const status = document.getElementById('status');

// 저장된 언어 설정 불러오기
chrome.storage.local.get(['targetLang'], (result) => {
  if (result.targetLang) {
    targetLangSelect.value = result.targetLang;
  }
});

// 언어 변경 시 저장
targetLangSelect.addEventListener('change', () => {
  chrome.storage.local.set({ targetLang: targetLangSelect.value });
});

translateBtn.addEventListener('click', async () => {
  const targetLang = targetLangSelect.value;

  translateBtn.disabled = true;
  translateBtn.textContent = '번역 중...';
  setStatus('페이지를 번역하고 있습니다...', '');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }).catch(() => {});

    chrome.tabs.sendMessage(tab.id, {
      action: 'translate',
      targetLang
    }, (response) => {
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
