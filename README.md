# Hotdog Translator

웹 페이지의 텍스트를 선택한 언어로 번역하는 Chrome 확장 프로그램.

Google 번역과 OpenAI 호환 API(GPT, Ollama 등)를 지원하며, 다중 AI 서버를 등록하여 전환할 수 있다.

YouTube 영상에서는 자막을 실시간으로 번역하여 오버레이로 표시한다.

## 주요 기능

- **웹 페이지 번역**: 제목, 본문, 댓글 등 페이지 텍스트를 선택한 언어로 번역
- **YouTube 자막 번역**: 영상 플레이어 위에 번역된 자막을 실시간 오버레이로 표시
- **다중 번역 엔진**: Google 번역 + OpenAI 호환 AI 서버 (복수 등록/전환 가능)
- **번역 중 로딩 애니메이션**: shimmer 효과로 번역 진행 상태 표시

## 소스 구조

```
hotdog/
├── manifest.json        # Chrome Extension Manifest V3 설정
├── popup.html           # 팝업 UI (3-View: 메인/서버목록/서버폼)
├── popup.css            # 팝업 스타일
├── popup.js             # 팝업 로직 (엔진 선택, 서버 CRUD, 번역 실행)
├── content.js           # 콘텐츠 스크립트 (페이지 번역 + YouTube 자막 모듈)
├── content.css          # 번역 텍스트 및 자막 오버레이 스타일
├── youtube-main.js      # YouTube MAIN world 스크립트 (자막 데이터 인터셉트)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### 주요 파일 설명

| 파일 | 역할 |
|------|------|
| `manifest.json` | 권한(`activeTab`, `storage`, `scripting`), 호스트 권한, MAIN world 스크립트 등록 |
| `popup.html` | 3개 뷰 구조 — 메인(번역), 서버 목록, 서버 추가/편집 폼 |
| `popup.js` | 엔진 드롭다운 동적 생성, AI 서버 등록/수정/삭제, `chrome.storage.local` 연동, 번역 메시지 전달 |
| `content.js` | 페이지 DOM에서 번역 대상 수집 (YouTube 전용 셀렉터 포함), 번역 API 호출, YouTube 자막 오버레이 관리 |
| `content.css` | 번역 텍스트, 로딩 애니메이션, 자막 오버레이, 플레이어 버튼 스타일 |
| `youtube-main.js` | MAIN world에서 fetch/XHR 인터셉트로 YouTube 자막 데이터 캡처, 플레이어 API 폴백 |

### YouTube 자막 번역 흐름

1. `youtube-main.js`가 `document_start`에 MAIN world에서 `fetch`/`XHR`을 인터셉트
2. YouTube 플레이어가 자막(timedtext)을 로드하면 데이터 자동 캡처
3. 사용자가 영상 플레이어의 "자막 번역" 버튼 클릭
4. `content.js`가 CustomEvent로 MAIN world에 자막 데이터 요청
5. 자막 세그먼트 병합 → 오버레이 즉시 표시 (원본 영어)
6. 백그라운드에서 점진적 번역 → 한국어로 자동 전환

### 데이터 저장 (`chrome.storage.local`)

```js
{
  targetLang: "ko",                  // 번역 대상 언어
  engine: "google" | "ai:<uuid>",    // 선택된 번역 엔진
  aiServers: [                       // 등록된 AI 서버 배열
    {
      id: "uuid",
      name: "서버 이름",
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-..."
    }
  ]
}
```

## 설치 방법

1. 이 저장소를 클론하거나 소스를 다운로드한다.

   ```bash
   git clone <repository-url>
   ```

2. Chrome 브라우저에서 `chrome://extensions` 페이지를 연다.

3. 우측 상단의 **개발자 모드**를 활성화한다.

4. **압축해제된 확장 프로그램을 로드합니다** 버튼을 클릭한다.

5. `hotdog` 폴더를 선택한다.

6. 툴바에 핫도그 아이콘이 나타나면 설치 완료.

## 사용 방법

### 웹 페이지 번역

1. 번역할 웹 페이지에서 툴바의 핫도그 아이콘을 클릭한다.
2. **번역 엔진**을 선택한다 (Google 번역 또는 등록된 AI 서버).
3. **번역 언어**를 선택한다.
4. **번역** 버튼을 클릭한다.

### YouTube 자막 번역

1. YouTube 영상 페이지에서 영상 위의 **자막 번역** 버튼을 클릭한다.
2. 자막이 없으면 YouTube 설정에서 자동생성 자막을 활성화한다.
3. 원본 자막이 즉시 표시되고, 점진적으로 번역된 자막으로 전환된다.
4. 다시 버튼을 클릭하면 자막 오버레이가 제거된다.

### AI 서버 등록

1. 팝업 하단의 **⚙ AI 서버 관리**를 클릭한다.
2. **+ 서버 추가** 버튼을 클릭한다.
3. 서버 이름, Endpoint URL, Model, API Key를 입력하고 **저장**한다.
4. 메인 화면의 번역 엔진 드롭다운에서 등록한 서버를 선택할 수 있다.

OpenAI 호환 API(`/v1/chat/completions`)를 지원하는 서비스라면 모두 사용 가능하다 (OpenAI, Ollama, LM Studio, vLLM 등).
