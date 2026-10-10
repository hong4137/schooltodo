// 가족 공용 데이터(쉬는 날, 시간표 예외)가 바뀌면 다른 가족에게 알린다.
//   assistant.js(도구 실행)와 draft.js(초안 저장) 둘 다 쓴다.

export async function notifyFamily(env, deps, { exceptChatId, actorName, text }) {
  try {
    const rows = await deps.supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "user_telegrams", {
      query: "?is_active=eq.true&select=chat_id,display_name",
    });
    if (!Array.isArray(rows)) return;
    const who = actorName ? `${esc(actorName)}님이 ` : "";
    const msg = `👨‍👩‍👧 ${who}${text}`;
    for (const r of rows) {
      if (String(r.chat_id) === String(exceptChatId)) continue;
      await deps.sendMessage(env.TELEGRAM_BOT_TOKEN, r.chat_id, msg);
    }
  } catch (err) {
    console.error("notifyFamily error:", err);
  }
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
