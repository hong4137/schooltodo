# sql/migrations

Supabase(`schoolworks`, ref `sprrelvxxgvrdkmplidu`)에 적용한 SQL 모음.

| 파일 | 내용 |
|---|---|
| `000_baseline_2026-10-10.sql` | **기준선.** 2026-10-10 운영 DB 를 `pg_dump --schema-only -n public` 으로 받은 것. 테이블 16개·함수 6개·RLS 정책 20개·트리거 1개. 과거 001~003·006~017 누락분은 전부 여기에 녹아 있다. |
| `004_archive_setup.sql` | 보관함 (기준선에 포함, 이력용) |
| `005_timetable_setup.sql` | 시간표 (기준선에 포함, 이력용) |
| `006_days_off.sql` | **쉬는 날** 표 + RLS + 2026-12~2027 공휴일 시드. 2026-10-10 작성, 대시보드 SQL Editor 에서 실행 |
| `007_job_status.sql` | Cron 실행 기록(`job_status`, `job_runs`) + 30일 정리 함수. 헬스체크용 |
| `008_bot_conversations.sql` | 봇 v2 대화 기억(`bot_conversations`)·사용량(`bot_usage`) |
| `009_upload_sessions_draft.sql` | 사진 초안: `upload_sessions.draft/hint/draft_message_id` 컬럼 |

새 변경은 `010_` 부터 번호를 이어 붙이고, 대시보드 SQL Editor 에서 실행한 뒤 파일을 커밋한다.

## 기준선 다시 받기

Supabase CLI 의 `db dump` 는 Docker 가 필요해서 이 PC 에서는 안 된다. scoop 으로 설치한 `pg_dump` 를 직접 쓴다. DB 비밀번호는 대시보드 → Database → Settings 에서.

```powershell
& "$env:USERPROFILE\scoop\apps\postgresql\current\bin\pg_dump.exe" --schema-only --no-owner --no-privileges -n public -f sql/migrations/000_baseline_YYYY-MM-DD.sql "postgresql://postgres.sprrelvxxgvrdkmplidu@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"
```

`supabase/.temp/` 는 link 정보라 커밋하지 않는다(.gitignore).
