// ═══════════════════════════════════════════════════════════════
// 날짜별 시간표 예외 (schedule_exceptions) — Worker 쪽 조회·매칭
//   kind: block | pickup | alert | oneoff,  action: skip | move | add
//   가족 공용. 블록 id 가 아니라 '날짜 + 이름/시각' 으로 맞춘다 (두 계정 시간표가 각자라서).
// ═══════════════════════════════════════════════════════════════

const hm = (t) => (t ? String(t).slice(0, 5) : null);
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

export async function getExceptions(env, deps, dateStr) {
  try {
    const rows = await deps.supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "schedule_exceptions", {
      query: `?start_date=lte.${dateStr}&end_date=gte.${dateStr}&select=id,start_date,end_date,kind,target_name,target_time,action,new_start,new_end,reason`,
    });
    if (!Array.isArray(rows)) {
      if (rows && rows.message) console.error("schedule_exceptions query error:", rows.message);
      return [];
    }
    return rows.map((e) => ({ ...e, target_time: hm(e.target_time), new_start: hm(e.new_start), new_end: hm(e.new_end) }));
  } catch (err) {
    console.error("schedule_exceptions error:", err);
    return [];
  }
}

function nameMatch(a, b) {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

// block: { name, start }  (start = "HH:MM")
export function blockException(list, block) {
  return (list || []).find((e) => e.kind === "block" && e.target_name && nameMatch(block.name, e.target_name) && (!e.target_time || e.target_time === block.start)) || null;
}

// time = "HH:MM"
export function pickupException(list, time) {
  return (list || []).find((e) => e.kind === "pickup" && (!e.target_time || e.target_time === time)) || null;
}

// alert: { name, time }
export function alertException(list, alert) {
  return (list || []).find((e) => e.kind === "alert" && (!e.target_name || nameMatch(alert.name, e.target_name)) && (!e.target_time || e.target_time === alert.time)) || null;
}

export function oneoffs(list) {
  return (list || []).filter((e) => e.kind === "oneoff" && e.action === "add");
}

export function describeException(e) {
  const what = e.kind === "pickup" ? `픽업${e.target_time ? " " + e.target_time : ""}` : (e.target_name || e.kind);
  const why = e.reason ? ` (${e.reason})` : "";
  if (e.action === "skip") return `${what} 쉼${why}`;
  if (e.action === "move") return `${what} → ${e.new_start}${e.new_end ? "~" + e.new_end : ""}${why}`;
  return `${what} ${e.new_start}${e.new_end ? "~" + e.new_end : ""} 추가${why}`;
}

// 블록 목록에 예외를 입힌다 (표시·브리핑용). skip 은 effective=false, move 는 시각 교체, oneoff 는 추가.
export function applyToBlocks(list, blocks) {
  const out = blocks.map((b) => {
    const ex = blockException(list, b);
    if (!ex) return { ...b, exception: null };
    if (ex.action === "skip") return { ...b, exception: ex, skipped: true };
    if (ex.action === "move") return { ...b, exception: ex, start: ex.new_start || b.start, end: ex.new_end || b.end, moved_from: b.start };
    return { ...b, exception: ex };
  });
  for (const o of oneoffs(list)) {
    out.push({ name: o.target_name, start: o.new_start, end: o.new_end || o.new_start, category: "other", oneoff: true, exception: o });
  }
  return out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
