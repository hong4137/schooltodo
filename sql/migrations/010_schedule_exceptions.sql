-- ══════════════════════════════════════
-- 010: 날짜별 시간표 예외 (봇 v2-3)
--   "이번 주 피아노 쉬어", "내일 태권도 5시로", "10/8 방과후 휴강", "금요일 4시 치과(일회성)"
--   매주 반복되는 시간표 위에 그 날짜만 다른 것을 얹는다. days_off 가 하루 통째라면 이건 수업 하나 단위.
--   가족 공용(두 계정의 시간표가 각자라서 블록 id 가 아니라 '날짜 + 수업 이름/시각'으로 맞춘다).
-- ══════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.schedule_exceptions (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  kind         varchar(10) NOT NULL CHECK (kind IN ('block', 'pickup', 'alert', 'oneoff')),
  target_name  varchar(100),           -- block/alert: 수업·알림 이름(부분 일치). pickup: NULL. oneoff: 새 일정 이름
  target_time  time,                   -- 원래 시각으로 특정할 때 (pickup 17:35, alert 15:10). NULL 이면 이름만으로
  action       varchar(10) NOT NULL CHECK (action IN ('skip', 'move', 'add')),
  new_start    time,                   -- move/add
  new_end      time,                   -- move(블록)/add
  reason       varchar(100),
  created_by   uuid,
  created_at   timestamptz DEFAULT now(),
  CONSTRAINT schedule_exceptions_range_check CHECK (end_date >= start_date),
  CONSTRAINT schedule_exceptions_action_check CHECK (
    (action = 'skip') OR
    (action = 'move' AND new_start IS NOT NULL) OR
    (action = 'add'  AND kind = 'oneoff' AND target_name IS NOT NULL AND new_start IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS schedule_exceptions_range_idx ON public.schedule_exceptions (start_date, end_date);

ALTER TABLE public.schedule_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read schedule_exceptions"   ON public.schedule_exceptions;
DROP POLICY IF EXISTS "Authenticated can insert schedule_exceptions" ON public.schedule_exceptions;
DROP POLICY IF EXISTS "Authenticated can update schedule_exceptions" ON public.schedule_exceptions;
DROP POLICY IF EXISTS "Authenticated can delete schedule_exceptions" ON public.schedule_exceptions;
CREATE POLICY "Authenticated can read schedule_exceptions"   ON public.schedule_exceptions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can insert schedule_exceptions" ON public.schedule_exceptions FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can update schedule_exceptions" ON public.schedule_exceptions FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can delete schedule_exceptions" ON public.schedule_exceptions FOR DELETE USING (auth.role() = 'authenticated');
