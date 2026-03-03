(() => {
  if (window.__hotdogLoaded) return;
  window.__hotdogLoaded = true;

  const BATCH_SIZE = 20;

  // 번역 대상 블록 태그
  const BLOCK_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'BLOCKQUOTE', 'FIGCAPTION',
    'TD', 'TH', 'DT', 'DD', 'SUMMARY', 'CAPTION'
  ]);

  // 내부 탐색 제외 태그
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE',
    'TEXTAREA', 'INPUT', 'SVG', 'MATH', 'KBD', 'VAR'
  ]);

  // 콘텐츠 영역 셀렉터 (우선순위순)
  const CONTENT_AREA_SELECTOR = [
    '.markdown-body',
    'article',
    '[role="article"]',
    '.post-content',
    '.entry-content',
    '.article-body',
    '.blog-post',
    '.prose',
    '.content-body'
  ].join(',');

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'translate') {
      handleTranslate(message.targetLang, message.engine, message.aiConfig)
        .then((count) => sendResponse({ success: true, count }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (message.action === 'remove') {
      removeTranslations();
      sendResponse({ success: true });
    }
  });

  function collectBlockElements(root, elements, seen) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.classList.contains('hotdog-translation')) return NodeFilter.FILTER_REJECT;
          if (!BLOCK_TAGS.has(node.tagName)) return NodeFilter.FILTER_SKIP;

          const text = node.textContent.trim();
          if (text.length < 2) return NodeFilter.FILTER_SKIP;

          // 자식에 블록 태그가 있으면 건너뛰고 자식을 번역
          const hasBlockChild = Array.from(node.children).some(
            (child) => BLOCK_TAGS.has(child.tagName)
          );
          if (hasBlockChild) return NodeFilter.FILTER_SKIP;

          // 이미 번역된 요소 건너뛰기
          if (node.querySelector('.hotdog-translation')) return NodeFilter.FILTER_SKIP;

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      if (!seen.has(node)) {
        seen.add(node);
        elements.push(node);
      }
    }
  }

  function getTranslatableElements() {
    const elements = [];
    const seen = new Set();

    // 1단계: 콘텐츠 영역 내 블록 요소 수집
    const contentAreas = document.querySelectorAll(CONTENT_AREA_SELECTOR);
    for (const area of contentAreas) {
      collectBlockElements(area, elements, seen);
    }

    // 2단계: 콘텐츠 영역 밖의 독립 단락 (예: GitHub About 설명)
    const mainEl = document.querySelector('main, [role="main"]') || document.body;
    for (const p of mainEl.querySelectorAll('p')) {
      if (seen.has(p)) continue;
      if (p.closest(CONTENT_AREA_SELECTOR)) continue;
      if (p.closest('nav, header, footer, button, [role="navigation"], [role="banner"]')) continue;
      if (p.textContent.trim().length < 20) continue;
      seen.add(p);
      elements.push(p);
    }

    // 3단계: 위에서 아무것도 없으면 main 전체에서 탐색
    if (elements.length === 0) {
      collectBlockElements(mainEl, elements, seen);
    }

    return elements;
  }

  async function translateTextGoogle(text, targetLang) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Translation API error: ${res.status}`);
    const data = await res.json();
    return data[0].map((seg) => seg[0]).join('');
  }

  const LANG_NAMES = {
    ko: 'Korean', en: 'English', ja: 'Japanese',
    'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese',
    es: 'Spanish', fr: 'French', de: 'German',
    pt: 'Portuguese', vi: 'Vietnamese', th: 'Thai', ru: 'Russian',
  };

  async function translateTextWithAI(texts, targetLang, aiConfig) {
    const langName = LANG_NAMES[targetLang] || targetLang;
    const numbered = texts.map((t, i) => `[${i}] ${t}`).join('\n');

    const res = await fetch(`${aiConfig.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [
          {
            role: 'system',
            content: `You are a translator. Translate each numbered line to ${langName}. Output ONLY the translated lines in the same [N] format. Do not add any explanation.`,
          },
          { role: 'user', content: numbered },
        ],
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI API error: ${res.status} ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    const results = new Array(texts.length).fill('');
    for (const line of content.split('\n')) {
      const match = line.match(/^\[(\d+)\]\s*(.+)/);
      if (match) {
        const idx = parseInt(match[1], 10);
        if (idx >= 0 && idx < texts.length) results[idx] = match[2].trim();
      }
    }
    return results;
  }

  function appendTranslation(el, translated, originalText) {
    if (!translated || translated.toLowerCase() === originalText.toLowerCase()) return false;
    const translationEl = document.createElement('span');
    translationEl.className = 'hotdog-translation';
    translationEl.textContent = translated;
    el.appendChild(translationEl);
    return true;
  }

  async function handleTranslate(targetLang, engine, aiConfig) {
    removeTranslations();

    const elements = getTranslatableElements();
    if (elements.length === 0) throw new Error('번역할 텍스트를 찾을 수 없습니다.');

    const useAI = engine === 'ai' && aiConfig;
    if (useAI && (!aiConfig.endpoint || !aiConfig.model || !aiConfig.apiKey)) {
      throw new Error('AI 설정(Endpoint, Model, API Key)을 모두 입력해주세요.');
    }

    let translatedCount = 0;

    for (let i = 0; i < elements.length; i += BATCH_SIZE) {
      const batch = elements.slice(i, i + BATCH_SIZE);
      const texts = batch.map((el) => el.textContent.trim());

      if (useAI) {
        const results = await translateTextWithAI(texts, targetLang, aiConfig);
        batch.forEach((el, idx) => {
          if (appendTranslation(el, results[idx], texts[idx])) translatedCount++;
        });
      } else {
        const promises = batch.map(async (el, idx) => {
          try {
            const translated = await translateTextGoogle(texts[idx], targetLang);
            if (appendTranslation(el, translated.trim(), texts[idx])) translatedCount++;
          } catch {
            // 개별 실패 시 건너뛰기
          }
        });
        await Promise.all(promises);
      }
    }

    return translatedCount;
  }

  function removeTranslations() {
    document.querySelectorAll('.hotdog-translation').forEach((el) => el.remove());
  }
})();
