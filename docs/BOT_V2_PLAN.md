# 봇 v2 설계안 — Claude 기반 대화형 비서 (2026-10-10)

## 지금 (v1)

- 사진 → "완료" → OpenAI gpt-4.1 Vision → 할 일 바로 저장 → 결과 한 번 통보. 되묻거나 고칠 수 없다.
- 텍스트 → gpt-4.1-mini 가 의도 6종으로 분류 → 분기별 하드코딩 핸들러. 대화 기억 없음(매 메시지가 독립).
- 할 수 있는 말: 목록 / 삭제 / 완료 / 초기화 / 추가 / 도움말 / 쉬는 날.

## 목표 (v2)

1. **확인 루프** — 사진 분석 결과를 먼저 보여주고, 사용자가 "2번은 금요일이야, 3번은 빼" 라고 말하면 고친 뒤 ✅ 저장. 저장 전엔 초안.
2. **되묻기** — 날짜가 모호하거나("다음 주 수요일"), 아이 이름·반이 불분명하면 봇이 먼저 질문.
3. **질문 응답** — "이번 주 준비물 뭐 있어?", "수요일 몇 시에 끝나?", "지난번 현장학습 안내문 다시 보여줘", "내일 픽업 몇 시야?"
4. **시간표 편집** — "목요일 픽업 17:35 를 18:00 로", "화요일 태권도 빼줘" 가 텔레그램에서 된다. 변경 결과를 가족 모두에게 알린다.
5. **대화 기억** — 직전 몇 턴을 기억해 "그거 내일로 미뤄" 같은 지시가 통한다.
6. **가족 공용** — 두 사람 다 같은 데이터를 보고, 누가 뭘 바꿨는지 봇이 알린다(선택).

## 구조

```
Telegram ─webhook─▶ Worker
                      │ 1. bot_conversations 에서 최근 20턴 로드 (chat_id 별, 2시간 TTL)
                      │ 2. Claude Messages API + tools 호출 (ctx.waitUntil, 즉시 200)
                      │ 3. tool_use 루프: 아래 도구 실행 → 결과 돌려줌 → 최종 답
                      │ 4. 답 전송 (필요하면 인라인 버튼) + 대화 저장
                      ▼
                   Supabase (tasks / days_off / timetable_* / documents)
```

### 도구 (tool use) — 하드코딩 분기 전부 대체

| 도구 | 하는 일 |
|---|---|
| `list_tasks(range, include_done)` | 오늘/내일/이번 주/전체 |
| `add_tasks(tasks[])` | 여러 개 한 번에. 저장 전 `find_similar_tasks` 로 중복 경고 |
| `update_task(id, patch)` / `complete_task(id)` / `delete_task(id)` | 번호·제목으로 찾아 수정 |
| `get_timetable(day)` / `get_pickups(day)` / `get_alerts(day)` | 활성 학기 기준 조회 |
| `add_block` / `update_block` / `delete_block` | 시간표 블록 추가·수정·삭제 ("수요일 바이올린 13:00~14:20 음악실"). 삭제·시간 변경은 저장 전 되묻기 |
| `set_pickups(day, times[])` / `add_alert` / `delete_alert` | 픽업 시각, 정각 알림 |
| `set_active_term(name)` / `list_terms()` | 학기 전환 ("다음 주부터 2학기 시간표") |
| `add_exception` / `list_exceptions` / `delete_exception` | **날짜별 예외**: 특정 수업·픽업·알림을 그날만 쉼 / 시간 변경 / 일회성 추가 ("이번 주 피아노 쉬어", "내일 태권도 5시로", "금요일 4시 치과") |
| `get_days_off(range)` / `add_day_off(start, end, reason)` | 쉬는 날 |
| `search_documents(query)` | 보관된 알림장 검색 → 제목·요약·사진 URL |
| `show_draft()` / `edit_draft(patch)` / `save_draft()` / `discard_draft()` | 사진 분석 초안 |

도구만 있으면 "의도 분류"가 필요 없다. 모델이 알아서 도구를 고르고, 필요하면 질문한다.

### 사진 흐름

1. 사진 여러 장 → `upload_sessions` (지금과 같음)
2. "완료" 또는 30초 자동 → Claude Vision 으로 초안 추출 → `upload_sessions.draft`(jsonb) 에 저장
3. 봇이 초안을 번호 매겨 보여주고 인라인 버튼 `[✅ 저장] [❌ 취소]`
4. 사용자가 텍스트로 고치면 `edit_draft` → 다시 보여줌. 버튼은 `callback_query` 로 처리
5. 저장 시 `add_tasks` 와 같은 경로(중복 검사 포함)

### 날짜별 예외 (schedule_exceptions)

매주 반복되는 시간표 위에 "그날만" 다른 것을 얹는다. `days_off` 가 하루 통째로 쉬는 것이라면 이건 수업 하나 단위.

```sql
CREATE TABLE schedule_exceptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,                        -- NULL = 가족 공용
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  target_type varchar(10) NOT NULL,        -- block | pickup | alert | oneoff
  target_id   uuid,                        -- block/pickup/alert 의 id (oneoff 면 NULL)
  action      varchar(10) NOT NULL,        -- skip | move | add
  new_start   time, new_end  time,         -- move/add 일 때
  name        varchar(100),                -- add 일 때 (예: 치과)
  reason      varchar(100),
  created_by  uuid, created_at timestamptz DEFAULT now()
);
```

반영되는 곳: Worker 픽업·정각 알림(skip/move), 웹 시간표 오늘 칸(취소선·변경 표시)·캘린더 점, 네스트 브리핑 한 줄. 봇은 저장 전 "화(10/14)·목(10/16) 피아노 쉼으로 둘까요?" 확인.

### 대화 상태

```sql
CREATE TABLE bot_conversations (
  chat_id bigint PRIMARY KEY,
  user_id uuid NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]',   -- Anthropic MessageParam[] 그대로 (최근 20턴)
  updated_at timestamptz DEFAULT now()
);
```

- 2시간 넘게 조용하면 비운다(새 화제). "처음부터" 라고 하면 즉시 비움.
- service_role 만 접근. RLS 로 앱 사용자에겐 안 보임.

### 모델 · 비용

| 모델 | 입력/출력 (1M 토큰) | 1턴 추정(캐시 적용) | 월 900턴(가족 2명, 하루 30턴) |
|---|---|---|---|
| Claude Opus 5.5 `claude-opus-5-5` | $4 / $20 | 약 1.5¢ | 약 $14 |
| Claude Sonnet 5.5 `claude-sonnet-5-5` | $2 / $10 | 약 0.8¢ | 약 $7 |
| Claude Haiku 5.5 `claude-haiku-5-5` | $0.10 / $0.50 | 약 0.05¢ | 약 $0.5 |

- 1턴 = 시스템 프롬프트·도구 정의 약 3K(캐시) + 대화 2K + 출력 300 토큰 기준. 사진 1장 ≈ 1.5K 토큰 추가.
- 기본은 Opus 5.5 (어린이 알림장 특유의 날짜·맥락 추론이 중요). 사진 추출만 Opus, 가벼운 질의는 Haiku 로 나누는 2단 구성도 가능 — 결정은 월 크레딧 규모 보고.
- 캐시: 시스템 프롬프트 + 도구 정의에 `cache_control` → 매 턴 입력의 70% 가 캐시 읽기($0.20/M).
- 안전장치: `bot_usage`(chat_id, date, input_tokens, output_tokens) 에 누적, 하루 상한 넘으면 "오늘은 여기까지" 응답.

### 기술 메모

- SDK: `@anthropic-ai/sdk` (Cloudflare Workers 에서 fetch 기반으로 동작). wrangler 가 번들.
- 응답 포맷: 저장용 JSON 이 필요한 곳(초안 추출)은 `output_config.format` 구조화 출력, 대화는 일반 텍스트.
- `thinking` 은 기본(adaptive). `output_config.effort` 는 대화 `low`, 사진 추출 `medium`.
- 안전 분류기 거절(`stop_reason: refusal`) 대비 `fallbacks: "default"` 켜 둠.
- Telegram: `sendChatAction typing` → 처리 중 표시. 긴 처리는 `ctx.waitUntil`, webhook 은 즉시 200 (지금은 동기라 재전송 위험).
- OpenAI 키·코드는 제거. 비밀은 `ANTHROPIC_API_KEY` 하나를 `wrangler secret put` 으로 등록(사용자가 직접).
- Cron 알림(아침/저녁/픽업/브리핑)은 LLM 을 쓰지 않으므로 그대로.

## 단계

| 단계 | 내용 | 규모 |
|---|---|---|
| V2-1 | ✅ 2026-10-10 — `assistant.js` + `008_bot_conversations.sql`. 기존 핸들러는 키 없을 때 fallback 으로 남겨 둠(V2-2 끝나면 제거) | 완료 |
| V2-2 | ✅ 2026-10-10 — `draft.js` + `009_upload_sessions_draft.sql`. Sonnet Vision → 초안 → [✅ 저장][❌ 취소] 버튼 또는 말로 수정(set_draft_tasks) → 저장 시 중복 건너뜀 | 완료 |
| V2-3 | ✅ 2026-10-11 — 시간표 편집 도구 9개, `schedule_exceptions`(010) + Worker 픽업·정각 알림 반영 + 아침 요약 한 줄 + 시간표 화면 표시/삭제, 사진 초안의 '시간표 변경 제안'. 보관함 검색은 V2-4 로 | 완료 |
| V2-4 | 되묻기 품질 다듬기, 사용량 상한, 가족 변경 알림 | 소 |

V2-1 만 해도 "질문에 대답"이 되고, V2-2 가 "제대로 입력됐는지 서로 확인"이다.

## 필요한 것

- Anthropic API 키를 Worker 비밀로: `cd worker; npx wrangler secret put ANTHROPIC_API_KEY`
- 모델 선택(기본 Opus 5.5). 월 크레딧이 작으면 Haiku 5.5 또는 2단 구성.
- SQL 2개(`bot_conversations`, `upload_sessions.draft`)를 대시보드에서 실행.
