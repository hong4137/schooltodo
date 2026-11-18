# Storage 버킷 비공개 전환 — 조사와 계획 (2026-11-18)

## 결정·진행 (2026-11-19 갱신)

- **계정은 하나(fdb9…)**, 가족이 그 계정을 함께 쓴다. 테이블 공용화(A-1)는 **하지 않는다**.
- 정책은 **본인 폴더만 읽기**(`own read school files`). 처음 넣은 "가족 전원 읽기"는 가입 화면이 열려 있어 아무나 가입하면 파일을 읽을 수 있어서 사용자가 SQL Editor 에서 바꿨다(실행 성공).
- **신규 가입은 끈다**(대시보드 Authentication → Allow new users to sign up 해제). 계정이 더 필요하면 Add user 로만. 사용자가 진행 중.
- 나중에 배우자 계정을 따로 만들면 그때 A-1 + 가족 읽기 정책을 함께 넣는다.
- 코드(웹·봇 서명 URL)는 2026-11-18 커밋. 남은 수동 단계: Worker 배포 → 웹·봇에서 사진 열림 확인 → 두 버킷 Public 해제.

비서실장 창이 넘긴 보안 미처리 건(public_url/STATUS.md 3번). **조사·계획까지만** 했고, 정책 변경·배포는 사용자 결정 뒤에 한다. 아무것도 지우지 않았다.

## 1. 지금 버킷에 뭐가 있나 (파일 내용은 열지 않음, 이름만)

| 버킷 | 파일 | 경로 모양 | 비고 |
|---|---|---|---|
| `document-images` (알림장 사진) | **jpg 31개**, 문서 28건 | `user_id/document_id/n.jpg` | 전부 한 계정(fdb9f068…) 것 |
| `archive-files` (보관함 첨부) | **pdf 1개** | `user_id/post_id/타임스탬프.pdf` | 같은 계정 |

둘 다 **Public 버킷**. URL 을 아는 사람은 로그인 없이 읽을 수 있다. URL 은 UUID 두 개 조합이라 추측은 사실상 불가능하지만, 텔레그램 메시지(봇이 사진을 다시 보낼 때)·브라우저 기록·공유 링크에 URL 이 남는다. 아이 학교 자료라 내용 자체는 민감할 수 있다.

## 2. 지금 파일을 읽고 쓰는 곳

| 어디 | 무엇 | 지금 방식 | private 로 바꾸면 |
|---|---|---|---|
| 웹 `TaskCard.jsx` 74행 | 할 일 카드 펼치면 알림장 사진 | `/object/public/…` 를 `<img>` 에 직접 | 깨짐 → 서명 URL 로 |
| 웹 `ArchivePage.jsx` 221행 (`archive.js getFileUrl`) | 보관함 첨부 열기 | `/object/public/…` | 깨짐 → 서명 URL 로 |
| 웹 `tasks.js getImageUrl` | (현재 사용처 없음) | `/object/authenticated/…` | `<img>` 는 헤더를 못 붙여 어차피 안 됨 → 정리 |
| 봇 `assistant.js send_document_photos` | "사진 줘" | public URL 을 Telegram sendPhoto 에 | 깨짐 → service role 로 서명 URL 만들어 넘김 (실패 시 telegram_file_id 로 보내는 fallback 은 이미 있음) |
| Worker `draft.js saveDraft` | 사진 업로드 | service role 로 POST | 영향 없음 |
| 웹 `archive.js uploadFile/deleteFile` | 첨부 올리기·지우기 | 로그인 사용자 토큰 | `storage.objects` RLS 에 INSERT/DELETE 정책이 있어야 함 (지금 정책 상태는 대시보드에서 확인 필요) |

네스트 브리핑·Cron 알림은 파일을 안 읽으므로 무관.

## 3. 바꾸는 방법 (권장안)

**A. Storage 정책 (SQL 012, `storage.objects`)**
두 버킷에 대해 로그인 사용자만 읽기/쓰기. 경로 첫 폴더가 본인 `user_id` 인 것만:
```sql
CREATE POLICY "own files read"   ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('document-images','archive-files') AND (storage.foldername(name))[1] = auth.uid()::text);
-- INSERT / UPDATE / DELETE 도 같은 조건으로
```
가족 2명이 서로의 알림장을 봐야 하면 `auth.uid()` 조건을 빼고 `authenticated` 전체 허용으로(지금 할 일·문서는 계정별이라 그럴 일은 적다).

**B. 웹 (3파일)**
- `TaskCard.jsx`: `supabase.storage.from("document-images").createSignedUrls(paths, 3600)` 으로 1시간짜리 URL 을 받아 `<img>` 에.
- `archive.js getFileUrl` → `createSignedUrl(path, 3600)` (비동기로 바뀌므로 `ArchivePage` 호출부 수정).
- `tasks.js getImageUrl` 제거.

**C. Worker (1파일)**
- `send_document_photos`: service role 로 `POST /storage/v1/object/sign/document-images/<path>` `{expiresIn: 600}` → 돌아온 `signedURL` 을 `${SUPABASE_URL}/storage/v1` 뒤에 붙여 Telegram 에 넘김. Telegram 이 10분 안에 받아가면 끝.

**D. 순서 (끊김 없이)**
1. 정책 SQL 실행 (public 상태에서도 해가 없음)
2. 웹 push(Pages 자동 배포) + Worker 배포 — 서명 URL 은 public 버킷에서도 동작하므로 먼저 나가도 안전
3. 마지막에 Supabase 대시보드 → Storage → 버킷 설정에서 두 버킷 **Public 해제**
4. 확인: 웹에서 알림장 사진·보관함 PDF 열림, 봇 "사진 줘" 동작, 예전 public URL 은 403

**E. 부작용**
- 과거 텔레그램 대화에 남은 public URL 은 더 이상 열리지 않는다(의도한 바).
- 서명 URL 은 1시간 뒤 만료 → 앱을 오래 켜 두면 사진이 깨질 수 있어, 카드를 다시 펼칠 때 재발급하게 한다.

규모: SQL 1개, 웹 3파일, Worker 1파일, 배포 2회. 약 1시간.

## 4. 권하는 쪽

**비공개 전환을 권한다.** 파일이 32개뿐이고 읽는 곳이 네 군데라 전환 비용이 작다. 10/10 에 "URL 추측 불가 + 가족용"이라 유지하기로 했던 결정은, 그때는 봇이 사진을 텔레그램으로 다시 보내는 기능이 없을 때였다. 지금은 URL 이 메시지에 남는 경로가 생겼다.

**유지한다면** 최소한 봇의 `send_document_photos` 만 `telegram_file_id` 우선으로 바꿔 public URL 이 메시지에 안 남게 할 수 있다(코드 1줄, 배포 1회).

## 5. 사용자가 정할 것

1. 비공개 전환 진행 여부 (권장: 진행)
2. 가족끼리 서로의 파일을 봐야 하는지 (기본: 본인 것만)
