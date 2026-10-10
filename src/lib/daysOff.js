import { supabase } from "./supabase";

// 쉬는 날 (공휴일 · 재량휴업일 · 방학). 가족 공용 표라 user_id 는 쓰지 않는다.

export const KINDS = {
  holiday: { label: "공휴일", emoji: "🎌" },
  school: { label: "재량휴업", emoji: "🏫" },
  vacation: { label: "방학", emoji: "🏖" },
  other: { label: "기타", emoji: "📌" },
};

export function kstTodayStr() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

// [fromStr, toStr] 와 겹치는 쉬는 날 전부
export async function fetchDaysOff(fromStr, toStr) {
  const { data, error } = await supabase
    .from("days_off")
    .select("*")
    .lte("start_date", toStr)
    .gte("end_date", fromStr)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addDayOff({ start, end, reason, kind = "school", userId }) {
  const { data, error } = await supabase
    .from("days_off")
    .insert({ start_date: start, end_date: end || start, reason, kind, created_by: userId || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDayOff(id) {
  const { error } = await supabase.from("days_off").delete().eq("id", id);
  if (error) throw error;
}

export function findDayOff(list, dateStr) {
  return (list || []).find((d) => d.start_date <= dateStr && dateStr <= d.end_date) || null;
}

export function dayOffEmoji(dayOff) {
  return (dayOff && KINDS[dayOff.kind]?.emoji) || "🏖";
}
