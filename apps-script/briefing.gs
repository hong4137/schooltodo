/**
 * SchoolToDo 네스트 브리핑 — Google Apps Script (웹 앱)
 *
 * ⚠️ 재구성본. 2026-10-11 기준 Apps Script 편집기의 원본을 내려받지 못해, Worker 가 보내는 요청 규격에 맞춰 다시 썼다.
 *    실제 배포된 스크립트(프로젝트 이름 schooltodo-briefing)와 대조해서 원본으로 교체할 것.
 *
 * 흐름: Worker(07:10 KST) → POST 이 웹 앱 → Google Tasks 에 오늘 브리핑 1건 생성
 *       → Google Home 루틴(07:25) "내 오늘 일정 알려줘" 가 Google Tasks 를 읽어 네스트가 말해 준다.
 *
 * 요청:  { "action": "createBriefing", "date": "2026-10-13", "title": "...", "description": "..." }
 * 응답:  { "success": true, "taskId": "..." }  |  { "success": false, "error": "..." }
 *
 * 배포: 배포 → 새 배포 → 웹 앱, 실행 주체 "나", 액세스 "모든 사용자". 그 URL 을 Worker 비밀 BRIEFING_APPS_SCRIPT_URL 에.
 * 서비스: 왼쪽 "서비스 +" 에서 Tasks API 추가 (식별자 Tasks).
 */

var BRIEFING_TAG = "[SchoolToDo]"; // 같은 날 브리핑이 중복되지 않게 이 태그로 기존 것을 찾아 지운다

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || "{}");
    if (body.action !== "createBriefing") {
      return json_({ success: false, error: "unknown action: " + body.action });
    }
    var date = body.date;                 // YYYY-MM-DD (KST)
    var title = String(body.title || "오늘 할 일");
    var notes = String(body.description || "");

    var listId = defaultTaskListId_();
    removeOldBriefings_(listId, date);

    var due = new Date(date + "T00:00:00+09:00");
    var task = Tasks.Tasks.insert({
      title: title,
      notes: BRIEFING_TAG + " " + date + "\n\n" + notes,
      due: due.toISOString(),
      status: "needsAction",
    }, listId);

    return json_({ success: true, taskId: task.id });
  } catch (err) {
    return json_({ success: false, error: String(err && err.message || err) });
  }
}

// 수동 확인용: 편집기에서 실행하면 요청 없이 오늘 브리핑을 하나 만든다
function testCreate() {
  var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  var res = doPost({ postData: { contents: JSON.stringify({ action: "createBriefing", date: today, title: "테스트 브리핑", description: "1. 🟡 테스트" }) } });
  Logger.log(res.getContent());
}

function defaultTaskListId_() {
  var lists = Tasks.Tasklists.list({ maxResults: 10 });
  if (!lists.items || !lists.items.length) throw new Error("Google Tasks 목록이 없음");
  return lists.items[0].id; // 기본 목록 ("내 할 일")
}

// 같은 날짜의 이전 브리핑(태그 포함)을 지운다 — Cron 이 두 번 돌아도 하나만 남게
function removeOldBriefings_(listId, date) {
  var res = Tasks.Tasks.list(listId, { showCompleted: true, showHidden: true, maxResults: 100 });
  var items = (res && res.items) || [];
  for (var i = 0; i < items.length; i++) {
    var t = items[i];
    if (t.notes && t.notes.indexOf(BRIEFING_TAG + " " + date) === 0) {
      Tasks.Tasks.remove(listId, t.id);
    }
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
