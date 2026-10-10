# 개선 후보 (2026-10-10 코드 점검) — 2026-10-11 기준 전 항목 완료

Worker 1,579줄 · 웹앱 전체를 읽고 찾은 것. 체감 큰 순서로 묶었다. 각 항목의 "근거"는 코드 위치.

## A. 알림이 틀리게 오는 문제

### A1. 공휴일·재량휴업일·방학에도 픽업 알림이 온다 ★ — ✅ 2026-10-10 완료 (006_days_off)
- 근거: `worker/src/index.js` `scheduled()` 는 요일(`isWeekday`)만 보고 날짜는 안 본다. 휴일 개념이 코드·DB 어디에도 없다. 2026-10-09 한글날에 알림이 온 원인.
- 제안:
  - `days_off` 테이블 (date, reason, user_id NULL=공통). 한국 공휴일(대체공휴일 포함)은 연 단위로 미리 넣고, 재량휴업일·방학은 사용자가 추가.
  - `scheduled()` 맨 앞에서 오늘이 `days_off` 면 픽업·정각 알림 skip. 네스트 브리핑·아침 알림에는 "오늘은 ○○(휴일)" 한 줄.
  - 텔레그램에서 "내일 학교 안 가", "10/20~10/24 방학" 같은 문장으로 등록 (`classifyIntent` 에 `day_off` 의도 추가).
  - 캘린더·시간표 화면에 휴일 표시, 시간표의 오늘 칸은 "쉬는 날"로.

### A2. 설정 화면의 아침/저녁 알림 시각이 무시된다 — ✅ 2026-10-10 완료 (Cron */5 + 사용자별 슬롯)
- 근거: `SettingsPage.jsx` 가 `profiles.notification_morning/evening` 을 저장하지만, Worker 는 Cron 고정(07:30/21:00)이고 `isMorning = kstHour>=7 && <8` 로만 판단. 저장해도 아무 일도 안 일어나는 죽은 설정.
- 제안: 10분 Cron 을 하루 전체로 넓히고(`*/10 * * * *`) 사용자별 `notification_morning` 과 현재 시각을 비교해 발송. 또는 설정 UI 를 없애고 "07:30 / 21:00 고정"이라고 표시.

### A3. 픽업 알림이 최대 9분 늦고, 한 번뿐이다 — ✅ 5분 간격 + 10분 전 2차 알림 토글(011)
- 근거: Cron 10분 간격 + `nowTotalMin >= reminderMin && < reminderMin+10`. 픽업 17:35 → 16:40 알림.
- 제안: 픽업 Cron 을 5분 간격으로. 선택으로 "10분 전" 2차 알림 (`profiles.pickup_second_reminder`).

### A4. 밀린 할 일은 다시 알려주지 않는다 — ✅ 2026-10-11 아침 요약 꼬리
- 근거: 아침 알림 쿼리가 `due_date=eq.오늘` 만. 어제 못 한 일은 앱을 열어야만 보인다.
- 제안: 아침 알림 끝에 "⚠️ 지난 할 일 N개: …" 2~3개 제목 붙이기.

### A5. 네스트 브리핑이 할 일 없는 날엔 아예 안 만들어진다 — ✅ 2026-10-11 시간표·픽업·예외 포함, 매일 생성
- 근거: `runNestHubBriefing()` 에서 tasks 0개면 return. "오늘 할 일 없습니다"가 정상인지 고장인지 구분이 안 된다(9월에 몇 달 고장을 못 알아챈 이유이기도 함).
- 제안: 시간표·픽업·휴일을 포함해 매일 브리핑 생성. "오늘 수요일. 바이올린 13시, 방송댄스 14시 30분, 도보하원 15시 50분, 픽업 17시 35분. 할 일 2개: …". 인수인계서 다음 작업 2번과 같음.

## B. 텔레그램 봇 동작

### B1. 사진 분석이 webhook 응답을 막는다 — ✅ 2026-10-10 (ctx.waitUntil, v2-1 과 함께)
- 근거: "완료" 수신 시 `processSession()` 을 `await` 한 뒤에야 200 응답. OpenAI Vision(여러 장, detail high)은 수십 초 걸릴 수 있어 Telegram 이 webhook 을 재전송하면 같은 세션을 두 번 분석할 수 있다. Worker 요청 시간 제한에도 걸린다.
- 제안: `ctx.waitUntil(processSession(...))` 로 넘기고 즉시 200. 세션 status 를 `processing` 으로 먼저 바꿔 중복 진입 차단(이미 PATCH 는 하고 있으니 그 뒤 재확인만 추가).

### B2. "완료"가 들어간 말은 세션이 없으면 조용히 삼켜진다 — ✅ 2026-10-10 (세션 있을 때만 가로챔)
- 근거: `COMPLETE_KEYWORDS.some(kw => lowerText.includes(kw))` 가 먼저 걸리고, 세션이 없으면 아무 답 없이 `return OK`. "서류 제출 완료했어", "숙제 끝"이 전부 무응답. 세션이 있을 때 보낸 일반 텍스트도 무시된다.
- 제안: 세션이 없으면 키워드 분기를 건너뛰고 `classifyIntent` 로. 세션 중 일반 텍스트에는 "사진 분석 중이에요. 완료/취소를 보내주세요" 안내.

### B3. 같은 알림장을 두 번 보내면 할 일이 중복된다 — ✅ v2-2 (find_similar_tasks 로 건너뜀)
- 근거: 저장 전 중복 검사 없음. DB 에 `find_similar_tasks(user_id, title, due_date)` 함수가 있는데 호출부가 없다.
- 제안: 저장 전 호출해서 같은 날짜·유사 제목이면 건너뛰고 결과 메시지에 "(이미 있음 N개)" 표시.

### B4. 할 일 제목에 `<`, `&` 가 있으면 메시지 전송이 조용히 실패한다 — ✅ 2026-10-10 완료 (전 핸들러 escapeHtml)
- 근거: `sendMessage` 가 `parse_mode: HTML` 인데 제목·설명을 이스케이프 없이 끼워 넣는다. AI 가 "A&B 학원", "<준비물>" 같은 제목을 뽑으면 Telegram 400.
- 제안: `escapeHtml()` 한 줄 추가해 사용자 데이터 전부 통과시키기.

### B5. webhook 과 `/test-briefing` 에 인증이 없다 — ✅ 2026-10-10 완료 (HEALTH_KEY · TELEGRAM_WEBHOOK_SECRET, 비밀 등록은 사용자)
- 근거: 누구나 Worker URL 로 가짜 update 를 POST 하면 봇이 반응한다. `/test-briefing` 은 GET 한 번으로 Google Tasks 에 글을 만든다.
- 제안: Telegram `setWebhook` 의 `secret_token` 을 쓰고 `X-Telegram-Bot-Api-Secret-Token` 헤더 검사. `/test-briefing` 은 `?key=` 비밀값 요구.

### B6. `/today` 와 알림장 파싱이 UTC 날짜를 쓴다 — ✅ v2-4
- 근거: `handleToday()` 157행, `callOpenAI()` 450행의 `new Date().toISOString()`. 밤 9시 이후 `/today` 는 내일 것을 보여주고, AI 에게 알려주는 "오늘"이 하루 밀려 "이번 주 금요일까지" 같은 상대 날짜가 틀어진다.
- 제안: `getKSTDateString()` 이 이미 있으니 그걸로 교체.

## C. 웹앱

### C1. 캘린더의 "오늘"이 하루 어긋난다 ★ — ✅ 2026-10-10 완료
- 근거: `CalendarPage.jsx` 11~13행 `today.setHours(0,0,0,0)` 뒤 `toISOString()`. KST 자정은 UTC 로 전날 15시라 **항상 어제**가 오늘로 표시되고 기본 선택도 어제.
- 제안: `TodayPage` 의 `getKSTToday()` 를 공용 유틸로 빼서 같이 쓰기.

### C2. 텍스트로 추가한 할 일이 목록에서 빠질 수 있다 — ✅ 2026-10-11
- 근거: `tasks.js` `fetchTasks()` 의 select 에 `documents!inner(...)` 가 있다. inner 조인이라 `document_id` 가 NULL 인 할 일(텔레그램 텍스트 입력, 웹에서 직접 추가)은 결과에서 제외된다. 지금은 같은 테이블을 두 번 embed 해서 쿼리가 에러 → fallback 으로 살아나는 듯하지만 우연에 기댄 상태.
- 제안: `documents(title, uploaded_by, user_telegrams(display_name))` 한 번만, inner 없이.

### C3. 시간표에 휴일·오늘 수업 없음이 안 보인다 — ✅ 1단계(배너) + v2-3(예외 표시)
- A1 과 함께. 오늘 칸 강조는 있으니 `days_off` 면 "쉬는 날" 배지.

### C4. 완료 항목 펼침 높이가 카드 수 × 120px 고정 — ✅
- 근거: `TodayPage.jsx` `CompletedSection` `maxHeight: completed.length * 120`. 설명이 긴 카드는 아래가 잘린다. 사소.

### C5. 배포마다 `sw.js` 의 `CACHE_NAME` 을 손으로 올려야 한다 — ✅ scripts/stamp-sw.mjs
- 제안: 빌드 시 `__BUILD_ID__` 를 치환하거나 `vite-plugin-pwa` 로 전환.

### C6. anon key 하드코딩 — ✅ VITE_SUPABASE_* 우선
- `VITE_SUPABASE_URL/ANON_KEY` 환경변수 + GitHub Actions secrets. 보안보다는 정리 목적.

## D. 운영·안전장치

### D1. 알림이 안 와도 아무도 모른다 ★ — ✅ 2026-10-10 완료 (007 + /health + GitHub Actions)
- 근거: 브리핑이 2026-04~09 몇 달 죽어 있었는데 발견이 늦었다. Cron 실행 기록이 어디에도 없다.
- 제안: `job_runs` 테이블(job, ran_at, result, detail) 에 Cron 마다 한 줄 기록. 웹 설정 화면에 "마지막 실행" 표시. 24시간 넘게 기록이 없으면 텔레그램으로 경고(Worker 가 매일 23:00 자기 점검).

### D2. 브리핑 대상이 `TARGET_USER_ID` 하드코딩 — ✅ profiles.briefing_enabled
- `profiles.briefing_enabled` 플래그로.

### D3. Worker 자동 배포 — ✅ worker-deploy.yml (CLOUDFLARE_API_TOKEN 비밀 필요)
- `.github/workflows/worker.yml`: `worker/**` 변경 시 `wrangler deploy` (`CLOUDFLARE_API_TOKEN` secret). 대시보드 수동 편집 유인을 없앤다.

## 추천 1차 묶음

1. A1 휴일 처리 (+C3 화면 표시) — 가장 체감
2. C1 캘린더 오늘 버그 — 확정 버그, 10줄
3. A2 알림 시각 설정 반영 — 죽은 설정 살리기
4. D1 실행 기록·헬스체크 — 다시 몇 달 모르는 일 방지
5. B1·B2·B4 봇 안정화 — 작고 독립적

2차: A5 브리핑 확장, B3 중복 감지, A3 픽업 2차 알림, B5 인증.
