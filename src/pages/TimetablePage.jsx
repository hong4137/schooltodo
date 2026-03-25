import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../lib/auth";
import { fetchBlocks, createBlock, updateBlock, deleteBlock, fetchSubjects, fetchPickups, upsertPickup, deletePickup, fetchAlerts } from "../lib/timetable";

const DAYS = ["월", "화", "수", "목", "금"];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri"];

const CATEGORIES = {
  school: { label: "정규", bg: "#EEF0FF", border: "#D0D5F7" },
  aftercare: { label: "돌봄", bg: "#FFF4E6", border: "#FFD9A0" },
  academy: { label: "학원", bg: "#E8FFF3", border: "#A0E8C8" },
  other: { label: "기타", bg: "#F5F5F5", border: "#DDD" },
};

const PRESET_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FECA57",
  "#FF9FF3", "#C39BD3", "#F0B27A", "#82E0AA", "#F8C471",
  "#E74C3C", "#8E44AD", "#2980B9", "#27AE60", "#E67E22",
];

const DEFAULT_SUBJECTS = [
  { name: "국어", color: "#FF6B6B" }, { name: "수학", color: "#4ECDC4" },
  { name: "영어", color: "#45B7D1" }, { name: "과학", color: "#96CEB4" },
  { name: "사회", color: "#FECA57" }, { name: "체육", color: "#FF9FF3" },
  { name: "음악", color: "#C39BD3" }, { name: "미술", color: "#F0B27A" },
  { name: "창체", color: "#82E0AA" }, { name: "점심", color: "#CCC" },
];

function timeToMin(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function minToTime(m) { return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }

export default function TimetablePage() {
  const { user } = useAuth();
  const [blocks, setBlocks] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [pickups, setPickups] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editBlock, setEditBlock] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showPickupEdit, setShowPickupEdit] = useState(false);

  useEffect(() => { if (user) load(); }, [user]);

  async function load() {
    try {
      const [b, s, p, a] = await Promise.all([
        fetchBlocks(user.id), fetchSubjects(user.id), fetchPickups(user.id), fetchAlerts(user.id),
      ]);
      // Filter out alert-type blocks (도보하원, 태권도 이동) from regular blocks
      setBlocks(b.filter((bl) => !bl.name.includes("도보하원") && !bl.name.includes("이동")));
      setSubjects(s.length > 0 ? s : DEFAULT_SUBJECTS);
      setPickups(p);
      setAlerts(a);
    } catch (err) { console.error("Load timetable:", err); }
    setLoading(false);
  }

  // Compute time range from data
  const { timeStart, timeEnd, pxPerMin, gridHeight } = useMemo(() => {
    if (blocks.length === 0) return { timeStart: 9 * 60, timeEnd: 16 * 60, pxPerMin: 1.4, gridHeight: 420 * 1.4 };
    const allTimes = [
      ...blocks.map((b) => timeToMin(b.start)),
      ...blocks.map((b) => timeToMin(b.end)),
      ...Object.values(pickups).map((p) => timeToMin(p.time)),
    ];
    const earliest = Math.floor(Math.min(...allTimes) / 60) * 60;
    const latest = Math.ceil(Math.max(...allTimes) / 60) * 60;
    const total = latest - earliest;
    const px = Math.min(1.6, Math.max(0.9, 600 / total));
    return { timeStart: earliest, timeEnd: latest, pxPerMin: px, gridHeight: total * px };
  }, [blocks, pickups]);

  const hours = [];
  for (let h = Math.floor(timeStart / 60); h <= Math.floor(timeEnd / 60); h++) hours.push(h);

  // Current time (KST)
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const nowMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const showNowLine = nowMin >= timeStart && nowMin <= timeEnd;
  const nowTop = (nowMin - timeStart) * pxPerMin;
  const nowDay = kst.getUTCDay(); // 0=sun

  async function handleSave(data) {
    try {
      if (data.id) {
        const updated = await updateBlock(data.id, data);
        setBlocks((prev) => prev.map((b) => b.id === data.id ? updated : b));
      } else {
        const created = await createBlock({ ...data, user_id: user.id });
        setBlocks((prev) => [...prev, created]);
      }
    } catch (err) { console.error("Save block:", err); alert("저장 실패"); }
    setShowEdit(false);
  }

  async function handleDelete(data) {
    try {
      await deleteBlock(data.id);
      setBlocks((prev) => prev.filter((b) => b.id !== data.id));
    } catch (err) { console.error("Delete block:", err); }
    setShowEdit(false);
  }

  async function handlePickupSave(data) {
    try {
      for (const [day, time] of Object.entries(data)) {
        if (time) {
          const result = await upsertPickup(user.id, day, time);
          setPickups((prev) => ({ ...prev, [day]: result }));
        } else {
          await deletePickup(user.id, day);
          setPickups((prev) => { const n = { ...prev }; delete n[day]; return n; });
        }
      }
    } catch (err) { console.error("Pickup save:", err); alert("저장 실패"); }
    setShowPickupEdit(false);
  }

  function handleBlockClick(block) { setEditBlock(block); setShowEdit(true); }
  function handleAdd() { setEditBlock(null); setShowEdit(true); }

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 14 }}>로딩 중...</span>
    </div>
  );

  return (
    <div style={{ padding: "0 0 100px" }}>
      {/* Header */}
      <div style={{ padding: "16px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>2026년 1학기</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)", margin: "2px 0 0" }}>시간표</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowPickupEdit(true)} style={{
            width: 40, height: 40, borderRadius: 12, border: "1px solid var(--border)",
            background: "var(--surface)", fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>🚗</button>
          <button onClick={handleAdd} style={{
            width: 40, height: 40, borderRadius: 12, border: "none", background: "#1A1A2E",
            color: "#fff", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", boxShadow: "0 2px 8px rgba(26,26,46,0.3)",
          }}>+</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {Object.entries(CATEGORIES).filter(([k]) => k !== "other").map(([key, cat]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: cat.border }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{cat.label}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: "#FF6B35" }} />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>픽업</span>
        </div>
      </div>

      {/* Empty state */}
      {blocks.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 16px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>시간표가 비어있어요</h3>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>+ 버튼을 눌러 수업을 추가해보세요</p>
        </div>
      ) : (
        /* Grid */
        <div style={{ padding: "0 4px", overflowX: "auto" }}>
          <div style={{ display: "flex", minWidth: 0 }}>
            {/* Time axis */}
            <div style={{ width: 34, flexShrink: 0, paddingTop: 32, position: "relative" }}>
              <div style={{ height: gridHeight, position: "relative" }}>
                {hours.map((h) => (
                  <div key={h} style={{ position: "absolute", top: (h * 60 - timeStart) * pxPerMin, left: 0, right: 0 }}>
                    <span style={{ fontSize: 10, color: "#BBB", fontWeight: 600 }}>{String(h).padStart(2, "0")}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Day columns */}
            {DAY_KEYS.map((dayKey, di) => {
              const dayBlocks = blocks.filter((b) => b.day === dayKey);
              const isToday = nowDay === di + 1;
              const pickup = pickups[dayKey];
              const dayAlerts = alerts.filter((a) => a.day === dayKey);

              return (
                <div key={dayKey} style={{ flex: 1, minWidth: 0 }}>
                  {/* Day header */}
                  <div style={{
                    textAlign: "center", padding: "6px 0 8px",
                    background: isToday ? "#1A1A2E" : "transparent",
                    borderRadius: isToday ? 10 : 0, margin: "0 2px",
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: isToday ? "#fff" : "#666" }}>{DAYS[di]}</span>
                  </div>

                  {/* Timeline column */}
                  <div style={{
                    position: "relative", height: gridHeight, margin: "0 1px",
                    background: "#fff",
                    borderRadius: 8, border: "1px solid #F0F0F0",
                  }}>
                    {/* Hour lines */}
                    {hours.map((h) => (
                      <div key={h} style={{ position: "absolute", top: (h * 60 - timeStart) * pxPerMin, left: 0, right: 0, borderTop: "1px solid #F0F0F0" }} />
                    ))}

                    {/* Blocks */}
                    {dayBlocks.map((b) => (
                      <TimetableBlock key={b.id} block={b} timeStart={timeStart} pxPerMin={pxPerMin} onClick={handleBlockClick} />
                    ))}

                    {/* Alert markers (도보하원, 태권도 이동) */}
                    {dayAlerts.map((a) => (
                      <AlertMarker key={a.id} alert={a} timeStart={timeStart} pxPerMin={pxPerMin} isToday={isToday} nowMin={nowMin} />
                    ))}

                    {/* Pickup marker */}
                    {pickup && (
                      <PickupMarker time={pickup.time} timeStart={timeStart} pxPerMin={pxPerMin} isToday={isToday} />
                    )}

                    {/* Now line - only on today */}
                    {showNowLine && isToday && (
                      <div style={{
                        position: "absolute", top: nowTop, left: -2, right: -2,
                        height: 2, background: "#FF3B30", zIndex: 10, borderRadius: 1,
                      }}>
                        <div style={{
                          position: "absolute", left: -4, top: -3, width: 8, height: 8,
                          borderRadius: "50%", background: "#FF3B30",
                        }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showEdit && (
        <EditSheet block={editBlock} subjects={subjects} onClose={() => setShowEdit(false)} onSave={handleSave} onDelete={handleDelete} />
      )}
      {showPickupEdit && (
        <PickupEditSheet pickups={pickups} onClose={() => setShowPickupEdit(false)} onSave={handlePickupSave} />
      )}
    </div>
  );
}

// ══════════════════════════════
// Pickup marker
// ══════════════════════════════
function PickupMarker({ time, timeStart, pxPerMin, isToday }) {
  const min = timeToMin(time) - timeStart;
  const top = min * pxPerMin;

  if (isToday) {
    // Today: big highlighted marker
    return (
      <div style={{ position: "absolute", top: top - 14, left: -1, right: -1, zIndex: 8, pointerEvents: "none" }}>
        <div style={{
          background: "linear-gradient(135deg, #FF6B35, #FF8C42)",
          borderRadius: 8, padding: "4px 0", textAlign: "center",
          boxShadow: "0 2px 10px rgba(255,107,53,0.4)",
          animation: "pickupPulse 2s ease-in-out infinite",
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#fff", opacity: 0.85 }}>🚗 픽업</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>{time}</div>
        </div>
        <style>{`@keyframes pickupPulse { 0%,100% { box-shadow: 0 2px 10px rgba(255,107,53,0.4); } 50% { box-shadow: 0 2px 18px rgba(255,107,53,0.7); } }`}</style>
      </div>
    );
  }

  // Other days: subtle line
  return (
    <div style={{
      position: "absolute", top, left: 0, right: 0, zIndex: 6,
      borderTop: "2px dashed #FF6B3580", pointerEvents: "none",
    }}>
      <span style={{
        position: "absolute", top: -8, right: 2, fontSize: 8,
        color: "#FF6B35", fontWeight: 700, background: "#fff", padding: "0 2px",
      }}>{time}</span>
    </div>
  );
}

// ══════════════════════════════
// Alert marker (도보하원, 태권도 이동)
// ══════════════════════════════
function AlertMarker({ alert, timeStart, pxPerMin, isToday, nowMin }) {
  const alertMin = timeToMin(alert.time);
  const top = (alertMin - timeStart) * pxPerMin;
  const emoji = alert.emoji || "🔔";

  // 오늘이고 10분 전 ~ 해당 시간 사이: 크게 표시
  const isActive = isToday && nowMin >= alertMin - 10 && nowMin <= alertMin;

  if (isActive) {
    return (
      <div style={{ position: "absolute", top: top - 14, left: -1, right: -1, zIndex: 8, pointerEvents: "none" }}>
        <div style={{
          background: "linear-gradient(135deg, #2980B9, #3498DB)",
          borderRadius: 8, padding: "4px 0", textAlign: "center",
          boxShadow: "0 2px 10px rgba(41,128,185,0.4)",
          animation: "alertPulse 2s ease-in-out infinite",
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#fff", opacity: 0.85 }}>{emoji} {alert.name}</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>{alert.time}</div>
        </div>
        <style>{`@keyframes alertPulse { 0%,100% { box-shadow: 0 2px 10px rgba(41,128,185,0.4); } 50% { box-shadow: 0 2px 18px rgba(41,128,185,0.7); } }`}</style>
      </div>
    );
  }

  // 평소: 파란 점선
  return (
    <div style={{
      position: "absolute", top, left: 0, right: 0, zIndex: 6,
      borderTop: "2px dashed #2980B980", pointerEvents: "none",
    }}>
      <span style={{
        position: "absolute", top: -8, right: 2, fontSize: 8,
        color: "#2980B9", fontWeight: 700, background: "#fff", padding: "0 2px",
      }}>{alert.time}</span>
    </div>
  );
}

// ══════════════════════════════
// Block component
// ══════════════════════════════
function TimetableBlock({ block, timeStart, pxPerMin, onClick }) {
  const startMin = timeToMin(block.start) - timeStart;
  const endMin = timeToMin(block.end) - timeStart;
  const top = startMin * pxPerMin;
  const height = Math.max((endMin - startMin) * pxPerMin, 18);
  const isSmall = height < 40;
  const isTiny = height < 28;
  const isLunch = block.name === "점심";

  return (
    <div onClick={() => onClick?.(block)} style={{
      position: "absolute", top, left: 2, right: 2, height, borderRadius: 8,
      background: isLunch ? "#F5F5F5" : `${block.color}18`,
      border: `1.5px solid ${isLunch ? "#E0E0E0" : block.color}40`,
      borderLeft: isLunch ? undefined : `3px solid ${block.color}`,
      padding: isTiny ? "1px 6px" : "3px 6px", cursor: "pointer", overflow: "hidden",
      display: "flex", flexDirection: isSmall ? "row" : "column",
      alignItems: isSmall ? "center" : "flex-start", gap: isSmall ? 4 : 0,
      transition: "transform 0.1s",
    }}>
      <span style={{
        fontSize: isTiny ? 10 : 11, fontWeight: 700,
        color: isLunch ? "#999" : block.color, lineHeight: 1.2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{block.name}</span>
      {!isTiny && (
        <span style={{ fontSize: 9, color: isLunch ? "#BBB" : `${block.color}99`, lineHeight: 1.2, whiteSpace: "nowrap" }}>
          {block.start}~{block.end}
        </span>
      )}
    </div>
  );
}

// ══════════════════════════════
// Pickup Edit Bottom Sheet
// ══════════════════════════════
function PickupEditSheet({ pickups, onClose, onSave }) {
  const [times, setTimes] = useState(() => {
    const init = {};
    DAY_KEYS.forEach((d) => { init[d] = pickups[d]?.time || ""; });
    return init;
  });
  const [saving, setSaving] = useState(false);

  const timeOptions = [""];
  for (let m = 12 * 60; m <= 20 * 60; m += 10) timeOptions.push(minToTime(m));

  async function handleSubmit() {
    setSaving(true);
    await onSave?.(times);
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} />
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, background: "var(--bg)",
        borderRadius: "20px 20px 0 0", padding: "20px 20px 32px",
        animation: "sheetUp 0.3s ease",
      }}>
        <div style={{ width: 40, height: 4, background: "var(--border)", borderRadius: 2, margin: "0 auto 16px" }} />
        <h3 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 4px" }}>🚗 픽업 시간 설정</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px" }}>요일별 픽업 시간을 입력하세요. 비우면 표시 안 돼요.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {DAY_KEYS.map((d, i) => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 28, fontSize: 15, fontWeight: 700, color: "var(--text-primary)", textAlign: "center" }}>{DAYS[i]}</span>
              <select value={times[d]} onChange={(e) => setTimes((prev) => ({ ...prev, [d]: e.target.value }))}
                style={{
                  flex: 1, padding: "10px 12px", fontSize: 14, border: "1px solid var(--border)",
                  borderRadius: 10, fontFamily: "inherit", color: times[d] ? "var(--text-primary)" : "var(--text-disabled)",
                  background: "var(--surface)", appearance: "auto",
                }}>
                <option value="">없음</option>
                {timeOptions.filter(Boolean).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          ))}

          <button onClick={handleSubmit} disabled={saving} style={{
            width: "100%", padding: "14px 0", fontSize: 15, fontWeight: 700, color: "#fff",
            background: saving ? "#CCC" : "linear-gradient(135deg, #FF6B35, #FF8C42)",
            border: "none", borderRadius: 14, cursor: saving ? "default" : "pointer", marginTop: 4,
          }}>{saving ? "저장 중..." : "저장"}</button>
        </div>
      </div>
      <style>{`@keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}

// ══════════════════════════════
// Edit Bottom Sheet
// ══════════════════════════════
function EditSheet({ block, subjects, onClose, onSave, onDelete }) {
  const isNew = !block?.id;
  const [name, setName] = useState(block?.name || "");
  const [day, setDay] = useState(block?.day || "mon");
  const [start, setStart] = useState(block?.start || "09:00");
  const [end, setEnd] = useState(block?.end || "09:40");
  const [category, setCategory] = useState(block?.category || "school");
  const [color, setColor] = useState(block?.color || "#4ECDC4");
  const [saving, setSaving] = useState(false);

  const timeOptions = [];
  for (let m = 7 * 60; m <= 21 * 60; m += 10) timeOptions.push(minToTime(m));

  function applySubject(sub) { setName(sub.name); setColor(sub.color); }

  async function handleSubmit() {
    setSaving(true);
    await onSave?.({ ...(block || {}), name, day, start, end, category, color });
    setSaving(false);
  }

  const inputStyle = {
    width: "100%", padding: "10px 12px", fontSize: 14,
    border: "1px solid var(--border)", borderRadius: 10,
    fontFamily: "inherit", color: "var(--text-primary)", background: "var(--surface)",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} />
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, background: "var(--bg)",
        borderRadius: "20px 20px 0 0", padding: "20px 20px 32px",
        maxHeight: "85vh", overflowY: "auto", animation: "sheetUp 0.3s ease",
      }}>
        <div style={{ width: 40, height: 4, background: "var(--border)", borderRadius: 2, margin: "0 auto 16px" }} />
        <h3 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 16px" }}>{isNew ? "수업 추가" : "수업 수정"}</h3>

        {/* Quick subject select */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>빠른 선택</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {subjects.map((s, i) => (
              <button key={s.id || i} onClick={() => applySubject(s)} style={{
                padding: "5px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 20,
                background: name === s.name ? s.color : `${s.color}20`,
                color: name === s.name ? "#fff" : s.color, cursor: "pointer",
              }}>{s.name}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>과목명</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="과목명 입력" style={inputStyle} />
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>요일</div>
            <div style={{ display: "flex", gap: 6 }}>
              {DAY_KEYS.map((d, i) => (
                <button key={d} onClick={() => setDay(d)} style={{
                  flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 600, border: "none", borderRadius: 10,
                  background: day === d ? "#1A1A2E" : "var(--border-light)", color: day === d ? "#fff" : "#666", cursor: "pointer",
                }}>{DAYS[i]}</button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>시작</div>
              <select value={start} onChange={(e) => setStart(e.target.value)} style={{ ...inputStyle, appearance: "auto" }}>
                {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>종료</div>
              <select value={end} onChange={(e) => setEnd(e.target.value)} style={{ ...inputStyle, appearance: "auto" }}>
                {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>구분</div>
            <div style={{ display: "flex", gap: 6 }}>
              {Object.entries(CATEGORIES).map(([key, cat]) => (
                <button key={key} onClick={() => setCategory(key)} style={{
                  flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 600,
                  border: `1.5px solid ${category === key ? "#1A1A2E" : cat.border}`,
                  borderRadius: 10, background: category === key ? cat.bg : "#fff",
                  color: category === key ? "#1A1A2E" : "#999", cursor: "pointer",
                }}>{cat.label}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>색상</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PRESET_COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} style={{
                  width: 30, height: 30, borderRadius: "50%", padding: 0,
                  border: color === c ? "3px solid #1A1A2E" : "2px solid #E0E0E0",
                  background: c, cursor: "pointer",
                }} />
              ))}
            </div>
          </div>

          <button onClick={handleSubmit} disabled={!name || !start || !end || saving} style={{
            width: "100%", padding: "14px 0", fontSize: 15, fontWeight: 700, color: "#fff",
            background: !name || saving ? "#CCC" : "linear-gradient(135deg, #1A1A2E, #2D2B55)",
            border: "none", borderRadius: 14, cursor: !name || saving ? "default" : "pointer", marginTop: 4,
          }}>{saving ? "저장 중..." : isNew ? "추가" : "저장"}</button>

          {!isNew && (
            <button onClick={() => { if (confirm("이 수업을 삭제할까요?")) onDelete?.(block); }} style={{
              width: "100%", padding: "12px 0", fontSize: 14, fontWeight: 600, color: "var(--red)",
              background: "none", border: "1px solid var(--red-bg)", borderRadius: 14, cursor: "pointer",
            }}>삭제</button>
          )}
        </div>
      </div>
      <style>{`@keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}
