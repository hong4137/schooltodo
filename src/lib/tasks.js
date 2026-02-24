import { supabase } from "./supabase";

export async function fetchTasks(userId) {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      `
      *,
      documents (title, uploaded_by),
      documents!inner ( user_telegrams:uploaded_by (display_name) )
    `
    )
    .eq("user_id", userId)
    .order("due_date", { ascending: true });

  if (error) {
    // Fallback: simpler query without join
    const { data: simple, error: err2 } = await supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .order("due_date", { ascending: true });
    if (err2) throw err2;
    return simple;
  }
  return data;
}

export async function toggleTask(taskId, isCompleted) {
  const { data, error } = await supabase
    .from("tasks")
    .update({
      is_completed: !isCompleted,
      completed_at: !isCompleted ? new Date().toISOString() : null,
    })
    .eq("id", taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTask(taskId, updates) {
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createTask(task) {
  const { data, error } = await supabase
    .from("tasks")
    .insert(task)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTask(taskId) {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw error;
}

export async function fetchDocumentImages(documentId) {
  const { data, error } = await supabase
    .from("document_images")
    .select("*")
    .eq("document_id", documentId)
    .order("page_order", { ascending: true });
  if (error) throw error;
  return data;
}

export function getImageUrl(storagePath) {
  if (!storagePath) return null;
  return `${supabase.supabaseUrl}/storage/v1/object/authenticated/document-images/${storagePath}`;
}

export async function fetchTasksByMonth(userId, year, month) {
  const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDate =
    month === 11
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 2).padStart(2, "0")}-01`;

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .gte("due_date", startDate)
    .lt("due_date", endDate)
    .order("due_date", { ascending: true });
  if (error) throw error;
  return data;
}
