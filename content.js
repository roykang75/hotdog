(() => {
  if (window.__hotdogLoaded) return;
  window.__hotdogLoaded = true;
  console.log('[Hotdog] v1.0.2 로드됨, SUBTITLE_BATCH=50');

  const BATCH_SIZE = 20;
  const SUBTITLE_BATCH_SIZE = 50;
  const CACHE_MAX = 5000;

  // 번역 캐시 (메모리 + chrome.storage)
  const transCache = new Map();
  let cacheLoaded = false;

  async function loadCache() {
    if (cacheLoaded) return;
    try {
      const data = await new Promise((r) => chrome.storage.local.get('hotdogCache', r));
      if (data.hotdogCache) {
        for (const [k, v] of Object.entries(data.hotdogCache)) transCache.set(k, v);
      }
    } catch {}
    cacheLoaded = true;
  }

  function saveCache() {
    // 캐시 크기 제한: 오래된 항목 삭제
    if (transCache.size > CACHE_MAX) {
      const keys = [...transCache.keys()];
      for (let i = 0; i < keys.length - CACHE_MAX; i++) transCache.delete(keys[i]);
    }
    try {
      chrome.storage.local.set({ hotdogCache: Object.fromEntries(transCache) });
    } catch {}
  }

  function cacheKey(text, targetLang, engine) {
    return `${targetLang}:${engine}:${text.length}:${text.slice(0, 200)}`;
  }

  // 번역 대상 블록 태그
  const BLOCK_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'BLOCKQUOTE', 'FIGCAPTION',
    'TD', 'TH', 'DT', 'DD', 'SUMMARY', 'CAPTION',
    'CENTER'
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
    '.content-body',
    'main',
    '#primary',
    '#content',
    '#main-content',
    '.main-content'
  ].join(',');

  // hasBlockChild 검사용 - 중첩된 블록 요소 감지 (UL/OL 래퍼 내부 LI 등)
  const BLOCK_DESCENDANT_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,summary,caption';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'translate') {
      handleTranslate(message.targetLang, message.engine, message.aiConfig)
        .then((result) => sendResponse({ success: true, count: result.count, subtitleCount: result.subtitleCount }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (message.action === 'remove') {
      removeTranslations();
      sendResponse({ success: true });
    }
    if (message.action === 'summarize') {
      const cacheUrl = location.href;
      if (summaryCache.has(cacheUrl)) {
        showSummaryCard(summaryCache.get(cacheUrl));
        sendResponse({ success: true, cached: true });
        return;
      }
      // 팝업에서 AI 호출 후 결과를 showSummaryCard로 표시
      sendResponse({ success: true, cached: false });
    }
    if (message.action === 'showSummaryCard') {
      summaryCache.set(location.href, message.text);
      showSummaryCard(message.text);
      sendResponse({ success: true });
    }
    if (message.action === 'getSummaryText') {
      const elements = getTranslatableElements();
      const MAX_CHARS = 12000;
      let text = elements.map(el => el.textContent.trim()).filter(Boolean).join('\n\n');
      if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n\n...[내용 축약됨]';
      sendResponse({ success: true, text });
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

          // 후손에 블록 요소가 있으면 건너뛰고 후손을 번역
          // (UL/OL 래퍼 안에 LI가 중첩된 경우 등 래퍼 태그를 건너뛰어야 함)
          if (node.querySelector(BLOCK_DESCENDANT_SELECTOR)) return NodeFilter.FILTER_SKIP;

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

  // Gmail 전용: 이메일 제목, 본문 수집
  const GMAIL_SELECTORS = [
    'h2.hP',                    // 스레드 뷰 이메일 제목
    '.ha h2',                   // 스레드 뷰 이메일 제목 (대체)
    '.ii.gt',                   // 이메일 본문 컨테이너
    'span.bog',                 // 메일 목록 제목
    '.y2',                      // 메일 목록 미리보기 스니펫
  ];

  const GMAIL_BLOCK_TAGS = new Set([...BLOCK_TAGS, 'DIV']);

  function isGmail() {
    return location.hostname === 'mail.google.com';
  }

  function collectGmailElements(elements, seen) {
    for (const selector of GMAIL_SELECTORS) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el)) continue;
        if (el.querySelector('.hotdog-translation')) continue;
        const text = el.textContent.trim();
        if (text.length < 2) continue;

        // 이메일 본문 컨테이너는 내부 블록 요소를 개별 수집
        if (el.matches('.ii.gt')) {
          collectGmailBodyElements(el, elements, seen);
        } else if (el.matches('h2.hP') || el.matches('.ha h2')) {
          // Gmail 제목은 overflow:hidden으로 자식이 잘릴 수 있으므로
          // 래퍼 div를 형제로 삽입하고 래퍼를 번역 대상으로 등록
          if (el.nextElementSibling && el.nextElementSibling.classList.contains('hotdog-gmail-subject-wrap')) continue;
          const wrap = document.createElement('div');
          wrap.className = 'hotdog-gmail-subject-wrap';
          const hiddenText = document.createElement('span');
          hiddenText.className = 'hotdog-gmail-subject-original';
          hiddenText.textContent = text;
          wrap.appendChild(hiddenText);
          el.parentNode.insertBefore(wrap, el.nextSibling);
          seen.add(wrap);
          elements.push(wrap);
        } else {
          seen.add(el);
          elements.push(el);
        }
      }
    }
  }

  function collectGmailBodyElements(root, elements, seen) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.classList.contains('hotdog-translation')) return NodeFilter.FILTER_REJECT;
          if (!GMAIL_BLOCK_TAGS.has(node.tagName)) return NodeFilter.FILTER_SKIP;

          const text = node.textContent.trim();
          if (text.length < 2) return NodeFilter.FILTER_SKIP;

          const hasBlockChild = Array.from(node.children).some(
            (child) => GMAIL_BLOCK_TAGS.has(child.tagName)
          );
          if (hasBlockChild) return NodeFilter.FILTER_SKIP;

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

  // YouTube 전용: 제목, 설명, 댓글, 답글 등 커스텀 요소 수집
  const YT_SELECTORS = [
    '#title h1 yt-formatted-string',              // 영상 제목
    'ytd-text-inline-expander .content',           // 영상 설명 (접힌/펼친)
    '#content-text',                               // 댓글 및 답글 본문
  ];

  function collectYouTubeElements(elements, seen) {
    for (const selector of YT_SELECTORS) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el)) continue;
        if (el.querySelector('.hotdog-translation')) continue;
        const text = el.textContent.trim();
        if (text.length < 2) continue;
        seen.add(el);
        elements.push(el);
      }
    }
  }

  function getTranslatableElements() {
    const elements = [];
    const seen = new Set();

    // YouTube 페이지: 전용 셀렉터로 수집
    if (isYouTubeWatch()) {
      collectYouTubeElements(elements, seen);
      return elements;
    }

    // Gmail 페이지: 전용 셀렉터로 수집
    if (isGmail()) {
      collectGmailElements(elements, seen);
      return elements;
    }

    // 1단계: 콘텐츠 영역 내 블록 요소 수집
    const contentAreas = document.querySelectorAll(CONTENT_AREA_SELECTOR);
    for (const area of contentAreas) {
      collectBlockElements(area, elements, seen);
    }

    // 2단계: 콘텐츠 영역 밖의 독립 단락 및 제목 (예: GitHub About 설명, Reddit 게시글 제목)
    const mainEl = document.querySelector('main, [role="main"]') || document.body;
    const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    for (const el of mainEl.querySelectorAll('p, h1, h2, h3, h4, h5, h6')) {
      if (seen.has(el)) continue;
      if (el.closest(CONTENT_AREA_SELECTOR)) continue;
      if (el.closest('nav, footer, button, [role="navigation"]')) continue;
      const text = el.textContent.trim();
      const minLen = HEADING_TAGS.has(el.tagName) ? 2 : 20;
      if (text.length < minLen) continue;
      if (el.querySelector('.hotdog-translation')) continue;
      seen.add(el);
      elements.push(el);
    }

    // 3단계: 수집된 요소가 부족하면 main 전체에서 블록 요소 추가 탐색
    // (본문이 대부분 LI 구조이거나 래퍼 클래스가 없는 페이지 대응)
    const totalChars = elements.reduce((n, el) => n + el.textContent.trim().length, 0);
    if (elements.length < 5 || totalChars < 500) {
      collectBlockElements(mainEl, elements, seen);
    }

    return elements;
  }

  async function translateTextGoogle(text, targetLang) {
    // 긴 텍스트는 분할 번역 (URL 길이 제한 ~2000자)
    if (encodeURIComponent(text).length > 1800) {
      const sentences = text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) || [text];
      const mid = Math.ceil(sentences.length / 2);
      const part1 = sentences.slice(0, mid).join('');
      const part2 = sentences.slice(mid).join('');
      const [r1, r2] = await Promise.all([
        translateTextGoogle(part1, targetLang),
        translateTextGoogle(part2, targetLang),
      ]);
      return r1 + r2;
    }
    // Background service worker를 통해 CORS 우회
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'googleTranslate', text, targetLang }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.success) {
          resolve(response.translated);
        } else {
          reject(new Error(response?.error || 'Translation failed'));
        }
      });
    });
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
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI API error: ${res.status} ${body.slice(0, 500)}`);
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

  function addLoading(el) {
    const loader = document.createElement('span');
    loader.className = 'hotdog-loading';
    const shine = document.createElement('span');
    shine.className = 'hotdog-loading-shine';
    loader.appendChild(shine);
    el.appendChild(loader);
    return loader;
  }

  function replaceWithTranslation(loader, el, translated, originalText) {
    if (!translated || translated.toLowerCase() === originalText.toLowerCase()) {
      loader.remove();
      return false;
    }
    const translationEl = document.createElement('span');
    translationEl.className = 'hotdog-translation';
    translationEl.textContent = translated;
    loader.remove();
    if (el.tagName === 'LI') {
      // LI 내부 grid/flex 레이아웃을 무시하고 전체 너비로 표시
      translationEl.style.cssText = 'display:block!important;grid-column:1/-1!important;width:100%!important;';
      el.appendChild(translationEl);
    } else {
      el.after(translationEl);
    }
    return true;
  }

  async function handleTranslate(targetLang, engine, aiConfig) {
    removeTranslations();
    await loadCache();

    const elements = getTranslatableElements();
    const engineKey = engine === 'ai' && aiConfig ? `ai:${aiConfig.model}` : engine;

    const useAI = engine === 'ai' && aiConfig;
    if (useAI && (!aiConfig.endpoint || !aiConfig.model || !aiConfig.apiKey)) {
      throw new Error('AI 설정(Endpoint, Model, API Key)을 모두 입력해주세요.');
    }

    let translatedCount = 0;
    let cacheHits = 0;

    for (let i = 0; i < elements.length; i += BATCH_SIZE) {
      const batch = elements.slice(i, i + BATCH_SIZE);
      const texts = batch.map((el) => el.textContent.trim());
      const loaders = batch.map((el) => addLoading(el));

      // 캐시 히트 먼저 처리
      const uncachedIndices = [];
      for (let idx = 0; idx < batch.length; idx++) {
        const key = cacheKey(texts[idx], targetLang, engineKey);
        const cached = transCache.get(key);
        if (cached) {
          if (replaceWithTranslation(loaders[idx], batch[idx], cached, texts[idx])) translatedCount++;
          cacheHits++;
        } else {
          uncachedIndices.push(idx);
        }
      }

      if (uncachedIndices.length === 0) continue;

      if (useAI) {
        const uncachedTexts = uncachedIndices.map((idx) => texts[idx]);
        const results = await translateTextWithAI(uncachedTexts, targetLang, aiConfig);
        uncachedIndices.forEach((idx, ri) => {
          const translated = results[ri];
          if (translated) transCache.set(cacheKey(texts[idx], targetLang, engineKey), translated);
          if (replaceWithTranslation(loaders[idx], batch[idx], translated, texts[idx])) translatedCount++;
        });
      } else {
        // Google Translate: 동시 요청 5개로 제한하여 rate limit 회피
        for (let j = 0; j < uncachedIndices.length; j += 5) {
          const chunk = uncachedIndices.slice(j, j + 5);
          const promises = chunk.map(async (idx) => {
            try {
              const translated = await translateTextGoogle(texts[idx], targetLang);
              const trimmed = translated.trim();
              if (trimmed) transCache.set(cacheKey(texts[idx], targetLang, engineKey), trimmed);
              if (replaceWithTranslation(loaders[idx], batch[idx], trimmed, texts[idx])) translatedCount++;
            } catch {
              loaders[idx].remove();
            }
          });
          await Promise.all(promises);
        }
      }
    }

    saveCache();

    if (elements.length === 0) {
      throw new Error('번역할 텍스트를 찾을 수 없습니다.');
    }

    return { count: translatedCount, subtitleCount: 0 };
  }

  function removeTranslations() {
    document.querySelectorAll('.hotdog-translation, .hotdog-translation-wrap, .hotdog-loading, .hotdog-gmail-subject-wrap').forEach((el) => el.remove());
    stopSubtitleSync();
  }

  // ===== YouTube 자막 모듈 =====

  let subtitleSyncHandler = null;
  let subtitleOverlay = null;
  let ytSubtitleBtn = null;
  let ytSubtitleActive = false;

  function isYouTubeWatch() {
    return location.hostname.includes('youtube.com') && location.pathname === '/watch';
  }

  function getVideoId() {
    return new URLSearchParams(location.search).get('v');
  }

  /**
   * MAIN world의 youtube-main.js에 자막 데이터 요청.
   * CustomEvent로 통신하여 페이지 컨텍스트의 인증된 fetch를 활용.
   */
  function fetchSubtitlesFromMainWorld() {
    return new Promise((resolve) => {
      let settled = false;

      const handler = (e) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('hotdog-subs-result', handler);
        try { resolve(JSON.parse(e.detail)); }
        catch { resolve([]); }
      };
      document.addEventListener('hotdog-subs-result', handler);

      // MAIN world의 youtube-main.js에 요청 전송
      document.dispatchEvent(new CustomEvent('hotdog-fetch-subs'));

      setTimeout(() => {
        if (settled) return;
        settled = true;
        document.removeEventListener('hotdog-subs-result', handler);
        resolve([]);
      }, 15000);
    });
  }

  // 자막 배열을 in-place로 점진적 번역 (오버레이는 이미 표시 중)
  async function translateSubtitlesInPlace(subtitles, targetLang, engine, aiConfig) {
    const texts = subtitles.map((s) => s.text);
    const useAI = engine === 'ai' && aiConfig;

    const SUB_BATCH = 30;
    for (let i = 0; i < texts.length; i += SUB_BATCH) {
      const batch = texts.slice(i, i + SUB_BATCH);
      let results;
      if (useAI) {
        // 실패 시 배치를 절반으로 줄여 재시도
        try {
          results = await translateTextWithAI(batch, targetLang, aiConfig);
        } catch (err) {
          const mid = Math.ceil(batch.length / 2);
          const r1 = await translateTextWithAI(batch.slice(0, mid), targetLang, aiConfig).catch(() => new Array(mid).fill(''));
          const r2 = await translateTextWithAI(batch.slice(mid), targetLang, aiConfig).catch(() => new Array(batch.length - mid).fill(''));
          results = [...r1, ...r2];
        }
      } else {
        results = await Promise.all(
          batch.map((t) => translateTextGoogle(t, targetLang).catch(() => t))
        );
      }

      // 번역 결과를 원본 배열에 in-place 반영 → sync 핸들러가 자동 반영
      for (let j = 0; j < results.length; j++) {
        const idx = i + j;
        if (idx < subtitles.length && results[j] && results[j] !== subtitles[idx].text) {
          subtitles[idx].translatedText = results[j];
          subtitles[idx]._translated = true;
        }
      }
    }
  }

  function createSubtitleOverlay() {
    stopSubtitleSync();

    const player = document.querySelector('.html5-video-player');
    if (!player) return null;

    const overlay = document.createElement('div');
    overlay.className = 'hotdog-subtitle-overlay';
    player.appendChild(overlay);
    subtitleOverlay = overlay;
    return overlay;
  }

  function startSubtitleSync(subtitles) {
    const video = document.querySelector('video');
    if (!video || !subtitleOverlay) return;

    subtitleSyncHandler = () => {
      const timeMs = video.currentTime * 1000;

      // 이진 탐색으로 현재 시간대 자막 검색
      let lo = 0, hi = subtitles.length - 1;
      let found = null;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (subtitles[mid].startMs <= timeMs && timeMs < subtitles[mid].endMs) {
          found = subtitles[mid];
          break;
        } else if (subtitles[mid].startMs > timeMs) {
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }

      if (found) {
        // startMs + 번역 여부로 키 생성 → 번역 완료 시 자동 갱신
        const key = found.startMs + (found._translated ? ':t' : '');
        if (subtitleOverlay.dataset.current !== key) {
          subtitleOverlay.innerHTML = '';
          const span = document.createElement('span');
          span.className = 'hotdog-subtitle-text';
          span.textContent = found.translatedText;
          subtitleOverlay.appendChild(span);
          subtitleOverlay.dataset.current = key;
        }
      } else if (subtitleOverlay.dataset.current) {
        subtitleOverlay.innerHTML = '';
        subtitleOverlay.dataset.current = '';
      }
    };

    video.addEventListener('timeupdate', subtitleSyncHandler);
  }

  function stopSubtitleSync() {
    if (subtitleSyncHandler) {
      const video = document.querySelector('video');
      if (video) video.removeEventListener('timeupdate', subtitleSyncHandler);
      subtitleSyncHandler = null;
    }
    if (subtitleOverlay) {
      subtitleOverlay.remove();
      subtitleOverlay = null;
    }
  }

  // 인접한 짧은 자막을 병합하여 번역 횟수 줄이기
  // (자동생성 자막은 1-3단어 세그먼트가 1000개 이상 될 수 있음)
  function mergeSubtitles(subs, maxGapMs = 2000, maxDurationMs = 10000) {
    if (subs.length === 0) return subs;
    const merged = [];
    let cur = { startMs: subs[0].startMs, endMs: subs[0].endMs, text: subs[0].text };

    for (let i = 1; i < subs.length; i++) {
      const gap = subs[i].startMs - cur.endMs;
      const duration = subs[i].endMs - cur.startMs;

      if (gap <= maxGapMs && duration <= maxDurationMs) {
        cur.text += ' ' + subs[i].text;
        cur.endMs = subs[i].endMs;
      } else {
        merged.push(cur);
        cur = { startMs: subs[i].startMs, endMs: subs[i].endMs, text: subs[i].text };
      }
    }
    merged.push(cur);
    return merged;
  }

  // 자막 사전 로딩 캐시
  let prefetchedSubs = null;
  let prefetchVideoId = null;

  async function prefetchSubtitles() {
    if (!isYouTubeWatch()) return;
    const vid = getVideoId();
    if (!vid || vid === prefetchVideoId) return;
    prefetchVideoId = vid;
    prefetchedSubs = null;

    try {
      const rawSubs = await fetchSubtitlesFromMainWorld();
      if (rawSubs.length > 0) {
        prefetchedSubs = rawSubs;
      }
    } catch {}
  }

  async function handleYouTubeSubtitles(targetLang, engine, aiConfig) {
    if (!isYouTubeWatch()) return 0;

    try {
      let rawSubs;
      if (prefetchedSubs && prefetchVideoId === getVideoId()) {
        rawSubs = prefetchedSubs;
      } else {
        rawSubs = await fetchSubtitlesFromMainWorld();
      }
      if (rawSubs.length === 0) { return 0; }

      const subtitles = mergeSubtitles(rawSubs);

      // 원본 텍스트로 초기화 → 즉시 표시
      for (const s of subtitles) s.translatedText = s.text;

      const overlay = createSubtitleOverlay();
      if (!overlay) { return 0; }

      // 오버레이 즉시 시작 (원본 영어 자막 먼저 표시)
      startSubtitleSync(subtitles);

      // 백그라운드에서 점진적 번역 (in-place 업데이트 → sync 핸들러가 자동 반영)
      translateSubtitlesInPlace(subtitles, targetLang, engine, aiConfig)
        .catch(() => {});

      return subtitles.length;
    } catch {
      return 0;
    }
  }

  // ===== YouTube 플레이어 번역 버튼 =====

  const YT_ICON_DEFAULT = '<svg viewBox="0 0 36 36" width="36" height="36"><text x="14" y="18" text-anchor="middle" font-size="18">🌭</text></svg>';
  const YT_ICON_ACTIVE = '<svg viewBox="0 0 36 36" width="36" height="36"><text x="14" y="18" text-anchor="middle" font-size="18">🌭</text><circle cx="26" cy="8" r="4" fill="#ef4444"/></svg>';
  const YT_ICON_LOADING = '<svg viewBox="0 0 36 36" width="36" height="36"><text x="14" y="18" text-anchor="middle" font-size="18">🌭</text><g transform-origin="14 6"><animateTransform attributeName="transform" type="rotate" from="0 14 6" to="360 14 6" dur="1s" repeatCount="indefinite"/><text x="14" y="9" text-anchor="middle" font-size="8">♨️</text></g></svg>';

  function initYouTubeButton() {
    // 기존 버튼 제거
    if (ytSubtitleBtn) { ytSubtitleBtn.remove(); ytSubtitleBtn = null; }
    ytSubtitleActive = false;

    if (!isYouTubeWatch()) return;

    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) return;

    const btn = document.createElement('button');
    btn.className = 'hotdog-yt-btn ytp-button';
    btn.innerHTML = YT_ICON_DEFAULT;
    btn.title = '자막 번역';
    btn.addEventListener('click', onYtBtnClick);
    rightControls.insertBefore(btn, rightControls.firstChild);
    ytSubtitleBtn = btn;
  }

  async function onYtBtnClick() {
    if (ytSubtitleActive) {
      stopSubtitleSync();
      ytSubtitleActive = false;
      ytSubtitleBtn.innerHTML = YT_ICON_DEFAULT;
      ytSubtitleBtn.title = '자막 번역';
      ytSubtitleBtn.classList.remove('hotdog-yt-btn--active');
      return;
    }

    // 저장된 설정 읽기
    const settings = await new Promise((resolve) => {
      chrome.storage.local.get(['targetLang', 'engine', 'aiServers'], resolve);
    });

    const targetLang = settings.targetLang || 'ko';
    let engine = settings.engine || 'google';
    let aiConfig = null;

    if (engine.startsWith('ai:')) {
      const serverId = engine.slice(3);
      const server = (settings.aiServers || []).find((s) => s.id === serverId);
      if (server) {
        engine = 'ai';
        aiConfig = {
          endpoint: server.endpoint.replace(/\/+$/, ''),
          model: server.model,
          apiKey: server.apiKey,
        };
      } else {
        engine = 'google';
      }
    }

    ytSubtitleBtn.innerHTML = YT_ICON_LOADING;
    ytSubtitleBtn.title = '번역 중...';
    ytSubtitleBtn.disabled = true;

    try {
      const count = await handleYouTubeSubtitles(targetLang, engine, aiConfig);
      if (count > 0) {
        ytSubtitleActive = true;
        ytSubtitleBtn.innerHTML = YT_ICON_ACTIVE;
        ytSubtitleBtn.title = '자막 제거';
        ytSubtitleBtn.classList.add('hotdog-yt-btn--active');
      } else {
        ytSubtitleBtn.innerHTML = YT_ICON_DEFAULT;
        ytSubtitleBtn.title = '자막 없음';
        setTimeout(() => {
          if (ytSubtitleBtn) { ytSubtitleBtn.innerHTML = YT_ICON_DEFAULT; ytSubtitleBtn.title = '자막 번역'; }
        }, 2000);
      }
    } catch {
      ytSubtitleBtn.innerHTML = YT_ICON_DEFAULT;
      ytSubtitleBtn.title = '자막 번역';
    }
    ytSubtitleBtn.disabled = false;
  }

  // YouTube SPA 네비게이션 시 자막 오버레이 자동 제거 + 버튼 재생성 + 사전 로딩
  document.addEventListener('yt-navigate-finish', () => {
    stopSubtitleSync();
    prefetchedSubs = null;
    prefetchVideoId = null;
    setTimeout(() => {
      initYouTubeButton();
      prefetchSubtitles();
    }, 1000);
  });

  // 최초 로드 시 버튼 생성 + 사전 로딩
  if (isYouTubeWatch()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
        initYouTubeButton();
        prefetchSubtitles();
      }, 1000));
    } else {
      setTimeout(() => {
        initYouTubeButton();
        prefetchSubtitles();
      }, 1000);
    }
  }

  // ===== 플로팅 번역 버튼 (FAB) =====

  let fabTranslated = false;
  const summaryCache = new Map();

  function getStoredSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['targetLang', 'engine', 'aiServers'], resolve);
    });
  }

  function parseEngine(settings) {
    let engine = settings.engine || 'google';
    let aiConfig = null;

    if (engine.startsWith('ai:')) {
      const serverId = engine.slice(3);
      const server = (settings.aiServers || []).find((s) => s.id === serverId);
      if (server) {
        engine = 'ai';
        aiConfig = {
          endpoint: server.endpoint.replace(/\/+$/, ''),
          model: server.model,
          apiKey: server.apiKey,
        };
      } else {
        engine = 'google';
      }
    }

    return { engine, aiConfig };
  }

  function initFab() {
    if (document.querySelector('.hotdog-fab-container')) return;

    const fab = document.createElement('button');
    fab.className = 'hotdog-fab';
    fab.innerHTML = '🌭';
    fab.title = '번역';

    // 드래그 지원
    let isDragging = false;
    let dragStartY = 0;
    let fabStartY = 0;

    fab.addEventListener('mousedown', (e) => {
      isDragging = false;
      dragStartY = e.clientY;
      fabStartY = fab.closest('.hotdog-fab-container').getBoundingClientRect().bottom - fab.offsetHeight;

      const container = fab.closest('.hotdog-fab-container');
      const onMove = (e2) => {
        if (Math.abs(e2.clientY - dragStartY) > 5) isDragging = true;
        if (isDragging) {
          container.classList.add('hotdog-fab-dragging');
          const newBottom = window.innerHeight - Math.max(50, Math.min(window.innerHeight - 10, fabStartY + fab.offsetHeight + (e2.clientY - dragStartY)));
          container.style.bottom = newBottom + 'px';
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        container.classList.remove('hotdog-fab-dragging');
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    fab.addEventListener('click', async () => {
      if (isDragging) {
        isDragging = false;
        return;
      }

      if (fabTranslated) {
        removeTranslations();
        fabTranslated = false;
        fab.classList.remove('hotdog-fab--active');
        fab.title = '번역';
        return;
      }

      fab.classList.add('hotdog-fab--loading');
      fab.title = '번역 중...';

      try {
        const settings = await getStoredSettings();
        const targetLang = settings.targetLang || 'ko';
        const { engine, aiConfig } = parseEngine(settings);

        await handleTranslate(targetLang, engine, aiConfig);
        fabTranslated = true;
        fab.classList.add('hotdog-fab--active');
        fab.title = '번역 제거';
      } catch (err) {
        fab.title = err.message || '번역 실패';
        setTimeout(() => { fab.title = '번역'; }, 3000);
      }
      fab.classList.remove('hotdog-fab--loading');
    });

    // summaryCache는 모듈 스코프에서 선언됨

    // 요약 버튼
    const fabSummary = document.createElement('button');
    fabSummary.className = 'hotdog-fab hotdog-fab-summary';
    fabSummary.innerHTML = '📋';
    fabSummary.title = '페이지 요약';
    fabSummary.addEventListener('click', async () => {
      const card = document.querySelector('.hotdog-summary-card');
      if (card) { card.remove(); return; }

      // 캐시 히트 시 즉시 표시
      const cacheUrl = location.href;
      if (summaryCache.has(cacheUrl)) {
        showSummaryCard(summaryCache.get(cacheUrl));
        return;
      }

      const settings = await getStoredSettings();
      const { engine, aiConfig } = parseEngine(settings);

      if (engine !== 'ai' || !aiConfig) {
        showSummaryCard('AI 서버를 설정해야 요약 기능을 사용할 수 있습니다.');
        return;
      }

      fabSummary.classList.add('hotdog-fab--loading');
      fabSummary.title = '요약 중...';

      try {
        const elements = getTranslatableElements();
        const MAX_CHARS = 12000;
        let text = elements.map(el => el.textContent.trim()).filter(Boolean).join('\n\n');
        if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n\n...[내용 축약됨]';

        if (text.trim().length < 10) throw new Error('요약할 텍스트가 부족합니다.');

        const targetLang = settings.targetLang || 'ko';
        const langName = LANG_NAMES[targetLang] || targetLang;

        const res = await fetch(`${aiConfig.endpoint}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.apiKey}` },
          body: JSON.stringify({
            model: aiConfig.model,
            messages: [
              { role: 'system', content: `You are a summarizer. Summarize the following page content concisely in ${langName}. Format your response in markdown: use "- " for bullet points, "**bold**" for emphasis, and "## " for section headers if needed. Be specific, not generic.` },
              { role: 'user', content: text },
            ],
          }),
        });

        if (!res.ok) throw new Error(`AI API error: ${res.status}`);
        const data = await res.json();
        const summary = data.choices?.[0]?.message?.content || '요약 결과 없음';
        summaryCache.set(cacheUrl, summary);
        showSummaryCard(summary);
      } catch (err) {
        showSummaryCard('요약 실패: ' + (err.message || '알 수 없는 오류'));
      }
      fabSummary.classList.remove('hotdog-fab--loading');
      fabSummary.title = '페이지 요약';
    });

    const fabContainer = document.createElement('div');
    fabContainer.className = 'hotdog-fab-container';
    fabContainer.appendChild(fabSummary);
    fabContainer.appendChild(fab);
    document.body.appendChild(fabContainer);
  }

  function renderMarkdown(md) {
    const lines = md.split('\n');
    let html = '';
    let listDepth = 0;

    const inline = (s) => s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

    const closeListsTo = (depth) => {
      while (listDepth > depth) { html += '</ul>'; listDepth--; }
    };

    for (const raw of lines) {
      const listMatch = raw.match(/^(\s*)[-*]\s+(.+)/);
      if (listMatch) {
        const spaces = listMatch[1].length;
        const indent = spaces === 0 ? 1 : Math.floor((spaces - 1) / 2) + 2;
        while (listDepth < indent) { html += '<ul>'; listDepth++; }
        while (listDepth > indent) { html += '</ul>'; listDepth--; }
        html += `<li>${inline(listMatch[2])}</li>`;
        continue;
      }

      closeListsTo(0);

      if (/^\s*$/.test(raw)) { html += '<br>'; continue; }
      let m;
      if ((m = raw.match(/^###\s+(.+)/))) { html += `<h4>${inline(m[1])}</h4>`; continue; }
      if ((m = raw.match(/^##\s+(.+)/))) { html += `<h3>${inline(m[1])}</h3>`; continue; }
      if ((m = raw.match(/^#\s+(.+)/))) { html += `<h2>${inline(m[1])}</h2>`; continue; }
      html += `<p>${inline(raw)}</p>`;
    }
    closeListsTo(0);
    return html;
  }

  function showSummaryCard(text) {
    let card = document.querySelector('.hotdog-summary-card');
    if (card) card.remove();

    card = document.createElement('div');
    card.className = 'hotdog-summary-card';
    card.innerHTML = `
      <div class="hotdog-summary-header">
        <span>📋 페이지 요약</span>
        <div class="hotdog-summary-actions">
          <button class="hotdog-summary-copy" data-tooltip="복사">⧉</button>
          <button class="hotdog-summary-close" data-tooltip="닫기">&times;</button>
        </div>
      </div>
      <div class="hotdog-summary-body"></div>
    `;
    card.querySelector('.hotdog-summary-body').innerHTML = renderMarkdown(text);
    card.querySelector('.hotdog-summary-close').addEventListener('click', () => card.remove());

    // 드래그 이동
    const header = card.querySelector('.hotdog-summary-header');
    let dragX, dragY, cardX, cardY;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragX = e.clientX; dragY = e.clientY;
      const rect = card.getBoundingClientRect();
      cardX = rect.left; cardY = rect.top;
      const onMove = (e2) => {
        card.style.left = (cardX + e2.clientX - dragX) + 'px';
        card.style.top = (cardY + e2.clientY - dragY) + 'px';
        card.style.right = 'auto';
        card.style.bottom = 'auto';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    card.querySelector('.hotdog-summary-copy').addEventListener('click', async function () {
      const btn = this;
      const rect = btn.getBoundingClientRect();
      await navigator.clipboard.writeText(text);
      const tooltip = document.createElement('span');
      tooltip.className = 'hotdog-copy-tooltip';
      tooltip.textContent = 'Copied!';
      tooltip.style.top = (rect.bottom + 6) + 'px';
      tooltip.style.left = (rect.left + rect.width / 2) + 'px';
      tooltip.style.transform = 'translateX(-50%)';
      document.body.appendChild(tooltip);
      setTimeout(() => tooltip.remove(), 1200);
    });
    document.body.appendChild(card);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFab);
  } else {
    initFab();
  }
})();
