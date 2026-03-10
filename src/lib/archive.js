import { supabase } from "./supabase";

const BUCKET = "archive-files";

export async function fetchPosts(userId) {
  const { data, error } = await supabase
    .from("archive_posts")
    .select("*, archive_files(id, file_name, file_size, mime_type, storage_path)")
    .eq("user_id", userId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createPost(userId, title, content) {
  const { data, error } = await supabase
    .from("archive_posts")
    .insert({ user_id: userId, title, content: content || "" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePost(id, updates) {
  const { data, error } = await supabase
    .from("archive_posts")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePost(id) {
  // Files cascade delete from DB, but need to clean storage too
  const { data: files } = await supabase
    .from("archive_files")
    .select("storage_path")
    .eq("post_id", id);
  if (files && files.length > 0) {
    await supabase.storage.from(BUCKET).remove(files.map((f) => f.storage_path));
  }
  const { error } = await supabase.from("archive_posts").delete().eq("id", id);
  if (error) throw error;
}

export async function togglePin(id, pinned) {
  return updatePost(id, { pinned: !pinned });
}

export async function uploadFile(userId, postId, file) {
  // Resize images before upload
  let uploadFile = file;
  if (file.type.startsWith("image/") && file.size > 500 * 1024) {
    uploadFile = await resizeImage(file, 1200);
  }

  const ext = file.name.split(".").pop();
  const path = `${userId}/${postId}/${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, uploadFile, { contentType: uploadFile.type });
  if (uploadErr) throw uploadErr;

  const { data, error } = await supabase
    .from("archive_files")
    .insert({
      post_id: postId,
      user_id: userId,
      file_name: file.name,
      file_size: uploadFile.size,
      mime_type: uploadFile.type,
      storage_path: path,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFile(fileId, storagePath) {
  await supabase.storage.from(BUCKET).remove([storagePath]);
  const { error } = await supabase.from("archive_files").delete().eq("id", fileId);
  if (error) throw error;
}

export function getFileUrl(storagePath) {
  return `${supabase.supabaseUrl}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

async function resizeImage(file, maxWidth) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        resolve(new File([blob], file.name, { type: "image/jpeg" }));
      }, "image/jpeg", 0.85);
    };
    img.src = URL.createObjectURL(file);
  });
}
