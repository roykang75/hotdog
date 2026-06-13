# Hotdog Translator TODO

## 완료된 기능

- [x] Gmail 번역 지원 (스레드 뷰 제목 + 본문 + 목록 뷰)
- [x] 플로팅 번역 버튼 (FAB) — 모든 페이지에 🌭 아이콘 표시
- [x] 요약 FAB (📋) — FAB hover 시 나타남, 페이지 요약 슬라이드 카드
- [x] 페이지 요약 기능 (AI 엔진 사용, 마크다운 렌더링, 캐싱)
- [x] 요약 카드 드래그 이동, 복사 버튼 + Copied 툴팁
- [x] 팝업/FAB 요약 통합 (동일한 슬라이드 카드 + 캐시 공유)
- [x] OpenAI GPT-4o-mini / GPT-5-mini 프리셋 추가
- [x] 핫도그 모양 아이콘 적용 (SVG 기반 16/48/128px)
- [x] 번역 캐싱 (chrome.storage.local, 최대 5000건)
- [x] 캐시 삭제 버튼 팝업에 추가
- [x] Google Translate Background SW 프록시 (CORS 우회) + 긴 텍스트 분할
- [x] YouTube 자막 CC 없이도 로드 (ytInitialPlayerResponse 폴백)
- [x] YouTube 자막 사전 로딩 (페이지 진입 시 자동 fetch)
- [x] YouTube 자막 배치 크기 최적화 (30개) + AI 실패 시 절반 재시도
- [x] YouTube ASR 트랙 직접 fetch 건너뛰기 (빈 응답 방지)
- [x] YouTube 컨트롤 바에 🌭 아이콘 버튼 (상태별 SVG 아이콘)
- [x] YouTube 자막 폰트 크기 반응형 (clamp)
- [x] youtube-main.js IIFE 래핑 (SPA 변수 재선언 에러 해결)
- [x] arxiv References 등 grid/flex 레이아웃 번역 표시 개선
- [x] 팝업 UI 리디자인 (Plus Jakarta Sans, 앰버 라이트 테마)
- [x] 모든 버튼 pill 스타일 통일
- [x] temperature 파라미터 제거 (GPT-5-mini 호환)
- [x] AI API 에러 로깅 강화
- [x] 코드 리뷰 이슈 수정 (XSS 방지, 캐시 키 충돌, API 응답 가드, 자막 번역 실패 처리)
- [x] 블로그/가이드 페이지 번역 누락 개선 (CONTENT_AREA_SELECTOR 확장, CENTER 태그 지원)
- [x] FAB 위치를 chrome.storage에 저장하여 탭 간 유지 (뷰포트 비율 기반)
- [x] FAB 가로/세로 자유 드래그 이동 지원
- [x] FAB이 호스트 페이지 테마의 영향을 받지 않도록 스타일 격리 (!important, isolation, color-scheme)
- [x] 선택 번역 (드래그 → 툴팁, 캐시 공유)
- [x] 단축키 지원 (`Alt+Shift+T` 번역 토글, `Alt+Shift+H` 번역 숨김/보임)
- [x] 시니어 코드 리뷰 대응 (renderMarkdown 하드닝, API 토큰 마스킹 + endpoint https 강제, fetch 몽키패치 정리, cacheKey 해시+LRU, AI 실패 시 loader 정리, 민감 도메인 exclude_matches)
- [x] GitHub 레포 페이지 오번역 수정 (specific/generic 콘텐츠 영역 분리로 파일 목록 표 제외, sr-only/ScreenReaderHeading/1x1px 요소 감지, DIV 조건부 포함)
- [x] YouTube 컨트롤 바 🌭 버튼 중복 수정 (querySelectorAll 전체 정리 + MutationObserver dedupe, `.ytp-right-controls-left` 신규 레이아웃 지원)
- [x] 번역 문장이 다음 원문 위에 붙어 보이는 문제 수정 (sibling after → 원문 요소 내부 appendChild로 변경, margin collapsing 회피)
- [x] 서버 추가/저장 폼 인라인 검증 (빈 칸·잘못된 endpoint를 폼에서 즉시 안내)
- [x] AI 엔드포인트 http 허용 + 모든 AI 호출을 background 서비스워커 경유로 (혼합 콘텐츠/CORS 우회, host_permissions 확장)
- [x] 번역 실패 시 페이지 에러 토스트 표시 (팝업이 닫혀도 원인 노출)
- [x] FAB 번역 중 중복 번역 방지 (isTranslating 잠금)
- [x] 번역 중 "핫도그 데워지는" 효과 (그릴 배경 + 바닥 열기 + 김 + 지글거림)
- [x] FAB 캡처용 숨김 버튼 (📸, hover 시 상단 노출, 클릭 시 N초간 숨김 — 설정 가능)
- [x] 팝업 설정 화면 분리 (메인=번역, 설정 뷰에 AI/캡처/데이터 카테고리)

## Chrome 웹스토어 등록

### 심사 주의사항

1. **`<all_urls>` 권한** — FAB 표시를 위해 필요. 심사 지연 가능하지만 거절은 아님.
2. **fetch/XHR 인터셉트 (youtube-main.js)** — 자막 데이터 캡처용. 정당한 목적 명시 필요.
3. **개인정보처리방침** — 광범위 권한에는 필수.

### TODO

- [x] 개인정보처리방침 페이지 작성 (privacy-policy.html)
- [x] 확장 프로그램 설명에 fetch 인터셉트의 정당한 목적 명시
- [ ] 웹스토어 스크린샷 업데이트 (새 UI 반영)
- [x] 버전 업데이트 후 패키징 (`hotdog-v1.0.2.zip`)

## 향후 개선 아이디어

- [ ] 번역 결과 색상/스타일 커스터마이징 옵션
- [ ] 특정 사이트별 번역 제외 설정
- [ ] 자막 번역 캐싱 (동일 영상 재방문 시 즉시 표시)
- [ ] 다크 모드 팝업 옵션
