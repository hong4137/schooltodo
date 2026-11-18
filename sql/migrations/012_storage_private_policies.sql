-- ══════════════════════════════════════
-- 012: Storage 버킷 비공개 전환용 정책 (2026-11-18)
--   순서: ① 이 SQL 실행 → ② 웹·Worker 배포(서명 URL) → ③ 대시보드에서 두 버킷 Public 해제 → ④ 확인
--   이 SQL 은 버킷이 Public 인 상태에서 먼저 실행해도 해가 없다.
--
--   가족 공유 방식 (사용자 결정 2026-11-18): 로그인한 가족 누구나 두 버킷의 파일을 읽을 수 있다.
--   쓰기·삭제는 본인 폴더(경로 첫 칸 = user_id)만.
--   ⚠️ 할 일·문서·보관함 "목록" 은 여전히 계정별(RLS auth.uid() = user_id)이다. 파일만 공유되는 셈이니
--      목록까지 가족 공유가 필요하면 별도 작업(테이블 정책 변경)이 필요하다. docs/STORAGE_PRIVATE_PLAN.md 참고.
-- ══════════════════════════════════════

-- 기존 공개 읽기 정책이 있으면 정리 (이름은 대시보드에서 만든 것. 없으면 무시됨)
DROP POLICY IF EXISTS "Public read archive files" ON storage.objects;
DROP POLICY IF EXISTS "Public read document images" ON storage.objects;

DROP POLICY IF EXISTS "family read school files"  ON storage.objects;
DROP POLICY IF EXISTS "own write school files"    ON storage.objects;
DROP POLICY IF EXISTS "own update school files"   ON storage.objects;
DROP POLICY IF EXISTS "own delete school files"   ON storage.objects;

-- 읽기: 로그인한 가족 전원
CREATE POLICY "family read school files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('document-images', 'archive-files'));

-- 쓰기·수정·삭제: 본인 폴더만 (경로 첫 칸 = auth.uid())
CREATE POLICY "own write school files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('document-images', 'archive-files') AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own update school files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('document-images', 'archive-files') AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own delete school files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('document-images', 'archive-files') AND (storage.foldername(name))[1] = auth.uid()::text);

-- (대안) 본인 파일만 읽게 하려면 위 SELECT 정책 대신:
-- CREATE POLICY "own read school files" ON storage.objects FOR SELECT TO authenticated
--   USING (bucket_id IN ('document-images', 'archive-files') AND (storage.foldername(name))[1] = auth.uid()::text);

-- 확인: 정책 목록
-- select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1;
