// Background service worker - CORS/혼합 콘텐츠 우회용 네트워크 프록시
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'googleTranslate') {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(message.targetLang)}&dt=t&q=${encodeURIComponent(message.text)}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (!data?.[0] || !Array.isArray(data[0])) {
          sendResponse({ success: false, error: 'Unexpected API response' });
          return;
        }
        const translated = data[0].map((seg) => seg[0]).join('');
        sendResponse({ success: true, translated });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // OpenAI 호환 chat/completions 프록시.
  // content script(페이지 문맥)에서 직접 호출하면 https 페이지 → http 서버 요청이
  // 혼합 콘텐츠로 차단되므로, 확장 서비스워커가 대신 호출한다.
  if (message.action === 'aiChat') {
    const endpoint = String(message.endpoint || '').replace(/\/+$/, '');
    fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${message.apiKey}`,
      },
      body: JSON.stringify({ model: message.model, messages: message.messages }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          sendResponse({ success: false, status: res.status, error: body.slice(0, 300) });
          return;
        }
        const data = await res.json();
        sendResponse({ success: true, content: data.choices?.[0]?.message?.content || '' });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
