# Hotdog Translator

웹 페이지, Gmail, YouTube 자막을 번역하는 Chrome 확장 프로그램.

Google 번역과 OpenAI 호환 API(GPT, Ollama, LM Studio 등)를 지원하며, 다중 AI 서버를 등록하여 전환할 수 있다.

## 주요 기능

- **웹 페이지 번역**: 제목, 본문, 댓글 등 페이지 텍스트를 선택한 언어로 번역 (원문 아래에 번역문 병기)
- **Gmail 번역**: 이메일 제목, 본문, 목록 뷰 번역
- **YouTube 자막 번역**: 영상 플레이어 위에 번역된 자막을 실시간 오버레이로 표시
- **선택 번역**: 텍스트를 드래그하면 툴팁으로 번역 표시 (전체 번역 캐시 공유)
- **단축키**: `Alt+Shift+T` 번역 토글, `Alt+Shift+H` 번역 숨김/보임
- **플로팅 번역 버튼(FAB)**: 모든 페이지에서 클릭 한 번으로 번역/제거
  - 가로/세로 자유 드래그 이동 + 위치를 `chrome.storage`에 저장하여 탭 간 유지
  - 호스트 페이지 테마의 영향을 받지 않도록 스타일 격리 (`!important`, `isolation`, `color-scheme`)
  - **번역 중 "핫도그 데워지는" 효과** (따뜻한 배경 + 바닥 열기 + 김 + 지글거림)
  - **📸 캡처 버튼**: hover 시 상단에 나타나며, 클릭하면 화면 캡처를 위해 FAB을 잠시 숨김(시간 설정 가능)
  - **📋 요약 버튼**: hover 시 하단에 나타남
- **다중 번역 엔진**: Google 번역 + OpenAI 호환 AI 서버 (복수 등록/전환 가능)
- **프리셋 지원**: GitHub Models, OpenAI GPT-4o-mini, GPT-5-mini 원클릭 설정
- **로컬/사내 AI 서버 지원**: `http://` 엔드포인트 허용. 모든 AI 호출을 background 서비스워커로 프록시하여 혼합 콘텐츠·CORS 제약을 우회
- **번역 캐싱**: 동일 텍스트 재번역 시 API 호출 없이 즉시 표시 (최대 5000건)
- **페이지 요약**: AI로 페이지 내용 요약 (마크다운 렌더링, 캐싱, 복사 지원)
- **실패 피드백**: 번역 실패 시 페이지에 에러 토스트 표시 (팝업이 닫혀 있어도 원인 확인 가능)

## 소스 구조

```
hotdog/
├── manifest.json        # Chrome Extension Manifest V3 설정
├── background.js        # Service Worker (Google 번역 + AI 호출 프록시)
├── popup.html           # 팝업 UI (4-View: 메인/설정/서버목록/서버폼)
├── popup.css            # 팝업 스타일 (앰버 테마)
├── popup.js             # 팝업 로직 (엔진 선택, 서버 CRUD, 설정, 번역 실행)
├── content.js           # 콘텐츠 스크립트 (페이지/Gmail 번역 + 선택 번역 + YouTube 자막 + FAB)
├── content.css          # 번역 텍스트, 자막 오버레이, FAB 스타일/애니메이션
├── youtube-main.js      # YouTube MAIN world 스크립트 (자막 데이터 인터셉트)
├── privacy-policy.html  # 개인정보처리방침
├── build.sh             # Chrome Web Store 업로드용 ZIP 빌드 (런타임 파일만 포함)
├── icons/
│   ├── hotdog.svg       # 핫도그 아이콘 원본 (SVG)
│   ├── icon16.png       # 툴바/확장 아이콘 (투명 배경)
│   ├── icon48.png
│   ├── icon128.png
│   └── webstore-128.png # 스토어 등록용 아이콘 (패키지에는 미포함)
└── docs/
    └── privacy-policy.html  # GitHub Pages 개인정보처리방침
```

### 주요 파일 설명

| 파일 | 역할 |
|------|------|
| `manifest.json` | 권한(`activeTab`, `storage`, `scripting`), 호스트 권한(`*://*/*` — 임의 AI 엔드포인트 호출용), MAIN world 스크립트 등록 |
| `background.js` | Google 번역 + AI(`/chat/completions`) 호출을 대신 수행하는 Service Worker 프록시 (혼합 콘텐츠·CORS 우회) |
| `popup.html` | 4개 뷰 구조 — 메인(번역), 설정, 서버 목록, 서버 추가/편집 폼 |
| `popup.js` | 엔진 드롭다운 동적 생성, AI 서버 등록/수정/삭제, 프리셋 버튼, 설정(캡처 숨김 시간 등), 캐시 삭제 |
| `content.js` | 페이지 DOM에서 번역 대상 수집 (YouTube/Gmail 전용 셀렉터), 선택 번역, 번역 캐싱, 동시 번역 잠금, FAB 관리 |
| `content.css` | 번역 텍스트, FAB 및 "데워지는" 로딩 애니메이션, 자막 오버레이, YouTube 버튼 스타일 |
| `youtube-main.js` | MAIN world에서 fetch/XHR 인터셉트로 YouTube 자막(timedtext) 데이터 캡처, 플레이어 API 폴백 |

### YouTube 자막 번역 흐름

1. `youtube-main.js`가 `document_start`에 MAIN world에서 `fetch`/`XHR`을 인터셉트
2. YouTube 플레이어가 자막(timedtext)을 로드하면 데이터 자동 캡처 (자막 데이터만 읽음)
3. 페이지 진입 시 자막 **사전 로딩** (버튼 클릭 전에 미리 준비)
4. 사용자가 컨트롤 바의 🌭 버튼 클릭
5. 자막 세그먼트 병합 → 오버레이 즉시 표시 (원본)
6. 백그라운드에서 점진적 번역 → 번역 자막으로 자동 전환
7. CC가 꺼져 있어도 `ytInitialPlayerResponse` 폴백으로 자막 로드

### AI 호출 흐름

AI 번역/요약은 콘텐츠 스크립트나 팝업에서 직접 호출하지 않고 **background 서비스워커를 경유**한다.
이렇게 하면 `https` 페이지에서 `http` 로컬 AI 서버를 호출할 때 발생하는 **혼합 콘텐츠 차단**과 **CORS** 제약을 우회할 수 있다.

```
content.js / popup.js  ──(chrome.runtime.sendMessage: aiChat)──►  background.js  ──(fetch)──►  AI 서버
```

### 데이터 저장 (`chrome.storage.local`)

```js
{
  targetLang: "ko",                  // 번역 대상 언어
  engine: "google" | "ai:<uuid>",    // 선택된 번역 엔진
  aiServers: [                       // 등록된 AI 서버 배열
    {
      id: "uuid",
      name: "서버 이름",
      endpoint: "http://192.168.1.13:1234/v1",  // OpenAI 호환 base URL (http 허용)
      model: "gpt-4o-mini",
      apiKey: "sk-..."               // 로컬에만 저장, 외부로 수집되지 않음
    }
  ],
  captureHideSec: 3,                 // 캡처 시 FAB 숨김 시간(초)
  fabBottomRatio: 0.05,              // FAB 위치(뷰포트 비율)
  fabRightRatio: 0.02,
  hotdogCache: { ... }               // 번역 캐시 (최대 5000건)
}
```

> 모든 값은 사용자 기기 로컬에만 저장되며 개발자에게 전송되지 않는다. 페이지 텍스트는 번역·요약 목적으로 사용자가 선택한 번역/AI 서비스로만 전송된다.

## 설치 방법

1. 이 저장소를 클론한다.

   ```bash
   git clone https://github.com/roykang75/hotdog.git
   ```

2. Chrome에서 `chrome://extensions` 페이지를 연다.

3. 우측 상단의 **개발자 모드**를 활성화한다.

4. **압축해제된 확장 프로그램을 로드합니다** 버튼을 클릭한다.

5. `hotdog` 폴더를 선택한다.

6. 툴바에 핫도그 아이콘이 나타나면 설치 완료.

## 사용 방법

### 웹 페이지 번역

1. 번역할 웹 페이지에서 **플로팅 🌭 버튼**을 클릭한다. (또는 툴바 아이콘 → 번역, 또는 `Alt+Shift+T`)
2. 번역이 완료되면 다시 클릭하여 원본으로 되돌린다.
3. 팝업에서 번역 엔진과 언어를 변경할 수 있다.

### 선택 번역

1. 페이지에서 번역하고 싶은 텍스트를 드래그하여 선택한다.
2. 선택 영역 근처에 번역 결과 툴팁이 표시된다.

### YouTube 자막 번역

1. YouTube 영상 페이지에서 컨트롤 바의 **🌭 버튼**을 클릭한다.
2. CC가 꺼져 있어도 자동으로 자막을 로드한다.
3. 원본 자막이 즉시 표시되고, 점진적으로 번역된 자막으로 전환된다.
4. 다시 버튼을 클릭하면 자막 오버레이가 제거된다.

### Gmail 번역

1. Gmail에서 이메일을 열고 **플로팅 🌭 버튼**을 클릭한다.
2. 이메일 제목과 본문이 번역된다.
3. 목록 뷰에서도 제목과 미리보기가 번역된다.

### 페이지 요약

1. AI 서버가 등록된 상태에서 **플로팅 🌭 버튼**에 마우스를 올리면 하단에 **📋 버튼**이 나타난다.
2. 📋 버튼을 클릭하면 페이지 내용을 AI로 요약하여 슬라이드 카드로 표시한다.
3. 팝업의 **요약** 버튼을 클릭해도 동일하게 동작한다.
4. 같은 페이지 재요약 시 캐시에서 즉시 표시된다.
5. 요약 카드는 드래그로 이동 가능하고, 복사 버튼으로 내용을 복사할 수 있다.

### 화면 캡처용 FAB 숨김

1. **플로팅 🌭 버튼**에 마우스를 올리면 상단에 **📸 버튼**이 나타난다.
2. 📸 버튼을 클릭하면 FAB이 잠시 사라진다 — 그 사이에 화면을 캡처한다.
3. 설정한 시간(기본 3초) 후 FAB이 다시 나타난다.

### 설정

팝업의 **⚙ 설정**에서 다음을 관리한다.

- **AI** — AI 서버 관리(등록/수정/삭제)
- **캡처** — 캡처 숨김 시간(2/3/5/7/10초)
- **데이터** — 번역 캐시 삭제

### AI 서버 등록

1. 팝업 → **⚙ 설정** → **AI 서버 관리**를 클릭한다.
2. **+ 서버 추가** 버튼을 클릭한다.
3. **프리셋** (GitHub Models, OpenAI GPT-4o-mini/5-mini)을 선택하거나 직접 입력한다.
4. 서버 이름, Endpoint URL, Model, API Key를 입력하고 **저장**한다.

OpenAI 호환 API(`/v1/chat/completions`)를 지원하는 서비스라면 모두 사용 가능하다 (OpenAI, Ollama, LM Studio, vLLM 등).
로컬/사내 서버의 `http://` 엔드포인트도 사용할 수 있다. Endpoint는 base URL(예: `http://localhost:1234/v1`)을 입력한다.

## 빌드

```bash
bash build.sh
# hotdog-v{version}.zip 생성 (런타임 파일만 포함)
```

## 개인정보처리방침

[개인정보처리방침](https://roykang75.github.io/hotdog/docs/privacy-policy.html)

## 라이선스

MIT
