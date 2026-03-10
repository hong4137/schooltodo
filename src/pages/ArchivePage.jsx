import { useState, useEffect, useRef } from "react";
import { useAuth } from "../lib/auth";
import { fetchPosts, createPost, updatePost, deletePost, togglePin, uploadFile, deleteFile, getFileUrl } from "../lib/archive";

export default function ArchivePage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showWrite, setShowWrite] = useState(false);
  const [viewPost, setViewPost] = useState(null);
  const [editPost, setEditPost] = useState(null);

  useEffect(() => { if (user) load(); }, [user]);

  async function load() {
    try { setPosts(await fetchPosts(user.id)); }
    catch (err) { console.error("Load archive:", err); }
    setLoading(false);
  }

  async function handleCreate(title, content, files) {
    try {
      const post = await createPost(user.id, title, content);
      for (const file of files) {
        await uploadFile(user.id, post.id, file);
      }
      await load();
    } catch (err) { console.error("Create post:", err); alert("저장 실패"); }
    setShowWrite(false);
  }

  async function handleUpdate(id, title, content, newFiles) {
    try {
      await updatePost(id, { title, content });
      for (const file of newFiles) {
        await uploadFile(user.id, id, file);
      }
      await load();
    } catch (err) { console.error("Update post:", err); alert("수정 실패"); }
    setEditPost(null);
    setViewPost(null);
  }

  async function handleDelete(id) {
    if (!confirm("이 글을 삭제할까요?")) return;
    try { await deletePost(id); await load(); }
    catch (err) { console.error("Delete:", err); }
    setViewPost(null);
  }

  async function handlePin(id, pinned) {
    try {
      await togglePin(id, pinned);
      await load();
    } catch (err) { console.error("Pin:", err); }
  }

  async function handleDeleteFile(fileId, storagePath) {
    try { await deleteFile(fileId, storagePath); await load(); }
    catch (err) { console.error("Delete file:", err); }
  }

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 14 }}>로딩 중...</span>
    </div>
  );

  // Detail view
  if (viewPost) {
    const post = posts.find((p) => p.id === viewPost);
    if (!post) { setViewPost(null); return null; }
    return (
      <PostDetail
        post={post}
        onBack={() => setViewPost(null)}
        onEdit={() => setEditPost(post)}
        onDelete={() => handleDelete(post.id)}
        onPin={() => handlePin(post.id, post.pinned)}
        onDeleteFile={handleDeleteFile}
      />
    );
  }

  // Edit view
  if (editPost) {
    return (
      <WriteSheet
        post={editPost}
        onClose={() => setEditPost(null)}
        onSave={(title, content, files) => handleUpdate(editPost.id, title, content, files)}
      />
    );
  }

  // Write view
  if (showWrite) {
    return <WriteSheet onClose={() => setShowWrite(false)} onSave={handleCreate} />;
  }

  // List view
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 16px 12px" }}>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{posts.length}개의 공지</span>
        <button onClick={() => setShowWrite(true)} style={{
          padding: "8px 16px", fontSize: 13, fontWeight: 600, color: "#fff",
          background: "#1A1A2E", border: "none", borderRadius: 10, cursor: "pointer",
        }}>+ 새 글</button>
      </div>

      {posts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "50px 16px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" }}>보관함이 비어있어요</h3>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>학교 공지사항 중 나중에 필요한 것들을<br />사진이나 파일과 함께 저장해두세요</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 16px" }}>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onClick={() => setViewPost(post.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════
// Post card (list item)
// ══════════════════════════════
function PostCard({ post, onClick }) {
  const fileCount = post.archive_files?.length || 0;
  const hasImages = post.archive_files?.some((f) => f.mime_type?.startsWith("image/"));
  const d = new Date(post.created_at);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;

  return (
    <div onClick={onClick} style={{
      padding: "14px 16px", background: "var(--surface)", borderRadius: 12,
      border: `1px solid ${post.pinned ? "#FFD9A0" : "var(--border)"}`,
      cursor: "pointer", transition: "transform 0.1s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        {post.pinned && <span style={{ fontSize: 12 }}>📌</span>}
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {post.title}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-disabled)", flexShrink: 0 }}>{dateStr}</span>
      </div>
      {(post.content || fileCount > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          {post.content && (
            <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {post.content.slice(0, 60)}
            </span>
          )}
          {fileCount > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-disabled)", flexShrink: 0 }}>
              {hasImages ? "🖼" : "📎"} {fileCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════
// Post detail
// ══════════════════════════════
function PostDetail({ post, onBack, onEdit, onDelete, onPin, onDeleteFile }) {
  const d = new Date(post.created_at);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = `${kst.getUTCFullYear()}.${kst.getUTCMonth() + 1}.${kst.getUTCDate()}`;
  const files = post.archive_files || [];

  return (
    <div style={{ padding: "0 16px" }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 14, color: "var(--text-muted)", cursor: "pointer", padding: "4px 0" }}>← 목록</button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onPin} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4 }}>{post.pinned ? "📌" : "📍"}</button>
          <button onClick={onEdit} style={{ background: "none", border: "none", fontSize: 14, color: "var(--text-secondary)", cursor: "pointer" }}>수정</button>
          <button onClick={onDelete} style={{ background: "none", border: "none", fontSize: 14, color: "var(--red)", cursor: "pointer" }}>삭제</button>
        </div>
      </div>

      {/* Title */}
      <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", margin: "0 0 6px" }}>{post.title}</h2>
      <div style={{ fontSize: 12, color: "var(--text-disabled)", marginBottom: 16 }}>{dateStr}</div>

      {/* Content */}
      {post.content && (
        <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 20, whiteSpace: "pre-wrap" }}>{post.content}</p>
      )}

      {/* Files */}
      {files.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>첨부파일 ({files.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {files.map((f) => (
              <FileItem key={f.id} file={f} onDelete={() => onDeleteFile(f.id, f.storage_path)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════
// File item
// ══════════════════════════════
function FileItem({ file, onDelete }) {
  const isImage = file.mime_type?.startsWith("image/");
  const url = getFileUrl(file.storage_path);
  const sizeStr = file.file_size > 1024 * 1024
    ? `${(file.file_size / 1024 / 1024).toFixed(1)}MB`
    : `${Math.round(file.file_size / 1024)}KB`;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
      overflow: "hidden",
    }}>
      {isImage && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={file.file_name} style={{ width: "100%", maxHeight: 300, objectFit: "cover", display: "block" }} />
        </a>
      )}
      <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{isImage ? "🖼" : "📎"}</span>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.file_name}
          </a>
          <span style={{ fontSize: 11, color: "var(--text-disabled)" }}>{sizeStr}</span>
        </div>
        <button onClick={onDelete} style={{ background: "none", border: "none", fontSize: 12, color: "var(--text-disabled)", cursor: "pointer", padding: 4 }}>✕</button>
      </div>
    </div>
  );
}

// ══════════════════════════════
// Write / Edit sheet
// ══════════════════════════════
function WriteSheet({ post, onClose, onSave }) {
  const isEdit = !!post;
  const [title, setTitle] = useState(post?.title || "");
  const [content, setContent] = useState(post?.content || "");
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  function handleFiles(e) {
    const selected = Array.from(e.target.files);
    setFiles((prev) => [...prev, ...selected]);
  }

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    if (!title.trim()) return;
    setSaving(true);
    await onSave(title.trim(), content.trim(), files);
    setSaving(false);
  }

  const inputStyle = {
    width: "100%", padding: "10px 12px", fontSize: 14,
    border: "1px solid var(--border)", borderRadius: 10,
    fontFamily: "inherit", color: "var(--text-primary)", background: "var(--surface)",
  };

  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0" }}>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 14, color: "var(--text-muted)", cursor: "pointer" }}>← 취소</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{isEdit ? "수정" : "새 글"}</span>
        <div style={{ width: 40 }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" style={{ ...inputStyle, fontSize: 16, fontWeight: 600 }} />

        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="메모 (선택)" rows={4}
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />

        {/* File attach */}
        <div>
          <button onClick={() => fileInputRef.current?.click()} style={{
            width: "100%", padding: 12, background: "var(--bg)", border: "1px dashed #CED4DA",
            borderRadius: 10, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer",
          }}>📎 파일 첨부 (사진, 문서)</button>
          <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.hwp,.xlsx" onChange={handleFiles} style={{ display: "none" }} />
        </div>

        {/* File previews */}
        {files.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
                <span style={{ fontSize: 14 }}>{f.type.startsWith("image/") ? "🖼" : "📎"}</span>
                <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <span style={{ fontSize: 11, color: "var(--text-disabled)" }}>{(f.size / 1024).toFixed(0)}KB</span>
                <button onClick={() => removeFile(i)} style={{ background: "none", border: "none", fontSize: 12, color: "var(--text-disabled)", cursor: "pointer" }}>✕</button>
              </div>
            ))}
          </div>
        )}

        <button onClick={handleSubmit} disabled={!title.trim() || saving} style={{
          width: "100%", padding: "14px 0", fontSize: 15, fontWeight: 700, color: "#fff",
          background: !title.trim() || saving ? "#CCC" : "linear-gradient(135deg, #1A1A2E, #2D2B55)",
          border: "none", borderRadius: 14, cursor: !title.trim() || saving ? "default" : "pointer",
        }}>{saving ? "저장 중..." : isEdit ? "수정 완료" : "저장"}</button>
      </div>
    </div>
  );
}
