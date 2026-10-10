import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../lib/auth";
import { fetchTasksByMonth, toggleTask } from "../lib/tasks";
import { fetchDaysOff, addDayOff, deleteDayOff, findDayOff, kstTodayStr, dayOffEmoji, KINDS } from "../lib/daysOff";
import TaskCard from "../components/TaskCard";
import TaskDetail from "../components/TaskDetail";
import ArchivePage from "./ArchivePage";

export default function CalendarPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("calendar");
  // KST 기준 오늘. (예전엔 setHours(0)+toISOString 이라 한국에선 항상 어제가 '오늘'이었다)
  const todayStr = kstTodayStr();
  const [ty, tm] = todayStr.split("-").map(Number);

  const [currentMonth, setCurrentMonth] = useState({ year: ty, month: tm - 1 });
  const [tasks, setTasks] = useState([]);
  const [daysOff, setDaysOff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedTask, setSelectedTask] = useState(null);
  const [offForm, setOffForm] = useState(null); // { reason, kind, end }

  useEffect(() => {
    if (user) loadMonth();
  }, [user, currentMonth.year, currentMonth.month]);

  const monthRange = useMemo(() => {
    const y = currentMonth.year, m = currentMonth.month;
    const last = new Date(y, m + 1, 0).getDate();
    const mm = String(m + 1).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }, [currentMonth]);

  async function loadMonth() {
    setLoading(true);
    try {
      const data = await fetchTasksByMonth(user.id, currentMonth.year, currentMonth.month);
      setTasks(data || []);
    } catch (err) {
      console.error("Failed to load calendar tasks:", err);
    } finally {
      setLoading(false);
    }
    try {
      setDaysOff(await fetchDaysOff(monthRange.from, monthRange.to));
    } catch (err) {
      console.error("Failed to load days off:", err);
    }
  }

  async function handleToggle(taskId, isCompleted) {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, is_completed: !t.is_completed } : t))
    );
    try {
      await toggleTask(taskId, isCompleted);
    } catch {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, is_completed: isCompleted } : t))
      );
    }
  }

  async function handleAddDayOff() {
    const reason = (offForm?.reason || "").trim();
    if (!reason) return;
    const end = offForm.end && offForm.end >= selectedDate ? offForm.end : selectedDate;
    try {
      await addDayOff({ start: selectedDate, end, reason, kind: offForm.kind || "school", userId: user.id });
      setOffForm(null);
      setDaysOff(await fetchDaysOff(monthRange.from, monthRange.to));
    } catch (err) {
      console.error("Add day off:", err);
      alert("등록에 실패했어요.");
    }
  }

  async function handleDeleteDayOff(row) {
    if (!confirm(`'${row.reason}' 쉬는 날을 지울까요?\n지우면 그날 픽업·시간표 알림이 다시 와요.`)) return;
    try {
      await deleteDayOff(row.id);
      setDaysOff((prev) => prev.filter((d) => d.id !== row.id));
    } catch (err) {
      console.error("Delete day off:", err);
      alert("삭제에 실패했어요.");
    }
  }

  const daysInMonth = new Date(currentMonth.year, currentMonth.month + 1, 0).getDate();
  const firstDayOfWeek = new Date(currentMonth.year, currentMonth.month, 1).getDay();
  const monthLabel = `${currentMonth.year}년 ${currentMonth.month + 1}월`;

  const tasksByDate = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      if (!map[t.due_date]) map[t.due_date] = [];
      map[t.due_date].push(t);
    });
    return map;
  }, [tasks]);

  const selectedTasks = tasksByDate[selectedDate] || [];
  const selectedOff = findDayOff(daysOff, selectedDate);

  const prevMonth = () =>
    setCurrentMonth((p) => (p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 }));
  const nextMonth = () =>
    setCurrentMonth((p) => (p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 }));

  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const selectedLabel = (() => {
    const d = new Date(selectedDate + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()} ${dayNames[d.getDay()]}`;
  })();

  return (
    <div style={{ padding: "0 16px 100px" }}>
      {/* Segment control */}
      <div style={{ padding: "20px 0 16px" }}>
        <div style={{ display: "flex", background: "var(--border-light)", borderRadius: 12, padding: 3 }}>
          <button onClick={() => setTab("calendar")} style={{
            flex: 1, padding: "9px 0", fontSize: 14, fontWeight: 600, border: "none", borderRadius: 10, cursor: "pointer",
            background: tab === "calendar" ? "var(--surface)" : "transparent",
            color: tab === "calendar" ? "var(--text-primary)" : "var(--text-muted)",
            boxShadow: tab === "calendar" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            transition: "all 0.2s",
          }}>📅 캘린더</button>
          <button onClick={() => setTab("archive")} style={{
            flex: 1, padding: "9px 0", fontSize: 14, fontWeight: 600, border: "none", borderRadius: 10, cursor: "pointer",
            background: tab === "archive" ? "var(--surface)" : "transparent",
            color: tab === "archive" ? "var(--text-primary)" : "var(--text-muted)",
            boxShadow: tab === "archive" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            transition: "all 0.2s",
          }}>📌 보관함</button>
        </div>
      </div>

      {tab === "archive" ? <ArchivePage /> : (
      <>
      {/* Month nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={prevMonth} style={navBtnStyle}>‹</button>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>{monthLabel}</span>
        <button onClick={nextMonth} style={navBtnStyle}>›</button>
      </div>

      {/* Day names */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", marginBottom: 6 }}>
        {dayNames.map((d, i) => (
          <div key={d} style={{ fontSize: 12, fontWeight: 600, color: i === 0 ? "var(--red)" : i === 6 ? "var(--blue)" : "var(--text-muted)", padding: "4px 0" }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 20 }}>
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`e-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayTasks = tasksByDate[dateStr] || [];
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === todayStr;
          const off = findDayOff(daysOff, dateStr);
          const hasHigh = dayTasks.some((t) => t.priority === "high" && !t.is_completed);
          const hasMedium = dayTasks.some((t) => t.priority === "medium" && !t.is_completed);
          const allDone = dayTasks.length > 0 && dayTasks.every((t) => t.is_completed);
          const dayOfWeek = new Date(currentMonth.year, currentMonth.month, day).getDay();
          const numColor = isSelected ? "#fff" : (off || dayOfWeek === 0) ? "var(--red)" : dayOfWeek === 6 ? "var(--blue)" : "var(--text-primary)";

          return (
            <button
              key={day}
              onClick={() => { setSelectedDate(dateStr); setOffForm(null); }}
              style={{
                position: "relative",
                background: isSelected ? "var(--text-primary)" : isToday ? "#F0F4FF" : off ? "#FFF7ED" : "transparent",
                border: "none",
                borderRadius: 12,
                padding: "8px 0 10px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: isToday || isSelected || off ? 700 : 400, color: numColor }}>
                {day}
              </span>
              <div style={{ display: "flex", gap: 3, height: 6 }}>
                {hasHigh && <Dot color={isSelected ? "#FF6B6B" : "var(--red)"} />}
                {hasMedium && <Dot color={isSelected ? "#FFD93D" : "var(--orange)"} />}
                {allDone && <Dot color={isSelected ? "#6BCB77" : "var(--green)"} />}
                {dayTasks.length > 0 && !hasHigh && !hasMedium && !allDone && <Dot color={isSelected ? "#aaa" : "#CED4DA"} />}
              </div>
              <span style={{
                fontSize: 9, lineHeight: "10px", height: 10, maxWidth: "100%", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                color: isSelected ? "rgba(255,255,255,0.8)" : "#C2410C", fontWeight: 600,
              }}>
                {off ? off.reason : ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected date header */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
            {selectedDate === todayStr ? `📌 오늘 (${selectedLabel})` : selectedLabel}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-secondary)", background: "var(--border-light)", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>
            {selectedTasks.length}
          </span>
          <span style={{ flex: 1 }} />
          {!selectedOff && !offForm && (
            <button onClick={() => setOffForm({ reason: "", kind: "school", end: selectedDate })} style={{
              fontSize: 12, fontWeight: 600, color: "#C2410C", background: "#FFF7ED", border: "1px solid #FED7AA",
              borderRadius: 8, padding: "4px 10px", cursor: "pointer",
            }}>쉬는 날로 등록</button>
          )}
        </div>

        {/* 쉬는 날 표시 */}
        {selectedOff && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "10px 12px",
            background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 12,
          }}>
            <span style={{ fontSize: 18 }}>{dayOffEmoji(selectedOff)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#9A3412" }}>{selectedOff.reason}</div>
              <div style={{ fontSize: 12, color: "#C2410C" }}>
                {KINDS[selectedOff.kind]?.label || "쉬는 날"}
                {selectedOff.start_date !== selectedOff.end_date && ` · ${selectedOff.start_date.slice(5).replace("-", "/")} ~ ${selectedOff.end_date.slice(5).replace("-", "/")}`}
                {" · 알림 쉼"}
              </div>
            </div>
            <button onClick={() => handleDeleteDayOff(selectedOff)} style={{
              fontSize: 12, color: "#9A3412", background: "none", border: "1px solid #FED7AA", borderRadius: 8, padding: "4px 8px", cursor: "pointer",
            }}>지우기</button>
          </div>
        )}

        {/* 쉬는 날 등록 폼 */}
        {offForm && !selectedOff && (
          <div style={{ marginBottom: 12, padding: "12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              autoFocus
              value={offForm.reason}
              onChange={(e) => setOffForm({ ...offForm, reason: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddDayOff(); }}
              placeholder="이유 (예: 재량휴업일, 겨울방학)"
              style={{ fontSize: 14, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, outline: "none" }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={offForm.kind} onChange={(e) => setOffForm({ ...offForm, kind: e.target.value })}
                style={{ fontSize: 13, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
              </select>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>~</span>
              <input type="date" value={offForm.end} min={selectedDate}
                onChange={(e) => setOffForm({ ...offForm, end: e.target.value })}
                style={{ fontSize: 13, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 10, flex: 1, minWidth: 0 }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setOffForm(null)} style={{ fontSize: 13, padding: "8px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer", color: "var(--text-secondary)" }}>취소</button>
              <button onClick={handleAddDayOff} disabled={!offForm.reason.trim()} style={{ fontSize: 13, fontWeight: 700, padding: "8px 14px", background: "#1A1A2E", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", opacity: offForm.reason.trim() ? 1 : 0.4 }}>등록</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 14 }}>로딩 중...</div>
        ) : selectedTasks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-disabled)", fontSize: 14 }}>이 날짜에는 할 일이 없어요</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {selectedTasks
              .sort((a, b) => a.is_completed - b.is_completed)
              .map((t) => (
                <TaskCard key={t.id} task={t} onToggle={handleToggle} onSelect={setSelectedTask} />
              ))}
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskDetail task={selectedTask} onClose={() => setSelectedTask(null)} onToggle={handleToggle} />
      )}
      </>
      )}
    </div>
  );
}

function Dot({ color }) {
  return <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />;
}

const navBtnStyle = {
  background: "none",
  border: "none",
  fontSize: 20,
  cursor: "pointer",
  padding: "4px 8px",
  color: "var(--text-secondary)",
};
