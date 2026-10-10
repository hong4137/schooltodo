-- ══════════════════════════════════════
-- 006: 쉬는 날 (공휴일 · 재량휴업일 · 방학)
--   가족 2명이 같이 보는 달력이라 로그인한 사용자는 전부 읽고 쓴다.
--   Worker 는 이 표를 보고 픽업·시간표 알림을 건너뛴다.
-- ══════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.days_off (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = 가족 공용 (지금은 전부 NULL)
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  reason      varchar(100) NOT NULL,
  kind        varchar(20) NOT NULL DEFAULT 'school'
              CHECK (kind IN ('holiday', 'school', 'vacation', 'other')),
  created_by  uuid,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT days_off_range_check CHECK (end_date >= start_date),
  CONSTRAINT days_off_unique UNIQUE (start_date, end_date, reason)
);

CREATE INDEX IF NOT EXISTS days_off_range_idx ON public.days_off (start_date, end_date);

ALTER TABLE public.days_off ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read days_off"   ON public.days_off;
DROP POLICY IF EXISTS "Authenticated can insert days_off" ON public.days_off;
DROP POLICY IF EXISTS "Authenticated can update days_off" ON public.days_off;
DROP POLICY IF EXISTS "Authenticated can delete days_off" ON public.days_off;
CREATE POLICY "Authenticated can read days_off"   ON public.days_off FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can insert days_off" ON public.days_off FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can update days_off" ON public.days_off FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can delete days_off" ON public.days_off FOR DELETE USING (auth.role() = 'authenticated');

-- 공휴일 시드 (2026-10 이후 ~ 2027). 대체공휴일 포함. 매년 말에 다음 해 분을 추가한다.
INSERT INTO public.days_off (start_date, end_date, reason, kind) VALUES
  ('2026-12-25', '2026-12-25', '성탄절',               'holiday'),
  ('2027-01-01', '2027-01-01', '신정',                 'holiday'),
  ('2027-02-06', '2027-02-09', '설 연휴',              'holiday'),  -- 2/7 설날, 2/9 대체공휴일
  ('2027-03-01', '2027-03-01', '삼일절',               'holiday'),
  ('2027-05-05', '2027-05-05', '어린이날',             'holiday'),
  ('2027-05-13', '2027-05-13', '부처님오신날',         'holiday'),
  ('2027-06-06', '2027-06-06', '현충일',               'holiday'),
  ('2027-08-15', '2027-08-16', '광복절',               'holiday'),  -- 8/16 대체공휴일
  ('2027-09-14', '2027-09-16', '추석 연휴',            'holiday'),
  ('2027-10-03', '2027-10-04', '개천절',               'holiday'),  -- 10/4 대체공휴일
  ('2027-10-09', '2027-10-11', '한글날',               'holiday'),  -- 10/11 대체공휴일
  ('2027-12-25', '2027-12-27', '성탄절',               'holiday')   -- 12/27 대체공휴일
ON CONFLICT (start_date, end_date, reason) DO NOTHING;
