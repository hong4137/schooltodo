const priorityConfig = {
  high: { label: "긴급", color: "var(--red)", bg: "var(--red-bg)" },
  medium: { label: "보통", color: "var(--orange)", bg: "var(--orange-bg)" },
  low: { label: "여유", color: "var(--green)", bg: "var(--green-bg)" },
};

const categoryLabels = {
  submission: "제출",
  preparation: "준비물",
  attendance: "참석",
  payment: "납부",
  other: "기타",
};

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function getDday(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  const diff = Math.ceil((target - today) / 86400000);
  if (diff < 0) return { text: `D+${Math.abs(diff)}`, overdue: true };
  if (diff === 0) return { text: "오늘", overdue: false };
  if (diff === 1) return { text: "내일", overdue: false };
  return { text: `D-${diff}`, overdue: false };
}

export default function TaskCard({ task, onToggle, onSelect }) {
  const p = priorityConfig[task.priority] || priorityConfig.medium;
  const dday = getDday(task.due_date);
  const uploaderName =
    task.documents?.user_telegrams?.display_name ||
    task.uploaded_by_name ||
    null;

  return (
    <div
      onClick={() => onSelect?.(task)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "14px 16px",
        background: task.is_completed ? "#F8F9FA" : "var(--surface)",
        borderRadius: 14,
        border: `1px solid ${task.is_completed ? "#E9ECEF" : "var(--border)"}`,
        cursor: "pointer",
        transition: "all 0.2s",
        boxShadow: task.is_completed ? "none" : "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.(task.id, task.is_completed);
        }}
        style={{
          width: 24,
          height: 24,
          minWidth: 24,
          borderRadius: 8,
          border: task.is_completed ? "none" : `2px solid ${p.color}`,
          background: task.is_completed ? "var(--text-disabled)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          marginTop: 2,
          transition: "all 0.2s",
        }}
      >
        {task.is_completed && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: task.is_completed ? "var(--text-disabled)" : "var(--text-primary)",
              textDecoration: task.is_completed ? "line-through" : "none",
              lineHeight: 1.3,
            }}
          >
            {task.title}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {!task.is_completed && (
            <span style={{ fontSize: 11, fontWeight: 700, color: p.color, background: p.bg, padding: "2px 7px", borderRadius: 6 }}>
              {p.label}
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--border-light)", padding: "2px 7px", borderRadius: 6 }}>
            {categoryLabels[task.category] || "기타"}
          </span>
          {task.due_time && (
            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>⏰ {task.due_time?.slice(0, 5)}</span>
          )}
          {uploaderName && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>📎 {uploaderName}</span>
          )}
        </div>
      </div>

      <div style={{ textAlign: "right", minWidth: 44 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: dday.overdue ? "var(--red)" : task.is_completed ? "var(--text-disabled)" : "var(--text-secondary)" }}>
          {dday.text}
        </span>
        <div style={{ fontSize: 11, color: "var(--text-disabled)", marginTop: 2 }}>
          {formatDate(task.due_date)}
        </div>
      </div>
    </div>
  );
}

export { priorityConfig, categoryLabels };
