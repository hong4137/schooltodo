# SchoolToDo

초등학생 자녀의 학교 할 일·시간표·픽업을 가족 2명이 함께 관리하는 PWA.
알림장 사진을 텔레그램 봇에 보내면 AI 가 할 일을 뽑아 저장하고, 시간표·픽업 시각에 맞춰 텔레그램·웹푸시·구글 네스트로 알려준다.

| 축 | 위치 | 레포 |
|---|---|---|
| 웹앱 (React + Vite) | https://hong4137.github.io/schooltodo/ | `src/` — main push 시 GitHub Pages 자동 배포 |
| 봇·알림 Worker | `schooltodo-bot.hong4137.workers.dev` | `worker/` — `npx wrangler deploy` |
| DB·스토리지 (Supabase `schoolworks`) | `sprrelvxxgvrdkmplidu.supabase.co` | `sql/migrations/`, `docs/SUPABASE_SCHEMA.md` |
| 네스트 브리핑 (Apps Script) | Google Apps Script | `apps-script/briefing.gs` |

## 개발

```bash
npm ci
npm run dev        # base 가 /schooltodo/ 라 http://localhost:5173/schooltodo/
npm run build      # dist/
```

Worker 는 `worker/README.md` 참고.

## 꼭 알아야 할 것

- **Worker 정본은 `worker/src/index.js`.** 대시보드 Quick Edit 로 고치면 레포와 어긋나고, 과거에 그 때문에 네스트 브리핑 코드가 통째로 사라진 적이 있다.
- 서비스워커 캐시 이름은 빌드 때 자동으로 바뀐다(`scripts/stamp-sw.mjs`). 손으로 올릴 필요 없음.
- 날짜는 `toISOString()` 을 쓰지 말고 KST 로 뽑는다. UTC 기준이면 밤 9시 이후 D-Day 가 하루 밀린다.
- 여러 파일을 고쳤으면 한 커밋으로 묶어 push 한다. 중간 상태로 Pages 빌드가 돌면 실패한다.
- Supabase 접속 정보는 `VITE_SUPABASE_URL/ANON_KEY` 환경변수가 우선, 없으면 코드의 기본값(anon key 는 공개 가능, RLS 로 보호).

## 문서

- [docs/HANDOVER.md](docs/HANDOVER.md) — 2026-10-10 인수인계서 (시스템 전체 구조, 시간표 데이터, 함정, 다음 작업)
- [docs/SUPABASE_SCHEMA.md](docs/SUPABASE_SCHEMA.md) — 테이블·RPC·버킷
- [worker/README.md](worker/README.md) — Worker 배포·구조
- [docs/BOT_V2_PLAN.md](docs/BOT_V2_PLAN.md) — 봇 v2(Claude 대화형) 설계·진행
- [apps-script/README.md](apps-script/README.md) — 네스트 브리핑 스크립트
