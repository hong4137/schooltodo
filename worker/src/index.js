// SchoolToDo Telegram Bot - Cloudflare Worker v1.1
// 변경: base64 대신 URL 방식으로 이미지 전달, 에러 디버깅 강화
// 2026-10-10 v2-1: ANTHROPIC_API_KEY 가 있으면 텍스트 메시지는 assistant.js(Claude)가 처리한다.
//                  없으면 아래 classifyIntent 기반 기존 흐름. 사진은 아직 기존 흐름.
import { handleAssistantText } from "./assistant.js";

const COMPLETE_KEYWORDS = ["완료", "끝", "분석", "다했어", "done"];
const CANCEL_KEYWORDS = ["취소", "cancel"];

// Cron 간격(분). wrangler.toml 의 "*/5 * * * *" 와 맞춘다.
const CRON_STEP_MIN = 5;
// 할 일 알림은 task 별 notified_* 플래그로 중복이 막히므로, 한 번 놓쳐도 30분 안에 다시 시도한다.
const DIGEST_GRACE_MIN = 30;

// ══════════════════════════════════════
// Telegram API helpers
// ══════════════════════════════════════
async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(token, chatId, text) {
  return tg(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  });
}

async function getFileUrl(token, fileId) {
  const res = await tg(token, "getFile", { file_id: fileId });
  if (res.ok) {
    return `https://api.telegram.org/file/bot${token}/${res.result.file_path}`;
  }
  return null;
}

// ══════════════════════════════════════
// Supabase helpers
// ══════════════════════════════════════
function supabaseHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function supabaseQuery(url, serviceKey, path, options = {}) {
  const { method = "GET", body, query = "" } = options;
  const res = await fetch(`${url}/rest/v1/${path}${query}`, {
    method,
    headers: supabaseHeaders(serviceKey),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function supabaseRpc(url, serviceKey, fnName, params) {
  const res = await fetch(`${url}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: supabaseHeaders(serviceKey),
    body: JSON.stringify(params),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ══════════════════════════════════════
// Command: /start
// ══════════════════════════════════════
async function handleStart(env, chatId) {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    "📋 <b>SchoolToDo 봇</b>에 오신 걸 환영합니다!\n\n" +
      "학교 알림장/공문 사진을 보내면\nAI가 자동으로 할 일을 추출해요.\n\n" +
      "📌 <b>시작하려면:</b>\n" +
      "1. 웹앱에서 연동 코드 발급\n" +
      "2. 여기서 <code>/link 코드6자리</code> 입력\n\n" +
      "📌 <b>명령어:</b>\n" +
      "/link [코드] - 계정 연동\n" +
      "/today - 오늘 할 일\n" +
      "/list - 전체 할 일 목록\n" +
      "/delete [번호] - 할 일 삭제\n" +
      "/reset - 전체 초기화\n" +
      "/cancel - 업로드 취소"
  );
}

// ══════════════════════════════════════
// Command: /link CODE
// ══════════════════════════════════════
async function handleLink(env, chatId, code, from) {
  if (!code || code.length < 4) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 사용법: <code>/link 코드6자리</code>\n\n웹앱 설정에서 연동 코드를 발급받으세요.");
    return;
  }

  const userId = await supabaseRpc(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "verify_link_code", {
    p_code: code.toUpperCase(),
  });

  if (!userId) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 유효하지 않은 코드예요.\n코드가 만료되었거나 이미 사용되었을 수 있어요.");
    return;
  }

  const existing = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "user_telegrams", {
    query: `?chat_id=eq.${chatId}&is_active=eq.true`,
  });

  if (existing && existing.length > 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "이미 연동된 계정이 있어요!");
    return;
  }

  const displayName = from.first_name || "텔레그램";
  const result = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "user_telegrams", {
    method: "POST",
    body: {
      user_id: userId,
      chat_id: chatId,
      display_name: displayName,
      is_active: true,
    },
  });

  if (result && !result.error) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `✅ 연동 완료! <b>${escapeHtml(displayName)}</b>님으로 등록되었어요.\n\n이제 학교 알림장 사진을 보내보세요! 📸`
    );
  } else {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 연동 실패: " + JSON.stringify(result));
  }
}

// ══════════════════════════════════════
// Command: /today
// ══════════════════════════════════════
async function handleToday(env, chatId) {
  const userTg = await findUserByChatId(env, chatId);
  if (!userTg) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 먼저 /link로 계정을 연동해주세요.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const tasks = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
    query: `?user_id=eq.${userTg.user_id}&due_date=eq.${today}&order=due_time.asc.nullslast`,
  });

  if (!tasks || tasks.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🎉 오늘 마감인 할 일이 없어요!");
    return;
  }

  let msg = `📌 <b>오늘의 할 일</b> (${tasks.length}개)\n\n`;
  tasks.forEach((t) => {
    const check = t.is_completed ? "✅" : "⬜";
    const time = t.due_time ? ` ⏰${t.due_time.slice(0, 5)}` : "";
    const pri = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
    msg += `${check} ${pri} ${escapeHtml(t.title)}${time}\n`;
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

// ══════════════════════════════════════
// Find user by chat_id
// ══════════════════════════════════════
async function findUserByChatId(env, chatId) {
  const data = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "user_telegrams", {
    query: `?chat_id=eq.${chatId}&is_active=eq.true&select=*`,
  });
  return data && data.length > 0 ? data[0] : null;
}

// ══════════════════════════════════════
// Session management
// ══════════════════════════════════════
async function getActiveSession(env, chatId) {
  const data = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "upload_sessions", {
    query: `?chat_id=eq.${chatId}&status=eq.active&order=created_at.desc&limit=1`,
  });
  return data && data.length > 0 ? data[0] : null;
}

async function createSession(env, chatId, userId, telegramId) {
  await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "upload_sessions", {
    method: "PATCH",
    body: { status: "expired" },
    query: `?chat_id=eq.${chatId}&status=eq.active`,
  });

  const data = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "upload_sessions", {
    method: "POST",
    body: {
      chat_id: chatId,
      user_id: userId,
      telegram_id: telegramId,
      status: "active",
      photo_file_ids: [],
      photo_count: 0,
      last_photo_at: new Date().toISOString(),
    },
  });
  return data && data.length > 0 ? data[0] : null;
}

async function addPhotoToSession(env, sessionId, fileId, currentIds, currentCount) {
  const newIds = [...currentIds, fileId];
  await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "upload_sessions", {
    method: "PATCH",
    body: {
      photo_file_ids: newIds,
      photo_count: currentCount + 1,
      last_photo_at: new Date().toISOString(),
    },
    query: `?id=eq.${sessionId}`,
  });
  return newIds;
}

async function markSessionCompleted(env, sessionId) {
  await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "upload_sessions", {
    method: "PATCH",
    body: { status: "completed" },
    query: `?id=eq.${sessionId}`,
  });
}

// ══════════════════════════════════════
// Photo upload handling
// ══════════════════════════════════════
async function handlePhoto(env, chatId, photoFileId, from) {
  const userTg = await findUserByChatId(env, chatId);
  if (!userTg) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 먼저 /link로 계정을 연동해주세요.");
    return;
  }

  let session = await getActiveSession(env, chatId);

  if (!session) {
    session = await createSession(env, chatId, userTg.user_id, userTg.id);
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "📸 사진을 받았어요! (1장)\n\n" +
        "여러 장이면 계속 보내세요.\n" +
        '<b>"완료"</b>를 입력하면 분석을 시작해요.'
    );
  } else {
    const newCount = session.photo_count + 1;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `📸 사진 추가! (${newCount}장)`);
  }

  await addPhotoToSession(env, session.id, photoFileId, session.photo_file_ids || [], session.photo_count || 0);
}

// ══════════════════════════════════════
// Process session → AI parsing
// ══════════════════════════════════════
async function processSession(env, chatId) {
  const session = await getActiveSession(env, chatId);
  if (!session || session.photo_count === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "업로드된 사진이 없어요.");
    return;
  }

  await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "upload_sessions", {
    method: "PATCH",
    body: { status: "processing" },
    query: `?id=eq.${session.id}`,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🔍 ${session.photo_count}장 분석 중...`);

  try {
    // Step 1: Get image URLs from Telegram
    const imageUrls = [];
    for (const fileId of session.photo_file_ids) {
      const url = await getFileUrl(env.TELEGRAM_BOT_TOKEN, fileId);
      if (url) imageUrls.push(url);
    }

    if (imageUrls.length === 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 사진을 불러올 수 없었어요. 다시 보내주세요.");
      await markSessionCompleted(env, session.id);
      return;
    }

    // Step 2: Download images, convert to base64 for AI, and store raw bytes for Storage
    const imageContents = [];
    const imageBuffers = []; // raw ArrayBuffer for Storage upload
    for (const url of imageUrls) {
      try {
        const res = await fetch(url);
        const arrayBuf = await res.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        
        // Keep raw buffer for storage
        imageBuffers.push(arrayBuf);
        
        // Chunk-safe base64 encoding for OpenAI
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, chunk);
        }
        const base64 = btoa(binary);
        
        imageContents.push({
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${base64}`,
            detail: "high",
          },
        });
      } catch (imgErr) {
        console.error("Image download error:", imgErr);
        imageBuffers.push(null);
      }
    }

    if (imageContents.length === 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 이미지 다운로드에 실패했어요. 다시 보내주세요.");
      await markSessionCompleted(env, session.id);
      return;
    }

    // Step 3: Call OpenAI
    const aiResult = await callOpenAI(env, imageContents, chatId);

    if (!aiResult || !aiResult.tasks || aiResult.tasks.length === 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🤔 할 일을 찾지 못했어요.\n사진이 선명한지 확인하고 다시 보내주세요.");
      await markSessionCompleted(env, session.id);
      return;
    }

    // Step 4: Save document
    const doc = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "documents", {
      method: "POST",
      body: {
        user_id: session.user_id,
        uploaded_by: session.telegram_id,
        title: aiResult.document_title || "알림장",
        document_type: aiResult.document_type || "notice",
        ai_summary: aiResult.summary || "",
        source: "telegram",
        status: "completed",
      },
    });

    const docId = doc && doc.length > 0 ? doc[0].id : null;

    // Save document images + upload to Supabase Storage
    for (let i = 0; i < session.photo_file_ids.length; i++) {
      let storagePath = null;
      
      // Upload to Supabase Storage
      if (docId && imageBuffers[i]) {
        storagePath = `${session.user_id}/${docId}/${i + 1}.jpg`;
        try {
          await fetch(
            `${env.SUPABASE_URL}/storage/v1/object/document-images/${storagePath}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "image/jpeg",
              },
              body: imageBuffers[i],
            }
          );
        } catch (storageErr) {
          console.error("Storage upload error:", storageErr);
          storagePath = null;
        }
      }
      
      await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "document_images", {
        method: "POST",
        body: {
          document_id: docId,
          telegram_file_id: session.photo_file_ids[i],
          storage_path: storagePath,
          page_order: i + 1,
        },
      });
    }

    // Step 5: Save tasks
    const savedTasks = [];
    for (const task of aiResult.tasks) {
      const result = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
        method: "POST",
        body: {
          document_id: docId,
          user_id: session.user_id,
          title: task.title,
          description: task.description || "",
          due_date: task.due_date,
          due_time: task.due_time || null,
          priority: task.priority || "medium",
          category: task.category || "other",
        },
      });
      if (result && result.length > 0) savedTasks.push(result[0]);
    }

    // Step 6: Send result
    let msg = `✅ <b>${escapeHtml(aiResult.document_title || "알림장")}</b>에서 ${savedTasks.length}개 할 일을 찾았어요!\n\n`;
    savedTasks.forEach((t, i) => {
      const pri = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
      msg += `${i + 1}. ${pri} <b>${escapeHtml(t.title)}</b>\n   📅 ${t.due_date}${t.due_time ? ` ⏰${t.due_time.slice(0, 5)}` : ""}\n`;
    });
    msg += "\n수정은 웹앱에서 할 수 있어요!";

    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
    await markSessionCompleted(env, session.id);
  } catch (err) {
    console.error("Processing error:", err);
    // Send detailed error to user for debugging
    const errMsg = err.message || String(err);
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `❌ 분석 중 오류가 발생했어요.\n\n<code>${escapeHtml(errMsg.slice(0, 200))}</code>\n\n다시 시도해주세요.`
    );
    await markSessionCompleted(env, session.id);
  }
}

// ══════════════════════════════════════
// OpenAI GPT-4.1 Vision
// ══════════════════════════════════════
async function callOpenAI(env, imageContents, chatId) {
  const today = new Date().toISOString().slice(0, 10);
  
  const systemPrompt = `당신은 한국 초등학교 알림장/공문 사진에서 학부모가 해야 할 Task를 추출하는 AI입니다.
오늘 날짜: ${today}

규칙:
1. 사진에서 날짜, 제출물, 준비물, 참석 일정, 납부 항목을 찾아내세요.
2. 각 Task에 마감일(due_date)을 반드시 YYYY-MM-DD 형식으로 지정하세요.
3. 우선순위: 마감 임박/필수 → high, 일반 → medium, 여유/선택 → low
4. 카테고리: submission(제출), preparation(준비물), attendance(참석), payment(납부), other(기타)
5. 캡처 이미지인 경우 UI 요소는 무시하세요.
6. description은 반드시 사진에서 읽은 구체적 정보를 포함하세요:
   - 장소, 시간, 층/건물 정보
   - 제출할 서류 목록, 준비물 상세
   - 주의사항, 참고사항
   - 연락처, 금액 등 구체적 수치
   예시: "3월 3일(화) 오전 11시, 은평초 어울림관 2층. 등교 10시 30분까지. 책가방, 실내화 지참."
7. 기간이 있는 항목(신청기간, 접수기간, 모집기간, 제출기간 등)은 반드시 2개 Task로 분리:
   - Task 1: "[항목명] [맥락에 맞는 동사] 시작" → due_date는 시작일, priority는 medium
   - Task 2: "[항목명] [맥락에 맞는 동사] 마감" → due_date는 마감일, priority는 high
   동사는 문맥에 맞게 자연스럽게 선택:
   - 신청기간 → "신청 시작" / "신청 마감"
   - 모집기간 → "모집 시작" / "모집 마감"  
   - 접수기간 → "접수 시작" / "접수 마감"
   - 제출기간 → "제출 시작" / "제출 마감"

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:
{
  "document_title": "문서 제목",
  "document_type": "notice",
  "summary": "요약",
  "tasks": [
    {
      "title": "할 일 (20자 이내)",
      "description": "사진에서 읽은 관련 상세 내용 (장소, 시간, 준비물, 주의사항 등 구체적으로)",
      "due_date": "YYYY-MM-DD",
      "due_time": "HH:MM 또는 null",
      "priority": "high",
      "category": "submission"
    }
  ]
}`;

  const requestBody = {
    model: "gpt-4.1",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "이 학교 알림장/공문 사진에서 학부모가 해야 할 일을 추출해주세요." },
          ...imageContents,
        ],
      },
    ],
    max_tokens: 2000,
    temperature: 0.1,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json();

  // Check for API errors
  if (data.error) {
    console.error("OpenAI API error:", data.error);
    throw new Error(`OpenAI: ${data.error.message || JSON.stringify(data.error)}`);
  }

  if (data.choices && data.choices[0]) {
    let content = data.choices[0].message.content;
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    try {
      return JSON.parse(content);
    } catch (parseErr) {
      console.error("JSON parse error:", content);
      throw new Error("AI 응답 파싱 실패");
    }
  }

  throw new Error("AI 응답 없음");
}

// ══════════════════════════════════════
// Command: /list - 전체 할 일 목록
// ══════════════════════════════════════
async function handleList(env, chatId) {
  const userTg = await findUserByChatId(env, chatId);
  if (!userTg) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 먼저 /link로 계정을 연동해주세요.");
    return;
  }

  const tasks = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
    query: `?user_id=eq.${userTg.user_id}&is_completed=eq.false&order=due_date.asc`,
  });

  if (!tasks || tasks.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "할 일이 없어요! 📭");
    return;
  }

  let msg = `📋 <b>전체 할 일</b> (${tasks.length}개)\n\n`;
  tasks.forEach((t, i) => {
    const pri = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
    msg += `<b>${i + 1}.</b> ${pri} ${escapeHtml(t.title)}\n   📅 ${t.due_date}\n`;
  });
  msg += "\n삭제: <code>/delete 번호</code>\n전체 초기화: /reset";

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

// ══════════════════════════════════════
// Command: /delete N - 할 일 삭제
// ══════════════════════════════════════
async function handleDelete(env, chatId, arg) {
  const userTg = await findUserByChatId(env, chatId);
  if (!userTg) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 먼저 /link로 계정을 연동해주세요.");
    return;
  }

  const num = parseInt(arg);
  if (!num || num < 1) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "사용법: <code>/delete 번호</code>\n\n먼저 /list로 번호를 확인하세요.");
    return;
  }

  const tasks = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
    query: `?user_id=eq.${userTg.user_id}&is_completed=eq.false&order=due_date.asc`,
  });

  if (!tasks || num > tasks.length) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ ${num}번 할 일이 없어요. /list로 확인해주세요.`);
    return;
  }

  const target = tasks[num - 1];
  await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
    method: "DELETE",
    query: `?id=eq.${target.id}`,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🗑️ <b>${escapeHtml(target.title)}</b> (${target.due_date}) 삭제했어요.`);
}

// ══════════════════════════════════════
// Command: /reset - 전체 초기화
// ══════════════════════════════════════
async function handleReset(env, chatId, confirmed) {
  const userTg = await findUserByChatId(env, chatId);
  if (!userTg) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 먼저 /link로 계정을 연동해주세요.");
    return;
  }

  if (!confirmed) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "⚠️ <b>정말 모든 할 일을 삭제할까요?</b>\n\n되돌릴 수 없어요!\n\n확인하려면: <code>/reset 확인</code>"
    );
    return;
  }

  // Delete all tasks
  await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
    method: "DELETE",
    query: `?user_id=eq.${userTg.user_id}`,
  });

  // Delete all documents
  await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "documents", {
    method: "DELETE",
    query: `?user_id=eq.${userTg.user_id}`,
  });

  // Delete all sessions
  await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "upload_sessions", {
    method: "DELETE",
    query: `?user_id=eq.${userTg.user_id}`,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "✅ 모든 할 일과 문서가 초기화되었어요.\n\n새로운 사진을 보내서 시작하세요! 📸");
}

// ══════════════════════════════════════
// AI Intent Classifier
// ══════════════════════════════════════
async function classifyIntent(env, text) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `사용자의 텍스트가 어떤 의도인지 분류하세요.
오늘 날짜: ${today}

의도 종류:
- "list": 할 일 목록을 보고 싶다 (예: "목록 보여줘", "뭐 해야돼?", "할 일 알려줘", "오늘 할 거", "이번주 할 일")
- "delete": 특정 할 일을 삭제 (예: "3번 지워줘", "첫번째 삭제", "입학식 참석 삭제해줘")
- "complete": 특정 할 일을 완료 처리 (예: "2번 했어", "서류 제출 완료", "1번 끝")
- "reset": 전체 초기화 (예: "다 지워줘", "전부 삭제", "초기화")
- "add_task": 새로운 할 일 추가 (예: "내일까지 수저 준비", "3월 5일 서류 제출")
- "day_off": 학교 안 가는 날(공휴일·재량휴업일·방학) 등록 (예: "내일 학교 안 가", "10/20부터 24일까지 방학", "다음주 금요일 재량휴업일", "오늘 쉬는 날이야")
- "day_off_list": 쉬는 날 목록 조회 (예: "쉬는 날 알려줘", "휴일 목록", "방학 언제야")
- "help": 사용법 문의 (예: "뭐 할 수 있어?", "도움말", "사용법")
- "unknown": 판단 불가

반드시 JSON만 응답:
{"intent": "list", "param": null}

param 설명:
- delete일 때: 번호(숫자) 또는 제목(문자열). 예: {"intent": "delete", "param": "3"} 또는 {"intent": "delete", "param": "입학식 참석"}
- complete일 때: 번호(숫자) 또는 제목(문자열)
- day_off일 때: {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "reason": "방학"}. 하루면 start=end. 이유가 없으면 reason은 "쉬는 날". 날짜는 오늘 날짜 기준으로 계산.
- 나머지: null`,
        },
        { role: "user", content: text },
      ],
      max_tokens: 160,
      temperature: 0,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  let content = data.choices[0].message.content;
  content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(content);
}

// ══════════════════════════════════════
// Natural language: complete task
// ══════════════════════════════════════
async function handleCompleteTask(env, chatId, param, userTg) {
  const tasks = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
    query: `?user_id=eq.${userTg.user_id}&is_completed=eq.false&order=due_date.asc`,
  });

  if (!tasks || tasks.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "완료할 할 일이 없어요! 📭");
    return;
  }

  let target = null;
  const num = parseInt(param);
  if (!isNaN(num) && num >= 1 && num <= tasks.length) {
    target = tasks[num - 1];
  } else if (param) {
    target = tasks.find((t) => t.title.includes(param));
  }

  if (!target) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🤔 어떤 할 일인지 모르겠어요.\n\n/list로 번호를 확인해주세요.`);
    return;
  }

  await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
    method: "PATCH",
    body: { is_completed: true },
    query: `?id=eq.${target.id}`,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ <b>${escapeHtml(target.title)}</b> 완료! 👏`);
}

// ══════════════════════════════════════
// Natural language: delete by name
// ══════════════════════════════════════
async function handleSmartDelete(env, chatId, param, userTg) {
  const tasks = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
    query: `?user_id=eq.${userTg.user_id}&is_completed=eq.false&order=due_date.asc`,
  });

  if (!tasks || tasks.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "삭제할 할 일이 없어요! 📭");
    return;
  }

  let target = null;
  const num = parseInt(param);
  if (!isNaN(num) && num >= 1 && num <= tasks.length) {
    target = tasks[num - 1];
  } else if (param) {
    target = tasks.find((t) => t.title.includes(param));
  }

  if (!target) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🤔 어떤 할 일인지 모르겠어요.\n\n/list로 번호를 확인해주세요.`);
    return;
  }

  await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
    method: "DELETE",
    query: `?id=eq.${target.id}`,
  });

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🗑️ <b>${escapeHtml(target.title)}</b> (${target.due_date}) 삭제했어요.`);
}

// ══════════════════════════════════════
// Natural language: help
// ══════════════════════════════════════
async function handleHelp(env, chatId) {
  const msg = `📖 <b>사용법</b>\n\n` +
    `📸 <b>사진 보내기</b> → 알림장/공문 자동 분석\n` +
    `✏️ <b>할 일 입력</b> → "내일까지 수저 준비"\n\n` +
    `💬 <b>자연어 명령</b>\n` +
    `• "할 일 보여줘" → 목록 조회\n` +
    `• "3번 삭제해줘" → 삭제\n` +
    `• "2번 했어" → 완료 처리\n` +
    `• "다 지워줘" → 전체 초기화\n` +
    `• "내일 학교 안 가", "10/20~24 방학" → 쉬는 날 등록 (알림 쉼)\n` +
    `• "쉬는 날 알려줘" → 쉬는 날 목록\n\n` +
    `⌨️ <b>명령어</b>\n` +
    `/list · /delete 번호 · /reset · /cancel`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

// ══════════════════════════════════════
// Text-based task input (AI parsing)
// ══════════════════════════════════════
async function handleTextTask(env, chatId, text, userTg) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const dayOfWeek = dayNames[kst.getUTCDay()];

  const systemPrompt = `사용자가 텍스트로 할 일을 입력했습니다. 자연어를 파싱하여 Task를 추출하세요.
오늘 날짜: ${today} (${dayOfWeek}요일)

규칙:
1. "내일까지 준비물 가져가기" → due_date: 내일, title: "준비물 가져가기"
2. "3월 5일 서류 제출" → due_date: 2026-03-05, title: "서류 제출"
3. "다음주 월요일 학부모 상담" → 날짜 계산해서 due_date 설정
4. 날짜가 없으면 due_date는 오늘로 설정
5. 여러 개의 할 일이 포함될 수 있음 (쉼표, 줄바꿈 등으로 구분)

반드시 JSON만 응답:
{
  "tasks": [
    {
      "title": "할 일 (20자 이내)",
      "description": "상세 내용",
      "due_date": "YYYY-MM-DD",
      "due_time": "HH:MM 또는 null",
      "priority": "medium",
      "category": "other"
    }
  ]
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        max_tokens: 1000,
        temperature: 0.1,
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    let content = data.choices[0].message.content;
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const result = JSON.parse(content);

    if (!result.tasks || result.tasks.length === 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🤔 할 일을 파악하지 못했어요.\n다시 입력해주세요.");
      return;
    }

    const savedTasks = [];
    for (const task of result.tasks) {
      const res = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
        method: "POST",
        body: {
          user_id: userTg.user_id,
          title: task.title,
          description: task.description || "",
          due_date: task.due_date,
          due_time: task.due_time || null,
          priority: task.priority || "medium",
          category: task.category || "other",
        },
      });
      if (res && res.length > 0) savedTasks.push(res[0]);
    }

    let msg = `✏️ ${savedTasks.length}개 할 일을 추가했어요!\n\n`;
    savedTasks.forEach((t, i) => {
      const pri = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
      msg += `${i + 1}. ${pri} <b>${escapeHtml(t.title)}</b>\n   📅 ${t.due_date}${t.due_time ? ` ⏰${t.due_time.slice(0, 5)}` : ""}\n`;
    });

    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
  } catch (err) {
    console.error("Text task error:", err);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ 오류: ${(err.message || "").slice(0, 100)}\n\n다시 입력해주세요.`);
  }
}

// ══════════════════════════════════════
// Auto-process check (30초 타임아웃)
// ══════════════════════════════════════
async function checkAutoProcess(env, chatId) {
  const session = await getActiveSession(env, chatId);
  if (!session) return;

  const lastPhoto = new Date(session.last_photo_at).getTime();
  const now = Date.now();

  if (now - lastPhoto >= 30000) {
    await processSession(env, chatId);
  }
}

// ══════════════════════════════════════
// Pickup Reminder
// ══════════════════════════════════════
async function handlePickupReminder(env, kst, kstHour, kstMin, kstDayOfWeek, daysOff = []) {
  const dayMap = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri" };
  const todayKey = dayMap[kstDayOfWeek];
  if (!todayKey) return;

  // 가족 공용 쉬는 날이면 전부 건너뜀 (사용자별 쉬는 날은 아래 루프에서 개별 처리)
  const commonOff = daysOff.find((r) => !r.user_id);
  if (commonOff) {
    console.log(`[Pickup] day off (${commonOff.reason}), skipping`);
    return;
  }

  const nowTotalMin = kstHour * 60 + kstMin;

  try {
    // Get all pickup times for today's day (filtered by active term)
    const pickups = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "timetable_pickups", {
      query: `?day=eq.${todayKey}&select=*,profiles!inner(active_term)`,
    });

    if (!pickups || pickups.length === 0) return;

    for (const pickup of pickups) {
      // Only send for active term pickups
      const activeTerm = pickup.profiles?.active_term;
      if (pickup.term && activeTerm && pickup.term !== activeTerm) continue;
      if (dayOffFor(daysOff, pickup.user_id)) continue;
      const pickupTime = pickup.pickup_time; // "15:30:00"
      const [ph, pm] = pickupTime.split(":").map(Number);
      const pickupTotalMin = ph * 60 + pm;
      const reminderMin = pickupTotalMin - 60; // 1시간 전

      // 현재 시각이 리마인드 슬롯 안인지 (Cron 간격만큼)
      if (nowTotalMin >= reminderMin && nowTotalMin < reminderMin + CRON_STEP_MIN) {
        // Check if user has pickup reminder enabled
        const profile = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "profiles", {
          query: `?id=eq.${pickup.user_id}&select=pickup_reminder_enabled`,
        });
        if (profile && profile[0] && profile[0].pickup_reminder_enabled === false) continue;

        const pickupTimeStr = `${String(ph).padStart(2, "0")}:${String(pm).padStart(2, "0")}`;

        // 텔레그램 알림
        const telegrams = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "user_telegrams", {
          query: `?user_id=eq.${pickup.user_id}&is_active=eq.true`,
        });

        const msg = `🚗 <b>픽업 1시간 전!</b>\n\n⏰ 오늘 픽업 시간: <b>${pickupTimeStr}</b>\n\n준비해주세요!`;

        if (telegrams && telegrams.length > 0) {
          for (const tg of telegrams) {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, tg.chat_id, msg);
          }
        }

        // 웹 푸시
        await sendWebPush(env, pickup.user_id, {
          title: "🚗 픽업 1시간 전!",
          body: `오늘 픽업 ${pickupTimeStr} - 준비해주세요!`,
          tag: `pickup-${todayKey}`,
          url: "/schooltodo/",
        });
        await recordRun(env, "pickup", pickup.user_id, true, { time: pickupTimeStr, day: todayKey });
      }
    }
  } catch (err) {
    console.error("Pickup reminder error:", err);
  }

  // ── 시간표 정각 알림 (도보하원, 태권도 이동 등) ──
  try {
    const alerts = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "timetable_alerts", {
      query: `?day=eq.${todayKey}&is_active=eq.true&select=*,profiles!inner(active_term)`,
    });

    if (!alerts || alerts.length === 0) return;

    for (const alert of alerts) {
      const activeTerm = alert.profiles?.active_term;
      if (alert.term && activeTerm && alert.term !== activeTerm) continue;
      if (dayOffFor(daysOff, alert.user_id)) continue;
      const [ah, am] = alert.alert_time.split(":").map(Number);
      const alertTotalMin = ah * 60 + am;

      // 정각 알림: 해당 슬롯 안
      if (nowTotalMin >= alertTotalMin && nowTotalMin < alertTotalMin + CRON_STEP_MIN) {
        const alertTimeStr = `${String(ah).padStart(2, "0")}:${String(am).padStart(2, "0")}`;
        const emoji = alert.emoji || "🔔";

        const telegrams = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "user_telegrams", {
          query: `?user_id=eq.${alert.user_id}&is_active=eq.true`,
        });

        const msg = `${emoji} <b>${escapeHtml(alert.name)}</b>\n\n⏰ ${alertTimeStr}`;

        if (telegrams && telegrams.length > 0) {
          for (const tg of telegrams) {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, tg.chat_id, msg);
          }
        }

        await sendWebPush(env, alert.user_id, {
          title: `${emoji} ${alert.name}`,
          body: alertTimeStr,
          tag: `alert-${todayKey}-${alert.id}`,
          url: "/schooltodo/",
        });
        await recordRun(env, "alert", alert.user_id, true, { name: alert.name, time: alertTimeStr, day: todayKey });
      }
    }
  } catch (err) {
    console.error("Timetable alert error:", err);
  }
}

// ══════════════════════════════════════
// Web Push (VAPID)
// ══════════════════════════════════════
async function sendWebPush(env, userId, payload) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;

  try {
    const subscriptions = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "push_subscriptions", {
      query: `?user_id=eq.${userId}&is_active=eq.true`,
    });

    if (!subscriptions || subscriptions.length === 0) return;

    for (const sub of subscriptions) {
      try {
        await sendPushNotification(env, {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        }, JSON.stringify(payload));
      } catch (err) {
        console.error("Push send error:", err);
        // Deactivate invalid subscriptions (410 Gone)
        if (err.status === 410 || err.status === 404) {
          await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "push_subscriptions", {
            method: "PATCH",
            body: { is_active: false },
            query: `?id=eq.${sub.id}`,
          });
        }
      }
    }
  } catch (err) {
    console.error("Web push error:", err);
  }
}

async function sendPushNotification(env, subscription, payload) {
  // Web Push with VAPID using Cloudflare Workers crypto
  const vapidSubject = env.VAPID_SUBJECT || "mailto:schooltodo@example.com";

  // Create JWT for VAPID
  const audience = new URL(subscription.endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = { typ: "JWT", alg: "ES256" };
  const jwtPayload = { aud: audience, exp: expiration, sub: vapidSubject };

  const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payloadB64 = btoa(JSON.stringify(jwtPayload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import VAPID private key (web-push generates raw 32-byte base64url key)
  const publicKeyBytes = new Uint8Array(base64UrlToArrayBuffer(env.VAPID_PUBLIC_KEY));

  // Convert raw EC key to JWK for crypto.subtle.importKey
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: env.VAPID_PRIVATE_KEY,
    x: arrayBufferToBase64Url(publicKeyBytes.slice(1, 33)),
    y: arrayBufferToBase64Url(publicKeyBytes.slice(33, 65)),
  };

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // Sign JWT
  const signatureDer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  // crypto.subtle returns raw r||s (64 bytes) on Cloudflare Workers
  const signatureB64 = arrayBufferToBase64Url(new Uint8Array(signatureDer));
  const jwt = `${unsignedToken}.${signatureB64}`;

  // Encrypt payload
  const encrypted = await encryptPayload(subscription, payload);

  // Send push
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
    },
    body: encrypted,
  });

  if (!res.ok) {
    const err = new Error(`Push failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
}

async function encryptPayload(subscription, payload) {
  const payloadBytes = new TextEncoder().encode(payload);

  // Generate local ECDH key pair
  const localKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);

  // Import subscriber's public key
  const clientPubKeyRaw = base64UrlToArrayBuffer(subscription.keys.p256dh);
  const clientPubKey = await crypto.subtle.importKey("raw", clientPubKeyRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: clientPubKey }, localKeys.privateKey, 256);

  // Auth secret
  const authSecret = base64UrlToArrayBuffer(subscription.keys.auth);

  // IKM
  const ikmInfo = new TextEncoder().encode("WebPush: info\0");
  const localPubKeyRaw = await crypto.subtle.exportKey("raw", localKeys.publicKey);
  const ikm_info = concatBuffers(ikmInfo, new Uint8Array(clientPubKeyRaw), new Uint8Array(localPubKeyRaw));

  const prk = await hkdfExtract(authSecret, sharedSecret);
  const ikm = await hkdfExpand(prk, ikm_info, 32);

  // Salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Content encryption key and nonce
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");

  const prk2 = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk2, cekInfo, 16);
  const nonce = await hkdfExpand(prk2, nonceInfo, 12);

  // Encrypt with AES-128-GCM
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);

  // Add padding delimiter
  const paddedPayload = concatBuffers(payloadBytes, new Uint8Array([2]));

  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, paddedPayload);

  // Build aes128gcm header
  const recordSize = new ArrayBuffer(4);
  new DataView(recordSize).setUint32(0, encrypted.byteLength + 86);

  const header = concatBuffers(
    salt,
    new Uint8Array(recordSize),
    new Uint8Array([65]),
    new Uint8Array(localPubKeyRaw)
  );

  return concatBuffers(header, new Uint8Array(encrypted));
}

function concatBuffers(...buffers) {
  const arrays = buffers.map((b) => new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer || b));
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, ikm);
}

async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const infoWithCounter = concatBuffers(info, new Uint8Array([1]));
  const output = await crypto.subtle.sign("HMAC", key, infoWithCounter);
  return new Uint8Array(output).slice(0, length);
}

function base64UrlToArrayBuffer(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64Url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ══════════════════════════════════════
// Main webhook handler
// ══════════════════════════════════════
export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      const url = new URL(request.url);
      // 관리용 주소는 HEALTH_KEY 가 등록돼 있으면 ?key= 로 막는다. 등록 전엔 예전처럼 열려 있다.
      const admin = isAdminRequest(env, url);

      // 헬스체크: GitHub Actions 가 1시간마다 호출. 문제가 있으면 503.
      //   키 없이: {ok} 만 (생존 확인용).  키 있으면: 상세 + notify=1 로 텔레그램 경고.
      if (url.pathname === "/health") {
        const report = await buildHealthReport(env);
        if (admin && url.searchParams.get("notify") === "1" && !report.ok) {
          ctx.waitUntil(notifyHealthProblems(env, report));
        }
        const body = admin ? report : { ok: report.ok, checked_at: report.checked_at };
        return new Response(JSON.stringify(body, null, 2), {
          status: report.ok ? 200 : 503,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      // 수동 테스트: Nest Hub 브리핑 즉시 실행 (실제 Google Tasks 에 쓴다)
      if (url.pathname === "/test-briefing") {
        if (!admin) return new Response("Unauthorized", { status: 401 });
        ctx.waitUntil(runNestHubBriefing(env));
        return new Response(
          "Briefing triggered. Check Google Tasks + Cloudflare logs.",
          { status: 200 }
        );
      }

      // Telegram webhook 을 이 Worker 로 (비밀 토큰 포함) 다시 등록
      if (url.pathname === "/setup-webhook") {
        if (!admin) return new Response("Unauthorized", { status: 401 });
        const result = await setupTelegramWebhook(env, url.origin);
        return new Response(JSON.stringify(result, null, 2), {
          status: result.ok ? 200 : 500,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      return new Response("SchoolToDo Bot v1.1 is running!", { status: 200 });
    }

    // Telegram webhook 비밀 토큰 검사 (TELEGRAM_WEBHOOK_SECRET 등록 + /setup-webhook 실행 후부터 유효)
    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (got !== env.TELEGRAM_WEBHOOK_SECRET) {
        console.warn("webhook: bad secret token");
        return new Response("Unauthorized", { status: 401 });
      }
    }

    try {
      const update = await request.json();

      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const from = msg.from || {};
        const text = (msg.text || "").trim();

        // Commands
        if (text.startsWith("/start")) {
          await handleStart(env, chatId);
          return new Response("OK");
        }
        if (text.startsWith("/link")) {
          const code = text.split(/\s+/)[1] || "";
          await handleLink(env, chatId, code, from);
          return new Response("OK");
        }
        if (text.startsWith("/today")) {
          await handleToday(env, chatId);
          return new Response("OK");
        }
        if (text.startsWith("/list")) {
          await handleList(env, chatId);
          return new Response("OK");
        }
        if (text.startsWith("/delete")) {
          const arg = text.split(/\s+/)[1] || "";
          await handleDelete(env, chatId, arg);
          return new Response("OK");
        }
        if (text.startsWith("/reset")) {
          const arg = text.split(/\s+/)[1] || "";
          await handleReset(env, chatId, arg === "확인");
          return new Response("OK");
        }
        if (text.startsWith("/cancel")) {
          const session = await getActiveSession(env, chatId);
          if (session) {
            await markSessionCompleted(env, session.id);
            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🗑️ 업로드가 취소되었어요.");
          } else {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "취소할 업로드가 없어요.");
          }
          return new Response("OK");
        }
        if (text.startsWith("/unlink")) {
          const userTg = await findUserByChatId(env, chatId);
          if (userTg) {
            await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "user_telegrams", {
              method: "PATCH",
              body: { is_active: false },
              query: `?id=eq.${userTg.id}`,
            });
            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "✅ 연동이 해제되었어요.");
          } else {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "연동된 계정이 없어요.");
          }
          return new Response("OK");
        }

        // Photo
        if (msg.photo && msg.photo.length > 0) {
          const photo = msg.photo[msg.photo.length - 1];
          await handlePhoto(env, chatId, photo.file_id, from);
          return new Response("OK");
        }

        // "완료"/"취소" 키워드는 사진 세션이 있을 때만 가로챈다. (전엔 세션이 없어도 "숙제 끝" 같은 말을 조용히 삼켰다)
        const lowerText = text.toLowerCase();
        const kwSession = text ? await getActiveSession(env, chatId) : null;
        if (kwSession && COMPLETE_KEYWORDS.some((kw) => lowerText.includes(kw))) {
          if (kwSession.photo_count > 0) {
            // 분석은 뒤에서. 바로 200 을 돌려줘야 Telegram 이 같은 메시지를 재전송하지 않는다.
            ctx.waitUntil(processSession(env, chatId));
          }
          return new Response("OK");
        }
        if (kwSession && CANCEL_KEYWORDS.some((kw) => lowerText.includes(kw))) {
          await markSessionCompleted(env, kwSession.id);
          await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🗑️ 업로드가 취소되었어요.");
          return new Response("OK");
        }

        // Text-based input (no active photo session, not a command)
        if (text && !text.startsWith("/")) {
          const session = await getActiveSession(env, chatId);
          if (!session) {
            const userTg = await findUserByChatId(env, chatId);
            if (!userTg) {
              await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 먼저 /link로 계정을 연동해주세요.");
              return new Response("OK");
            }

            // v2: Claude 대화형 비서. 응답은 바로 200 으로 돌려주고 뒤에서 처리 (Telegram 재전송 방지)
            if (env.ANTHROPIC_API_KEY) {
              ctx.waitUntil(handleAssistantText(env, { chatId, userTg, text }, {
                supabaseQuery, supabaseHeaders, sendMessage, tg, getKSTDateString, formatKDate,
              }));
              return new Response("OK");
            }

            try {
              const intent = await classifyIntent(env, text);
              
              switch (intent.intent) {
                case "list":
                  await handleList(env, chatId);
                  break;
                case "delete":
                  if (intent.param) {
                    await handleSmartDelete(env, chatId, intent.param, userTg);
                  } else {
                    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "어떤 할 일을 삭제할까요? 번호나 이름을 알려주세요.\n\n/list로 목록을 확인해보세요.");
                  }
                  break;
                case "complete":
                  if (intent.param) {
                    await handleCompleteTask(env, chatId, intent.param, userTg);
                  } else {
                    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "어떤 할 일을 완료할까요? 번호나 이름을 알려주세요.");
                  }
                  break;
                case "reset":
                  await handleReset(env, chatId, false);
                  break;
                case "day_off":
                  await handleDayOff(env, chatId, intent.param, userTg);
                  break;
                case "day_off_list":
                  await handleDayOffList(env, chatId);
                  break;
                case "help":
                  await handleHelp(env, chatId);
                  break;
                case "add_task":
                  await handleTextTask(env, chatId, text, userTg);
                  break;
                default:
                  await handleTextTask(env, chatId, text, userTg);
                  break;
              }
            } catch (err) {
              console.error("Intent classification error:", err);
              // Fallback: treat as task input
              await handleTextTask(env, chatId, text, userTg);
            }
          }
          return new Response("OK");
        }

        // Auto-process removed - "완료" input required
      }

      return new Response("OK");
    } catch (err) {
      console.error("Webhook error:", err);
      return new Response("Error", { status: 200 });
    }
  },

  // ══════════════════════════════════════
  // Cron: "*/5 * * * *" (5분마다). 모든 시각 판단은 KST.
  //   07:10         네스트 브리핑 (고정)
  //   사용자별 시각   아침 → 오늘 할 일 / 저녁 → 내일 할 일 (profiles.notification_morning/evening)
  //   11:00~17:59 평일 픽업 1시간 전 · 정각 알림
  // ══════════════════════════════════════
  async scheduled(event, env, ctx) {
    const t0 = Date.now();
    try {
      const detail = await runScheduled(env, ctx);
      await recordStatus(env, "cron_tick", true, `${detail || ""} (${Date.now() - t0}ms)`);
    } catch (err) {
      console.error("scheduled error:", err);
      await recordStatus(env, "cron_tick", false, String((err && err.message) || err).slice(0, 300));
    }
  },
};

// scheduled() 본체. 반환값은 job_status.last_detail 에 남는 짧은 요약.
async function runScheduled(env, ctx) {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const kstHour = kst.getUTCHours();
    const kstMin = kst.getUTCMinutes();
    const nowTotalMin = kstHour * 60 + kstMin;
    const kstDayOfWeek = kst.getUTCDay(); // 0=sun, 1=mon...
    const isWeekday = kstDayOfWeek >= 1 && kstDayOfWeek <= 5;
    const todayStr = getKSTDateString();
    const tomorrowStr = addDaysStr(todayStr, 1);

    // ── 쉬는 날 (공휴일·재량휴업일·방학) ──
    const daysOff = await getDaysOff(env, todayStr);
    if (daysOff.length > 0) {
      console.log(`[DaysOff] ${todayStr}: ${daysOff.map((r) => r.reason).join(", ")}`);
    }

    // ── Nest Hub 브리핑 (KST 07:10 슬롯, 하루 한 번) ──
    // Google Home 루틴이 07:25에 "내 오늘 일정 알려줘"로 읽어감.
    if (inSlot(nowTotalMin, 7 * 60 + 10, CRON_STEP_MIN)) {
      ctx.waitUntil(runNestHubBriefing(env));
    }

    // ── 픽업 리마인드 (KST 11:00~18:00, 월~금) ──
    if (kstHour >= 11 && kstHour < 18 && isWeekday) {
      await handlePickupReminder(env, kst, kstHour, kstMin, kstDayOfWeek, daysOff);
    }

    // ── 할 일 알림: 사용자별 설정 시각 ──
    const profiles = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "profiles", {
      query: "?select=id,notification_morning,notification_evening",
    });
    if (!Array.isArray(profiles)) {
      console.error("profiles query error:", profiles);
      throw new Error("profiles query failed");
    }

    let tomorrowDaysOff = null;
    let digests = 0;
    for (const p of profiles) {
      const morningMin = timeStrToMin(p.notification_morning) ?? 7 * 60 + 30;
      const eveningMin = timeStrToMin(p.notification_evening) ?? 21 * 60;

      if (inSlot(nowTotalMin, morningMin, DIGEST_GRACE_MIN)) {
        digests += await sendTaskDigest(env, p.id, "morning", todayStr, daysOff);
      }
      if (inSlot(nowTotalMin, eveningMin, DIGEST_GRACE_MIN)) {
        if (!tomorrowDaysOff) tomorrowDaysOff = await getDaysOff(env, tomorrowStr);
        digests += await sendTaskDigest(env, p.id, "evening", tomorrowStr, tomorrowDaysOff);
      }
    }

    // ── 하루 한 번 (KST 03:00) 30일 지난 실행 기록 정리 ──
    if (inSlot(nowTotalMin, 3 * 60, CRON_STEP_MIN)) {
      ctx.waitUntil(supabaseRpc(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "prune_job_runs", {}));
    }

    return `${todayStr} ${String(kstHour).padStart(2, "0")}:${String(kstMin).padStart(2, "0")} daysOff=${daysOff.length} digests=${digests}`;
}

// ── 시각 유틸 ──
function inSlot(nowMin, targetMin, width) {
  return nowMin >= targetMin && nowMin < targetMin + width;
}

// "07:30:00" | "07:30" → 450. 잘못된 값이면 null.
function timeStrToMin(t) {
  if (typeof t !== "string") return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

// ── 할 일 요약 알림 (아침=오늘, 저녁=내일). task 별 notified_* 플래그로 중복 방지 ──
async function sendTaskDigest(env, userId, kind, targetDate, daysOffRows) {
  const isMorning = kind === "morning";
  const label = isMorning ? "오늘" : "내일";
  const emoji = isMorning ? "☀️" : "🌙";
  const notifiedField = isMorning ? "notified_morning" : "notified_evening";

  try {
    const tasks = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
      query: `?user_id=eq.${userId}&due_date=eq.${targetDate}&is_completed=eq.false&${notifiedField}=eq.false&order=due_time.asc.nullslast`,
    });
    if (!Array.isArray(tasks) || tasks.length === 0) return 0;

    let msg = `${emoji} <b>${label}의 할 일</b> (${tasks.length}개)\n\n`;
    const off = dayOffFor(daysOffRows, userId);
    if (off) msg += `🏖 ${label}은 <b>${escapeHtml(off.reason)}</b>, 학교 안 가는 날이에요.\n\n`;
    tasks.forEach((t, i) => {
      const pri = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
      const time = t.due_time ? ` ⏰${t.due_time.slice(0, 5)}` : "";
      msg += `${i + 1}. ${pri} <b>${escapeHtml(t.title)}</b>${time}\n`;
      if (t.description) {
        const desc = t.description.length > 50 ? t.description.slice(0, 50) + "..." : t.description;
        msg += `   ${escapeHtml(desc)}\n`;
      }
    });
    msg += isMorning ? "\n오늘도 화이팅! 💪" : "\n미리 준비해두세요! 📝";

    const telegrams = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "user_telegrams", {
      query: `?user_id=eq.${userId}&is_active=eq.true&select=chat_id`,
    });
    if (Array.isArray(telegrams)) {
      for (const tg of telegrams) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, tg.chat_id, msg);
      }
    }

    const pushTaskList = tasks.map((t) => {
      const pri = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
      return `${pri} ${t.title}`;
    }).join("\n");
    await sendWebPush(env, userId, {
      title: `${emoji} ${label}의 할 일 ${tasks.length}개`,
      body: pushTaskList,
      tag: `${label}-${targetDate}`,
      url: "/schooltodo/",
    });

    for (const t of tasks) {
      await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "tasks", {
        method: "PATCH",
        body: { [notifiedField]: true },
        query: `?id=eq.${t.id}`,
      });
    }
    console.log(`[Digest] ${kind} ${targetDate} user=${userId} tasks=${tasks.length}`);
    await recordRun(env, isMorning ? "digest_morning" : "digest_evening", userId, true, {
      date: targetDate, tasks: tasks.length, telegrams: Array.isArray(telegrams) ? telegrams.length : 0,
    });
    return 1;
  } catch (err) {
    console.error("Notification error:", err);
    await recordRun(env, isMorning ? "digest_morning" : "digest_evening", userId, false, { error: String(err).slice(0, 200) });
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// 실행 기록 · 헬스체크
//   job_status : job 별 마지막 실행 한 줄 (cron_tick, health_alert ...)
//   job_runs   : 실제 발송 기록 (briefing, digest_*, pickup, alert)
//   GET /health : GitHub Actions 가 1시간마다 호출 (.github/workflows/healthcheck.yml)
// ═══════════════════════════════════════════════════════════════

async function recordStatus(env, job, ok, detail) {
  try {
    const nowIso = new Date().toISOString();
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/job_status?on_conflict=job`, {
      method: "POST",
      headers: { ...supabaseHeaders(env.SUPABASE_SERVICE_ROLE_KEY), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        job, last_run_at: nowIso, last_ok: !!ok,
        last_detail: detail ? String(detail).slice(0, 500) : null, updated_at: nowIso,
      }),
    });
    if (!res.ok) console.error("job_status upsert failed:", res.status, (await res.text()).slice(0, 200));
  } catch (err) {
    console.error("job_status error:", err);
  }
}

async function recordRun(env, job, userId, ok, detail) {
  try {
    const r = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "job_runs", {
      method: "POST",
      body: { job, user_id: userId || null, ok: !!ok, detail: detail || null },
    });
    if (r && !Array.isArray(r) && r.message) console.error("job_runs insert failed:", r.message);
  } catch (err) {
    console.error("job_runs error:", err);
  }
}

// 관리용 GET 주소(/health 상세, /test-briefing, /setup-webhook) 보호.
// HEALTH_KEY 가 없으면 예전처럼 열어 둔다 (설정 전 동작 유지).
function isAdminRequest(env, url) {
  if (!env.HEALTH_KEY) return true;
  const key = url.searchParams.get("key") || "";
  return key.length > 0 && key === env.HEALTH_KEY;
}

// Telegram 에 webhook 주소와 비밀 토큰을 등록한다. 결과로 getWebhookInfo 를 돌려준다.
async function setupTelegramWebhook(env, origin) {
  const body = { url: `${origin}/`, allowed_updates: ["message", "callback_query"], drop_pending_updates: false };
  if (env.TELEGRAM_WEBHOOK_SECRET) body.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
  const set = await tg(env.TELEGRAM_BOT_TOKEN, "setWebhook", body);
  const info = await tg(env.TELEGRAM_BOT_TOKEN, "getWebhookInfo", {});
  const r = info && info.result ? info.result : {};
  return {
    ok: !!(set && set.ok),
    set_result: set && set.description,
    webhook_url: r.url,
    secret_token_enabled: !!env.TELEGRAM_WEBHOOK_SECRET,
    pending_update_count: r.pending_update_count,
    last_error: r.last_error_message || null,
  };
}

const HEALTH_CRON_STALE_MIN = 15;      // Cron 이 이 시간 넘게 안 돌면 문제
const HEALTH_ALERT_COOLDOWN_H = 12;    // 같은 경고는 12시간에 한 번

async function buildHealthReport(env) {
  const problems = [];
  const nowMs = Date.now();
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  const kstMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const todayStr = getKSTDateString();
  const checkedAt = new Date(nowMs).toISOString();

  const rows = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "job_status", {
    query: "?select=job,last_run_at,last_ok,last_detail",
  });
  if (!Array.isArray(rows)) {
    problems.push("job_status 표를 읽을 수 없음 (007_job_status.sql 실행했는지 확인)");
    return { ok: false, checked_at: checkedAt, problems };
  }
  const status = {};
  for (const r of rows) status[r.job] = r;

  const tick = status.cron_tick;
  let cronAgeMin = null;
  if (!tick) {
    problems.push("Cron 실행 기록이 없음 (배포 직후면 5분 뒤 다시 확인)");
  } else {
    cronAgeMin = Math.round((nowMs - Date.parse(tick.last_run_at)) / 60000);
    if (cronAgeMin > HEALTH_CRON_STALE_MIN) problems.push(`Cron 이 ${cronAgeMin}분째 멈춤`);
    else if (!tick.last_ok) problems.push(`마지막 Cron 실행 오류: ${tick.last_detail || ""}`);
  }

  const runs = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "job_runs", {
    query: `?ran_at=gte.${todayStr}T00:00:00%2B09:00&order=ran_at.desc&limit=50&select=job,user_id,ran_at,ok,detail`,
  });
  const todayRuns = Array.isArray(runs) ? runs : [];
  const briefing = todayRuns.find((r) => r.job === "briefing");
  // 기록이 오늘 07:10 이후에 시작됐으면(첫 배포 날) "브리핑 안 돌았다"고 할 수 없다
  const oldest = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "job_runs", {
    query: "?order=ran_at.asc&limit=1&select=ran_at",
  });
  const recordingSince = Array.isArray(oldest) && oldest[0] ? Date.parse(oldest[0].ran_at) : null;
  const briefingDueMs = Date.parse(`${todayStr}T07:10:00+09:00`);
  const canJudgeBriefing = recordingSince !== null && recordingSince < briefingDueMs;
  if (kstMin >= 7 * 60 + 30 && !briefing && canJudgeBriefing) problems.push("오늘 네스트 브리핑이 실행되지 않음 (07:10 예정)");
  else if (briefing && !briefing.ok) problems.push(`오늘 네스트 브리핑 실패: ${JSON.stringify(briefing.detail)}`);

  return {
    ok: problems.length === 0,
    checked_at: checkedAt,
    kst_now: `${todayStr} ${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`,
    problems,
    cron: tick ? { last_run_at: tick.last_run_at, age_min: cronAgeMin, ok: tick.last_ok, detail: tick.last_detail } : null,
    today_runs: todayRuns.slice(0, 20).map((r) => ({ job: r.job, ran_at: r.ran_at, ok: r.ok, detail: r.detail })),
    last_alert_at: status.health_alert ? status.health_alert.last_run_at : null,
  };
}

async function notifyHealthProblems(env, report) {
  try {
    const rows = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "job_status", {
      query: "?job=eq.health_alert&select=last_run_at",
    });
    const last = Array.isArray(rows) && rows[0] ? Date.parse(rows[0].last_run_at) : 0;
    if (Date.now() - last < HEALTH_ALERT_COOLDOWN_H * 3600 * 1000) return;

    const telegrams = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "user_telegrams", {
      query: "?is_active=eq.true&select=chat_id",
    });
    if (!Array.isArray(telegrams) || telegrams.length === 0) return;

    const msg = `🚨 <b>SchoolToDo 알림 시스템 점검</b>\n\n` +
      report.problems.map((p) => `• ${escapeHtml(p)}`).join("\n") +
      `\n\n확인: 웹앱 설정 → 알림 시스템 상태`;
    for (const tg of telegrams) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, tg.chat_id, msg);
    }
    await recordStatus(env, "health_alert", true, report.problems.join(" / "));
  } catch (err) {
    console.error("health notify error:", err);
  }
}

// ═══════════════════════════════════════════════════════════════
// Nest Hub 브리핑 (BLOCK B)
//  Worker → Apps Script(schooltodo-briefing) → Google Tasks
//  Nest Hub가 "내 오늘 일정 알려줘"로 Google Tasks를 읽음
// ═══════════════════════════════════════════════════════════════

const TARGET_USER_ID = "fdb9f068-d7b0-43c3-9736-94d37bd1bfe2";

async function runNestHubBriefing(env) {
  try {
    const todayKST = getKSTDateString();

    const tasks = await supabaseQuery(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      "tasks",
      {
        query:
          `?user_id=eq.${TARGET_USER_ID}` +
          `&due_date=eq.${todayKST}` +
          `&is_completed=eq.false` +
          `&select=id,title,priority,due_time` +
          `&order=priority.desc,created_at.asc`,
      }
    );

    if (!tasks || tasks.length === 0) {
      console.log(`[NestHub] ${todayKST}: no tasks, skipping`);
      await recordRun(env, "briefing", TARGET_USER_ID, true, { date: todayKST, skipped: "no_tasks" });
      return;
    }

    const title = buildBriefingTitle(tasks);
    const description = buildBriefingDescription(tasks);

    if (!env.BRIEFING_APPS_SCRIPT_URL) {
      console.error("[NestHub] BRIEFING_APPS_SCRIPT_URL secret not set");
      await recordRun(env, "briefing", TARGET_USER_ID, false, { date: todayKST, error: "BRIEFING_APPS_SCRIPT_URL not set" });
      return;
    }

    const res = await fetch(env.BRIEFING_APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "createBriefing",
        date: todayKST,
        title,
        description,
      }),
    });

    try {
      const result = await res.json();
      if (result.success) {
        console.log(`[NestHub] ${todayKST}: "${title}" — task created`);
        await recordRun(env, "briefing", TARGET_USER_ID, true, { date: todayKST, title, tasks: tasks.length });
      } else {
        console.error(`[NestHub] Apps Script error:`, result.error);
        await recordRun(env, "briefing", TARGET_USER_ID, false, { date: todayKST, error: String(result.error).slice(0, 200) });
      }
    } catch (e) {
      console.log(`[NestHub] ${todayKST}: "${title}" — POST sent (response not JSON, likely OK)`);
      await recordRun(env, "briefing", TARGET_USER_ID, true, { date: todayKST, title, tasks: tasks.length, note: "non-json response" });
    }
  } catch (err) {
    console.error("[NestHub] briefing error:", err);
    await recordRun(env, "briefing", TARGET_USER_ID, false, { error: String(err).slice(0, 200) });
  }
}

function buildBriefingTitle(tasks) {
  const titles = tasks.map((t) => t.title);
  if (titles.length <= 3) {
    return `오늘 할 일: ${titles.join(", ")}`;
  }
  const top3 = titles.slice(0, 3).join(", ");
  const rest = titles.length - 3;
  return `오늘 할 일: ${top3} 외 ${rest}건`;
}

function buildBriefingDescription(tasks) {
  const lines = tasks.map((t, i) => {
    const pri =
      t.priority === "high" ? "🔴" :
      t.priority === "medium" ? "🟡" : "🟢";
    const time = t.due_time ? ` (${t.due_time.slice(0, 5)})` : "";
    return `${i + 1}. ${pri} ${t.title}${time}`;
  });
  return "오늘의 SchoolToDo 할 일:\n\n" + lines.join("\n");
}

function getKSTDateString() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ═══════════════════════════════════════════════════════════════
// 쉬는 날 (days_off): 공휴일 · 재량휴업일 · 방학
//   user_id 가 NULL 이면 가족 공용. 해당 날짜엔 픽업·시간표 알림을 건너뛴다.
// ═══════════════════════════════════════════════════════════════

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function getDaysOff(env, dateStr) {
  try {
    const rows = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "days_off", {
      query: `?start_date=lte.${dateStr}&end_date=gte.${dateStr}&select=id,user_id,reason,kind,start_date,end_date`,
    });
    if (!Array.isArray(rows)) {
      if (rows && rows.message) console.error("days_off query error:", rows.message);
      return [];
    }
    return rows;
  } catch (err) {
    console.error("days_off query error:", err);
    return [];
  }
}

function dayOffFor(rows, userId) {
  return (rows || []).find((r) => !r.user_id || r.user_id === userId) || null;
}

function formatKDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const names = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${names[d.getUTCDay()]})`;
}

function guessDayOffKind(reason) {
  if (/방학/.test(reason)) return "vacation";
  if (/공휴일|대체|명절|설|추석|성탄|크리스마스/.test(reason)) return "holiday";
  if (/재량|휴업|개교|운동회|현장|방과후|학교/.test(reason)) return "school";
  return "other";
}

// 자연어: "내일 학교 안 가", "10/20~24 방학" → days_off 등록
async function handleDayOff(env, chatId, param, userTg) {
  const p = param && typeof param === "object" ? param : {};
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const start = isDate(p.start) ? p.start : null;
  const end = isDate(p.end) ? p.end : start;
  if (!start || end < start) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      "언제 쉬는지 날짜를 못 알아들었어요.\n예) \"내일 학교 안 가\", \"10/20부터 10/24까지 방학\"");
    return;
  }
  const reason = (typeof p.reason === "string" && p.reason.trim()) || "쉬는 날";
  const kind = guessDayOffKind(reason);

  const existing = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "days_off", {
    query: `?start_date=lte.${end}&end_date=gte.${start}&select=id,reason,start_date,end_date`,
  });
  if (Array.isArray(existing) && existing.length > 0) {
    const e = existing[0];
    const range = e.start_date === e.end_date ? formatKDate(e.start_date) : `${formatKDate(e.start_date)}~${formatKDate(e.end_date)}`;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `이미 등록돼 있어요: ${range} <b>${escapeHtml(e.reason)}</b>\n바꾸려면 웹앱 캘린더에서 지우고 다시 등록해주세요.`);
    return;
  }

  const inserted = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "days_off", {
    method: "POST",
    body: { start_date: start, end_date: end, reason, kind, created_by: userTg.user_id },
  });
  if (!Array.isArray(inserted) || inserted.length === 0) {
    console.error("days_off insert error:", inserted);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ 등록에 실패했어요. 잠시 후 다시 시도해주세요.");
    return;
  }
  const range = start === end ? formatKDate(start) : `${formatKDate(start)} ~ ${formatKDate(end)}`;
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `🏖 ${range} <b>${escapeHtml(reason)}</b> 등록했어요.\n이 기간엔 픽업·시간표 알림을 쉬어요.\n\n취소는 웹앱 캘린더에서 할 수 있어요.`);
}

async function handleDayOffList(env, chatId) {
  const today = getKSTDateString();
  const rows = await supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "days_off", {
    query: `?end_date=gte.${today}&order=start_date.asc&limit=12&select=reason,kind,start_date,end_date`,
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "앞으로 등록된 쉬는 날이 없어요.\n\"내일 학교 안 가\"처럼 말하면 등록할 수 있어요.");
    return;
  }
  const kindEmoji = { holiday: "🎌", school: "🏫", vacation: "🏖", other: "📌" };
  let msg = `🗓 <b>앞으로 쉬는 날</b>\n\n`;
  for (const r of rows) {
    const range = r.start_date === r.end_date ? formatKDate(r.start_date) : `${formatKDate(r.start_date)} ~ ${formatKDate(r.end_date)}`;
    msg += `${kindEmoji[r.kind] || "📌"} ${range} ${escapeHtml(r.reason)}\n`;
  }
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}