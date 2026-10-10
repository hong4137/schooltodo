# SchoolToDo 작업 인수인계서

> 작성일: 2026-10-10 · 웹 Claude 세션 → Claude Code 이관용
> 이 문서는 레포만 클론한 상태에서 전체 시스템을 파악할 수 있도록 작성됨

## 0. 이관 후 확인 결과 (2026-10-10, Claude Code)

- **Worker 정본 편입 완료.** Cloudflare API로 대시보드 배포본(2026-09-02 업로드, 1,579줄)을 받아 `worker/src/index.js` 에 넣었다. `wrangler.toml` 에 Cron 4개·`SUPABASE_URL` 평문 변수를 선언했고 `wrangler deploy --dry-run` 통과.
- **네스트 브리핑 복구본은 배포돼 있다.** 배포본에 `runNestHubBriefing` · `GET /test-briefing` 이 들어 있다. 실제 Google Tasks 생성까지 됐는지는 아직 미확인(`/test-briefing` 은 실데이터에 쓰므로 호출하지 않았다).
- **Cron 4번은 평일 한정이 아니다.** 대시보드 실제 값은 `*/10 2-9 * * *` (매일). 평일 필터는 코드(`isWeekday`)가 한다.
- **텔레그램 연동 코드(`/link` + 코드)는 구현돼 있다.** DB 에 `link_codes` 테이블과 `generate_link_code`·`verify_link_code` 함수가 있고, 웹·Worker 호출부도 있다. 10장 4번은 완료 항목.
- **SQL 기준선 확보.** 누락된 001~003·006~017 원본은 사라졌지만, 운영 DB 를 `pg_dump` 로 받아 `sql/migrations/000_baseline_2026-10-10.sql` 에 넣었다(테이블 16개·함수 6개·정책 20개). 덤프 절차는 `sql/migrations/README.md`.
- **Apps Script 사본은 아직 없다.** Google Apps Script 편집기에서 `briefing.gs` 를 복사해 `apps-script/` 에 넣어야 한다.
- `toISOString()` 잔존: Worker `handleToday()`(157행)·`callOpenAI()`(450행)는 여전히 UTC 날짜를 쓴다. 미수정.

---

## 1. 프로젝트 개요

초등학생 자녀를 둔 가족(본인 + 배우자) 2명이 쓰는 학교 할 일/시간표 관리 앱.

학교 알림장·가정통신문 사진을 텔레그램 봇에 보내면 AI가 할 일을 추출해 저장하고,
시간표·픽업 시간에 맞춰 텔레그램/웹푸시/구글 네스트로 알림을 보낸다.

| 항목 | 값 |
|---|---|
| 웹앱 | https://hong4137.github.io/schooltodo/ |
| 레포 | `hong4137/schooltodo` (main 브랜치) |
| Worker | `schooltodo-bot.hong4137.workers.dev` |
| Supabase | `https://sprrelvxxgvrdkmplidu.supabase.co` |
| 사용자 | 2명, 둘 다 안드로이드, PWA로 홈 화면 설치해서 사용 |

---

## 2. 시스템 구성

4개 축으로 나뉘어 있다. (2026-10-10 기준 ①②가 레포에 있음)

```
① 웹앱 (React + Vite)          → GitHub Pages        ✅ 레포에 있음
② 봇/알림 (Cloudflare Worker)   → Cloudflare 대시보드  ✅ worker/ 로 편입 (2026-10-10)
③ DB/스토리지 (Supabase)        → Supabase 콘솔        ✅ 기준선 덤프 000 + 004·005 (2026-10-10)
④ 네스트 브리핑 (Apps Script)   → Google Apps Script   ❌ 레포에 없음
```

### 데이터 흐름

```
[텔레그램 사진]
      ↓
  Worker (webhook)
      ↓ OpenAI gpt-4.1 Vision
  Supabase tasks / documents / Storage
      ↓
  웹앱(PWA) 조회·수정

[Cron]
  KST 07:10 → Apps Script → Google Tasks → 네스트가 읽어줌
  KST 07:30 → 오늘 할 일 (텔레그램 + 웹푸시)
  KST 21:00 → 내일 할 일 (텔레그램 + 웹푸시)
  KST 11:00~18:50 /10분 → 픽업 1시간 전 · 도보하원/이동 정각 알림
```

---

## 3. 레포 구조

```
src/
  App.jsx                  하단 4탭: 투데이 / 시간표 / 캘린더 / 설정
  main.jsx                 서비스워커 등록
  lib/
    supabase.js            ⚠️ URL·anon key 하드코딩 (아래 9장 참고)
    auth.jsx               AuthProvider, useAuth
    tasks.js               할 일 CRUD
    timetable.js           시간표·픽업·알림·학기 CRUD (17개 export)
    archive.js             보관함 CRUD + 이미지 자동 리사이즈
    push.js                웹푸시 구독 관리 (VAPID)
  pages/
    TodayPage.jsx          오늘/이번주 할 일, 완료 항목 접힌 섹션
    TimetablePage.jsx      시간표 (596줄, 가장 큰 파일)
    CalendarPage.jsx       상단 세그먼트로 [캘린더 | 보관함] 전환
    ArchivePage.jsx        학교 공지 아카이브 (파일 첨부)
    SettingsPage.jsx       텔레그램 연동, 알림 시간, 푸시/픽업 토글
  components/
    TaskCard.jsx           아코디언 카드 + 수정 바텀시트 (351줄)
    TaskDetail.jsx
public/
  manifest.json  sw.js  icons/      PWA
worker/
  src/index.js   wrangler.toml   README.md       ← 2026-10-10 편입
sql/migrations/
  004_archive_setup.sql  005_timetable_setup.sql  README.md (누락 목록·덤프 절차)
docs/
  HANDOVER.md  SUPABASE_SCHEMA.md
.github/workflows/deploy.yml                main push → Pages 자동 배포
```

**빌드**: `npm ci && npm run build` → `dist/`. `vite.config.js`의 `base: '/schooltodo/'` 때문에 모든 경로가 `/schooltodo/` 하위로 나간다. 로컬에서 `npm run dev` 할 때도 같은 base가 적용된다.

---

## 4. Supabase 스키마

### 테이블

| 테이블 | 용도 |
|---|---|
| `profiles` | 사용자. `active_term`, `notification_morning/evening`, `pickup_reminder_enabled` |
| `tasks` | 할 일. `due_date`, `priority`, `category`, `notified_morning/evening` |
| `documents` / `document_images` | 업로드된 알림장 원문 + 사진 경로 |
| `upload_sessions` | 텔레그램 사진 업로드 세션 (여러 장 → "완료") |
| `user_telegrams` | chat_id ↔ user_id 연동 |
| `push_subscriptions` | 웹푸시 구독 (endpoint, p256dh, auth) |
| `app_settings` | `vapid_public_key` 저장 |
| `timetable_terms` | 학기 목록 (블록이 없어도 학기가 유지되도록 별도 테이블) |
| `timetable_blocks` | 시간표 블록. `term`, `day`, `start_time`, `end_time`, `category`, `color` |
| `timetable_pickups` | 픽업 시간. **요일당 복수 가능** (UNIQUE: user_id, day, pickup_time, term) |
| `timetable_alerts` | 정각 알림 (도보하원, 태권도 이동) |
| `timetable_subjects` | 과목 프리셋 (빠른 선택용) |
| `archive_posts` / `archive_files` | 보관함 글 + 첨부파일 |

전 테이블 RLS 활성화, 정책은 `auth.uid() = user_id`.

### Storage 버킷

- `document-images` — 알림장 원본 사진
- `archive-files` — 보관함 첨부 (이미지는 업로드 전 1200px로 리사이즈)

둘 다 **public** 버킷. 경로가 UUID 조합이라 추측은 사실상 불가능하고 Supabase는 robots.txt로 크롤링이 차단되지만, URL을 아는 사람은 볼 수 있다. 가족용이라 현 상태 유지하기로 결정했음.

### 학기 시스템

`profiles.active_term` 값으로 시간표/픽업/알림을 한 번에 전환한다.
현재 활성 학기는 `1학년2학기`. `1학년1학기` 데이터도 그대로 보존돼 있다.

⚠️ Worker는 `active_term`과 다른 학기의 픽업·알림은 건너뛴다. 학기를 바꾸면 알림도 자동으로 따라간다.

---

## 5. Cloudflare Worker

### Cron Trigger (1개, 2026-10-10부터)

`*/5 * * * *` 하나. 시각 판단은 `scheduled()` 에서 KST 로 한다.

| KST | 하는 일 |
|---|---|
| 07:10 | **네스트 브리핑** (고정) |
| 사용자 설정 시각 (`profiles.notification_morning`, 기본 07:30) | 오늘 할 일 알림. 놓치면 30분 안에 재시도(task 플래그로 중복 방지) |
| 사용자 설정 시각 (`profiles.notification_evening`, 기본 21:00) | 내일 할 일 알림 |
| 11:00~17:59 평일, 5분마다 | 픽업 1시간 전 · 정각 알림. 쉬는 날은 건너뜀 |

이전(~2026-10-10)엔 고정 Cron 4개였고 설정 화면의 알림 시각은 무시됐다.

### Secrets (8개, 이미 등록돼 있음)

`BRIEFING_APPS_SCRIPT_URL` · `OPENAI_API_KEY` · `SUPABASE_SERVICE_ROLE_KEY` ·
`SUPABASE_URL`(Text, wrangler.toml `[vars]`) · `TELEGRAM_BOT_TOKEN` ·
`VAPID_PRIVATE_KEY` · `VAPID_PUBLIC_KEY` · `VAPID_SUBJECT`

### 주요 함수

- `fetch(request, env, ctx)` — 텔레그램 webhook + `GET /test-briefing`
- `scheduled(event, env, ctx)` — 위 Cron 4종 분기
- `classifyIntent()` — gpt-4.1-mini로 자연어 의도 분류 (목록/삭제/완료/초기화/추가/도움말)
- `callOpenAI()` — gpt-4.1 Vision으로 알림장 파싱
- `handlePickupReminder()` — 픽업 + 정각 알림 (term 필터 포함)
- `sendWebPush()` / `sendPushNotification()` / `encryptPayload()` — VAPID 웹푸시 직접 구현
- `runNestHubBriefing()` / `buildBriefingTitle()` / `buildBriefingDescription()`

### 하드코딩 주의

`runNestHubBriefing()` 안에 `TARGET_USER_ID = "fdb9f068-..."`가 박혀 있다. 브리핑은 이 한 사용자만 대상으로 한다.

---

## 6. 레포에 없던 파일들 (경위)

**이게 실제로 장애를 한 번 일으켰다.**

Worker 코드의 정본이 Cloudflare 대시보드에만 있다 보니, 웹 세션에서 들고 있던 구버전 사본으로 전체를 덮어쓰는 일이 반복됐다. 그 결과 2026년 4월에 추가했던 **네스트 브리핑 코드(`runNestHubBriefing` 등)가 통째로 사라졌고**, 9월 초 "오늘 할 일 없습니다"로 발견될 때까지 몇 달간 작동하지 않았다.

### 편입 현황 (2026-10-10)

```
worker/
  src/index.js          ✅ 대시보드 정본 그대로 (1,579줄)
  wrangler.toml         ✅ Cron 4개 + vars
sql/migrations/
  000_baseline          ✅ 운영 DB pg_dump (누락 001~003·006~017 을 대체)
  004, 005              ✅
apps-script/
  briefing.gs           ❌ Apps Script 편집기에서 복사해 올 것
```

이제부터 Worker 는 `worker/` 에서 `npx wrangler deploy` 로만 배포한다.

---

## 7. 미확인 상태 (이어받아 확인할 것)

- [x] 네스트 브리핑 복구본이 배포됐는지 — 배포본에 코드 있음 (0장). 실제 동작은 아침 07:25 네스트 응답 또는 `/test-briefing` 으로 확인
- [ ] 웹푸시가 실제로 도착하는지 — 과거 `Push failed: 410`(구독 만료)이 있었고, 설정에서 토글을 껐다 켜면 재구독된다
- [ ] 2학기 정규수업 시간표 — 수·금에 5교시가 없는 것으로 두었는데 1학기 기준 복사본이라 실제와 다를 수 있음

---

## 8. 현재 시간표 데이터 (term = `1학년2학기`)

| | 월 | 화 | 수 | 목 | 금 |
|---|---|---|---|---|---|
| 정규 | 등교 08:40 / 1~4교시 / 점심 11:20~12:10 | 〃 | 〃 | 〃 | 〃 |
| 5교시 13:00~13:40 | ○ | ○ | ✕ | ○ | ✕ |
| 늘봄 13:40~15:10 | 보드게임 | 창의음악 | ✕ | 책놀이 | ✕ |
| 방과후 | 바둑&체스 15:20~16:40 | | 바이올린 13:00~14:20<br>방송댄스 14:30~15:50 | | 음악줄넘기 13:00~14:20<br>도자기공예 14:40~16:00 |
| 사설학원 | 미술 17:00~18:00 | 피아노 15:20~16:20<br>태권도 16:30~17:30 | 태권도 16:30~17:30 | 피아노 15:20~16:20<br>태권도 16:30~17:30 | 태권도 16:30~17:30 |
| 도보하원 | — | 15:10 | 15:50 | 15:10 | 16:00 |
| 태권도 이동 | — | 16:20 | — | 16:20 | — |
| 픽업 | 16:40, 18:00 | 17:35 | 17:35 | 17:35 | 17:35 |

**장소**: 늘봄3반(보드게임·창의음악·책놀이) 1-5교실 / 바둑&체스 교과교육실3 / 바이올린 음악실 / 방송댄스·음악줄넘기 소체육실 / 도자기공예 실과실

**알림 시각 규칙**: 이동 알림은 수업 시작 시각이 아니라 **직전 프로그램이 끝나는 시각**에 맞춘다. (화·목 16:20 = 피아노 종료)

Cron 이 5분 간격이라 픽업 17:35의 1시간 전 알림은 16:35 슬롯에 정확히 울린다(5분 단위가 아니면 최대 4분 늦음).

---

## 9. 알아두면 좋은 함정들

**KST 타임존** — `toISOString()`은 항상 UTC 기준 날짜를 반환한다. 한국 시간 밤 9시 이후엔 UTC로 이미 다음 날이라 D-Day가 하루 밀렸던 버그가 있었다. 알림 Cron 쪽은 KST 년/월/일을 직접 뽑는 방식으로 고쳐져 있다. **새 날짜 코드를 쓸 때 `toISOString()`을 쓰지 말 것.** (Worker `handleToday`·`callOpenAI` 에 잔존)

**PWA 서비스워커 캐시** — 배포했는데 화면이 안 바뀌면 `public/sw.js`의 `CACHE_NAME`을 올려야 한다. 현재 `schooltodo-v2`. 이것 때문에 "빌드는 성공했는데 왜 안 바뀌지" 상황을 겪었다.

**VAPID 키 import** — web-push가 만드는 private key는 raw 32바이트라 `pkcs8`로 import하면 실패한다. public key의 x·y 좌표를 붙여 **JWK로** import해야 한다. 이미 그렇게 고쳐져 있다.

**GitHub Actions 연속 푸시** — 파일을 하나씩 push하면 중간 상태에서 빌드가 돌아 실패한다. 여러 파일을 고쳤으면 **한 커밋으로 묶어서** 푸시할 것.

**anon key 하드코딩** — `src/lib/supabase.js`에 URL과 anon key가 그대로 들어 있다. anon key는 공개돼도 되는 키이고 RLS로 막혀 있어 당장 문제는 아니지만, 환경변수(`VITE_SUPABASE_*`)로 빼는 게 정석이다.

**wrangler deploy 와 평문 변수** — `wrangler.toml` `[vars]` 에 없는 평문 변수는 deploy 시 지워진다. Secrets 는 유지된다. `SUPABASE_URL` 은 반드시 `[vars]` 에 둔다.

---

## 9-1. 쉬는 날 처리 (2026-10-10 추가)

- `days_off` 표(006)에 걸리는 날은 Worker 가 픽업·정각 알림을 건너뛴다. 아침/저녁 할 일 알림에는 "🏖 오늘은 ○○" 한 줄이 붙는다.
- 등록 경로: 웹 캘린더(날짜 선택 → 쉬는 날로 등록 / 지우기), 텔레그램("내일 학교 안 가", "10/20~24 방학", "쉬는 날 알려줘").
- 공휴일은 연 단위 시드. **매년 12월에 다음 해 공휴일을 `days_off` 에 넣어야 한다.** (2027년분은 006 에 포함)
- 가족 공용 표라 user_id 는 비워 둔다. Worker 는 user_id 가 비어 있으면 전원 건너뜀.

## 10. 다음 작업 후보

1. ~~worker/ 편입, SQL 기준선~~ 완료. 남은 것: Apps Script 사본 넣기
2. 네스트 브리핑에 시간표·픽업 시간 추가 (현재는 할 일만 읽어줌)
3. 2학기 정규수업 시간표 실제와 대조
3-1. 매년 12월: 다음 해 공휴일을 `days_off` 에 추가
4. ~~텔레그램 연동 코드 방식~~ — DB·웹·Worker 모두 구현돼 있음
5. 중복 업로드 감지(DB 에 `find_similar_tasks` 함수는 있음, 호출부 없음), 세션 만료 처리
6. Worker `handleToday`·`callOpenAI` 의 UTC 날짜를 KST 로 교체

---

## 부록: 인쇄용 시간표 카드

주머니에 넣고 다니는 8.5×5.2cm 카드(2장)를 Pillow로 생성해 docx에 넣는 스크립트가 있었다.
A4 한 장에 카드 2개 + 재단선을 얹는 방식(페이지를 카드 크기로 맞추면 프린터 여백 때문에 상단이 잘림).
생성 스크립트는 레포에 없고 웹 세션 산출물에만 있었다(세션 종료로 유실). 필요하면 다시 만들어 `tools/`에 둘 것.
