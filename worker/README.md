# worker/ — 텔레그램 봇 · 알림 Cron Worker

`schooltodo-bot.hong4137.workers.dev` 에 배포되는 Cloudflare Worker의 정본.
2026-10-10 Cloudflare API로 대시보드 배포본(2026-09-02 업로드, 1,579줄)을 그대로 내려받아 넣었다.

## 배포

```bash
cd worker
npx wrangler deploy
```

- wrangler 가 로그인돼 있어야 한다 (`npx wrangler whoami`).
- Cron 은 `*/5 * * * *` 하나. 시각 분기는 `scheduled()` 가 KST 로 한다 (`wrangler.toml` 주석 참고).
- Secrets 8개는 대시보드에 등록돼 있고 deploy 해도 유지된다. `SUPABASE_URL` 만 평문이라 `[vars]` 에 둔다.
- 배포 전 확인: `npm run dry-run` (번들만 만들고 올리지 않음).

## 구조 (src/index.js · src/assistant.js)

| 구간 | 함수 |
|---|---|
| 텔레그램 webhook | `fetch()` → `/start` `/link` `/today` `/list` `/delete` `/reset` 명령, 사진은 `handlePhoto` → `processSession` |
| 자연어 (v2) | `assistant.js` `handleAssistantText()` — Claude Sonnet 5.5 + tool use. `ANTHROPIC_API_KEY` 있을 때 |
| 자연어 의도 분류 (v1, 키 없을 때) | `classifyIntent()` gpt-4.1-mini |
| 알림장 파싱 | `callOpenAI()` gpt-4.1 Vision |
| Cron 분기 | `scheduled()` — 5분마다. 브리핑 07:10 고정, 할 일 알림은 사용자별 `notification_morning/evening`, 픽업은 11~18시 평일 |
| 할 일 요약 | `sendTaskDigest()` — 아침=오늘, 저녁=내일. `notified_*` 플래그로 중복 방지 |
| 쉬는 날 | `getDaysOff()` `dayOffFor()` `handleDayOff()` — `days_off` 표 |
| 실행 기록·헬스체크 | `recordStatus()` `recordRun()` `buildHealthReport()` `GET /health` — `job_status`·`job_runs` |
| 픽업·정각 알림 | `handlePickupReminder()` — `profiles.active_term` 과 다른 학기는 건너뜀 |
| 웹푸시 | `sendWebPush()` `sendPushNotification()` `encryptPayload()` (VAPID 직접 구현, JWK import) |
| 네스트 브리핑 | `runNestHubBriefing()` — `TARGET_USER_ID` 하드코딩, `GET /test-briefing` 으로 수동 실행 |

## 의존성

`@anthropic-ai/sdk` (package.json). `npm install` 후 wrangler 가 번들한다. 번들 약 770KB.

## 주의

- 관리용 GET 주소: `/health?key=` (상세), `/test-briefing?key=` (실제 Google Tasks 에 씀), `/setup-webhook?key=` (Telegram webhook + 비밀 토큰 등록). `HEALTH_KEY` 비밀이 없으면 열려 있다.
- Telegram webhook 은 `TELEGRAM_WEBHOOK_SECRET` 이 있으면 헤더를 검사한다. 비밀을 넣은 뒤 반드시 `/setup-webhook` 을 한 번 열어야 Telegram 쪽에도 토큰이 등록된다.
- 날짜는 `toISOString()` 을 쓰지 말고 KST 로 변환한 뒤 뽑는다. `handleToday()`(157행)와 `callOpenAI()`(450행)는 아직 UTC 기준 `toISOString()` 을 쓰고 있어 KST 21시 이후 하루 밀릴 수 있다. 미수정.
- `CRON_STEP_MIN`(5) 은 wrangler.toml 의 Cron 간격과 반드시 같아야 한다. 다르면 알림이 두 번 가거나 빠진다.
