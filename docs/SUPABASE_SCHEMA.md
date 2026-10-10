# Supabase 스키마 (코드 기준 정리, 2026-10-10)

프로젝트 `schoolworks` · ref `sprrelvxxgvrdkmplidu` · 서울 리전.
정확한 DDL 은 아직 레포에 없다(`sql/migrations/README.md` 의 덤프 절차 참고). 아래는 웹앱(`src/lib/*.js`)과 Worker(`worker/src/index.js`)가 실제로 읽고 쓰는 객체를 추린 것이다.

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

전 테이블 RLS 활성, 정책은 `auth.uid() = user_id`. Worker 는 service_role 키로 RLS 를 우회한다.

## RPC 함수

- `generate_link_code()` — 웹 설정 화면에서 호출. 텔레그램 연동용 6자리 코드 발급.
- `verify_link_code(code, ...)` — Worker `/link <코드>` 에서 호출.

(인수인계서에는 "연동 코드 방식 미구현"으로 적혀 있으나, 양쪽 코드에 호출부가 있다. DB 쪽 함수 존재 여부는 덤프로 확인할 것.)

## Storage 버킷

- `document-images` — 알림장 원본. Worker 가 `/object/authenticated/` 로 올리고, 웹은 `/object/public/` 으로 읽는다(public 버킷).
- `archive-files` — 보관함 첨부. 업로드 전 1200px 리사이즈.

둘 다 public. URL 을 아는 사람은 볼 수 있다. 가족용이라 유지하기로 결정(2026-10).
