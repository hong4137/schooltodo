import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../lib/auth";
import { fetchTasks, toggleTask } from "../lib/tasks";
import TaskCard, { getDday } from "../components/TaskCard";

const FILTERS = [
  { id: "today", label: "오늘" },
  { id: "tomorrow", label: "내일" },
  { id: "thisWeek", label: "이번 주" },
  { id: "nextWeek", label: "다음 주" },
  { id: "all", label: "전체" },
];

function getKSTToday() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  return { year: y, month: m, date: d };
}

function kstDateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function getDateRanges() {
  const { year, month, date } = getKSTToday();
  const todayStr = kstDateStr(year, month, date);
  
  const today = new Date(year, month, date);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowStr = kstDateStr(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
  
  const day = today.getDay();
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  const thisSunday = new Date(thisMonday);
  thisSunday.setDate(thisMonday.getDate() + 6);
  const nextMonday = new Date(thisSunday);
  nextMonday.setDate(thisSunday.getDate() + 1);
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  return {
    todayStr, tomorrowStr,
    thisWeekStart: kstDateStr(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate()),
    thisWeekEnd: kstDateStr(thisSunday.getFullYear(), thisSunday.getMonth(), thisSunday.getDate()),
    nextWeekStart: kstDateStr(nextMonday.getFullYear(), nextMonday.getMonth(), nextMonday.getDate()),
    nextWeekEnd: kstDateStr(nextSunday.getFullYear(), nextSunday.getMonth(), nextSunday.getDate()),
  };
}

export default function TodayPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => { if (user) loadTasks(); }, [user]);

  async function loadTasks() {
    try {
      const data = await fetchTasks(user.id);
      setTasks(data || []);
    } catch (err) { console.error("Failed to load tasks:", err); }
    finally { setLoading(false); }
  }

  async function handleToggle(taskId, isCompleted) {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, is_completed: !t.is_completed } : t));
    try { await toggleTask(taskId, isCompleted); }
    catch { setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, is_completed: isCompleted } : t)); }
  }

  const ranges = getDateRanges();

  // Today counts for summary card
  const todayAll = useMemo(() => tasks.filter((t) => t.due_date === ranges.todayStr), [tasks, ranges.todayStr]);
  const todayRemaining = todayAll.filter((t) => !t.is_completed).length;
  const todayCompleted = todayAll.filter((t) => t.is_completed).length;

  const overdueTasks = useMemo(() => tasks.filter((t) => t.due_date < ranges.todayStr && !t.is_completed), [tasks, ranges.todayStr]);

  const getFilteredCount = (filterId) => {
    const incomplete = tasks.filter((t) => !t.is_completed);
    switch (filterId) {
      case "today": return incomplete.filter((t) => t.due_date === ranges.todayStr).length;
      case "tomorrow": return incomplete.filter((t) => t.due_date === ranges.tomorrowStr).length;
      case "thisWeek": return incomplete.filter((t) => t.due_date >= ranges.thisWeekStart && t.due_date <= ranges.thisWeekEnd).length;
      case "nextWeek": return incomplete.filter((t) => t.due_date >= ranges.nextWeekStart && t.due_date <= ranges.nextWeekEnd).length;
      case "all": default: return incomplete.filter((t) => t.due_date >= ranges.todayStr).length;
    }
  };

  const filteredTasks = useMemo(() => {
    const incomplete = tasks.filter((t) => !t.is_completed);
    switch (filter) {
      case "today": return incomplete.filter((t) => t.due_date === ranges.todayStr);
      case "tomorrow": return incomplete.filter((t) => t.due_date === ranges.tomorrowStr);
      case "thisWeek": return incomplete.filter((t) => t.due_date >= ranges.thisWeekStart && t.due_date <= ranges.thisWeekEnd);
      case "nextWeek": return incomplete.filter((t) => t.due_date >= ranges.nextWeekStart && t.due_date <= ranges.nextWeekEnd);
      case "all": default: return incomplete.filter((t) => t.due_date >= ranges.todayStr);
    }
  }, [tasks, filter, ranges]);

  const activeFilter = FILTERS.find((f) => f.id === filter);

  const groupedTasks = useMemo(() => {
    const groups = {};
    filteredTasks
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.due_time || "99:99").localeCompare(b.due_time || "99:99"))
      .forEach((t) => { if (!groups[t.due_date]) groups[t.due_date] = []; groups[t.due_date].push(t); });
    return groups;
  }, [filteredTasks]);

  function formatGroupDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00+09:00");
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    const dday = getDday(dateStr);
    if (dateStr === ranges.todayStr) return `오늘 (${d.getMonth() + 1}/${d.getDate()} ${dayNames[d.getDay()]})`;
    if (dateStr === ranges.tomorrowStr) return `내일 (${d.getMonth() + 1}/${d.getDate()} ${dayNames[d.getDay()]})`;
    return `${d.getMonth() + 1}/${d.getDate()} ${dayNames[d.getDay()]} · ${dday.text}`;
  }

  if (loading) return (<div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}><span style={{ color: "var(--text-muted)", fontSize: 14 }}>로딩 중...</span></div>);

  if (tasks.length === 0) return (
    <div style={{ padding: "0 16px 100px" }}>
      <Header todayStr={ranges.todayStr} />
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>아직 할 일이 없어요</h3>
        <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>텔레그램 봇으로 알림장 사진을 보내면<br />AI가 자동으로 할 일을 추출해요!</p>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "0 16px 100px" }}>
      <Header todayStr={ranges.todayStr} />

      {/* Summary - 오늘 기준 */}
      <div style={{ background: "linear-gradient(135deg, #1A1A2E 0%, #2D2B55 100%)", borderRadius: 16, padding: "18px 20px", marginBottom: 20, color: "#fff" }}>
        <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>오늘의 할 일</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><span style={{ fontSize: 14, opacity: 0.8 }}>남은 일</span><span style={{ fontSize: 28, fontWeight: 800, marginLeft: 10 }}>{todayRemaining}개</span></div>
          <div style={{ textAlign: "right" }}><span style={{ fontSize: 14, opacity: 0.8 }}>완료</span><span style={{ fontSize: 20, fontWeight: 700, marginLeft: 8, color: "#4ECDC4" }}>{todayCompleted}개</span></div>
        </div>
        {overdueTasks.length > 0 && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(231,76,60,0.2)", borderRadius: 10, fontSize: 13, color: "#FF6B6B" }}>⚠️ 지난 할 일 {overdueTasks.length}개가 있어요</div>
        )}
      </div>

      {/* Filter dropdown */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <button onClick={() => setDropdownOpen(!dropdownOpen)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 15, fontWeight: 700, color: "var(--text-primary)", cursor: "pointer", width: "100%", justifyContent: "space-between" }}>
          <span>📋 {activeFilter.label} ({filteredTasks.length}개)</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", transform: dropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
        </button>
        {dropdownOpen && (
          <>
            <div onClick={() => setDropdownOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.1)", zIndex: 31, overflow: "hidden" }}>
              {FILTERS.map((f) => (
                <button key={f.id} onClick={() => { setFilter(f.id); setDropdownOpen(false); }} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "12px 16px", background: filter === f.id ? "var(--border-light)" : "transparent", border: "none", fontSize: 14, fontWeight: filter === f.id ? 700 : 400, color: "var(--text-primary)", cursor: "pointer", borderBottom: "1px solid var(--border-light)" }}>
                  <span>{f.label}</span>
                  <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>{getFilteredCount(f.id)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Overdue */}
      {overdueTasks.length > 0 && filter === "all" && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--red)" }}>⚠️ 지난 할 일</span>
            <span style={{ fontSize: 12, color: "var(--red)", background: "var(--red-bg)", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>{overdueTasks.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {overdueTasks.map((t) => (<TaskCard key={t.id} task={t} onToggle={handleToggle} onUpdate={loadTasks} />))}
          </div>
        </div>
      )}

      {/* Tasks grouped by date */}
      {Object.keys(groupedTasks).length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-disabled)", fontSize: 14 }}>{activeFilter.label}에 해당하는 할 일이 없어요</div>
      ) : (
        Object.entries(groupedTasks).map(([dateStr, dateTasks]) => (
          <div key={dateStr} style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: dateStr === ranges.todayStr ? "var(--red)" : "var(--text-primary)" }}>
                {dateStr === ranges.todayStr ? "📌" : "📅"} {formatGroupDate(dateStr)}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-secondary)", background: "var(--border-light)", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>{dateTasks.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {dateTasks.map((t) => (<TaskCard key={t.id} task={t} onToggle={handleToggle} onUpdate={loadTasks} />))}
            </div>
          </div>
        ))
      )}

      {/* Completed tasks section */}
      <CompletedSection tasks={tasks} ranges={ranges} onToggle={handleToggle} onUpdate={loadTasks} />
    </div>
  );
}

function CompletedSection({ tasks, ranges, onToggle, onUpdate }) {
  const [open, setOpen] = useState(false);
  const completed = useMemo(() =>
    tasks.filter((t) => t.is_completed).sort((a, b) => b.due_date.localeCompare(a.due_date)),
    [tasks]
  );

  if (completed.length === 0) return null;

  return (
    <div style={{ marginTop: 8, borderTop: "1px solid var(--border-light)", paddingTop: 12 }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", padding: "10px 0", background: "none", border: "none",
        cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--text-muted)",
      }}>
        <span>✅ 완료된 항목 ({completed.length}개)</span>
        <span style={{ fontSize: 12, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </button>
      <div style={{
        maxHeight: open ? completed.length * 120 : 0,
        opacity: open ? 1 : 0,
        overflow: "hidden",
        transition: "max-height 0.3s ease, opacity 0.2s ease",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}>
          {completed.map((t) => (<TaskCard key={t.id} task={t} onToggle={onToggle} onUpdate={onUpdate} />))}
        </div>
      </div>
    </div>
  );
}

function Header({ todayStr }) {
  const d = new Date(todayStr + "T00:00:00+09:00");
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const label = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${dayNames[d.getDay()]}요일`;
  return (
    <div style={{ padding: "20px 0 16px" }}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.5 }}>할 일</h1>
    </div>
  );
}
