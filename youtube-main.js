// YouTube MAIN world 스크립트 (document_start)
// YouTube 플레이어의 자막 네트워크 요청을 인터셉트하여 데이터 캡처

(() => {
  if (window.__hotdogMainLoaded) return;
  window.__hotdogMainLoaded = true;

  let capturedSubtitleData = null;

  // SPA 네비게이션 시 캡처 초기화 + ytInitialPlayerResponse 갱신 대기
  document.addEventListener('yt-navigate-finish', () => {
    capturedSubtitleData = null;
    setTimeout(() => {
      const player = document.getElementById('movie_player');
      if (player?.getPlayerResponse) {
        window.__hotdogPlayerResponse = player.getPlayerResponse();
      }
    }, 2000);
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

      // 캡처된 데이터가 없으면 플레이어 API로 자막 로드 시도
      if (!text) {
        const player = document.getElementById('movie_player');
        if (player) {
          // 방법 1: 여러 소스에서 캡션 트랙 URL 추출 시도
          const prSources = [
            player.getPlayerResponse?.(),
            window.__hotdogPlayerResponse,
            window.ytInitialPlayerResponse,
          ];
          const pr = prSources.find(s => s?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length > 0) || prSources.find(Boolean);
          if (pr) {
            try {
              const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

              if (tracks && tracks.length > 0) {
                const track = tracks.find((t) => t.kind !== 'asr') || tracks[0];

                // ASR(자동생성) 자막은 직접 fetch 시 빈 응답 → 건너뛰고 트랙 활성화로 진행
                if (track.kind !== 'asr') {
                  const url = track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3';
                  try {
                    const resp = await originalFetch(url);
                    if (resp.ok) {
                      const respText = await resp.text();
                      if (respText && respText.length > 0) {
                        text = respText;
                      }
                    }
                  } catch { /* 직접 fetch 실패는 무시 */ }
                }
              }
            } catch { /* playerResponse 방법 실패는 무시 */ }
          }

          // 방법 2: captions 모듈 로드 + 트랙 활성화로 자막 fetch 트리거
          if (!text && player.loadModule) {
            player.loadModule('captions');

            // 방법 1에서 얻은 트랙 정보 활용
            const knownTracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

            for (let attempt = 0; attempt < 8; attempt++) {
              await new Promise((r) => setTimeout(r, attempt === 0 ? 300 : 800));

              // 인터셉트로 캡처되었는지 확인
              if (capturedSubtitleData) {
                text = capturedSubtitleData;
                break;
              }

              // 트랙 활성화 시도 (알려진 트랙 또는 tracklist에서)
              const tracklist = player.getOption?.('captions', 'tracklist');
              const trackToSet = tracklist?.[0] || (knownTracks?.[0] ? { languageCode: knownTracks[0].languageCode } : null);

              if (trackToSet) {
                try {
                  player.setOption('captions', 'track', trackToSet);
                  // YouTube 자체 자막 표시 즉시 숨김
                  const captionWindow = document.querySelector('.ytp-caption-window-container');
                  if (captionWindow) captionWindow.style.display = 'none';
                } catch {}
              }
            }

            // 활성화된 자막을 다시 숨김 (사용자가 CC를 원하지 않으므로)
            if (text) {
              try { player.unloadModule('captions'); } catch {}
            }
          }
        }
      }

      if (!text || !text.trim()) {
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

      done(subs);
    } catch {
      done([]);
    }
  });
})();
