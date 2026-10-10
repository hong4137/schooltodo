-- ══════════════════════════════════════
-- 009: 봇 v2-2 — 사진 분석 초안
--   upload_sessions.status 흐름: active(사진 모으는 중) → processing → draft(저장 대기) → completed | cancelled
--   draft 에 AI 가 뽑은 문서 제목·요약·할 일 목록(jsonb)을 두고, 사용자가 텔레그램에서 고친 뒤 저장한다.
-- ══════════════════════════════════════

ALTER TABLE public.upload_sessions
  ADD COLUMN IF NOT EXISTS draft            jsonb,
  ADD COLUMN IF NOT EXISTS hint             text,        -- 사진과 함께 보낸 말 ("이거 내일까지야")
  ADD COLUMN IF NOT EXISTS draft_message_id bigint,      -- 초안을 보여준 텔레그램 메시지 (버튼 지우기용)
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS upload_sessions_chat_status_idx ON public.upload_sessions (chat_id, status, created_at DESC);
