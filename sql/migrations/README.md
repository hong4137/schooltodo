# sql/migrations

Supabase(`schoolworks`, ref `sprrelvxxgvrdkmplidu`)에 적용한 SQL 모음. 번호는 적용 순서.

| 파일 | 상태 |
|---|---|
| 001_supabase_schema.sql (기본 스키마: profiles·tasks·documents·upload_sessions·user_telegrams·push_subscriptions·app_settings) | **누락** |
| 002_pickup_setup.sql | **누락** |
| 003_add_pickup_reminder_column.sql | **누락** |
| 004_archive_setup.sql | 있음 (구 `sql/archive_setup.sql`) |
| 005_timetable_setup.sql | 있음 (구 `sql/timetable_setup.sql`) |
| 006_add_term_system.sql | **누락** |
| 007_fix_terms_table.sql | **누락** |
| 008_apply_term2.sql | **누락** |
| 009~017 (데이터 입력용) | **누락** |

누락분 원본은 웹 Claude 세션 산출물에만 있었고 세션 종료로 사라졌다.
복원은 현재 DB를 덤프해 기준선(baseline)으로 삼는 쪽이 정확하다:

```bash
supabase link --project-ref sprrelvxxgvrdkmplidu
supabase db dump --linked -f sql/migrations/000_baseline_2026-10-10.sql
```

(DB 비밀번호가 필요하다. Supabase 대시보드 → Project Settings → Database.)
덤프를 받으면 001~003·006~008 은 기준선에 포함되므로 따로 복원하지 않아도 된다.
코드에서 실제로 쓰는 테이블·컬럼 목록은 `docs/SUPABASE_SCHEMA.md` 참고.
