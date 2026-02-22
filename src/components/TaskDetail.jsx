import { priorityConfig, categoryLabels, formatDate } from "./TaskCard";

export default function TaskDetail({ task, onClose, onToggle }) {
  if (!task) return null;
  const p = priorityConfig[task.priority] || priorityConfig.medium;
  const uploaderName =
    task.documents?.user_telegrams?.display_name ||
    task.uploaded_by_name ||
    "";
  const docTitle = task.documents?.title || task.document_title || "";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          borderRadius: "20px 20px 0 0",
          width: "100%",
          maxWidth: "var(--max-width)",
          maxHeight: "85vh",
          overflow: "auto",
          padding: "20px 20px 32px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: p.color, background: p.bg, padding: "3px 10px", borderRadius: 8 }}>
            {p.label}
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-muted)", padding: 4 }}
          >
            ✕
          </button>
        </div>

        {/* Title */}
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px", lineHeight: 1.3 }}>
          {task.title}
        </h2>

        {/* Description */}
        {task.description && (
          <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 20px" }}>
            {task.description}
          </p>
        )}

        {/* Info table */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, background: "var(--bg)", borderRadius: 12, marginBottom: 20 }}>
          <InfoRow label="마감일" value={`${task.due_date}${task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}`} />
          <InfoRow label="카테고리" value={categoryLabels[task.category] || "기타"} />
          {docTitle && <InfoRow label="문서" value={docTitle} />}
          {uploaderName && <InfoRow label="업로더" value={uploaderName} />}
          {task.memo && <InfoRow label="메모" value={task.memo} />}
        </div>

        {/* Action button */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => {
              onToggle?.(task.id, task.is_completed);
              onClose();
            }}
            style={{
              flex: 1,
              padding: "14px",
              borderRadius: 12,
              border: "none",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              background: task.is_completed ? "var(--border-light)" : "var(--text-primary)",
              color: task.is_completed ? "var(--text-secondary)" : "#fff",
            }}
          >
            {task.is_completed ? "미완료로 변경" : "완료 처리"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{value}</span>
    </div>
  );
}
