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
        .then((result) => sendResponse({ success: true, count: result.count, subtitleCount: result.subtitleCount }))
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
    el.replaceChild(translationEl, loader);
    return true;
  }

  async function handleTranslate(targetLang, engine, aiConfig) {
    removeTranslations();

    // YouTube 자막 번역을 병렬로 시작
    const subtitlePromise = handleYouTubeSubtitles(targetLang, engine, aiConfig);

    const elements = getTranslatableElements();

    const useAI = engine === 'ai' && aiConfig;
    if (useAI && (!aiConfig.endpoint || !aiConfig.model || !aiConfig.apiKey)) {
      throw new Error('AI 설정(Endpoint, Model, API Key)을 모두 입력해주세요.');
    }

    let translatedCount = 0;

    for (let i = 0; i < elements.length; i += BATCH_SIZE) {
      const batch = elements.slice(i, i + BATCH_SIZE);
      const texts = batch.map((el) => el.textContent.trim());
      const loaders = batch.map((el) => addLoading(el));

      if (useAI) {
        const results = await translateTextWithAI(texts, targetLang, aiConfig);
        batch.forEach((el, idx) => {
          if (replaceWithTranslation(loaders[idx], el, results[idx], texts[idx])) translatedCount++;
        });
      } else {
        const promises = batch.map(async (el, idx) => {
          try {
            const translated = await translateTextGoogle(texts[idx], targetLang);
            if (replaceWithTranslation(loaders[idx], el, translated.trim(), texts[idx])) translatedCount++;
          } catch {
            loaders[idx].remove();
          }
        });
        await Promise.all(promises);
      }
    }

    const subtitleCount = await subtitlePromise;

    if (elements.length === 0 && subtitleCount === 0) {
      throw new Error('번역할 텍스트를 찾을 수 없습니다.');
    }

    return { count: translatedCount, subtitleCount };
  }

  function removeTranslations() {
    document.querySelectorAll('.hotdog-translation, .hotdog-loading').forEach((el) => el.remove());
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
        console.warn('[Hotdog] MAIN world 응답 타임아웃');
        resolve([]);
      }, 15000);
    });
  }

  // 자막 배열을 in-place로 점진적 번역 (오버레이는 이미 표시 중)
  async function translateSubtitlesInPlace(subtitles, targetLang, engine, aiConfig) {
    const texts = subtitles.map((s) => s.text);
    const useAI = engine === 'ai' && aiConfig;

    console.log(`[Hotdog] 자막 번역 시작: ${texts.length}개, 엔진=${engine}, 타겟=${targetLang}`);

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      let results;
      if (useAI) {
        results = await translateTextWithAI(batch, targetLang, aiConfig);
      } else {
        results = await Promise.all(
          batch.map((t) => translateTextGoogle(t, targetLang).catch((err) => {
            console.error('[Hotdog] 자막 번역 실패:', err.message, '원문:', t.slice(0, 50));
            return t;
          }))
        );
      }

      // 번역 결과를 원본 배열에 in-place 반영 → sync 핸들러가 자동 반영
      for (let j = 0; j < results.length; j++) {
        const idx = i + j;
        if (idx < subtitles.length && results[j]) {
          subtitles[idx].translatedText = results[j];
          subtitles[idx]._translated = true;
        }
      }
      console.log(`[Hotdog] 자막 번역 진행: ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length}`);
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

  async function handleYouTubeSubtitles(targetLang, engine, aiConfig) {
    if (!isYouTubeWatch()) return 0;

    try {
      const rawSubs = await fetchSubtitlesFromMainWorld();
      console.log(`[Hotdog] MAIN world에서 자막 ${rawSubs.length}개 수신`);
      if (rawSubs.length === 0) { console.warn('[Hotdog] 자막 데이터 없음'); return 0; }

      const subtitles = mergeSubtitles(rawSubs);
      console.log(`[Hotdog] 자막 병합: ${rawSubs.length}개 → ${subtitles.length}개`);

      // 원본 텍스트로 초기화 → 즉시 표시
      for (const s of subtitles) s.translatedText = s.text;

      const overlay = createSubtitleOverlay();
      if (!overlay) { console.warn('[Hotdog] .html5-video-player를 찾을 수 없음'); return 0; }

      // 오버레이 즉시 시작 (원본 영어 자막 먼저 표시)
      startSubtitleSync(subtitles);
      console.log(`[Hotdog] 자막 ${subtitles.length}개 즉시 표시, 백그라운드 번역 시작`);

      // 백그라운드에서 점진적 번역 (in-place 업데이트 → sync 핸들러가 자동 반영)
      translateSubtitlesInPlace(subtitles, targetLang, engine, aiConfig)
        .then(() => console.log('[Hotdog] 자막 번역 모두 완료'))
        .catch((err) => console.warn('[Hotdog] 자막 번역 오류:', err));

      return subtitles.length;
    } catch (err) {
      console.warn('[Hotdog] 자막 처리 오류:', err);
      return 0;
    }
  }

  // ===== YouTube 플레이어 번역 버튼 =====

  function initYouTubeButton() {
    // 기존 버튼 제거
    if (ytSubtitleBtn) { ytSubtitleBtn.remove(); ytSubtitleBtn = null; }
    ytSubtitleActive = false;

    if (!isYouTubeWatch()) return;

    const player = document.querySelector('.html5-video-player');
    if (!player) return;

    const btn = document.createElement('button');
    btn.className = 'hotdog-yt-btn';
    btn.textContent = '자막 번역';
    btn.addEventListener('click', onYtBtnClick);
    player.appendChild(btn);
    ytSubtitleBtn = btn;
  }

  async function onYtBtnClick() {
    if (ytSubtitleActive) {
      stopSubtitleSync();
      ytSubtitleActive = false;
      ytSubtitleBtn.textContent = '자막 번역';
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

    ytSubtitleBtn.textContent = '번역 중...';
    ytSubtitleBtn.disabled = true;

    try {
      const count = await handleYouTubeSubtitles(targetLang, engine, aiConfig);
      if (count > 0) {
        ytSubtitleActive = true;
        ytSubtitleBtn.textContent = '자막 제거';
        ytSubtitleBtn.classList.add('hotdog-yt-btn--active');
      } else {
        ytSubtitleBtn.textContent = '자막 없음';
        setTimeout(() => {
          if (ytSubtitleBtn) ytSubtitleBtn.textContent = '자막 번역';
        }, 2000);
      }
    } catch {
      ytSubtitleBtn.textContent = '자막 번역';
    }
    ytSubtitleBtn.disabled = false;
  }

  // YouTube SPA 네비게이션 시 자막 오버레이 자동 제거 + 버튼 재생성
  document.addEventListener('yt-navigate-finish', () => {
    stopSubtitleSync();
    // 플레이어 렌더링 대기 후 버튼 재생성
    setTimeout(initYouTubeButton, 1000);
  });

  // 최초 로드 시 버튼 생성
  if (isYouTubeWatch()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(initYouTubeButton, 1000));
    } else {
      setTimeout(initYouTubeButton, 1000);
    }
  }
})();
