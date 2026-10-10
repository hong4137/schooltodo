-- ══════════════════════════════════════
-- 007: Cron 실행 기록 · 헬스체크
--   job_status : job 별 마지막 실행 (한 줄씩 덮어씀)  → "지금 살아 있나"
--   job_runs   : 실제로 뭔가 보낸 기록 (추가만)       → "오늘 아침 알림 갔나"
--   Worker(service_role) 만 쓰고, 앱 사용자는 읽기만.
-- ══════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.job_status (
  job          varchar(40) PRIMARY KEY,          -- cron_tick · briefing · health_alert ...
  last_run_at  timestamptz NOT NULL DEFAULT now(),
  last_ok      boolean NOT NULL DEFAULT true,
  last_detail  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_runs (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job       varchar(40) NOT NULL,                -- briefing · digest_morning · digest_evening · pickup · alert
  user_id   uuid,
  ran_at    timestamptz NOT NULL DEFAULT now(),
  ok        boolean NOT NULL DEFAULT true,
  detail    jsonb
);
CREATE INDEX IF NOT EXISTS job_runs_job_ran_at_idx ON public.job_runs (job, ran_at DESC);

ALTER TABLE public.job_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_runs   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read job_status" ON public.job_status;
DROP POLICY IF EXISTS "Authenticated can read job_runs"   ON public.job_runs;
CREATE POLICY "Authenticated can read job_status" ON public.job_status FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can read job_runs"   ON public.job_runs   FOR SELECT USING (auth.role() = 'authenticated');
-- INSERT/UPDATE 정책 없음 = 앱 사용자는 못 씀. Worker 는 service_role 이라 RLS 우회.

-- 30일 넘은 기록 정리 (Worker 가 하루 한 번 호출)
CREATE OR REPLACE FUNCTION public.prune_job_runs() RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM public.job_runs WHERE ran_at < now() - interval '30 days';
$$;
