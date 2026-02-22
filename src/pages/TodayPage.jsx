import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../lib/auth";
import { fetchTasks, toggleTask } from "../lib/tasks";
import TaskCard, { getDday } from "../components/TaskCard";
import TaskDetail from "../components/TaskDetail";

export default function TodayPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);

  useEffect(() => {
    if (user) loadTasks();
  }, [user]);

  async function loadTasks() {
    try {
      const data = await fetchTasks(user.id);
      setTasks(data || []);
    } catch (err) {
      console.error("Failed to load tasks:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(taskId, isCompleted) {
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, is_completed: !t.is_completed } : t
      )
    );
    try {
      await toggleTask(taskId, isCompleted);
    } catch {
      // Revert on error
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, is_completed: isCompleted } : t
        )
      );
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  const todayTasks = useMemo(
    () => tasks.filter((t) => t.due_date === todayStr),
    [tasks, todayStr]
  );

  const overdueTasks = useMemo(
    () => tasks.filter((t) => t.due_date < todayStr && !t.is_completed),
    [tasks, todayStr]
  );

  // This week (Mon-Sun)
  const weekTasks = useMemo(() => {
    const d = new Date(today);
    const day = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const monStr = mon.toISOString().slice(0, 10);
    const sunStr = sun.toISOString().slice(0, 10);
    return tasks.filter(
      (t) => t.due_date >= monStr && t.due_date <= sunStr && t.due_date !== todayStr
    );
  }, [tasks, todayStr]);

  const completedToday = todayTasks.filter((t) => t.is_completed).length;
  const totalToday = todayTasks.length;
  const pct = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>로딩 중...</span>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div style={{ padding: "0 16px 100px" }}>
        <Header todayStr={todayStr} />
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>아직 할 일이 없어요</h3>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
            텔레그램 봇으로 알림장 사진을 보내면<br />
            AI가 자동으로 할 일을 추출해요!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 100px" }}>
      <Header todayStr={todayStr} />

      {/* Progress */}
      <div style={{ background: "linear-gradient(135deg, #1A1A2E 0%, #2D2B55 100%)", borderRadius: 16, padding: "18px 20px", marginBottom: 20, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 14, opacity: 0.8 }}>오늘 진행률</span>
          <span style={{ fontSize: 28, fontWeight: 800 }}>{pct}%</span>
        </div>
        <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 6, height: 8, overflow: "hidden" }}>
          <div style={{ background: "var(--teal)", height: "100%", borderRadius: 6, width: `${pct}%`, transition: "width 0.5s ease" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          <span>{completedToday}/{totalToday} 완료</span>
          <span>미완료 {tasks.filter((t) => !t.is_completed).length}개</span>
        </div>
      </div>

      {/* Overdue */}
      {overdueTasks.length > 0 && (
        <Section icon="⚠️" title="지난 할 일" count={overdueTasks.length} titleColor="var(--red)">
          {overdueTasks.map((t) => (
            <TaskCard key={t.id} task={t} onToggle={handleToggle} onSelect={setSelectedTask} />
          ))}
        </Section>
      )}

      {/* Today */}
      <Section icon="📌" title="오늘 마감" count={todayTasks.length}>
        {todayTasks
          .sort((a, b) => a.is_completed - b.is_completed || (a.due_time || "99:99").localeCompare(b.due_time || "99:99"))
          .map((t) => (
            <TaskCard key={t.id} task={t} onToggle={handleToggle} onSelect={setSelectedTask} />
          ))}
        {todayTasks.length === 0 && (
          <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-disabled)", fontSize: 14 }}>
            오늘 마감인 할 일이 없어요 🎉
          </div>
        )}
      </Section>

      {/* This week */}
      {weekTasks.length > 0 && (
        <Section icon="📅" title="이번 주" count={weekTasks.length}>
          {weekTasks
            .sort((a, b) => a.due_date.localeCompare(b.due_date))
            .map((t) => (
              <TaskCard key={t.id} task={t} onToggle={handleToggle} onSelect={setSelectedTask} />
            ))}
        </Section>
      )}

      {selectedTask && (
        <TaskDetail task={selectedTask} onClose={() => setSelectedTask(null)} onToggle={handleToggle} />
      )}
    </div>
  );
}

function Header({ todayStr }) {
  const d = new Date(todayStr + "T00:00:00");
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const label = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${dayNames[d.getDay()]}요일`;
  return (
    <div style={{ padding: "20px 0 16px" }}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.5 }}>오늘의 할 일</h1>
    </div>
  );
}

function Section({ icon, title, count, titleColor, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: titleColor || "var(--text-primary)" }}>
          {icon} {title}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)", background: "var(--border-light)", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>
          {count}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}
