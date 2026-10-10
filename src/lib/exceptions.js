import { supabase } from "./supabase";

// 날짜별 시간표 예외 (가족 공용). 봇에서 주로 등록하고, 화면은 표시 + 삭제.

export const ACTION_LABELS = { skip: "쉼", move: "시간 변경", add: "일회성" };

export async function fetchExceptions(fromStr, toStr) {
  const { data, error } = await supabase
    .from("schedule_exceptions")
    .select("*")
    .lte("start_date", toStr)
    .gte("end_date", fromStr)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return (data || []).map((e) => ({
    ...e,
    target_time: e.target_time ? e.target_time.slice(0, 5) : null,
    new_start: e.new_start ? e.new_start.slice(0, 5) : null,
    new_end: e.new_end ? e.new_end.slice(0, 5) : null,
  }));
}

export async function deleteException(id) {
  const { error } = await supabase.from("schedule_exceptions").delete().eq("id", id);
  if (error) throw error;
}

function norm(s) { return String(s || "").replace(/\s+/g, "").toLowerCase(); }

// 특정 날짜에 적용되는 예외만
export function exceptionsOn(list, dateStr) {
  return (list || []).filter((e) => e.start_date <= dateStr && dateStr <= e.end_date);
}

// 블록(이름·시작시각)에 걸리는 예외
export function findBlockException(dayExceptions, block) {
  return (dayExceptions || []).find((e) => {
    if (e.kind !== "block" || !e.target_name) return false;
    const nameOk = norm(block.name).includes(norm(e.target_name)) || norm(e.target_name).includes(norm(block.name));
    const timeOk = !e.target_time || e.target_time === block.start;
    return nameOk && timeOk;
  }) || null;
}

export function findPickupException(dayExceptions, time) {
  return (dayExceptions || []).find((e) => e.kind === "pickup" && (!e.target_time || e.target_time === time)) || null;
}

export function findAlertException(dayExceptions, alert) {
  return (dayExceptions || []).find((e) => {
    if (e.kind !== "alert") return false;
    const nameOk = !e.target_name || norm(alert.name).includes(norm(e.target_name)) || norm(e.target_name).includes(norm(alert.name));
    const timeOk = !e.target_time || e.target_time === alert.time;
    return nameOk && timeOk;
  }) || null;
}

export function oneoffsOn(dayExceptions) {
  return (dayExceptions || []).filter((e) => e.kind === "oneoff" && e.action === "add");
}

export function describeException(e) {
  const range = e.start_date === e.end_date ? e.start_date.slice(5).replace("-", "/") : `${e.start_date.slice(5).replace("-", "/")}~${e.end_date.slice(5).replace("-", "/")}`;
  const what = e.kind === "pickup" ? `픽업${e.target_time ? " " + e.target_time : ""}` : (e.target_name || e.kind);
  if (e.action === "skip") return `${range} ${what} 쉼${e.reason ? ` (${e.reason})` : ""}`;
  if (e.action === "move") return `${range} ${what} → ${e.new_start}${e.new_end ? `~${e.new_end}` : ""}${e.reason ? ` (${e.reason})` : ""}`;
  return `${range} ${what} ${e.new_start}${e.new_end ? `~${e.new_end}` : ""} 추가${e.reason ? ` (${e.reason})` : ""}`;
}
