// YouTube MAIN world 스크립트 (document_start)
// YouTube 플레이어의 자막 네트워크 요청을 인터셉트하여 데이터 캡처

let capturedSubtitleData = null;

// SPA 네비게이션 시 캡처 초기화
document.addEventListener('yt-navigate-finish', () => {
  capturedSubtitleData = null;
});

// --- fetch 인터셉트 ---
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await originalFetch.apply(this, args);
  try {
    const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';
    if (url.includes('timedtext') && !url.includes('type=list')) {
      const clone = response.clone();
      const text = await clone.text();
      if (text && text.length > 0) {
        capturedSubtitleData = text;
        console.log('[Hotdog-Main] fetch 인터셉트: 자막 데이터 캡처됨, 길이:', text.length);
      }
    }
  } catch { /* 인터셉트 실패는 무시 */ }
  return response;
};

// --- XMLHttpRequest 인터셉트 ---
const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this.__hotdogUrl = typeof url === 'string' ? url : '';
  return origOpen.call(this, method, url, ...rest);
};
const origSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (...args) {
  if (this.__hotdogUrl.includes('timedtext') && !this.__hotdogUrl.includes('type=list')) {
    this.addEventListener('load', function () {
      if (this.responseText && this.responseText.length > 0) {
        capturedSubtitleData = this.responseText;
        console.log('[Hotdog-Main] XHR 인터셉트: 자막 데이터 캡처됨, 길이:', this.responseText.length);
      }
    });
  }
  return origSend.call(this, ...args);
};

// --- Content script 요청 처리 ---
document.addEventListener('hotdog-fetch-subs', async () => {
  const done = (subs) => {
    document.dispatchEvent(new CustomEvent('hotdog-subs-result', { detail: JSON.stringify(subs) }));
  };

  try {
    let text = capturedSubtitleData;
    console.log('[Hotdog-Main] 캡처된 데이터:', text ? `${text.length}바이트` : '없음');

    // 캡처된 데이터가 없으면 플레이어 API로 자막 로드 시도
    if (!text) {
      const player = document.getElementById('movie_player');
      if (player) {
        // 방법 1: getPlayerResponse()에서 캡션 트랙 URL 직접 추출 후 fetch
        if (player.getPlayerResponse) {
          try {
            const pr = player.getPlayerResponse();
            const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            console.log('[Hotdog-Main] playerResponse captionTracks:', tracks?.length || 0);

            if (tracks && tracks.length > 0) {
              const track = tracks.find((t) => t.kind !== 'asr') || tracks[0];
              const url = track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3';
              console.log('[Hotdog-Main] 캡션 URL 직접 fetch:', url.slice(0, 100));
              const resp = await originalFetch(url);
              const respText = await resp.text();
              if (respText && respText.length > 0) {
                text = respText;
                console.log('[Hotdog-Main] 직접 fetch 성공:', respText.length, '바이트');
              }
            }
          } catch (e) {
            console.warn('[Hotdog-Main] playerResponse 방법 실패:', e.message);
          }
        }

        // 방법 2: captions 모듈 로드 + tracklist 재시도 (모듈 로딩 대기)
        if (!text && player.loadModule) {
          player.loadModule('captions');

          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise((r) => setTimeout(r, 800));

            // 인터셉트로 캡처되었는지 먼저 확인
            if (capturedSubtitleData) {
              text = capturedSubtitleData;
              console.log('[Hotdog-Main] 대기 중 인터셉트 캡처됨:', text.length, '바이트');
              break;
            }

            const tracklist = player.getOption?.('captions', 'tracklist');
            console.log(`[Hotdog-Main] tracklist 재시도 ${attempt + 1}/5:`, tracklist?.length || 0);

            if (tracklist && tracklist.length > 0) {
              const track = tracklist.find((t) => t.kind !== 'asr') || tracklist[0];
              player.setOption('captions', 'track', track);

              // 자막 fetch가 완료될 때까지 대기
              await new Promise((r) => setTimeout(r, 2000));
              text = capturedSubtitleData;
              if (text) {
                console.log('[Hotdog-Main] 플레이어 트리거 성공:', text.length, '바이트');
              }
              break;
            }
          }
        }
      }
    }

    if (!text || !text.trim()) {
      console.warn('[Hotdog-Main] 자막 데이터 없음');
      done([]);
      return;
    }

    // 파싱
    let subs = [];
    try {
      const data = JSON.parse(text);
      for (const ev of data.events || []) {
        if (!ev.segs) continue;
        const t = ev.segs
          .map((s) => s.utf8 || '')
          .join('')
          .trim();
        if (!t || t === '\n') continue;
        subs.push({ startMs: ev.tStartMs, endMs: ev.tStartMs + (ev.dDurationMs || 0), text: t });
      }
    } catch {
      // regex로 XML 파싱 (DOMParser는 Trusted Types 정책에 의해 차단됨)
      const regex = /<text[^>]*start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const s = parseFloat(match[1]) * 1000;
        const d = parseFloat(match[2]) * 1000;
        const t = match[3]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .trim();
        if (t) subs.push({ startMs: s, endMs: s + d, text: t });
      }
    }

    console.log('[Hotdog-Main] 자막 파싱 완료:', subs.length, '개');
    done(subs);
  } catch (err) {
    console.warn('[Hotdog-Main] 오류:', err);
    done([]);
  }
});
