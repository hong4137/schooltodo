-- ══════════════════════════════════════
-- 011: 브리핑 대상 플래그 · 픽업 2차 알림
--   briefing_enabled       : 네스트 브리핑(Google Tasks) 대상. Worker 의 TARGET_USER_ID 하드코딩 대체
--   pickup_second_reminder : 픽업 10분 전 2차 알림 (1시간 전은 기본)
-- ══════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS briefing_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_second_reminder boolean NOT NULL DEFAULT false;

-- 지금까지 브리핑 대상이던 계정 (worker 의 TARGET_USER_ID)
UPDATE public.profiles SET briefing_enabled = true WHERE id = 'fdb9f068-d7b0-43c3-9736-94d37bd1bfe2';
