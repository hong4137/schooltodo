# apps-script/ — 네스트 브리핑 (Google Apps Script)

Worker 가 매일 07:10(KST) 에 `BRIEFING_APPS_SCRIPT_URL` 로 POST 하면, 이 스크립트가 Google Tasks 에 "오늘 브리핑" 1건을 만든다.
Google Home 루틴이 07:25 에 "내 오늘 일정 알려줘"로 Google Tasks 를 읽어 네스트 허브가 말해 준다.

## 파일

- `briefing.gs` — **재구성본**. 원본은 Apps Script 편집기(프로젝트 `schooltodo-briefing`)에만 있고 2026-10-11 에 내려받지 못했다.
  편집기에서 원본을 열어 이 파일과 비교하고, 다르면 원본으로 덮어써 커밋할 것.

## 요청 규격 (Worker ↔ 스크립트)

```json
POST { "action": "createBriefing", "date": "2026-10-13", "title": "오늘 할 일: …", "description": "…" }
→   { "success": true, "taskId": "…" }  또는  { "success": false, "error": "…" }
```

Worker 쪽은 `worker/src/index.js` 의 `runNestHubBriefing()`. 2026-10-11 부터 할 일이 없는 날도 시간표·픽업·쉬는 날을 담아 보낸다.

## 원본 가져오는 법

1. https://script.google.com → 프로젝트 열기 → 파일 내용 복사 → `briefing.gs` 에 붙여넣기.
2. 또는 Google Drive 에서 `.gs` 프로젝트를 내보내기(Apps Script API 필요).

## 배포 바꿀 때

편집기 → 배포 → 배포 관리 → 연필 → 새 버전 → 배포. URL 이 바뀌지 않으면 Worker 비밀은 그대로.
URL 이 바뀌면 `cd worker; npx wrangler secret put BRIEFING_APPS_SCRIPT_URL`.
