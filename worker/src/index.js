// SchoolToDo Telegram Bot - Cloudflare Worker v1.1
// 변경: base64 대신 URL 방식으로 이미지 전달, 에러 디버깅 강화
// 2026-10-11 v2-4: 텍스트는 assistant.js(Claude), 사진은 draft.js. OpenAI 기반 v1 코드는 제거됨.
//                  ANTHROPIC_API_KEY 가 없으면 대화 기능은 안내만 하고, 슬래시 명령과 Cron 알림만 동작한다.
import { handleAssistantText, recordUsage } from "./assistant.js";
import { processSessionV2, handleDraftCallback } from "./draft.js";
import { getExceptions, pickupException, alertException, describeException } from "./exceptions.js";

// assistant.js / draft.js 에 넘기는 공용 헬퍼 묶음
function assistantDeps() {
  return {
    supabaseQuery, supabaseHeaders, supabaseRpc, sendMessage, tg, getFileUrl, getKSTDateString, formatKDate,
    addUsage: (env, chatId, day, usage) => recordUsage(env, assistantDeps(), chatId, day, usage),
  };
}

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

  const today = getKSTDateString(); // UTC 기준이면 밤 9시 이후 내일 것이 나왔다
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
        '<b>"완료"</b>를 입력하면 분석을 시작해요.\n' +
        '설명을 덧붙여도 돼요. (예: "이거 다음 주 거야")'
    );
  } else {
    const newCount = session.photo_count + 1;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `📸 사진 추가! (${newCount}장)`);
  }

  await addPhotoToSession(env, session.id, photoFileId, session.photo_file_ids || [], session.photo_count || 0);
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
// Natural language: help
// ══════════════════════════════════════
async function handleHelp(env, chatId) {
  const msg = `📖 <b>사용법</b>\n\n` +
    `📸 <b>사진 보내기</b> → 알림장을 읽어 초안을 보여주고, 확인 후 저장\n` +
    `   사진 뒤에 "이거 다음 주 거야" 처럼 말을 붙여도 돼요\n\n` +
    `💬 <b>그냥 말하면 돼요</b>\n` +
    `• "이번 주 준비물 뭐 있어?", "내일 뭐 해야 돼?"\n` +
    `• "금요일까지 체육복 준비", "2번 완료", "그거 내일로 미뤄"\n` +
    `• "수요일 몇 시에 끝나?", "내일 픽업 몇 시야?"\n` +
    `• "이번 주 피아노 쉬어", "내일 태권도 5시로", "금요일 4시 치과"\n` +
    `• "내일 학교 안 가", "10/20~24 방학", "쉬는 날 알려줘"\n` +
    `• "수요일 바이올린 13:00~14:20 추가", "2학기 시간표로"\n` +
    `• "지난번 현장학습 안내문 보여줘"\n` +
    `• "처음부터" → 대화 기억 초기화\n\n` +
    `⌨️ <b>명령어</b>\n` +
    `/list · /today · /cancel(사진 취소) · /unlink`;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
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

  // 오늘 날짜의 시간표 예외 (픽업 시각 변경·취소, 정각 알림 변경·취소)
  const exceptions = await getExceptions(env, { supabaseQuery }, getKSTDateString());

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
      let pickupTime = pickup.pickup_time; // "15:30:00"
      const pex = pickupException(exceptions, String(pickupTime).slice(0, 5));
      if (pex && pex.action === "skip") continue;
      if (pex && pex.action === "move" && pex.new_start) pickupTime = pex.new_start + ":00";
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
      let alertTime = alert.alert_time;
      const aex = alertException(exceptions, { name: alert.name, time: String(alertTime).slice(0, 5) });
      if (aex && aex.action === "skip") continue;
      if (aex && aex.action === "move" && aex.new_start) alertTime = aex.new_start + ":00";
      const [ah, am] = alertTime.split(":").map(Number);
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

      // 인라인 버튼 (초안 ✅ 저장 / ❌ 취소)
      if (update.callback_query) {
        ctx.waitUntil(handleDraftCallback(env, assistantDeps(), update.callback_query, escapeHtml));
        return new Response("OK");
      }

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
            const userTg = await findUserByChatId(env, chatId);
            ctx.waitUntil(processSessionV2(env, assistantDeps(), { chatId, userTg, session: kwSession, hint: null, esc: escapeHtml }));
          }
          return new Response("OK");
        }
        if (kwSession && CANCEL_KEYWORDS.some((kw) => lowerText.includes(kw))) {
          await markSessionCompleted(env, kwSession.id);
          await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🗑️ 업로드가 취소되었어요.");
          return new Response("OK");
        }
        // v2: 사진을 모으는 중에 온 다른 말은 "설명"으로 삼아 바로 분석한다 ("이거 내일까지야")
        if (kwSession && kwSession.photo_count > 0 && text && !text.startsWith("/")) {
          const userTg = await findUserByChatId(env, chatId);
          ctx.waitUntil(processSessionV2(env, assistantDeps(), { chatId, userTg, session: kwSession, hint: text, esc: escapeHtml }));
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
              ctx.waitUntil(handleAssistantText(env, { chatId, userTg, text }, assistantDeps()));
              return new Response("OK");
            }

            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ AI 비서 키(ANTHROPIC_API_KEY)가 설정되지 않아 대화 기능을 쓸 수 없어요.");
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
    const exceptions = await getExceptions(env, { supabaseQuery }, targetDate);
    if (exceptions.length) msg += `📅 ${label} 시간표 변경: ${escapeHtml(exceptions.map(describeException).join(", "))}\n\n`;
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