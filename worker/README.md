# worker/ — 텔레그램 봇 · 알림 Cron Worker

`schooltodo-bot.hong4137.workers.dev` 에 배포되는 Cloudflare Worker의 정본.
2026-10-10 Cloudflare API로 대시보드 배포본(2026-09-02 업로드, 1,579줄)을 그대로 내려받아 넣었다.

## 배포

```bash
cd worker
npx wrangler deploy
```

- wrangler 가 로그인돼 있어야 한다 (`npx wrangler whoami`).
- Cron 4개는 `wrangler.toml` 의 `[triggers]` 로 함께 배포된다.
- Secrets 8개는 대시보드에 등록돼 있고 deploy 해도 유지된다. `SUPABASE_URL` 만 평문이라 `[vars]` 에 둔다.
- 배포 전 확인: `npm run dry-run` (번들만 만들고 올리지 않음).

## 구조 (src/index.js)

| 구간 | 함수 |
|---|---|
| 텔레그램 webhook | `fetch()` → `/start` `/link` `/today` `/list` `/delete` `/reset` 명령, 사진은 `handlePhoto` → `processSession` |
| 자연어 의도 분류 | `classifyIntent()` gpt-4.1-mini |
| 알림장 파싱 | `callOpenAI()` gpt-4.1 Vision |
| Cron 분기 | `scheduled()` — KST 시각으로 아침/저녁/픽업/브리핑 판별 |
| 픽업·정각 알림 | `handlePickupReminder()` — `profiles.active_term` 과 다른 학기는 건너뜀 |
| 웹푸시 | `sendWebPush()` `sendPushNotification()` `encryptPayload()` (VAPID 직접 구현, JWK import) |
| 네스트 브리핑 | `runNestHubBriefing()` — `TARGET_USER_ID` 하드코딩, `GET /test-briefing` 으로 수동 실행 |

## 주의

- `GET /test-briefing` 은 실제로 Google Tasks 에 쓴다. 테스트할 때 알고 누를 것.
- 날짜는 `toISOString()` 을 쓰지 말고 KST 로 변환한 뒤 뽑는다. `handleToday()`(157행)와 `callOpenAI()`(450행)는 아직 UTC 기준 `toISOString()` 을 쓰고 있어 KST 21시 이후 하루 밀릴 수 있다. 미수정.
- Cron 이 10분 간격이라 픽업 17:35 의 1시간 전 알림은 16:40 에 울린다.
