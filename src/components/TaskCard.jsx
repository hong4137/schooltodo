import { useState, useEffect } from "react";
import { fetchDocumentImages } from "../lib/tasks";
import { supabase } from "../lib/supabase";

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
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  const target = new Date(dateStr + "T00:00:00");
  const diff = Math.ceil((target - today) / 86400000);
  if (diff < 0) return { text: `D+${Math.abs(diff)}`, overdue: true };
  if (diff === 0) return { text: "오늘", overdue: false };
  if (diff === 1) return { text: "내일", overdue: false };
  return { text: `D-${diff}`, overdue: false };
}

export default function TaskCard({ task, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const [images, setImages] = useState([]);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const p = priorityConfig[task.priority] || priorityConfig.medium;
  const dday = getDday(task.due_date);
  const uploaderName =
    task.documents?.user_telegrams?.display_name ||
    task.uploaded_by_name ||
    null;

  // Load images when expanded
  useEffect(() => {
    if (expanded && !imagesLoaded && task.document_id) {
      loadImages();
    }
  }, [expanded]);

  async function loadImages() {
    try {
      const imgs = await fetchDocumentImages(task.document_id);
      if (imgs && imgs.length > 0) {
        // Get signed URLs for private bucket
        const withUrls = await Promise.all(
          imgs.map(async (img) => {
            if (img.storage_path) {
              const { data } = await supabase.storage
                .from("document-images")
                .createSignedUrl(img.storage_path, 3600); // 1hr
              return { ...img, url: data?.signedUrl };
            }
            return img;
          })
        );
        setImages(withUrls);
      }
    } catch (err) {
      console.error("Failed to load images:", err);
    }
    setImagesLoaded(true);
  }

  return (
    <>
      <div
        style={{
          background: task.is_completed ? "#F8F9FA" : "var(--surface)",
          borderRadius: 14,
          border: `1px solid ${task.is_completed ? "#E9ECEF" : "var(--border)"}`,
          boxShadow: task.is_completed ? "none" : "0 1px 3px rgba(0,0,0,0.04)",
          overflow: "hidden",
          transition: "all 0.2s",
        }}
      >
        {/* Header */}
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "14px 16px", cursor: "pointer",
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onToggle?.(task.id, task.is_completed); }}
            style={{
              width: 24, height: 24, minWidth: 24, borderRadius: 8,
              border: task.is_completed ? "none" : `2px solid ${p.color}`,
              background: task.is_completed ? "var(--text-disabled)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", marginTop: 2, transition: "all 0.2s",
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
              <span style={{
                fontSize: 15, fontWeight: 600,
                color: task.is_completed ? "var(--text-disabled)" : "var(--text-primary)",
                textDecoration: task.is_completed ? "line-through" : "none",
                lineHeight: 1.3,
              }}>
                {task.title}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {!task.is_completed && (
                <span style={{ fontSize: 11, fontWeight: 700, color: p.color, background: p.bg, padding: "2px 7px", borderRadius: 6 }}>{p.label}</span>
              )}
              <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--border-light)", padding: "2px 7px", borderRadius: 6 }}>
                {categoryLabels[task.category] || "기타"}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-disabled)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
            </div>
          </div>

          <div style={{ textAlign: "right", minWidth: 44 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: dday.overdue ? "var(--red)" : task.is_completed ? "var(--text-disabled)" : "var(--text-secondary)" }}>
              {dday.text}
            </span>
            <div style={{ fontSize: 11, color: "var(--text-disabled)", marginTop: 2 }}>{formatDate(task.due_date)}</div>
          </div>
        </div>

        {/* Accordion detail */}
        <div style={{
          maxHeight: expanded ? 600 : 0,
          opacity: expanded ? 1 : 0,
          overflow: "hidden",
          transition: "max-height 0.3s ease, opacity 0.2s ease",
        }}>
          <div style={{
            padding: "0 16px 14px 52px",
            borderTop: "1px solid var(--border-light)",
            paddingTop: 12,
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            {/* Description */}
            {task.description ? (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                {task.description}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "var(--text-disabled)", fontStyle: "italic" }}>
                상세 설명이 없어요
              </div>
            )}

            {/* Meta info */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
              <span>📅 {task.due_date}</span>
              {task.due_time && <span>⏰ {task.due_time.slice(0, 5)}</span>}
              {uploaderName && <span>📎 {uploaderName}</span>}
            </div>

            {/* Original document images */}
            {task.document_id && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>📄 원문 사진</div>
                {!imagesLoaded ? (
                  <div style={{ fontSize: 12, color: "var(--text-disabled)" }}>불러오는 중...</div>
                ) : images.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-disabled)" }}>사진이 없어요</div>
                ) : (
                  <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                    {images.map((img) => (
                      img.url ? (
                        <img
                          key={img.id}
                          src={img.url}
                          alt={`원문 ${img.page_order}`}
                          onClick={(e) => { e.stopPropagation(); setSelectedImage(img.url); }}
                          style={{
                            width: 80, height: 100, objectFit: "cover",
                            borderRadius: 8, border: "1px solid var(--border)",
                            cursor: "pointer", flexShrink: 0,
                          }}
                        />
                      ) : null
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full-screen image viewer */}
      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.9)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20, cursor: "zoom-out",
          }}
        >
          <img
            src={selectedImage}
            alt="원문"
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }}
          />
          <div style={{
            position: "absolute", top: 20, right: 20,
            color: "#fff", fontSize: 24, cursor: "pointer",
            background: "rgba(0,0,0,0.5)", borderRadius: "50%",
            width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</div>
        </div>
      )}
    </>
  );
}

export { priorityConfig, categoryLabels };
