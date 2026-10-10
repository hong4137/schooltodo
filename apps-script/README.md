# apps-script/ — 네스트 브리핑 (Google Apps Script)

Worker 가 매일 07:10(KST) 에 `BRIEFING_APPS_SCRIPT_URL` 로 POST 하면, 이 스크립트가 Google Tasks 기본 목록에 "[브리핑] …" 할 일 1건을 만든다.
Google Home 루틴이 07:25 에 "내 오늘 일정 알려줘"로 Google Tasks 를 읽어 네스트 허브가 말해 준다.

## 파일

- `briefing.gs` — Apps Script 편집기 원본 (2026-10-11 사용자가 복사해 편입). 프로젝트 이름 `schooltodo-briefing`.

## 동작

- `createBriefing`: 제목 앞에 `[브리핑] ` 을 붙여 생성. 생성 전에 `[브리핑] ` 으로 시작하는 기존 할 일 중 **같은 날짜는 중복 제거, 지난 날짜는 정리**한다. 개인 할 일은 접두사가 없어 건드리지 않는다.
- `clearBriefing`(특정 날짜 삭제), `cleanupBriefing`(지난 것만 정리) — 수동·디버그용. Worker 는 `createBriefing` 만 쓴다.
- `doGet` 은 상태 확인(`{"status":"ready"}`).

## 요청 규격 (Worker ↔ 스크립트)

```json
POST { "action": "createBriefing", "date": "2026-10-13", "title": "오늘 할 일: …", "description": "…" }
→   { "success": true, "taskId": "…", "deletedToday": 0, "deletedOld": 1 }
```

Worker 쪽은 `worker/src/index.js` 의 `runNestHubBriefing()` / `buildBriefing()`. 2026-10-11 부터 할 일이 없는 날도 시간표·픽업·쉬는 날·예외를 담아 보낸다.

## 스크립트를 고칠 때

1. 편집기에서 수정 → 이 파일에도 같은 내용을 복사해 커밋 (정본은 레포).
2. 서비스에 Tasks API 가 추가돼 있어야 한다 (좌측 "서비스 +" → Google Tasks API).
3. 배포 → 배포 관리 → 연필 → 새 버전 → 배포. URL 이 그대로면 Worker 비밀은 손댈 필요 없음.
   URL 이 바뀌면 `cd worker; npx wrangler secret put BRIEFING_APPS_SCRIPT_URL`.
