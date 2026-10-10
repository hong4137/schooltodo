// ═══════════════════════════════════════════════════════════════
// 봇 v2-2 — 알림장 사진 → 초안(draft) → 확인·수정 → 저장
//   사진은 index.js 가 upload_sessions 에 모은다. "완료"(또는 사진과 함께 온 말)에 processSessionV2 가
//   Claude Vision 으로 초안을 뽑아 upload_sessions.draft 에 두고, 번호 목록 + [✅ 저장][❌ 취소] 버튼을 보낸다.
//   고치는 말("2번은 금요일로")은 assistant.js 가 set_draft_tasks 도구로 처리하고, 저장은 saveDraft().
// ═══════════════════════════════════════════════════════════════
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5-5";
const PRIORITY_EMOJI = { high: "🔴", medium: "🟡", low: "🟢" };
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

export const DRAFT_TASK_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "20자 이내, 학부모가 할 일" },
    due_date: { type: "string", description: "YYYY-MM-DD" },
    due_time: { type: ["string", "null"], description: "HH:MM 또는 null" },
    priority: { type: "string", enum: ["high", "medium", "low"] },
    category: { type: "string", enum: ["submission", "preparation", "attendance", "payment", "other"] },
    description: { type: "string", description: "사진에서 읽은 구체 정보(장소·시간·준비물·금액·주의). 없으면 빈 문자열" },
  },
  required: ["title", "due_date", "due_time", "priority", "category", "description"],
  additionalProperties: false,
};

// 사진에서 읽은 "그날만" 시간표 변경 (휴강, 시간 변경, 일회성 행사)
export const DRAFT_CHANGE_SCHEMA = {
  type: "object",
  properties: {
    start: { type: "string", description: "YYYY-MM-DD" },
    end: { type: "string", description: "YYYY-MM-DD (하루면 start 와 같게)" },
    kind: { type: "string", enum: ["block", "pickup", "alert", "oneoff"], description: "block=수업(방과후·늘봄·학원), pickup=픽업, alert=하원·이동 알림, oneoff=그날만 있는 일정" },
    target_name: { type: ["string", "null"], description: "대상 수업·알림 이름. 문서에 적힌 이름 그대로(예: 방과후, 늘봄). pickup 이면 null. oneoff 면 새 일정 이름" },
    action: { type: "string", enum: ["skip", "move", "add"] },
    new_start: { type: ["string", "null"], description: "move/add: HH:MM" },
    new_end: { type: ["string", "null"], description: "add: HH:MM" },
    reason: { type: "string", description: "예: 운동회로 휴강" },
  },
  required: ["start", "end", "kind", "target_name", "action", "new_start", "new_end", "reason"],
  additionalProperties: false,
};

const SUBMIT_DRAFT_TOOL = {
  name: "submit_draft",
  description: "사진에서 뽑은 결과를 제출한다. 반드시 이 도구로만 답한다.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      document_title: { type: "string", description: "문서 제목 (예: 10월 현장학습 안내)" },
      document_type: { type: "string", enum: ["notice", "letter", "schedule", "receipt", "other"] },
      summary: { type: "string", description: "한두 문장 요약" },
      tasks: { type: "array", items: DRAFT_TASK_SCHEMA },
      schedule_changes: { type: "array", items: DRAFT_CHANGE_SCHEMA, description: "문서가 특정 날짜의 수업 휴강·시간 변경·일회성 행사를 알리면 여기에. 없으면 빈 배열" },
      key_facts: { type: "array", items: { type: "string" }, description: "사진의 핵심 사실(날짜·기간·항목·장소·금액·연락처)을 한 줄씩. 할 일이 없어도 반드시 채운다. 나중에 사용자가 '그거 넣어줘'라고 할 때 쓴다" },
      unclear: { type: "array", items: { type: "string" }, description: "확실히 못 읽은 것이나 부모에게 확인할 질문(예: 지난 마감을 넣을지). 없으면 빈 배열" },
    },
    required: ["document_title", "document_type", "summary", "tasks", "schedule_changes", "key_facts", "unclear"],
    additionalProperties: false,
  },
};

function visionSystemPrompt(todayStr) {
  const d = new Date(todayStr + "T00:00:00Z");
  return `한국 초등학교 알림장·가정통신문·공문 사진에서 학부모가 해야 할 일을 뽑는다.
오늘: ${todayStr} (${DAY_NAMES[d.getUTCDay()]}요일). 날짜는 오늘 기준으로 YYYY-MM-DD 로. 연도가 없으면 가장 가까운 미래로.

뽑을 것: 제출물, 준비물, 참석 일정, 납부, 신청·접수 기간.
- 기간이 있는 항목(신청기간, 접수기간 등)은 "○○ 신청 시작"(시작일, medium)과 "○○ 신청 마감"(마감일, high) 두 개로.
- priority: 마감 임박·필수 high, 보통 medium, 선택 low.
- description 에는 사진에서 읽은 장소·시간·층·준비물 목록·금액·연락처·주의사항을 구체적으로. 지어내지 않는다.
- 화면 캡처면 앱 UI 요소는 무시.
- 날짜나 내용이 흐릿해 확신이 없으면 unclear 에 질문으로 적는다. (예: "제출 마감이 14일인지 16일인지 흐릿함")
- 마감·날짜가 이미 지난 항목은 네가 빼지 말고 tasks 에 그대로 넣되, unclear 에 "○○(10/8)은 이미 지났는데 넣을까요?" 라고 적는다. 뺄지는 부모가 정한다.
- key_facts 에는 할 일 여부와 상관없이 사진에서 읽은 날짜·기간·항목·장소·금액을 한 줄씩 적는다. (예: "방과후 신청 기간 10/2~10/8", "배드민턴 1~6학년 월·수")
- 특정 날짜에 수업이 쉬거나(휴강·운동회·현장학습으로 방과후 없음) 시간이 바뀌거나 그날만 있는 행사(운동회, 공개수업)는 schedule_changes 에 넣는다. 이름은 문서에 적힌 대로. 이것도 할 일(안내)과 별개로 적는다.
- 사용자가 사진과 함께 보낸 말이 있으면 그 말을 우선한다.

반드시 submit_draft 도구로만 답한다.`;
}

// ── 사진 분석 ─────────────────────────────────────────────────
async function downloadImages(env, deps, fileIds) {
  const out = [];
  for (const fileId of fileIds) {
    try {
      const url = await deps.getFileUrl(env.TELEGRAM_BOT_TOKEN, fileId);
      if (!url) continue;
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      out.push({ fileId, buf, base64: arrayBufferToBase64(buf) });
    } catch (err) {
      console.error("image download error:", err);
    }
  }
  return out;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function analyzePhotos(env, deps, { images, hint, todayStr }) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  const content = images.map((im) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: im.base64 } }));
  content.push({
    type: "text",
    text: hint
      ? `이 사진에서 학부모가 해야 할 일을 뽑아 submit_draft 로 제출해줘.\n사용자가 사진과 함께 한 말: "${hint}"`
      : "이 사진에서 학부모가 해야 할 일을 뽑아 submit_draft 로 제출해줘.",
  });
  const messages = [{ role: "user", content }];
  let usage = { input: 0, output: 0, cache_read: 0, calls: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: [{ type: "text", text: visionSystemPrompt(todayStr), cache_control: { type: "ephemeral" } }],
      tools: [SUBMIT_DRAFT_TOOL],
      messages,
    });
    usage.calls += 1;
    usage.input += (res.usage.input_tokens || 0) + (res.usage.cache_creation_input_tokens || 0) + (res.usage.cache_read_input_tokens || 0);
    usage.cache_read += res.usage.cache_read_input_tokens || 0;
    usage.output += res.usage.output_tokens || 0;

    if (res.stop_reason === "refusal") throw new Error("AI 가 이 사진 처리를 거절했어요");
    const tu = res.content.find((b) => b.type === "tool_use" && b.name === "submit_draft");
    if (tu) {
      const d = tu.input || {};
      return {
        draft: {
          document_title: d.document_title || "알림장",
          document_type: d.document_type || "notice",
          summary: d.summary || "",
          tasks: (d.tasks || []).map(normalizeTask).filter(Boolean),
          schedule_changes: (d.schedule_changes || []).map(normalizeChange).filter(Boolean),
          key_facts: Array.isArray(d.key_facts) ? d.key_facts.map((s) => String(s).slice(0, 120)).slice(0, 12) : [],
          unclear: Array.isArray(d.unclear) ? d.unclear.slice(0, 5) : [],
        },
        usage,
      };
    }
    // 도구를 안 쓰고 글로 답한 경우 한 번 더
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: "글 말고 submit_draft 도구로 제출해줘." });
  }
  throw new Error("AI 가 결과를 정해진 형식으로 주지 않았어요");
}

export function normalizeTask(t) {
  if (!t || !t.title) return null;
  const due = typeof t.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : null;
  if (!due) return null;
  return {
    title: String(t.title).slice(0, 200),
    due_date: due,
    due_time: typeof t.due_time === "string" && /^\d{2}:\d{2}/.test(t.due_time) ? t.due_time.slice(0, 5) : null,
    priority: ["high", "medium", "low"].includes(t.priority) ? t.priority : "medium",
    category: ["submission", "preparation", "attendance", "payment", "other"].includes(t.category) ? t.category : "other",
    description: t.description ? String(t.description).slice(0, 1000) : "",
  };
}

const isDateStr = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTimeStr = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d/.test(s);

export function normalizeChange(c) {
  if (!c || !isDateStr(c.start)) return null;
  const end = isDateStr(c.end) && c.end >= c.start ? c.end : c.start;
  const kind = ["block", "pickup", "alert", "oneoff"].includes(c.kind) ? c.kind : "block";
  const action = ["skip", "move", "add"].includes(c.action) ? c.action : "skip";
  const out = {
    start: c.start, end, kind,
    target_name: kind === "pickup" ? null : (c.target_name ? String(c.target_name).slice(0, 100) : null),
    action,
    new_start: isTimeStr(c.new_start) ? c.new_start.slice(0, 5) : null,
    new_end: isTimeStr(c.new_end) ? c.new_end.slice(0, 5) : null,
    reason: c.reason ? String(c.reason).slice(0, 100) : "",
  };
  if (out.action !== "skip" && !out.new_start) return null;
  if (out.action === "add" && (out.kind !== "oneoff" || !out.target_name)) return null;
  if (out.kind !== "pickup" && out.action !== "add" && !out.target_name) return null;
  return out;
}

export function describeChange(c) {
  const range = c.start === c.end ? fmtDate(c.start) : `${fmtDate(c.start)}~${fmtDate(c.end)}`;
  const what = c.kind === "pickup" ? "픽업" : c.target_name;
  const why = c.reason ? ` (${c.reason})` : "";
  if (c.action === "skip") return `${range} ${what} 쉼${why}`;
  if (c.action === "move") return `${range} ${what} → ${c.new_start}${c.new_end ? "~" + c.new_end : ""}${why}`;
  return `${range} ${what} ${c.new_start}${c.new_end ? "~" + c.new_end : ""}${why}`;
}

// ── 초안 표시 ─────────────────────────────────────────────────
function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DAY_NAMES[d.getUTCDay()]})`;
}

export function renderDraft(draft, esc) {
  let msg = `📋 <b>${esc(draft.document_title)}</b>\n`;
  if (draft.summary) msg += `<i>${esc(draft.summary)}</i>\n`;
  msg += "\n";
  if (!draft.tasks.length) {
    msg += (draft.schedule_changes && draft.schedule_changes.length) ? "할 일은 없고 시간표 변경만 있어요.\n" : "할 일을 찾지 못했어요.\n";
  }
  draft.tasks.forEach((t, i) => {
    msg += `${i + 1}. ${PRIORITY_EMOJI[t.priority] || "🟡"} <b>${esc(t.title)}</b> — ${fmtDate(t.due_date)}${t.due_time ? ` ${t.due_time}` : ""}\n`;
    if (t.description) {
      const desc = t.description.length > 70 ? t.description.slice(0, 70) + "…" : t.description;
      msg += `   ${esc(desc)}\n`;
    }
  });
  if (draft.schedule_changes && draft.schedule_changes.length) {
    msg += `\n📅 시간표 변경 제안\n` + draft.schedule_changes.map((c, i) => `${String.fromCharCode(0x2460 + i)} ${esc(describeChange(c))}`).join("\n") + `\n   저장하면 그날 알림·시간표에 반영돼요. 빼려면 "①은 빼줘".\n`;
  }
  if (draft.unclear && draft.unclear.length) {
    msg += `\n❓ 확인 필요\n` + draft.unclear.map((u) => `• ${esc(u)}`).join("\n") + "\n";
  }
  if (!draft.tasks.length && draft.key_facts && draft.key_facts.length) {
    msg += `\n읽은 내용\n` + draft.key_facts.map((f) => `• ${esc(f)}`).join("\n") + "\n";
  }
  msg += `\n맞으면 <b>✅ 저장</b>, 고칠 게 있으면 말씀해 주세요.\n(예: "2번은 금요일로", "3번 빼줘", "1번 제목은 체육복으로")`;
  return msg;
}

export function draftKeyboard(sessionId) {
  return {
    inline_keyboard: [[
      { text: "✅ 저장", callback_data: `draft:save:${sessionId}` },
      { text: "❌ 취소", callback_data: `draft:cancel:${sessionId}` },
    ]],
  };
}

// ── 세션 I/O ──────────────────────────────────────────────────
const q = (env, deps, path, opts) => deps.supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, path, opts);

export async function getDraftSession(env, deps, chatId) {
  // 하루 넘게 방치된 초안은 없는 것으로 친다
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = await q(env, deps, "upload_sessions", {
    query: `?chat_id=eq.${chatId}&status=eq.draft&created_at=gte.${since}&order=created_at.desc&limit=1`,
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function patchSession(env, deps, sessionId, body) {
  await q(env, deps, "upload_sessions", { method: "PATCH", body: { ...body, updated_at: new Date().toISOString() }, query: `?id=eq.${sessionId}` });
}

// 사진 모음 → 분석 → 초안 메시지
export async function processSessionV2(env, deps, { chatId, userTg, session, hint, esc }) {
  const todayStr = deps.getKSTDateString();
  const token = env.TELEGRAM_BOT_TOKEN;
  try {
    await patchSession(env, deps, session.id, { status: "processing", hint: hint || null });
    await deps.sendMessage(token, chatId, `🔍 ${session.photo_count}장 분석 중...`);
    await deps.tg(token, "sendChatAction", { chat_id: chatId, action: "typing" });

    const images = await downloadImages(env, deps, session.photo_file_ids || []);
    if (images.length === 0) {
      await deps.sendMessage(token, chatId, "❌ 사진을 불러올 수 없었어요. 다시 보내주세요.");
      await patchSession(env, deps, session.id, { status: "completed" });
      return;
    }

    const { draft, usage } = await analyzePhotos(env, deps, { images, hint, todayStr });
    console.log(`[Draft] chat=${chatId} photos=${images.length} tasks=${draft.tasks.length} in=${usage.input} out=${usage.output}`);
    if (deps.addUsage) await deps.addUsage(env, chatId, todayStr, usage);

    if (draft.tasks.length === 0 && draft.schedule_changes.length === 0) {
      // 할 일은 없지만 사진 맥락(key_facts)은 초안으로 남겨 둔다 → "그거라도 넣어줘" 가 이어진다
      let msg = `📋 <b>${esc(draft.document_title)}</b>\n`;
      if (draft.summary) msg += `<i>${esc(draft.summary)}</i>\n`;
      msg += "\n🤔 지금 해야 할 일은 못 찾았어요.";
      if (draft.key_facts.length) msg += "\n\n읽은 내용\n" + draft.key_facts.map((f) => `• ${esc(f)}`).join("\n");
      if (draft.unclear.length) msg += "\n\n❓ 확인 필요\n" + draft.unclear.map((u) => `• ${esc(u)}`).join("\n");
      msg += "\n\n넣고 싶은 게 있으면 말씀해 주세요. (예: \"신청 마감 넣어줘\", \"지난 일정이라도 넣어줘\")";
      const sent = await deps.tg(token, "sendMessage", {
        chat_id: chatId, text: msg, parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "❌ 닫기", callback_data: `draft:cancel:${session.id}` }]] },
      });
      const messageId = sent && sent.result ? sent.result.message_id : null;
      await patchSession(env, deps, session.id, { status: "draft", draft, draft_message_id: messageId });
      return;
    }

    const sent = await deps.tg(token, "sendMessage", {
      chat_id: chatId, text: renderDraft(draft, esc), parse_mode: "HTML", reply_markup: draftKeyboard(session.id),
    });
    const messageId = sent && sent.result ? sent.result.message_id : null;
    await patchSession(env, deps, session.id, { status: "draft", draft, draft_message_id: messageId });
  } catch (err) {
    console.error("processSessionV2 error:", err);
    await deps.sendMessage(token, chatId, `❌ 분석 중 오류가 났어요. <code>${esc(String((err && err.message) || err).slice(0, 150))}</code>\n다시 시도해 주세요.`);
    await patchSession(env, deps, session.id, { status: "completed" });
  }
}

// 초안 목록 교체 (assistant 의 set_draft_tasks 가 호출)
export async function updateDraft(env, deps, session, patch) {
  const draft = { ...(session.draft || {}), ...patch };
  draft.tasks = (draft.tasks || []).map(normalizeTask).filter(Boolean);
  draft.schedule_changes = (draft.schedule_changes || []).map(normalizeChange).filter(Boolean);
  await patchSession(env, deps, session.id, { draft });
  return draft;
}

// 저장: documents + document_images(스토리지 업로드) + tasks. 같은 날짜·비슷한 제목은 건너뛰고 알려준다.
export async function saveDraft(env, deps, { session, userTg }) {
  const draft = session.draft || { tasks: [] };
  const userId = session.user_id;
  const saved = [], duplicates = [];

  const docRows = await q(env, deps, "documents", {
    method: "POST",
    body: {
      user_id: userId, uploaded_by: session.telegram_id, title: draft.document_title || "알림장",
      document_type: draft.document_type || "notice", ai_summary: draft.summary || "", source: "telegram", status: "completed",
    },
  });
  const docId = Array.isArray(docRows) && docRows[0] ? docRows[0].id : null;

  // 사진 보관 (Telegram 에서 다시 받아 Storage 에)
  if (docId) {
    const images = await downloadImages(env, deps, session.photo_file_ids || []);
    for (let i = 0; i < (session.photo_file_ids || []).length; i++) {
      const im = images.find((x) => x.fileId === session.photo_file_ids[i]);
      let storagePath = null;
      if (im) {
        storagePath = `${userId}/${docId}/${i + 1}.jpg`;
        try {
          const up = await fetch(`${env.SUPABASE_URL}/storage/v1/object/document-images/${storagePath}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "image/jpeg" },
            body: im.buf,
          });
          if (!up.ok) { console.error("storage upload failed:", up.status); storagePath = null; }
        } catch (err) { console.error("storage upload error:", err); storagePath = null; }
      }
      await q(env, deps, "document_images", {
        method: "POST",
        body: { document_id: docId, telegram_file_id: session.photo_file_ids[i], storage_path: storagePath, page_order: i + 1 },
      });
    }
  }

  for (const t of draft.tasks || []) {
    let similar = [];
    try {
      const r = await deps.supabaseRpc(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "find_similar_tasks", {
        p_user_id: userId, p_title: t.title, p_due_date: t.due_date,
      });
      if (Array.isArray(r)) similar = r;
    } catch (err) { console.error("find_similar_tasks error:", err); }
    if (similar.length) { duplicates.push({ ...t, existing: similar[0].title }); continue; }

    const rows = await q(env, deps, "tasks", {
      method: "POST",
      body: {
        document_id: docId, user_id: userId, title: t.title, description: t.description || "",
        due_date: t.due_date, due_time: t.due_time || null, priority: t.priority, category: t.category,
      },
    });
    if (Array.isArray(rows) && rows[0]) saved.push(rows[0]);
  }

  // 시간표 변경 → schedule_exceptions (가족 공용)
  const changes = [];
  for (const c of (draft.schedule_changes || []).map(normalizeChange).filter(Boolean)) {
    const rows = await q(env, deps, "schedule_exceptions", {
      method: "POST",
      body: {
        start_date: c.start, end_date: c.end, kind: c.kind, target_name: c.target_name, target_time: null,
        action: c.action, new_start: c.new_start ? c.new_start + ":00" : null, new_end: c.new_end ? c.new_end + ":00" : null,
        reason: c.reason || null, created_by: userId,
      },
    });
    if (Array.isArray(rows) && rows[0]) changes.push(c);
    else console.error("schedule_exceptions insert failed:", rows && rows.message);
  }

  await patchSession(env, deps, session.id, { status: "completed" });
  return { saved, duplicates, changes, docId };
}

export async function discardDraft(env, deps, session) {
  await patchSession(env, deps, session.id, { status: "cancelled" });
}

export function renderSaveResult({ saved, duplicates, changes }, esc) {
  let msg = saved.length ? `✅ ${saved.length}개 할 일을 저장했어요!\n\n` : `✅ 저장했어요.\n\n`;
  saved.forEach((t, i) => {
    msg += `${i + 1}. ${PRIORITY_EMOJI[t.priority] || "🟡"} <b>${esc(t.title)}</b> — ${fmtDate(t.due_date)}${t.due_time ? ` ${String(t.due_time).slice(0, 5)}` : ""}\n`;
  });
  if (changes && changes.length) {
    msg += `\n📅 시간표 변경 ${changes.length}건 반영\n` + changes.map((c) => `• ${esc(describeChange(c))}`).join("\n") + "\n그날 알림은 바뀐 대로 울려요. 하원·픽업 시각도 바뀌면 말씀해 주세요.\n";
  }
  if (duplicates.length) {
    msg += `\n⏭ 이미 있어서 건너뜀 ${duplicates.length}개\n` + duplicates.map((d) => `• ${esc(d.title)} (${fmtDate(d.due_date)}, 기존: ${esc(d.existing)})`).join("\n") + "\n";
  }
  msg += "\n수정은 웹앱이나 여기서 말로 할 수 있어요.";
  return msg;
}

// 인라인 버튼 (callback_query)
export async function handleDraftCallback(env, deps, cq, esc) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const data = String(cq.data || "");
  const chatId = cq.message && cq.message.chat ? cq.message.chat.id : null;
  const messageId = cq.message ? cq.message.message_id : null;
  const m = data.match(/^draft:(save|cancel):([0-9a-f-]{36})$/);
  if (!m || !chatId) {
    await deps.tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "알 수 없는 버튼이에요" });
    return;
  }
  const [, action, sessionId] = m;
  const rows = await q(env, deps, "upload_sessions", { query: `?id=eq.${sessionId}&select=*` });
  const session = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!session || session.status !== "draft") {
    await deps.tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "이미 처리된 초안이에요" });
    if (messageId) await deps.tg(token, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId });
    return;
  }

  try {
    if (action === "cancel") {
      await discardDraft(env, deps, session);
      await deps.tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "취소했어요" });
      if (messageId) await deps.tg(token, "editMessageText", { chat_id: chatId, message_id: messageId, text: "❌ 초안을 취소했어요.", parse_mode: "HTML" });
      return;
    }
    await deps.tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "저장 중..." });
    const userTg = { user_id: session.user_id, id: session.telegram_id };
    const result = await saveDraft(env, deps, { session, userTg });
    if (messageId) await deps.tg(token, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId });
    await deps.sendMessage(token, chatId, renderSaveResult(result, esc));
  } catch (err) {
    console.error("draft callback error:", err);
    await deps.sendMessage(token, chatId, `❌ 저장 중 오류가 났어요. <code>${esc(String((err && err.message) || err).slice(0, 150))}</code>`);
  }
}
