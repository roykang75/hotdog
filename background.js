// Background service worker - CORS 우회를 위한 Google Translate 프록시
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'googleTranslate') {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(message.targetLang)}&dt=t&q=${encodeURIComponent(message.text)}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const translated = data[0].map((seg) => seg[0]).join('');
        sendResponse({ success: true, translated });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
