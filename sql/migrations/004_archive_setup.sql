-- ══════════════════════════════════════
-- 보관함 (학교 공지 아카이브)
-- ══════════════════════════════════════

CREATE TABLE IF NOT EXISTS archive_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE archive_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own posts" ON archive_posts FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_archive_posts_user ON archive_posts(user_id, created_at DESC);

-- 첨부파일
CREATE TABLE IF NOT EXISTS archive_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES archive_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE archive_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own files" ON archive_files FOR ALL USING (auth.uid() = user_id);

-- Storage 버킷 생성
INSERT INTO storage.buckets (id, name, public)
VALUES ('archive-files', 'archive-files', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: 인증된 사용자만 업로드
CREATE POLICY "Auth users upload archive files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'archive-files' AND auth.role() = 'authenticated');

CREATE POLICY "Public read archive files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'archive-files');

CREATE POLICY "Users delete own archive files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'archive-files' AND auth.uid()::text = (storage.foldername(name))[1]);
