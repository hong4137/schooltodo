-- ══════════════════════════════════════
-- 012: Storage 버킷 비공개 전환용 정책 (2026-11-18)
--   순서: ① 이 SQL 실행 → ② 웹·Worker 배포(서명 URL) → ③ 대시보드에서 두 버킷 Public 해제 → ④ 확인
--   이 SQL 은 버킷이 Public 인 상태에서 먼저 실행해도 해가 없다.
--
--   운영 방식 (사용자 결정 2026-11-19): 계정은 하나(fdb9…)이고 가족이 그 계정을 함께 쓴다.
--   → 읽기도 "본인 폴더만"(경로 첫 칸 = auth.uid()). 처음 넣었던 "family read"(로그인 전원 읽기)는
--     가입 화면이 열려 있어 아무나 가입하면 파일을 읽을 수 있었기 때문에 사용자가 SQL Editor 에서 own read 로 바꿈(실행 성공).
--   → 신규 가입은 대시보드에서 끔(Authentication → Allow new users to sign up). 계정이 더 필요하면 Add user 로만.
--   → 나중에 배우자 계정을 따로 만들면 그때 테이블 공용화(A-1)와 가족 읽기 정책을 같이 다시 넣는다.
--   아래 본문은 현재 DB 상태(own read)에 맞춰 둠. 쓰기·삭제도 본인 폴더만.
-- ══════════════════════════════════════

-- 기존 공개 읽기 정책이 있으면 정리 (이름은 대시보드에서 만든 것. 없으면 무시됨)
DROP POLICY IF EXISTS "Public read archive files" ON storage.objects;
DROP POLICY IF EXISTS "Public read document images" ON storage.objects;

DROP POLICY IF EXISTS "family read school files"  ON storage.objects;
DROP POLICY IF EXISTS "own read school files"     ON storage.objects;
DROP POLICY IF EXISTS "own write school files"    ON storage.objects;
DROP POLICY IF EXISTS "own update school files"   ON storage.objects;
DROP POLICY IF EXISTS "own delete school files"   ON storage.objects;

-- 읽기: 본인 폴더만 (경로 첫 칸 = auth.uid())
CREATE POLICY "own read school files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('document-images', 'archive-files') AND (storage.foldername(name))[1] = auth.uid()::text);

-- 쓰기·수정·삭제: 본인 폴더만 (경로 첫 칸 = auth.uid())
CREATE POLICY "own write school files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('document-images', 'archive-files') AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own update school files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('document-images', 'archive-files') AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own delete school files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('document-images', 'archive-files') AND (storage.foldername(name))[1] = auth.uid()::text);

-- (대안, 배우자 계정을 따로 만들 때) 로그인한 가족 전원 읽기 — 가입이 꺼져 있을 때만 안전:
-- CREATE POLICY "family read school files" ON storage.objects FOR SELECT TO authenticated
--   USING (bucket_id IN ('document-images', 'archive-files'));

-- 확인: 정책 목록
-- select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1;
