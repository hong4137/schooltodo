# SchoolToDo 를 sharktalk 로그인으로 옮길 수 있나 — 검토 (2026-11-18)

사용자 질문: "스쿨투두 지금이랑 같은 시스템으로 돌릴 건데, 비공개로 바꾸고 가족도 로그인으로 접속할 수 있도록. 샤크토크 기반으로 바꿀 수 있나?"
검토까지만. 결정 전 아무것도 바꾸지 않았다.

## 전제 사실

- 지금 로그인: **Supabase Auth**(이메일·비밀번호). 데이터 보호는 **RLS `auth.uid() = user_id`** — 할 일·문서·시간표·보관함 전부 **계정별**이다. 배우자가 자기 계정으로 들어오면 자기 데이터만 보인다(지금 데이터는 전부 한 계정에 있음).
- sharktalk 로그인: `auth.sharktalk.co.kr` 가 `.sharktalk.co.kr` 도메인 **HttpOnly 쿠키**를 발급. 같은 도메인의 사이트는 로그인 1번으로 통과. 사용자 관리는 Worker KV.
- 웹앱은 브라우저에서 supabase-js 로 DB 를 **직접** 호출한다(파일 9개, 호출 20여 곳). 봇·Cron 은 Worker 가 service role 로 이미 직접 읽는다.
- 9/29 결정: "게이트를 씌우면 로그인이 두 번이라 그대로 둔다."

## 선택지

### A. 지금 그대로 (GitHub Pages + Supabase 로그인) + 가족 공유만 해결

- **작업**: 가족 공유를 Supabase 쪽에서 푼다. 방법 두 가지.
  - A-1 **공용 테이블**: 모든 표의 RLS 를 `authenticated` 전체 허용으로(가족 2명뿐). SQL 1개, 코드 변경 거의 없음(할 일 조회가 `user_id` 로 거르는 곳은 그대로 둬도 되고, 공유하려면 그 필터만 빼면 됨). **반나절.**
  - A-2 **가족 id**: `families` 표 + 각 표에 `family_id`. 정석이지만 데이터 이관·코드 전반 수정. **2~3일.**
- **위험**: 낮음. A-1 은 "이 프로젝트에 다른 사람이 가입하면 다 보인다"는 뜻인데, 가입은 Supabase 대시보드에서 막아 두면 된다(지금도 가입 화면은 있으나 가족만 씀).
- **가족이 겪는 변화**: 배우자가 Supabase 계정으로 로그인하면 **같은 할 일·시간표**를 본다. 로그인은 지금처럼 1번(PWA 는 세션이 유지돼 사실상 안 함).
- **단점**: 주소가 `hong4137.github.io/schooltodo` 그대로. 9/29 의 "github.io 하나 남는다" 제약 유지.

### B. `school.sharktalk.co.kr` 게이트만 씌우고 Supabase 로그인 유지

- **작업**: Pages → sharktalk 도메인(Cloudflare Pages 또는 Worker 정적 서빙) 이전 + 게이트 미들웨어. 앱 코드는 base 경로(`/schooltodo/` → `/`), 서비스워커 경로, Supabase Auth 의 Site URL/Redirect 설정만. **1일.** Storage 비공개 작업과 별개.
- **위험**: 낮음~중간. 쿠키 게이트가 PWA 설치·푸시 알림(서비스워커가 게이트 뒤 자원을 받아야 함)과 부딪힐 수 있어 확인 필요.
- **가족이 겪는 변화**: **로그인이 두 번**이 된다 — sharktalk 쿠키(가끔 만료) + Supabase(거의 안 풀림). 9/29 에 피하려던 그 상황. 가족 공유는 여전히 A 의 작업이 따로 필요.
- **얻는 것**: 주소가 sharktalk 로 통일되고 github.io 가 사라짐. 링크가 밖에 노출돼도 게이트가 한 겹 더.

### C. sharktalk 로그인 하나로 바꾸고, 데이터는 Worker 가 service role 로 대신 읽기

- **작업**: 웹앱의 supabase-js 직접 호출 20여 곳을 전부 Worker API(`/api/tasks`, `/api/timetable`, …)로 바꾸고, Worker 가 sharktalk 쿠키를 `auth.sharktalk.co.kr/verify` 로 검증한 뒤 service role 로 DB 를 읽어 준다. 사용자 구분은 sharktalk 신원(아이디)↔`profiles` 매핑 표. Supabase Auth 는 안 쓰게 되고(RLS 는 service role 이 우회) 푸시 구독·텔레그램 연동 코드(`generate_link_code` 등 `auth.uid()` 를 쓰는 RPC)도 손봐야 한다. **4~6일.**
- **위험**: 중간~높음. 보안 경계가 "DB 의 RLS" 에서 "Worker 코드의 검증 로직" 으로 옮겨 간다. 실수 한 곳이면 전 데이터 노출. Storage 도 Worker 가 서명 URL 을 대신 만들어 줘야 한다.
- **가족이 겪는 변화**: 로그인 1번(sharktalk), 가족 공유는 매핑 표로 자연스럽게. 주소 sharktalk. 다만 이전 기간 동안 앱이 흔들릴 수 있고, 지금 쓰는 Supabase 비밀번호는 버리고 sharktalk 계정을 배우자에게 하나 더 만들어 줘야 한다.
- **얻는 것**: 사용자가 말한 "샤크토크 기반" 그대로. 모든 개인 사이트가 한 로그인.

## 비교

| | A 그대로 + 공유 | B 게이트만 | C sharktalk 하나로 |
|---|---|---|---|
| 작업량 | 반나절(A-1) | 1일 | 4~6일 |
| 위험 | 낮음 | 낮음~중간 (PWA·푸시) | 중간~높음 (보안 경계 이동) |
| 가족 로그인 | 1번 (Supabase) | **2번** | 1번 (sharktalk) |
| 가족 공유 | 됨 | 따로 A 필요 | 됨 |
| 주소 | github.io 유지 | sharktalk | sharktalk |
| 지금 봇·Cron | 그대로 | 그대로 | 그대로 (Worker 가 원래 service role) |

## 권하는 쪽

**A-1 을 먼저, C 는 보류.** 사용자가 바라는 핵심은 "가족도 로그인해서 같이 본다"와 "비공개"인데, 둘 다 A-1 + Storage 비공개로 반나절에 끝난다. C 는 얻는 게 주소 통일과 로그인 일원화뿐인데 비용과 위험이 열 배다. B 는 로그인 두 번이라 가족이 제일 불편해지는 안이다.

A-1 로 가고도 나중에 주소만 sharktalk 로 두고 싶으면, 게이트 없이 `school.sharktalk.co.kr` 로 **정적 호스팅만** 옮기는 변형(B 에서 게이트를 뺀 것)이 있다. 로그인은 Supabase 1번 그대로, github.io 는 사라진다. 이건 반나절.

## 사용자가 정할 것

1. A-1(공용 테이블)로 가족 공유를 풀지. 그러면 Storage 읽기도 가족 전원(012 SQL 그대로)과 아귀가 맞는다.
2. 주소를 sharktalk 로 옮길지(게이트 없이, 로그인은 Supabase 유지). 옮기면 9/29 의 "github.io 하나 남는다" 제약이 사라진다.
3. C(sharktalk 로그인 일원화)는 지금은 하지 않는 것으로 — 원하면 별도 프로젝트로.
