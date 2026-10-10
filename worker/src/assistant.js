// ═══════════════════════════════════════════════════════════════
// 봇 v2 — Claude 대화형 비서 (텍스트 메시지 담당)
//   index.js 의 텍스트 분기에서 ANTHROPIC_API_KEY 가 있으면 여기로 온다.
//   사진 분석은 아직 index.js 의 기존 흐름(V2-2 에서 이관).
//   대화 기억: bot_conversations (chat_id 별, 2시간 지나면 새로 시작)
//   사용량: bot_usage (chat_id·날짜), 하루 입력 토큰 상한
// ═══════════════════════════════════════════════════════════════
import Anthropic from "@anthropic-ai/sdk";
import { DRAFT_TASK_SCHEMA, DRAFT_CHANGE_SCHEMA, getDraftSession, updateDraft, saveDraft, discardDraft, renderDraft, renderSaveResult } from "./draft.js";
import { getExceptions, applyToBlocks, pickupException, alertException, describeException } from "./exceptions.js";

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 2048;
const MAX_TOOL_ITERATIONS = 8;
const STORED_TURNS = 20;            // 저장하는 user/assistant 메시지 수 (각각 아니라 합계)
const CONVERSATION_TTL_MIN = 120;   // 이보다 오래 조용하면 새 대화
const DAILY_INPUT_TOKEN_CAP = 400000;
const TELEGRAM_MAX_LEN = 4000;

const RESET_WORDS = ["처음부터", "대화 초기화", "새 대화", "/new"];

// ── 도구 정의 ─────────────────────────────────────────────────
// 주의: strict: true 는 상한 20개이고, 그 아래라도 합친 스키마가 크면 "compiled grammar is too large" 400 이 난다
// (2026-10-11 둘 다 겪음). 중첩 배열이 있는 add_tasks·set_draft_tasks·add_exception 만 strict. 나머지는 코드에서 검증.
export const TOOLS = [
  {
    name: "list_tasks",
    description: "할 일 목록을 가져온다. 번호(n)는 사용자에게 보여줄 때 그대로 쓰고, 사용자가 '3번'이라고 하면 이 번호다.",
    input_schema: {
      type: "object",
      properties: {
        range: { type: "string", enum: ["today", "tomorrow", "week", "next_week", "overdue", "upcoming", "all"],
          description: "today=오늘, tomorrow=내일, week=이번 주, next_week=다음 주, overdue=지난 미완료, upcoming=오늘 이후 전부(기본), all=완료 포함 전부" },
        include_done: { type: "boolean", description: "완료된 것도 포함" },
      },
      required: ["range", "include_done"],
      additionalProperties: false,
    },
  },
  {
    name: "add_tasks",
    description: "할 일을 추가한다. 여러 개 한 번에 가능. due_date 는 YYYY-MM-DD.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "20자 이내" },
              due_date: { type: "string", description: "YYYY-MM-DD" },
              due_time: { type: ["string", "null"], description: "HH:MM 또는 null" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              category: { type: "string", enum: ["submission", "preparation", "attendance", "payment", "other"] },
              description: { type: "string", description: "상세. 없으면 빈 문자열" },
            },
            required: ["title", "due_date", "due_time", "priority", "category", "description"],
            additionalProperties: false,
          },
        },
      },
      required: ["tasks"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task",
    description: "할 일 하나를 수정한다. id 는 list_tasks 결과의 id. 바꿀 항목만 넣는다.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        due_time: { type: ["string", "null"], description: "HH:MM 또는 null" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        description: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_task",
    description: "할 일을 완료(또는 완료 취소) 처리한다.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, done: { type: "boolean" } },
      required: ["id", "done"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_task",
    description: "할 일을 삭제한다. 되돌릴 수 없으니 사용자 확인을 받은 뒤에만 호출한다.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_days_off",
    description: "쉬는 날(공휴일·재량휴업일·방학) 목록. from~to 기간과 겹치는 것.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "add_day_off",
    description: "쉬는 날을 등록한다. 그 기간엔 픽업·시간표 알림이 쉰다. 하루면 start=end.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "YYYY-MM-DD" },
        end: { type: "string", description: "YYYY-MM-DD" },
        reason: { type: "string", description: "예: 재량휴업일, 겨울방학, 개교기념일" },
        kind: { type: "string", enum: ["holiday", "school", "vacation", "other"] },
      },
      required: ["start", "end", "reason", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_day_off",
    description: "쉬는 날 등록을 지운다. id 는 get_days_off 결과의 id.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_timetable",
    description: "특정 요일의 시간표(수업·방과후·학원), 픽업 시각, 정각 알림(도보하원·이동). 활성 학기 기준.",
    input_schema: {
      type: "object",
      properties: { day: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "today", "tomorrow"] } },
      required: ["day"],
      additionalProperties: false,
    },
  },
  // ── 사진 초안 (저장 대기 중인 초안이 있을 때만 의미 있음) ──
  {
    name: "set_draft_tasks",
    description: "저장 대기 중인 알림장 초안의 할 일 목록을 통째로 바꾼다. 사용자가 고치자고 한 부분만 반영하고 나머지는 그대로 둔 전체 목록을 넘긴다. 결과로 새 초안을 돌려주니 그대로 보여준다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        document_title: { type: "string", description: "바꾸지 않으면 기존 제목 그대로" },
        tasks: { type: "array", items: DRAFT_TASK_SCHEMA },
        schedule_changes: { type: "array", items: DRAFT_CHANGE_SCHEMA, description: "초안의 시간표 변경 제안 전체(고친 것 반영). 없으면 빈 배열" },
      },
      required: ["document_title", "tasks", "schedule_changes"],
      additionalProperties: false,
    },
  },
  {
    name: "save_draft",
    description: "저장 대기 중인 초안을 할 일로 저장한다. 사용자가 '저장', '맞아', 'ㅇㅇ', '좋아' 등으로 확인했을 때.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "discard_draft",
    description: "저장 대기 중인 초안을 버린다. 사용자가 '취소', '버려', '아니야 저장하지 마' 라고 했을 때.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  // ── 시간표 편집 (말하는 사람 계정의 활성 학기) ──
  {
    name: "add_block",
    description: "매주 반복되는 시간표 수업을 추가한다 (정규·늘봄·방과후·학원). 그날만 하는 건 add_exception(kind=oneoff).",
    input_schema: {
      type: "object",
      properties: {
        day: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri"] },
        name: { type: "string" },
        start: { type: "string", description: "HH:MM" },
        end: { type: "string", description: "HH:MM" },
        category: { type: "string", enum: ["school", "aftercare", "academy", "other"], description: "school=정규/방과후, aftercare=늘봄/돌봄, academy=학원, other" },
        memo: { type: ["string", "null"], description: "장소 등. 없으면 null" },
      },
      required: ["day", "name", "start", "end", "category", "memo"],
      additionalProperties: false,
    },
  },
  {
    name: "update_block",
    description: "시간표 수업을 수정한다. id 는 get_timetable 의 blocks[].id. 바꿀 항목만.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" }, day: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri"] },
        start: { type: "string" }, end: { type: "string" },
        category: { type: "string", enum: ["school", "aftercare", "academy", "other"] }, memo: { type: ["string", "null"] },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_block",
    description: "시간표 수업을 영구 삭제한다 (매주 반복에서 빠짐). 사용자 확인 후에만. '이번 주만'이면 add_exception.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "set_pickups",
    description: "특정 요일의 픽업 시각을 통째로 바꾼다 (기존 것은 지워지고 이 목록으로). 비우려면 빈 배열.",
    input_schema: {
      type: "object",
      properties: { day: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri"] }, times: { type: "array", items: { type: "string", description: "HH:MM" } } },
      required: ["day", "times"],
      additionalProperties: false,
    },
  },
  {
    name: "add_alert",
    description: "정각 알림(도보하원, 이동 등)을 추가한다. 매주 반복.",
    input_schema: {
      type: "object",
      properties: {
        day: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri"] }, name: { type: "string" },
        time: { type: "string", description: "HH:MM" }, emoji: { type: ["string", "null"] },
      },
      required: ["day", "name", "time", "emoji"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_alert",
    description: "정각 알림을 삭제한다. id 는 get_timetable 의 alerts[].id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "list_terms",
    description: "학기 목록과 현재 활성 학기.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "set_active_term",
    description: "활성 학기를 바꾼다. 시간표·픽업·알림이 그 학기 것으로 전환된다. 없는 이름이면 새로 만든다.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
  },
  // ── 날짜별 예외 (가족 공용) ──
  {
    name: "add_exception",
    description: "특정 날짜(기간)에만 적용되는 시간표 예외. 수업/픽업/정각알림을 그날만 쉬거나(skip) 시간을 옮기거나(move), 일회성 일정을 더한다(add, kind=oneoff). 매주 반복을 바꾸는 게 아니다. 수업을 쉬게 하면 그날의 하원·이동 알림이나 픽업도 바뀌는지 사용자에게 묻는다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "YYYY-MM-DD" },
        end: { type: "string", description: "YYYY-MM-DD (하루면 start 와 같게)" },
        kind: { type: "string", enum: ["block", "pickup", "alert", "oneoff"] },
        target_name: { type: ["string", "null"], description: "block/alert: 수업·알림 이름(get_timetable 에 나온 이름). pickup: null. oneoff: 새 일정 이름" },
        target_time: { type: ["string", "null"], description: "원래 시각 HH:MM 으로 특정할 때 (픽업 17:35, 알림 15:10). 이름만으로 충분하면 null" },
        action: { type: "string", enum: ["skip", "move", "add"] },
        new_start: { type: ["string", "null"], description: "move/add: HH:MM" },
        new_end: { type: ["string", "null"], description: "move(블록)/add: HH:MM" },
        reason: { type: ["string", "null"], description: "예: 운동회, 휴강, 치과" },
      },
      required: ["start", "end", "kind", "target_name", "target_time", "action", "new_start", "new_end", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "list_exceptions",
    description: "기간 안의 시간표 예외 목록.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_exception",
    description: "시간표 예외를 지운다 (원래 시간표로 돌아감). id 는 list_exceptions 결과의 id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
];

const CATEGORY_COLORS = { school: "#45B7D1", aftercare: "#FECA57", academy: "#96CEB4", other: "#C39BD3" };
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// ── 진입점 ────────────────────────────────────────────────────
// deps: { supabaseQuery, supabaseHeaders, sendMessage, tg, getKSTDateString, formatKDate }
export async function handleAssistantText(env, { chatId, userTg, text }, deps) {
  const { sendMessage, tg } = deps;
  const todayStr = deps.getKSTDateString();

  try {
    if (RESET_WORDS.some((w) => text.trim() === w)) {
      await deleteConversation(env, deps, chatId);
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🧹 대화를 새로 시작할게요.");
      return;
    }

    // 하루 상한
    const usage = await getUsageToday(env, deps, chatId, todayStr);
    if (usage && usage.input_tokens >= DAILY_INPUT_TOKEN_CAP) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "오늘은 AI 사용량 상한에 닿았어요. 내일 다시 이야기해요. 🙏\n(할 일 확인·수정은 웹앱에서 할 수 있어요)");
      return;
    }

    await tg(env.TELEGRAM_BOT_TOKEN, "sendChatAction", { chat_id: chatId, action: "typing" });

    const history = await loadConversation(env, deps, chatId);
    const messages = [...history.messages, { role: "user", content: text }];
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
    const draftSession = await getDraftSession(env, deps, chatId);
    const ctxForTools = { env, deps, userId: userTg.user_id, chatId, todayStr, draftSession, userTg };

    const { reply, usageTotals } = await runLoop(client, buildSystemPrompt(todayStr, userTg, draftSession), messages, ctxForTools);

    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, toTelegramHtml(reply));

    const stored = trimHistory([...history.messages, { role: "user", content: text }, { role: "assistant", content: reply }]);
    await saveConversation(env, deps, chatId, userTg.user_id, stored, history.exists);
    await addUsage(env, deps, chatId, todayStr, usageTotals, usage);
  } catch (err) {
    console.error("assistant error:", err);
    const brief = describeError(err);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ 잠시 문제가 생겼어요. ${brief}\n다시 한 번 말씀해 주세요.`);
  }
}

// ── Claude 호출 루프 ──────────────────────────────────────────
async function runLoop(client, system, messages, ctx) {
  const usageTotals = { input: 0, cache_read: 0, output: 0, calls: 0 };
  let lastText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      output_config: { effort: "low" },
      system: [{ type: "text", text: system }],
      tools: TOOLS,
      messages,
    });
    accumulate(usageTotals, res.usage);

    const textParts = res.content.filter((b) => b.type === "text").map((b) => b.text);
    if (textParts.length) lastText = textParts.join("\n").trim();

    if (res.stop_reason === "refusal") {
      return { reply: "그 요청은 도와드리기 어려워요. 🙏", usageTotals };
    }
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    if (res.stop_reason !== "tool_use") {
      return { reply: lastText || "(답을 만들지 못했어요)", usageTotals };
    }

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const tu of toolUses) {
      let out;
      try {
        out = await executeTool(tu.name, tu.input, ctx);
      } catch (err) {
        console.error(`tool ${tu.name} error:`, err);
        results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: String(err && err.message || err).slice(0, 300) });
        continue;
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: lastText || "처리가 길어져서 여기까지만 했어요. 다시 말씀해 주세요.", usageTotals };
}

function accumulate(t, u) {
  if (!u) return;
  t.calls += 1;
  t.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  t.cache_read += u.cache_read_input_tokens || 0;
  t.output += u.output_tokens || 0;
}

function buildSystemPrompt(todayStr, userTg, draftSession) {
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const d = new Date(todayStr + "T00:00:00Z");
  const who = userTg.display_name ? `지금 말하는 사람: ${userTg.display_name}` : "";
  let draftNote = "";
  if (draftSession && draftSession.draft) {
    const dr = draftSession.draft;
    const lines = (dr.tasks || []).map((t, i) => `${i + 1}. ${t.title} | ${t.due_date}${t.due_time ? " " + t.due_time : ""} | ${t.priority} | ${t.category}${t.description ? " | " + t.description.slice(0, 80) : ""}`);
    const changes = (dr.schedule_changes || []).map((c, i) => `${String.fromCharCode(0x2460 + i)} ${JSON.stringify(c)}`);
    draftNote = `

[저장 대기 중인 알림장 초안] 제목: ${dr.document_title}
요약: ${dr.summary || ""}
사진에서 읽은 사실: ${(dr.key_facts || []).join(" / ") || "(없음)"}
할 일 목록:
${lines.join("\n") || "(비어 있음)"}
시간표 변경 제안(①②…로 지칭):
${changes.join("\n") || "(없음)"}
${dr.unclear && dr.unclear.length ? "확인 필요: " + dr.unclear.join(" / ") : ""}
- 사용자가 번호를 말하면 이 초안의 번호다. 고치자고 하면 set_draft_tasks 로 전체 목록(고친 것 반영, 나머지 그대로)을 넘기고, 돌아온 초안을 그대로 보여준다.
- 목록이 비어 있는데 "넣어줘"라고 하면, 위 '사진에서 읽은 사실'을 바탕으로 할 일을 만들어 set_draft_tasks 로 넘기고 보여준 뒤 저장할지 묻는다. 지난 날짜도 사용자가 원하면 넣는다.
- "저장", "맞아", "ㅇㅇ", "좋아", "그대로" → save_draft. "취소", "버려", "닫아" → discard_draft.
- 초안과 상관없는 질문이면 평소처럼 답하되, 초안이 기다리고 있다고 한 줄 덧붙인다.`;
  }
  return `너는 "SchoolToDo" 가족 비서야. 초등학생 자녀를 둔 부모 두 명이 텔레그램으로 쓴다.
오늘: ${todayStr} (${dayNames[d.getUTCDay()]}요일), 한국 시간. ${who}

할 수 있는 일: 할 일(알림장에서 뽑은 준비물·제출물·일정·납부) 조회/추가/수정/완료/삭제, 쉬는 날(공휴일·재량휴업·방학) 등록/조회, 시간표·픽업·정각알림 조회와 편집, 학기 전환, 날짜별 시간표 예외(그날만 쉼·시간 변경·일회성 일정), 알림장 사진 초안 수정·저장.
아직 못 하는 일: 보관함 검색. 사진은 보내면 자동으로 초안이 만들어진다.

시간표 규칙:
- "매주" 바뀌는 것(새 학원, 시간 변경)은 add_block/update_block/delete_block/set_pickups/add_alert. 시간표는 말하는 사람 계정 기준이다.
- "이번 주만", "내일만", "10/8 은" 처럼 특정 날짜 얘기는 add_exception (가족 공용). 반복 시간표는 건드리지 않는다.
- "이번 주"는 오늘이 속한 월~일, 단 오늘이 토·일이면 다음 주를 뜻할 수 있으니 날짜를 말하며 확인한다.
- 예외를 넣기 전엔 get_timetable 로 그날 실제 수업·픽업·알림을 보고, 이름을 그대로 쓴다. 수업을 쉬게 하면 그날의 도보하원·이동 알림이나 픽업 시각도 바뀌는지 한 번 묻는다.
- 삭제(delete_block/delete_alert/delete_exception)와 학기 전환은 실행 전 확인.${draftNote}

원칙:
- 사실은 반드시 도구로 확인한다. 기억이나 추측으로 지어내지 않는다.
- 삭제, 세 개 이상을 한 번에 바꾸기, 날짜가 애매한 경우는 실행 전에 한 줄로 확인을 받는다. 단순 추가·완료는 바로 한다.
- 상대 날짜("내일", "다음 주 월요일", "이번 주 금요일")는 오늘 기준으로 계산해 YYYY-MM-DD 로 넘긴다. 애매하면 묻는다. 날짜가 없는 할 일은 오늘로.
- 사용자가 번호로 지칭하면(예: "3번") 직전에 보여준 목록의 번호다. 목록을 보여준 적이 없거나 확실하지 않으면 list_tasks 로 다시 확인한 뒤 처리한다.
- 답은 짧게, 존댓말, 이모지는 조금만. 목록은 "번호. 제목 — 날짜(요일)" 형식. 긴 설명 금지.
- 서식은 <b>, <i>, <code> 만 쓴다. 마크다운(**, #, -) 금지. 줄바꿈으로 구분.
- 도구를 쓸 때 한 문장 정도 먼저 말해도 된다. 도구로 표현할 수 없는 요청이면 추측하지 말고 그렇다고 말한다. 내부 또는 시스템 XML 태그를 답에 넣지 않는다.`;
}

// ── 도구 실행 ─────────────────────────────────────────────────
async function executeTool(name, input, ctx) {
  const { env, deps, userId, todayStr } = ctx;
  const q = (path, opts) => deps.supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, path, opts);
  const asArray = (r) => (Array.isArray(r) ? r : (() => { throw new Error(r && r.message ? r.message : "query failed"); })());

  switch (name) {
    case "list_tasks": {
      const { range, include_done } = input;
      const { from, to } = rangeToDates(range, todayStr);
      let query = `?user_id=eq.${userId}&select=id,title,due_date,due_time,priority,category,is_completed,description&order=due_date.asc,due_time.asc.nullslast,created_at.asc`;
      if (from) query += `&due_date=gte.${from}`;
      if (to) query += `&due_date=lte.${to}`;
      if (!include_done && range !== "all") query += `&is_completed=eq.false`;
      const rows = asArray(await q("tasks", { query }));
      return rows.map((t, i) => ({
        n: i + 1, id: t.id, title: t.title, due_date: t.due_date, weekday: weekdayOf(t.due_date),
        due_time: t.due_time ? t.due_time.slice(0, 5) : null, priority: t.priority, category: t.category,
        done: t.is_completed, description: t.description ? String(t.description).slice(0, 120) : "",
      }));
    }
    case "add_tasks": {
      const saved = [];
      for (const t of input.tasks || []) {
        if (!isDate(t.due_date)) throw new Error(`due_date 형식 오류: ${t.due_date}`);
        const r = asArray(await q("tasks", {
          method: "POST",
          body: {
            user_id: userId, title: String(t.title).slice(0, 200), due_date: t.due_date,
            due_time: t.due_time || null, priority: t.priority || "medium", category: t.category || "other",
            description: t.description || "",
          },
        }));
        if (r[0]) saved.push({ id: r[0].id, title: r[0].title, due_date: r[0].due_date, weekday: weekdayOf(r[0].due_date) });
      }
      return { saved };
    }
    case "update_task": {
      const { id, ...patch } = input;
      const body = {};
      if (patch.title !== undefined) body.title = String(patch.title).slice(0, 200);
      if (patch.due_date !== undefined) { if (!isDate(patch.due_date)) throw new Error("due_date 형식 오류"); body.due_date = patch.due_date; }
      if (patch.due_time !== undefined) body.due_time = patch.due_time || null;
      if (patch.priority !== undefined) body.priority = patch.priority;
      if (patch.description !== undefined) body.description = patch.description;
      if (Object.keys(body).length === 0) throw new Error("바꿀 항목이 없음");
      const r = asArray(await q("tasks", { method: "PATCH", body, query: `?id=eq.${id}&user_id=eq.${userId}` }));
      if (!r[0]) throw new Error("해당 id 의 할 일이 없음");
      return { updated: { id: r[0].id, title: r[0].title, due_date: r[0].due_date, weekday: weekdayOf(r[0].due_date), due_time: r[0].due_time } };
    }
    case "complete_task": {
      const r = asArray(await q("tasks", {
        method: "PATCH",
        body: { is_completed: !!input.done, completed_at: input.done ? new Date().toISOString() : null },
        query: `?id=eq.${input.id}&user_id=eq.${userId}`,
      }));
      if (!r[0]) throw new Error("해당 id 의 할 일이 없음");
      return { id: r[0].id, title: r[0].title, done: r[0].is_completed };
    }
    case "delete_task": {
      const r = asArray(await q("tasks", { method: "DELETE", query: `?id=eq.${input.id}&user_id=eq.${userId}` }));
      if (!r[0]) throw new Error("해당 id 의 할 일이 없음");
      return { deleted: { id: r[0].id, title: r[0].title } };
    }
    case "get_days_off": {
      if (!isDate(input.from) || !isDate(input.to)) throw new Error("날짜 형식 오류");
      const rows = asArray(await q("days_off", {
        query: `?start_date=lte.${input.to}&end_date=gte.${input.from}&order=start_date.asc&select=id,start_date,end_date,reason,kind`,
      }));
      return rows;
    }
    case "add_day_off": {
      if (!isDate(input.start) || !isDate(input.end) || input.end < input.start) throw new Error("날짜 형식 오류");
      const dup = asArray(await q("days_off", { query: `?start_date=lte.${input.end}&end_date=gte.${input.start}&select=id,reason,start_date,end_date` }));
      if (dup.length) return { already_exists: dup };
      const r = asArray(await q("days_off", {
        method: "POST",
        body: { start_date: input.start, end_date: input.end, reason: String(input.reason).slice(0, 100), kind: input.kind || "school", created_by: userId },
      }));
      return { added: r[0] };
    }
    case "delete_day_off": {
      const r = asArray(await q("days_off", { method: "DELETE", query: `?id=eq.${input.id}` }));
      if (!r[0]) throw new Error("해당 id 가 없음");
      return { deleted: r[0] };
    }
    case "get_timetable": {
      const dayKey = resolveDayKey(input.day, todayStr);
      if (!dayKey) return { note: "주말에는 시간표가 없어요", day: input.day };
      const term = await activeTermOf(q, userId);
      const termFilter = term ? `&term=eq.${encodeURIComponent(term)}` : "";
      const dateStr = dateForDay(input.day, dayKey, todayStr);
      const [blocks, pickups, alerts, exceptions] = await Promise.all([
        q("timetable_blocks", { query: `?user_id=eq.${userId}&day=eq.${dayKey}${termFilter}&order=start_time.asc&select=id,name,start_time,end_time,category,memo` }),
        q("timetable_pickups", { query: `?user_id=eq.${userId}&day=eq.${dayKey}${termFilter}&order=pickup_time.asc&select=id,pickup_time,memo` }),
        q("timetable_alerts", { query: `?user_id=eq.${userId}&day=eq.${dayKey}&is_active=eq.true${termFilter}&order=alert_time.asc&select=id,name,alert_time` }),
        getExceptions(env, deps, dateStr),
      ]);
      const hm = (t) => (t ? String(t).slice(0, 5) : null);
      const rawBlocks = asArray(blocks).map((b) => ({ id: b.id, name: b.name, start: hm(b.start_time), end: hm(b.end_time), category: b.category, memo: b.memo }));
      const rawPickups = asArray(pickups).map((p) => ({ id: p.id, time: hm(p.pickup_time), memo: p.memo }));
      const rawAlerts = asArray(alerts).map((a) => ({ id: a.id, name: a.name, time: hm(a.alert_time) }));
      return {
        day: dayKey, date: dateStr, weekday: weekdayOf(dateStr), term,
        blocks: applyToBlocks(exceptions, rawBlocks).map((b) => ({ ...b, exception: b.exception ? describeException(b.exception) : undefined })),
        pickups: rawPickups.map((p) => { const ex = pickupException(exceptions, p.time); return ex ? { ...p, exception: describeException(ex), effective: ex.action === "skip" ? null : (ex.new_start || p.time) } : p; }),
        alerts: rawAlerts.map((a) => { const ex = alertException(exceptions, a); return ex ? { ...a, exception: describeException(ex), effective: ex.action === "skip" ? null : (ex.new_start || a.time) } : a; }),
        exceptions_on_date: exceptions.map((e) => ({ id: e.id, ...e })),
      };
    }

    // ── 시간표 편집 ──
    case "add_block": {
      if (!isTime(input.start) || !isTime(input.end) || input.end <= input.start) throw new Error("시각 형식 오류 (HH:MM, 끝이 시작보다 뒤)");
      const term = await activeTermOf(q, userId);
      const r = asArray(await q("timetable_blocks", {
        method: "POST",
        body: {
          user_id: userId, name: String(input.name).slice(0, 50), day: input.day, start_time: input.start + ":00", end_time: input.end + ":00",
          category: input.category, color: CATEGORY_COLORS[input.category] || "#4ECDC4", memo: input.memo || null, term: term || null,
        },
      }));
      return { added: brief(r[0]) };
    }
    case "update_block": {
      const { id, ...p } = input;
      const body = { updated_at: new Date().toISOString() };
      if (p.name !== undefined) body.name = String(p.name).slice(0, 50);
      if (p.day !== undefined) body.day = p.day;
      if (p.start !== undefined) { if (!isTime(p.start)) throw new Error("start 형식 오류"); body.start_time = p.start + ":00"; }
      if (p.end !== undefined) { if (!isTime(p.end)) throw new Error("end 형식 오류"); body.end_time = p.end + ":00"; }
      if (p.category !== undefined) { body.category = p.category; body.color = CATEGORY_COLORS[p.category] || "#4ECDC4"; }
      if (p.memo !== undefined) body.memo = p.memo;
      const r = asArray(await q("timetable_blocks", { method: "PATCH", body, query: `?id=eq.${id}&user_id=eq.${userId}` }));
      if (!r[0]) throw new Error("해당 id 의 수업이 없음");
      return { updated: brief(r[0]) };
    }
    case "delete_block": {
      const r = asArray(await q("timetable_blocks", { method: "DELETE", query: `?id=eq.${input.id}&user_id=eq.${userId}` }));
      if (!r[0]) throw new Error("해당 id 의 수업이 없음");
      return { deleted: brief(r[0]) };
    }
    case "set_pickups": {
      const times = [...new Set((input.times || []).filter(isTime))];
      const term = await activeTermOf(q, userId);
      const termQ = term ? `&term=eq.${encodeURIComponent(term)}` : "&term=is.null";
      await q("timetable_pickups", { method: "DELETE", query: `?user_id=eq.${userId}&day=eq.${input.day}${termQ}` });
      const saved = [];
      for (const t of times) {
        const r = asArray(await q("timetable_pickups", { method: "POST", body: { user_id: userId, day: input.day, pickup_time: t + ":00", term: term || null } }));
        if (r[0]) saved.push(t);
      }
      return { day: input.day, pickups: saved };
    }
    case "add_alert": {
      if (!isTime(input.time)) throw new Error("시각 형식 오류");
      const term = await activeTermOf(q, userId);
      const r = asArray(await q("timetable_alerts", {
        method: "POST",
        body: { user_id: userId, name: String(input.name).slice(0, 100), day: input.day, alert_time: input.time + ":00", emoji: input.emoji || "🔔", is_active: true, term: term || null },
      }));
      return { added: { id: r[0].id, name: r[0].name, day: r[0].day, time: String(r[0].alert_time).slice(0, 5) } };
    }
    case "delete_alert": {
      const r = asArray(await q("timetable_alerts", { method: "DELETE", query: `?id=eq.${input.id}&user_id=eq.${userId}` }));
      if (!r[0]) throw new Error("해당 id 의 알림이 없음");
      return { deleted: { id: r[0].id, name: r[0].name } };
    }
    case "list_terms": {
      const [terms, active] = await Promise.all([
        q("timetable_terms", { query: `?user_id=eq.${userId}&order=sort_order.asc,name.asc&select=name` }),
        activeTermOf(q, userId),
      ]);
      return { terms: asArray(terms).map((t) => t.name), active };
    }
    case "set_active_term": {
      const name = String(input.name).slice(0, 30);
      const existing = asArray(await q("timetable_terms", { query: `?user_id=eq.${userId}&name=eq.${encodeURIComponent(name)}&select=id` }));
      if (!existing[0]) await q("timetable_terms", { method: "POST", body: { user_id: userId, name } });
      const r = asArray(await q("profiles", { method: "PATCH", body: { active_term: name }, query: `?id=eq.${userId}` }));
      return { active: r[0] ? r[0].active_term : name, created: !existing[0] };
    }

    // ── 날짜별 예외 ──
    case "add_exception": {
      if (!isDate(input.start) || !isDate(input.end) || input.end < input.start) throw new Error("날짜 형식 오류");
      if (input.action !== "skip" && !isTime(input.new_start)) throw new Error("move/add 는 new_start(HH:MM) 필요");
      if (input.action === "add" && (input.kind !== "oneoff" || !input.target_name)) throw new Error("add 는 kind=oneoff + target_name 필요");
      if (input.kind === "pickup" && input.target_name) input.target_name = null;
      const r = asArray(await q("schedule_exceptions", {
        method: "POST",
        body: {
          start_date: input.start, end_date: input.end, kind: input.kind,
          target_name: input.target_name ? String(input.target_name).slice(0, 100) : null,
          target_time: isTime(input.target_time) ? input.target_time + ":00" : null,
          action: input.action,
          new_start: isTime(input.new_start) ? input.new_start + ":00" : null,
          new_end: isTime(input.new_end) ? input.new_end + ":00" : null,
          reason: input.reason ? String(input.reason).slice(0, 100) : null, created_by: userId,
        },
      }));
      return { added: { id: r[0].id, text: describeException({ ...r[0], target_time: hm5(r[0].target_time), new_start: hm5(r[0].new_start), new_end: hm5(r[0].new_end) }), start: r[0].start_date, end: r[0].end_date } };
    }
    case "list_exceptions": {
      if (!isDate(input.from) || !isDate(input.to)) throw new Error("날짜 형식 오류");
      const rows = asArray(await q("schedule_exceptions", {
        query: `?start_date=lte.${input.to}&end_date=gte.${input.from}&order=start_date.asc&select=id,start_date,end_date,kind,target_name,target_time,action,new_start,new_end,reason`,
      }));
      return rows.map((e) => { const x = { ...e, target_time: hm5(e.target_time), new_start: hm5(e.new_start), new_end: hm5(e.new_end) }; return { id: e.id, start: e.start_date, end: e.end_date, text: describeException(x) }; });
    }
    case "delete_exception": {
      const r = asArray(await q("schedule_exceptions", { method: "DELETE", query: `?id=eq.${input.id}` }));
      if (!r[0]) throw new Error("해당 id 의 예외가 없음");
      return { deleted: r[0].id };
    }
    case "set_draft_tasks": {
      if (!ctx.draftSession) throw new Error("저장 대기 중인 초안이 없음");
      const draft = await updateDraft(env, deps, ctx.draftSession, { document_title: input.document_title, tasks: input.tasks, schedule_changes: input.schedule_changes || [] });
      ctx.draftSession = { ...ctx.draftSession, draft };
      return { ok: true, draft_preview: renderDraft(draft, (s) => String(s ?? "")).replace(/<[^>]+>/g, "") };
    }
    case "save_draft": {
      if (!ctx.draftSession) throw new Error("저장 대기 중인 초안이 없음");
      const result = await saveDraft(env, deps, { session: ctx.draftSession, userTg: ctx.userTg });
      await removeDraftButtons(env, deps, ctx);
      ctx.draftSession = null;
      return {
        saved: result.saved.map((t) => ({ title: t.title, due_date: t.due_date, weekday: weekdayOf(t.due_date) })),
        skipped_duplicates: result.duplicates.map((d) => ({ title: d.title, due_date: d.due_date, existing: d.existing })),
        summary_text: renderSaveResult(result, (s) => String(s ?? "")).replace(/<[^>]+>/g, ""),
      };
    }
    case "discard_draft": {
      if (!ctx.draftSession) throw new Error("저장 대기 중인 초안이 없음");
      await discardDraft(env, deps, ctx.draftSession);
      await removeDraftButtons(env, deps, ctx);
      ctx.draftSession = null;
      return { ok: true };
    }
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}

// 초안 메시지의 [저장][취소] 버튼을 지운다 (말로 처리했을 때 버튼이 남지 않게)
async function removeDraftButtons(env, deps, ctx) {
  const mid = ctx.draftSession && ctx.draftSession.draft_message_id;
  if (!mid) return;
  try {
    await deps.tg(env.TELEGRAM_BOT_TOKEN, "editMessageReplyMarkup", { chat_id: ctx.chatId, message_id: mid });
  } catch (err) {
    console.error("removeDraftButtons:", err);
  }
}

// draft.js 가 사용량을 같은 표에 더할 때 쓴다 (deps.addUsage)
export async function recordUsage(env, deps, chatId, day, usage) {
  const existing = await getUsageToday(env, deps, chatId, day);
  await addUsage(env, deps, chatId, day, usage, existing);
}

// ── 시간표 유틸 ───────────────────────────────────────────────
function isTime(s) { return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
const hm5 = (t) => (t ? String(t).slice(0, 5) : null);
function brief(b) { return b ? { id: b.id, name: b.name, day: b.day, start: hm5(b.start_time), end: hm5(b.end_time), category: b.category, memo: b.memo } : null; }
async function activeTermOf(q, userId) {
  const prof = await q("profiles", { query: `?id=eq.${userId}&select=active_term` });
  return Array.isArray(prof) && prof[0] ? prof[0].active_term : null;
}
// "today"/"tomorrow" 는 그 날짜, 요일 이름이면 오늘 이후 가장 가까운 그 요일
function dateForDay(dayInput, dayKey, today) {
  if (dayInput === "today") return today;
  if (dayInput === "tomorrow") return addDays(today, 1);
  const want = DAY_KEYS.indexOf(dayKey);
  const cur = new Date(today + "T00:00:00Z").getUTCDay();
  return addDays(today, (want - cur + 7) % 7);
}

// ── 날짜 유틸 ─────────────────────────────────────────────────
function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

function weekdayOf(dateStr) {
  if (!isDate(dateStr)) return null;
  return ["일", "월", "화", "수", "목", "금", "토"][new Date(dateStr + "T00:00:00Z").getUTCDay()];
}

function rangeToDates(range, today) {
  const dow = new Date(today + "T00:00:00Z").getUTCDay(); // 0=일
  const monday = addDays(today, dow === 0 ? -6 : 1 - dow);
  switch (range) {
    case "today": return { from: today, to: today };
    case "tomorrow": { const t = addDays(today, 1); return { from: t, to: t }; }
    case "week": return { from: monday, to: addDays(monday, 6) };
    case "next_week": return { from: addDays(monday, 7), to: addDays(monday, 13) };
    case "overdue": return { from: null, to: addDays(today, -1) };
    case "all": return { from: null, to: null };
    case "upcoming":
    default: return { from: today, to: null };
  }
}

function resolveDayKey(day, today) {
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let k = day;
  if (day === "today") k = keys[new Date(today + "T00:00:00Z").getUTCDay()];
  if (day === "tomorrow") k = keys[new Date(addDays(today, 1) + "T00:00:00Z").getUTCDay()];
  return ["mon", "tue", "wed", "thu", "fri"].includes(k) ? k : null;
}

// ── 대화 저장 ─────────────────────────────────────────────────
async function loadConversation(env, deps, chatId) {
  const rows = await deps.supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "bot_conversations", {
    query: `?chat_id=eq.${chatId}&select=messages,updated_at`,
  });
  if (!Array.isArray(rows)) {
    if (rows && rows.message) console.error("bot_conversations read error:", rows.message);
    return { messages: [], exists: false };
  }
  if (!rows[0]) return { messages: [], exists: false };
  const ageMin = (Date.now() - Date.parse(rows[0].updated_at)) / 60000;
  const msgs = Array.isArray(rows[0].messages) ? rows[0].messages : [];
  return { messages: ageMin > CONVERSATION_TTL_MIN ? [] : msgs, exists: true };
}

function trimHistory(msgs) {
  const clean = msgs.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim());
  let out = clean.slice(-STORED_TURNS);
  while (out.length && out[0].role !== "user") out = out.slice(1);
  return out;
}

async function saveConversation(env, deps, chatId, userId, messages, exists) {
  const body = { chat_id: chatId, user_id: userId, messages, updated_at: new Date().toISOString() };
  const r = await deps.supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "bot_conversations", exists
    ? { method: "PATCH", body, query: `?chat_id=eq.${chatId}` }
    : { method: "POST", body });
  if (r && !Array.isArray(r) && r.message) console.error("bot_conversations save error:", r.message);
}

async function deleteConversation(env, deps, chatId) {
  await deps.supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "bot_conversations", {
    method: "DELETE", query: `?chat_id=eq.${chatId}`,
  });
}

// ── 사용량 ────────────────────────────────────────────────────
async function getUsageToday(env, deps, chatId, day) {
  const rows = await deps.supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "bot_usage", {
    query: `?chat_id=eq.${chatId}&day=eq.${day}&select=calls,input_tokens,cache_read,output_tokens`,
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function addUsage(env, deps, chatId, day, t, existing) {
  const body = {
    chat_id: chatId, day,
    calls: (existing ? existing.calls : 0) + t.calls,
    input_tokens: (existing ? existing.input_tokens : 0) + t.input,
    cache_read: (existing ? existing.cache_read : 0) + t.cache_read,
    output_tokens: (existing ? existing.output_tokens : 0) + t.output,
    updated_at: new Date().toISOString(),
  };
  const r = await deps.supabaseQuery(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "bot_usage", existing
    ? { method: "PATCH", body, query: `?chat_id=eq.${chatId}&day=eq.${day}` }
    : { method: "POST", body });
  if (r && !Array.isArray(r) && r.message) console.error("bot_usage save error:", r.message);
  console.log(`[Assistant] chat=${chatId} calls=${t.calls} in=${t.input} (cache ${t.cache_read}) out=${t.output}`);
}

// ── 텔레그램 HTML ─────────────────────────────────────────────
// 모델 출력을 전부 이스케이프한 뒤 허용 태그(b, i, code, pre)만 되살린다.
export function toTelegramHtml(text) {
  let s = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const tag of ["b", "i", "code", "pre"]) {
    s = s.replace(new RegExp(`&lt;${tag}&gt;`, "g"), `<${tag}>`).replace(new RegExp(`&lt;/${tag}&gt;`, "g"), `</${tag}>`);
  }
  // 마크다운 굵게가 섞여 나오면 걷어낸다
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  if (s.length > TELEGRAM_MAX_LEN) s = s.slice(0, TELEGRAM_MAX_LEN) + "\n…(생략)";
  return s;
}

function describeError(err) {
  if (!err) return "";
  if (err instanceof Anthropic.AuthenticationError) return "(AI 키 설정을 확인해야 해요)";
  if (err instanceof Anthropic.RateLimitError) return "(AI 요청이 몰렸어요)";
  if (err instanceof Anthropic.APIError) {
    // 디버깅용으로 API 메시지 앞부분을 같이 보여준다 (비밀값 없음)
    const m = (err.error && err.error.error && err.error.error.message) || err.message || "";
    return `(AI 오류 ${err.status || ""}: ${String(m).replace(/\s+/g, " ").slice(0, 160)})`;
  }
  return "";
}
