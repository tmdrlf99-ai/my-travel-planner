# MY TRAVEL PLANNER

## 개요
- 개인용 여행 플래너 PWA. 여행 달력, 지역별 일정, 방문지 지도, 예산을 한 화면에서 관리한다.
- 사용자는 한 명(소유자). 사이트 전체가 비밀번호 하나로 잠겨 있다.
- 원래 ChatGPT로 바이브코딩해서 만들었고, 이제부터 Claude로 유지보수한다.

## 기술 스택
- 프론트엔드: 프레임워크 없음. 순수 HTML + Vanilla JS + CSS (`index.html`, `app.js`, `style.css`)
- 지도: MapLibre GL (CDN, unpkg)
- 백엔드: Vercel Serverless Functions (`api/` 폴더, Node.js CommonJS)
- DB: Supabase (Postgres, REST API만 사용. Supabase Auth는 쓰지 않음)
- 배포: Vercel. GitHub `main` 브랜치에 push하면 자동 배포
- 빌드 과정 없음. package.json 없음. 파일을 그대로 서빙한다.

## 폴더 구조
- `index.html` — 단일 페이지. 비밀번호 게이트(`#siteAuthGate`) + 앱 본체
- `app.js` — 앱 로직 전체 (약 1,800줄). 달력/일정/방문지/예산 탭, 로컬 저장소 병합, API 호출
- `style.css` — 전체 스타일. `board-date-single-line.css`는 보조 스타일
- `config.js` — `window.TRAVEL_CONFIG` (Supabase URL, publishable 키). 공개 키라 커밋해도 됨
- `api/_site-auth.js` — 비밀번호 검증, HMAC 쿠키 발급/확인 (공용 모듈, 라우트 아님)
- `api/auth.js` — `/api/auth` GET(로그인 상태) / POST(비밀번호 입력) / DELETE(로그아웃)
- `api/travel-data.js` — `/api/travel-data` Supabase 프록시. 쿠키 인증된 요청만 통과
- `sw.js` — 서비스워커 (Network First 캐시). `manifest.webmanifest`, `icons/` — PWA 설치용
- `supabase_travel_planner.sql` — DB 스키마 (일부 구버전, 아래 참고)
- `app_v5_7_ROLLBACK.js` — 과거 백업본. 실제 로드되지 않음

## 데이터 흐름
- 브라우저는 Supabase에 직접 접속하지 않는다. 모든 읽기/쓰기는 동일 출처 `/api/travel-data?table=...`를 거친다.
  (회사망/모바일망에서 `*.supabase.co`가 막혀도 동작하게 하려는 의도. 이 구조를 깨지 말 것)
- `api/travel-data.js`의 `ALLOWED` 집합에 있는 테이블만 접근 가능: `travel_trips`, `travel_events`, `travel_budgets`, `travel_places`
- 서버에 저장 실패하면 브라우저 localStorage에 임시 저장(음수 id)하고 나중에 동기화한다.

## DB 테이블 (Supabase)
- `travel_trips` — 여행 단위 (제목, 기간, 지역/도시/국가, 상태, 메모)
- `travel_events` — 여행에 속한 날짜별 일정
- `travel_budgets` — 여행별 예산 항목 (예산액, 지출액)
- `travel_places` — 방문지 (SQL 파일에 정의가 빠져 있음. 실제 컬럼은 Supabase 대시보드에서 확인)
- `travel_regions`, `travel_world_places` — 지역/세계지도 기준 데이터
- 모든 테이블 RLS 켜져 있음. 익명 읽기 허용, 쓰기는 서버 프록시 경유

## 환경변수 (Vercel에만 설정, 저장소에 절대 커밋 금지)
- `TRAVEL_SITE_PASSWORD` — 사이트 비밀번호
- `TRAVEL_AUTH_SECRET` — 쿠키 서명용 비밀값
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` — 서버 프록시가 Supabase에 쓸 때 사용

## 작업 규칙
- 수정은 파일 단위로 최소한만. 1,800줄짜리 `app.js`를 통째로 다시 쓰지 말 것
- `sw.js`를 바꾸거나 정적 파일을 추가/삭제하면 `CACHE_NAME` 버전을 올릴 것 (안 올리면 폰에 옛 버전이 남음)
- `api/` 파일은 Node.js CommonJS(`require`/`module.exports`) 유지. ESM으로 바꾸지 말 것
- Supabase 직접 호출 코드를 프론트에 추가하지 말 것
- UI 문구는 한국어
- 당분간 GitHub 연결 없이 ZIP 교환 방식으로 작업: 수정한 파일만 돌려주고, 소유자가 GitHub 웹에서 직접 반영

## 알려진 이슈 / 확인 필요
- `index.html`과 `sw.js`가 `pwa.js`, `offline.html`을 참조하는데 저장소에 두 파일이 없음 (확인 중)
- `supabase_travel_planner.sql`이 실제 DB보다 오래됨 (`travel_places` 누락)
