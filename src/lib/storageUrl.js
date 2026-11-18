import { supabase } from "./supabase";

// Storage 파일 주소. 버킷을 비공개로 바꾸는 중이라(2026-11-18) 서명 URL 을 먼저 시도하고,
// 아직 정책이 없어 실패하면 예전 공개 주소로 돌아간다. 버킷이 Public 해제되면 공개 주소는 403 이 난다.
const EXPIRES_SEC = 60 * 60;

export async function fileUrl(bucket, path) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, EXPIRES_SEC);
    if (!error && data?.signedUrl) return data.signedUrl;
    console.warn(`signed url failed (${bucket}):`, error?.message);
  } catch (err) {
    console.warn(`signed url error (${bucket}):`, err);
  }
  return `${supabase.supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

export async function fileUrls(bucket, paths) {
  const clean = (paths || []).filter(Boolean);
  if (clean.length === 0) return {};
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(clean, EXPIRES_SEC);
    if (!error && Array.isArray(data)) {
      const map = {};
      data.forEach((d, i) => { if (d?.signedUrl) map[clean[i]] = d.signedUrl; });
      if (Object.keys(map).length === clean.length) return map;
    } else {
      console.warn(`signed urls failed (${bucket}):`, error?.message);
    }
  } catch (err) {
    console.warn(`signed urls error (${bucket}):`, err);
  }
  const map = {};
  for (const p of clean) map[p] = `${supabase.supabaseUrl}/storage/v1/object/public/${bucket}/${p}`;
  return map;
}
