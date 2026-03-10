import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../lib/auth";
import { fetchTasksByMonth, toggleTask } from "../lib/tasks";
import TaskCard from "../components/TaskCard";
import TaskDetail from "../components/TaskDetail";
import ArchivePage from "./ArchivePage";

export default function CalendarPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("calendar");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  const [currentMonth, setCurrentMonth] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedTask, setSelectedTask] = useState(null);

  useEffect(() => {
    if (user) loadMonth();
  }, [user, currentMonth.year, currentMonth.month]);

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

  const prevMonth = () =>
    setCurrentMonth((p) => (p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 }));
  const nextMonth = () =>
    setCurrentMonth((p) => (p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 }));

  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

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
          const hasHigh = dayTasks.some((t) => t.priority === "high" && !t.is_completed);
          const hasMedium = dayTasks.some((t) => t.priority === "medium" && !t.is_completed);
          const allDone = dayTasks.length > 0 && dayTasks.every((t) => t.is_completed);
          const dayOfWeek = new Date(currentMonth.year, currentMonth.month, day).getDay();

          return (
            <button
              key={day}
              onClick={() => setSelectedDate(dateStr)}
              style={{
                position: "relative",
                background: isSelected ? "var(--text-primary)" : isToday ? "#F0F4FF" : "transparent",
                border: "none",
                borderRadius: 12,
                padding: "8px 0 12px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                transition: "all 0.15s",
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: isToday || isSelected ? 700 : 400,
                  color: isSelected ? "#fff" : dayOfWeek === 0 ? "var(--red)" : dayOfWeek === 6 ? "var(--blue)" : "var(--text-primary)",
                }}
              >
                {day}
              </span>
              <div style={{ display: "flex", gap: 3, height: 6 }}>
                {hasHigh && <Dot color={isSelected ? "#FF6B6B" : "var(--red)"} />}
                {hasMedium && <Dot color={isSelected ? "#FFD93D" : "var(--orange)"} />}
                {allDone && <Dot color={isSelected ? "#6BCB77" : "var(--green)"} />}
                {dayTasks.length > 0 && !hasHigh && !hasMedium && !allDone && <Dot color={isSelected ? "#aaa" : "#CED4DA"} />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected date tasks */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
            {selectedDate === todayStr
              ? "📌 오늘"
              : `${new Date(selectedDate + "T00:00:00").getMonth() + 1}/${new Date(selectedDate + "T00:00:00").getDate()}일`}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-secondary)", background: "var(--border-light)", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>
            {selectedTasks.length}
          </span>
        </div>
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
