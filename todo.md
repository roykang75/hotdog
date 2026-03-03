# Chrome 웹스토어 등록 TODO

## 통과 어려울 수 있는 부분

1. **`<all_urls>` 권한** — 가장 큰 리스크. 구글은 광범위한 권한을 매우 엄격히 심사. "왜 모든 사이트에 접근이 필요한지" 정당화 필요.

2. **fetch/XHR 인터셉트 (youtube-main.js)** — `window.fetch`와 `XMLHttpRequest.prototype`을 monkey-patch하는 것은 악성 확장 프로그램이 자주 쓰는 패턴이라 심사관이 민감하게 봄.

3. **개인정보처리방침 없음** — `<all_urls>` 같은 광범위 권한에는 필수.

## 통과 가능성을 높이려면

- [ ] `manifest.json`에서 `<all_urls>` 대신 `activeTab`만으로 동작하도록 구조 변경 (팝업에서 클릭 시에만 활성화)
- [ ] `host_permissions`는 `translate.googleapis.com`만 남기기
- [ ] 개인정보처리방침 페이지 작성 (GitHub Pages 등)
- [ ] 확장 프로그램 설명에 fetch 인터셉트의 정당한 목적 명시

## 현실적 판단

번역 확장 프로그램 자체는 문제없지만, **fetch/XHR 패치 + `<all_urls>`** 조합이 심사에서 reject될 확률이 높음. 권한 최소화 작업을 먼저 하는 것을 권장.
