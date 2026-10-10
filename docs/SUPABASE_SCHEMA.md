# Supabase 스키마 (코드 기준 정리, 2026-10-10)

프로젝트 `schoolworks` · ref `sprrelvxxgvrdkmplidu` · 서울 리전.
정확한 DDL 은 `sql/migrations/000_baseline_2026-10-10.sql`(RLS 정책·함수·트리거 포함). 아래는 읽기용 요약이다.

## 테이블

| 테이블 | 용도 | 쓰는 쪽 | 핵심 컬럼 |
|---|---|---|---|
| `profiles` | 사용자 설정 | 웹·Worker | `active_term`, `notification_morning`, `notification_evening`, `pickup_reminder_enabled` |
| `tasks` | 할 일 | 웹·Worker | `due_date`, `priority`, `category`, `completed`, `notified_morning`, `notified_evening` |
| `documents` / `document_images` | 알림장 원문 + 사진 경로 | Worker 저장, 웹 조회 | `storage_path` |
| `upload_sessions` | 텔레그램 사진 업로드 세션(여러 장 → 완료) | Worker | `photo_file_ids`, `photo_count`, `last_photo_at`, `status` |
| `user_telegrams` | chat_id ↔ user_id | 웹·Worker | `chat_id`, `user_id`, `is_active` |
| `push_subscriptions` | 웹푸시 구독 | 웹·Worker | `endpoint`, `p256dh`, `auth` |
| `app_settings` | `vapid_public_key` | 웹 | `key`, `value` |
| `timetable_terms` | 학기 목록 | 웹 | `name` |
| `timetable_blocks` | 시간표 블록 | 웹 | `term`, `day`, `start_time`, `end_time`, `category`, `color` |
| `timetable_pickups` | 픽업 시각, 요일당 복수 | 웹·Worker | UNIQUE(`user_id`,`day`,`pickup_time`,`term`) |
| `timetable_alerts` | 정각 알림(도보하원·이동) | 웹·Worker | `term`, `day`, `alert_time`, `label` |
| `timetable_subjects` | 과목 프리셋 | 웹 | |
| `archive_posts` / `archive_files` | 보관함 글·첨부 | 웹 | |
| `link_codes` | 텔레그램 연동 6자리 코드 | RPC 전용 | `code`, `user_id`, `expires_at` |
| `days_off` | 쉬는 날(공휴일·재량휴업·방학). **가족 공용**, 로그인 사용자 전원 읽기/쓰기 | 웹·Worker | `start_date`, `end_date`, `reason`, `kind`(holiday/school/vacation/other) — 006 |
| `job_status` | job 별 마지막 실행 (cron_tick, health_alert) | Worker 쓰기, 웹 읽기 | `job`(PK), `last_run_at`, `last_ok`, `last_detail` — 007 |
| `job_runs` | 발송 기록 (briefing, digest_morning/evening, pickup, alert). 30일 보관 | Worker 쓰기, 웹 읽기 | `job`, `user_id`, `ran_at`, `ok`, `detail`(jsonb) — 007 |

전 테이블 RLS 활성, 정책은 `auth.uid() = user_id`. Worker 는 service_role 키로 RLS 를 우회한다.

## 함수 (public, 기준선 덤프 기준)

- `generate_link_code()` — 웹 설정 화면에서 호출. `link_codes` 에 6자리 코드 발급.
- `verify_link_code(...)` — Worker `/link <코드>` 에서 호출. 코드 검증 후 `user_telegrams` 연결.
- `find_similar_tasks(...)` — 중복 할 일 탐지용. 호출부는 아직 없음.
- `reset_daily_notifications()` — `notified_morning/evening` 초기화.
- `handle_new_user()` — auth.users 삽입 시 `profiles` 생성 (트리거).
- `update_updated_at()` — `updated_at` 갱신.
- `prune_job_runs()` — 30일 지난 `job_runs` 삭제. Worker 가 매일 03:00 호출 (007).

텔레그램 연동 코드 방식은 DB·웹·Worker 모두 구현돼 있다.

## Storage 버킷

- `document-images` — 알림장 원본. Worker 가 `/object/authenticated/` 로 올리고, 웹은 `/object/public/` 으로 읽는다(public 버킷).
- `archive-files` — 보관함 첨부. 업로드 전 1200px 리사이즈.

둘 다 public. URL 을 아는 사람은 볼 수 있다. 가족용이라 유지하기로 결정(2026-10).
