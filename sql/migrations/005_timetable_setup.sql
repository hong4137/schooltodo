-- ══════════════════════════════════════
-- Timetable Setup
-- ══════════════════════════════════════

-- 과목 등록 (재사용)
CREATE TABLE IF NOT EXISTS timetable_subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  color VARCHAR(10) NOT NULL DEFAULT '#4ECDC4',
  category VARCHAR(20) NOT NULL DEFAULT 'school',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE timetable_subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own subjects" ON timetable_subjects FOR ALL USING (auth.uid() = user_id);

-- 시간표 블록
CREATE TABLE IF NOT EXISTS timetable_blocks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES timetable_subjects(id) ON DELETE SET NULL,
  name VARCHAR(50) NOT NULL,
  day VARCHAR(3) NOT NULL CHECK (day IN ('mon','tue','wed','thu','fri')),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'school',
  color VARCHAR(10) NOT NULL DEFAULT '#4ECDC4',
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE timetable_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own blocks" ON timetable_blocks FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_timetable_blocks_user_day ON timetable_blocks(user_id, day);
