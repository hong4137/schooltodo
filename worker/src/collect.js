// ═══════════════════════════════════════════════════════════════
// 봇 v2-5 — 사진 모으기: "완료"라고 말하지 않아도 된다
//   · 사진(또는 사진 설명)이 온 뒤 QUIET_MS 동안 조용하면 알아서 분석을 시작한다.
//     앨범으로 여러 장이 한꺼번에 와도 마지막 장의 타이머만 살아남는다 (last_photo_at 비교).
//   · 사진을 모으는 중에 온 말은 Haiku 가 무슨 뜻인지 고른다:
//       note(사진 설명·보충) / more(더 보낼 게 있음) / done(다 보냈음) / cancel(버려) / other(다른 부탁)
//   · 타이머가 끝나면 SELF 서비스 바인딩으로 새 요청을 띄워 분석한다 — 기다린 시간이 분석 시간을 깎지 않게.
//   · 그래도 놓친 세션은 5분 Cron 이 STALE_SEC 뒤에 줍는다.
//   · 초안을 보여 준 뒤 사진이 더 오면 draft.js 가 앞 초안에 합칠지 판단한다(같은 문서면 합침).
// ═══════════════════════════════════════════════════════════════
import Anthropic from "@anthropic-ai/sdk";
import { processSessionV2 } from "./draft.js";

export const QUIET_MS = 12_000;       // 마지막 사진·설명 뒤 이만큼 조용하면 분석
export const STALE_SEC = 90;          // 타이머가 잘렸을 때 Cron 이 줍는 기준
const MAX_HOPS = 8;                   // 앞 분석이 끝나길 기다리며 다시 띄우는 횟수 상한
const NOTE_MODEL = "claude-haiku-5-5";

// 말 한마디로 분명한 경우는 모델을 부르지 않는다 (메시지 전체가 이 말일 때만 — "신청 끝나기 전에"는 해당 없음)
const DONE_EXACT = ["완료", "끝", "다했어", "다 했어", "이게 다야", "이게다야", "분석", "분석해줘", "분석해 줘", "읽어줘", "읽어 줘", "done"];
const CANCEL_EXACT = ["취소", "cancel", "잘못 보냈어", "잘못보냈어"];
const MORE_EXACT = ["더 있어", "더있어", "잠깐", "잠깐만", "하나 더", "더 보낼게"];

const q = (env, deps, path, opts) => deps.supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, path, opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sameTime = (a, b) => a && b && Date.parse(a) === Date.parse(b);

export async function getSessionById(env, deps, id) {
  const rows = await q(env, deps, "upload_sessions", { query: `?id=eq.${id}&select=*` });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// 세션의 "마지막 움직임" 시각을 지금으로. 돌려준 값이 이 요청의 타이머 표식이다.
export async function touchSession(env, deps, sessionId, extra = {}) {
  const stamp = new Date().toISOString();
  await q(env, deps, "upload_sessions", {
    method: "PATCH",
    body: { ...extra, last_photo_at: stamp, updated_at: stamp },
    query: `?id=eq.${sessionId}`,
  });
  return stamp;
}

// 사진·설명이 온 뒤 조용해지면 분석을 띄운다.
export function armQuietTimer(env, deps, ctx, { sessionId, stamp, esc, findUser }) {
  ctx.waitUntil((async () => {
    await sleep(QUIET_MS);
    const s = await getSessionById(env, deps, sessionId);
    if (!s || s.status !== "active" || !s.photo_count || !sameTime(s.last_photo_at, stamp)) return; // 그새 더 왔거나 이미 처리됨
    await kick(env, deps, ctx, { type: "collect_fire", session_id: sessionId, hops: 0 }, { esc, findUser });
  })().catch((err) => console.error("quiet timer error:", err)));
}

// 새 요청으로 분석을 띄운다. SELF 바인딩이 없으면 이 요청 안에서 바로 한다.
async function kick(env, deps, ctx, body, { esc, findUser }) {
  if (env.SELF && typeof env.SELF.fetch === "function") {
    try {
      const headers = { "Content-Type": "application/json" };
      if (env.TELEGRAM_WEBHOOK_SECRET) headers["X-Telegram-Bot-Api-Secret-Token"] = env.TELEGRAM_WEBHOOK_SECRET;
      const res = await env.SELF.fetch("https://schooltodo-bot.internal/", { method: "POST", headers, body: JSON.stringify({ internal: body }) });
      if (res.ok) return;
      console.warn("SELF kick failed:", res.status);
    } catch (err) {
      console.warn("SELF kick error:", err);
    }
  }
  await fireSession(env, deps, ctx, body, { esc, findUser });
}

// 내부 요청 처리 (index.js 가 { internal } 을 받으면 부른다)
export async function handleInternal(env, deps, ctx, internal, { esc, findUser }) {
  if (internal && internal.type === "collect_fire" && /^[0-9a-f-]{36}$/.test(String(internal.session_id || ""))) {
    await fireSession(env, deps, ctx, internal, { esc, findUser });
  }
}

// 세션을 집어 들어(active → processing, 한 번만 성공) 분석한다.
async function fireSession(env, deps, ctx, { session_id, hops = 0 }, { esc, findUser }) {
  const s = await getSessionById(env, deps, session_id);
  if (!s || s.status !== "active" || !s.photo_count) return;

  // 같은 방에서 앞 사진을 아직 읽는 중이면 끝날 때까지 기다린다 → 끝나면 그 초안에 합칠 수 있다
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const busy = await q(env, deps, "upload_sessions", {
    query: `?chat_id=eq.${s.chat_id}&status=eq.processing&id=neq.${s.id}&updated_at=gte.${since}&select=id&limit=1`,
  });
  if (Array.isArray(busy) && busy.length && hops < MAX_HOPS) {
    await sleep(QUIET_MS);
    await kick(env, deps, ctx, { type: "collect_fire", session_id, hops: hops + 1 }, { esc, findUser });
    return;
  }

  const claimed = await claimSession(env, deps, s.id);
  if (!claimed) return;                       // 다른 요청이 먼저 집었다
  const userTg = await findUser(env, claimed.chat_id);
  if (!userTg) return;
  await processSessionV2(env, deps, { chatId: claimed.chat_id, userTg, session: claimed, hint: claimed.hint || null, esc });
}

// active 인 경우에만 processing 으로 — 동시에 두 요청이 와도 한쪽만 성공한다
export async function claimSession(env, deps, sessionId) {
  const rows = await q(env, deps, "upload_sessions", {
    method: "PATCH",
    body: { status: "processing", updated_at: new Date().toISOString() },
    query: `?id=eq.${sessionId}&status=eq.active`,
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// 사진을 모으는 중에 온 말 → 무슨 뜻인지 하나 고른다
export async function classifyCollectText(env, text, photoCount) {
  const t = String(text || "").trim().toLowerCase().replace(/[.!~?ㅎㅋ]+$/g, "").trim();
  if (DONE_EXACT.includes(t)) return "done";
  if (CANCEL_EXACT.includes(t)) return "cancel";
  if (MORE_EXACT.includes(t)) return "more";
  if (!env.ANTHROPIC_API_KEY) return "note";

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 15_000 });
    const res = await client.messages.create({
      model: NOTE_MODEL,
      max_tokens: 1024,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { intent: { type: "string", enum: ["note", "more", "done", "cancel", "other"] } },
            required: ["intent"],
            additionalProperties: false,
          },
        },
      },
      system:
        `학부모가 학교 알림장 사진을 텔레그램 봇에 보내는 중이다(지금까지 ${photoCount}장). ` +
        "사진을 다 받으면 봇이 읽어서 할 일 초안을 만든다. 방금 온 말이 무슨 뜻인지 하나만 고른다.\n" +
        "- note: 보낸 사진에 대한 설명·보충 (마감, 누구 것인지, 어떤 장은 무시하라, '이거 다음 주 거야', '체육복은 이미 샀어')\n" +
        "- more: 사진을 더 보낼 테니 기다려 달라 ('한 장 더 있어', '뒷면도 보낼게', '잠깐')\n" +
        "- done: 다 보냈으니 이제 읽어 달라 ('이게 다야', '이제 봐줘', '정리해줘')\n" +
        "- cancel: 보낸 사진을 버려 달라 ('잘못 보냈어', '그거 지워', '없던 걸로')\n" +
        "- other: 사진과 상관없는 다른 부탁·질문 ('내일 준비물 뭐야?', '픽업 몇 시야', '3번 완료')\n" +
        "애매하면 note.",
      messages: [{ role: "user", content: String(text).slice(0, 500) }],
    });
    const block = (res.content || []).find((b) => b.type === "text");
    const intent = block ? JSON.parse(block.text).intent : null;
    return ["note", "more", "done", "cancel", "other"].includes(intent) ? intent : "note";
  } catch (err) {
    console.error("classifyCollectText error:", err);
    return "note";   // 판단을 못 하면 설명으로 받아 두고 조용해지면 분석 — 사진은 잃지 않는다
  }
}

// 사진 모으는 중에 온 말 처리. 반환: true = 여기서 처리함, false = 평소 대화로 넘김
export async function handleCollectText(env, deps, ctx, { session, text, esc, findUser }) {
  const intent = await classifyCollectText(env, text, session.photo_count);
  console.log(`[Collect] chat=${session.chat_id} photos=${session.photo_count} intent=${intent}`);

  if (intent === "other") return false;

  if (intent === "cancel") {
    await q(env, deps, "upload_sessions", { method: "PATCH", body: { status: "cancelled" }, query: `?id=eq.${session.id}&status=eq.active` });
    await deps.sendMessage(env.TELEGRAM_BOT_TOKEN, session.chat_id, "🗑️ 보낸 사진은 버렸어요.");
    return true;
  }

  if (intent === "done") {
    await fireSession(env, deps, ctx, { session_id: session.id, hops: 0 }, { esc, findUser });
    return true;
  }

  if (intent === "more") {
    await touchSession(env, deps, session.id);       // 타이머를 새로 — 다음 사진이 오면 그때부터 다시 잰다
    await deps.sendMessage(env.TELEGRAM_BOT_TOKEN, session.chat_id, "네, 기다릴게요. 📸");
    return true;
  }

  // note — 설명을 모아 두고, 조용해지면 사진과 함께 읽는다
  const hint = session.hint ? `${session.hint} / ${text}` : text;
  const stamp = await touchSession(env, deps, session.id, { hint: hint.slice(0, 1000) });
  armQuietTimer(env, deps, ctx, { sessionId: session.id, stamp, esc, findUser });
  return true;
}

// Cron 안전망: 타이머가 잘려 남은 세션을 줍는다
export async function sweepStaleSessions(env, deps, ctx, { esc, findUser }) {
  const before = new Date(Date.now() - STALE_SEC * 1000).toISOString();
  const after = new Date(Date.now() - 60 * 60 * 1000).toISOString();   // 한 시간 넘게 묵은 모음은 줍지 않는다(배포 전 버려진 것)
  const rows = await q(env, deps, "upload_sessions", {
    query: `?status=eq.active&photo_count=gt.0&last_photo_at=lt.${before}&last_photo_at=gt.${after}&select=id&order=last_photo_at.asc&limit=5`,
  });
  if (!Array.isArray(rows) || !rows.length) return 0;
  for (const r of rows) {
    ctx.waitUntil(kick(env, deps, ctx, { type: "collect_fire", session_id: r.id, hops: 0 }, { esc, findUser })
      .catch((err) => console.error("sweep error:", err)));
  }
  return rows.length;
}
