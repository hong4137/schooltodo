import { supabase } from "./supabase";

// 알림 시스템 상태 (Worker 가 job_status / job_runs 에 남긴 기록을 읽기만 한다)

export const JOB_LABELS = {
  briefing: "네스트 브리핑",
  digest_morning: "아침 할 일 알림",
  digest_evening: "저녁 할 일 알림",
  pickup: "픽업 알림",
  alert: "정각 알림",
};

export async function fetchHealth() {
  const [statusRes, runsRes] = await Promise.all([
    supabase.from("job_status").select("job,last_run_at,last_ok,last_detail"),
    supabase.from("job_runs").select("job,ran_at,ok,detail").order("ran_at", { ascending: false }).limit(12),
  ]);
  if (statusRes.error) throw statusRes.error;
  if (runsRes.error) throw runsRes.error;
  const status = {};
  for (const r of statusRes.data || []) status[r.job] = r;
  return { status, runs: runsRes.data || [] };
}

// AI 비서 사용량 (bot_usage, KST 날짜별). Sonnet 5.5 단가로 추정 비용 계산
const PRICE = { input: 2 / 1e6, cache_read: 0.2 / 1e6, output: 10 / 1e6 };

export async function fetchBotUsage(fromDay) {
  const { data, error } = await supabase
    .from("bot_usage")
    .select("day,calls,input_tokens,cache_read,output_tokens")
    .gte("day", fromDay)
    .order("day", { ascending: false });
  if (error) throw error;
  const rows = data || [];
  const sum = rows.reduce((a, r) => ({
    calls: a.calls + (r.calls || 0), input: a.input + Number(r.input_tokens || 0),
    cache: a.cache + Number(r.cache_read || 0), output: a.output + Number(r.output_tokens || 0),
  }), { calls: 0, input: 0, cache: 0, output: 0 });
  const uncached = Math.max(0, sum.input - sum.cache);
  const usd = uncached * PRICE.input + sum.cache * PRICE.cache_read + sum.output * PRICE.output;
  return { rows, sum, usd };
}

export function minutesAgo(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
}

export function formatAgo(iso) {
  const m = minutesAgo(iso);
  if (m === null) return "기록 없음";
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function formatKstTime(iso) {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
