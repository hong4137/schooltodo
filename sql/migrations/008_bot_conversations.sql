-- ══════════════════════════════════════
-- 008: 봇 v2 — 대화 기억 · 사용량
--   bot_conversations : chat_id 별 최근 대화 (Worker 만 읽고 씀)
--   bot_usage         : chat_id·날짜별 토큰 사용량 (하루 상한 + 비용 확인)
-- ══════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.bot_conversations (
  chat_id     bigint PRIMARY KEY,
  user_id     uuid NOT NULL,
  messages    jsonb NOT NULL DEFAULT '[]',   -- [{role:'user'|'assistant', content:'...'}] 최근 턴만
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bot_usage (
  chat_id        bigint NOT NULL,
  day            date   NOT NULL,            -- KST 기준 날짜
  calls          integer NOT NULL DEFAULT 0,
  input_tokens   bigint  NOT NULL DEFAULT 0, -- 캐시 읽기/생성 포함
  cache_read     bigint  NOT NULL DEFAULT 0,
  output_tokens  bigint  NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, day)
);

ALTER TABLE public.bot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_usage         ENABLE ROW LEVEL SECURITY;

-- 앱 사용자는 사용량만 읽을 수 있다 (설정 화면 표시용). 대화 내용은 Worker 전용.
DROP POLICY IF EXISTS "Authenticated can read bot_usage" ON public.bot_usage;
CREATE POLICY "Authenticated can read bot_usage" ON public.bot_usage FOR SELECT USING (auth.role() = 'authenticated');
