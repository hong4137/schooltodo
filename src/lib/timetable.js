import { supabase } from "./supabase";

export async function fetchBlocks(userId) {
  const { data, error } = await supabase
    .from("timetable_blocks")
    .select("*")
    .eq("user_id", userId)
    .order("start_time", { ascending: true });
  if (error) throw error;
  return (data || []).map((b) => ({
    ...b,
    start: b.start_time?.slice(0, 5),
    end: b.end_time?.slice(0, 5),
  }));
}

export async function createBlock(block) {
  const { data, error } = await supabase
    .from("timetable_blocks")
    .insert({
      user_id: block.user_id,
      name: block.name,
      day: block.day,
      start_time: block.start + ":00",
      end_time: block.end + ":00",
      category: block.category,
      color: block.color,
      memo: block.memo || null,
    })
    .select()
    .single();
  if (error) throw error;
  return { ...data, start: data.start_time?.slice(0, 5), end: data.end_time?.slice(0, 5) };
}

export async function updateBlock(id, updates) {
  const body = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.day !== undefined) body.day = updates.day;
  if (updates.start !== undefined) body.start_time = updates.start + ":00";
  if (updates.end !== undefined) body.end_time = updates.end + ":00";
  if (updates.category !== undefined) body.category = updates.category;
  if (updates.color !== undefined) body.color = updates.color;
  if (updates.memo !== undefined) body.memo = updates.memo;

  const { data, error } = await supabase
    .from("timetable_blocks")
    .update(body)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return { ...data, start: data.start_time?.slice(0, 5), end: data.end_time?.slice(0, 5) };
}

export async function deleteBlock(id) {
  const { error } = await supabase.from("timetable_blocks").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchSubjects(userId) {
  const { data, error } = await supabase
    .from("timetable_subjects")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createSubject(subject) {
  const { data, error } = await supabase
    .from("timetable_subjects")
    .insert(subject)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSubject(id) {
  const { error } = await supabase.from("timetable_subjects").delete().eq("id", id);
  if (error) throw error;
}
