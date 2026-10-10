/**
 * ═══════════════════════════════════════════════════════════════
 * SchoolToDo Nest Hub 브리핑 (Google Tasks 버전) - Apps Script
 * ═══════════════════════════════════════════════════════════════
 *
 * 매일 아침 Cloudflare Worker가 호출하여 Google Tasks(할 일)에
 * 오늘의 브리핑 항목을 생성한다. Nest Hub가 07:30 루틴으로 이 할 일을 낭독.
 * 본인의 개인 할 일과 섞이거나 삭제되는 것을 막기 위해
 * 생성되는 할 일 앞에는 항상 "[브리핑]" 접두사가 붙습니다.
 *
 * ─── 설치 절차 (매우 중요!) ───────────────────────────────────
 * 1. 좌측 메뉴에서 '서비스(Services)' 옆에 있는 '+' 버튼 클릭
 * 2. 'Google Tasks API'를 찾아 선택하고 '추가(Add)' 클릭
 * (이 과정을 거치지 않으면 Tasks 객체를 찾을 수 없어 에러가 납니다!)
 *
 * 3. 배포
 * - 배포 → 새 배포 → 유형: 웹 앱
 * - 실행 대상: 나 (본인)
 * - 액세스: 모든 사용자 ("누구나"로 설정해야 Worker가 호출 가능)
 * - 배포 → 웹 앱 URL 복사 및 Worker에 반영
 */

// ═══════════════════════════════════════════════════════════════
// 설정
// ═══════════════════════════════════════════════════════════════

// 기본 할 일 목록(Default Task List)을 사용합니다.
const TASK_LIST_ID = "@default";
const BRIEFING_PREFIX = "[브리핑] ";

// ═══════════════════════════════════════════════════════════════
// 메인 핸들러
// ═══════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === "createBriefing") {
      return createBriefing(data);
    }
    if (action === "clearBriefing") {
      return clearBriefing(data);
    }
    if (action === "cleanupBriefing") {
      return cleanupBriefing(data);
    }
    return jsonResponse({ success: false, error: "unknown action: " + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// GET으로 접속 시 동작 확인용
function doGet(e) {
  return jsonResponse({
    service: "schooltodo-tasks-briefing",
    status: "ready"
  });
}

// ═══════════════════════════════════════════════════════════════
// 브리핑 할 일(Task) 생성
// ═══════════════════════════════════════════════════════════════

/**
 * data = {
 * action: "createBriefing",
 * date: "2026-04-22",
 * title: "입학식 준비물, 체육복 세탁, 숙제",
 * description: "상세:\n1. ...\n2. ..."
 * }
 */
function createBriefing(data) {
  if (!data.date || !data.title) {
    return jsonResponse({ success: false, error: "date and title required" });
  }

  const targetDateStr = data.date; // "2026-04-22"

  let deletedOld = 0;
  let deletedToday = 0;

  // 1. 기존 브리핑 할 일 정리 (오늘 중복 및 과거 브리핑 삭제)
  // 개인 할 일을 보호하기 위해 title이 BRIEFING_PREFIX로 시작하는 것만 삭제합니다.
  let pageToken;
  do {
    const response = Tasks.Tasks.list(TASK_LIST_ID, {
      showCompleted: true,
      showHidden: true,
      maxResults: 100,
      pageToken: pageToken
    });

    const tasks = response.items;
    if (tasks) {
      tasks.forEach(task => {
        if (task.title && task.title.startsWith(BRIEFING_PREFIX)) {
          const taskDueDate = task.due ? task.due.substring(0, 10) : ""; // YYYY-MM-DD 추출

          if (!taskDueDate || taskDueDate < targetDateStr) {
            Tasks.Tasks.remove(TASK_LIST_ID, task.id);
            deletedOld++;
          } else if (taskDueDate === targetDateStr) {
            Tasks.Tasks.remove(TASK_LIST_ID, task.id);
            deletedToday++;
          }
        }
      });
    }
    pageToken = response.nextPageToken;
  } while (pageToken);

  // 2. 새 할 일 생성 (Tasks API 요구사항에 맞춰 RFC3339 시간 포맷팅)
  const newTask = {
    title: BRIEFING_PREFIX + data.title,
    notes: data.description || "",
    due: targetDateStr + "T00:00:00.000Z" // Task API는 UTC 기준 자정을 해당 날짜로 인식
  };

  const createdTask = Tasks.Tasks.insert(newTask, TASK_LIST_ID);

  return jsonResponse({
    success: true,
    taskId: createdTask.id,
    title: newTask.title,
    date: targetDateStr,
    deletedToday: deletedToday,
    deletedOld: deletedOld
  });
}

/**
 * 특정 날짜의 브리핑 삭제 (수동 트리거/디버그용)
 */
function clearBriefing(data) {
  if (!data.date) {
    return jsonResponse({ success: false, error: "date required" });
  }

  const targetDateStr = data.date;
  let deletedCount = 0;

  let pageToken;
  do {
    const response = Tasks.Tasks.list(TASK_LIST_ID, {
      showCompleted: true,
      showHidden: true,
      maxResults: 100,
      pageToken: pageToken
    });

    const tasks = response.items;
    if (tasks) {
      tasks.forEach(task => {
        if (task.title && task.title.startsWith(BRIEFING_PREFIX)) {
          const taskDueDate = task.due ? task.due.substring(0, 10) : "";
          if (taskDueDate === targetDateStr) {
            Tasks.Tasks.remove(TASK_LIST_ID, task.id);
            deletedCount++;
          }
        }
      });
    }
    pageToken = response.nextPageToken;
  } while (pageToken);

  return jsonResponse({
    success: true,
    deletedCount: deletedCount,
    date: data.date
  });
}

/**
 * 오늘 이전 날짜의 브리핑 이벤트만 정리
 */
function cleanupBriefing(data) {
  if (!data.date) {
    return jsonResponse({ success: false, error: "date required" });
  }

  const targetDateStr = data.date;
  let deletedOld = 0;

  let pageToken;
  do {
    const response = Tasks.Tasks.list(TASK_LIST_ID, {
      showCompleted: true,
      showHidden: true,
      maxResults: 100,
      pageToken: pageToken
    });

    const tasks = response.items;
    if (tasks) {
      tasks.forEach(task => {
        if (task.title && task.title.startsWith(BRIEFING_PREFIX)) {
          const taskDueDate = task.due ? task.due.substring(0, 10) : "";
          if (taskDueDate && taskDueDate < targetDateStr) {
            Tasks.Tasks.remove(TASK_LIST_ID, task.id);
            deletedOld++;
          }
        }
      });
    }
    pageToken = response.nextPageToken;
  } while (pageToken);

  return jsonResponse({
    success: true,
    deletedOld: deletedOld,
    date: data.date
  });
}

// ═══════════════════════════════════════════════════════════════
// 유틸 및 테스트
// ═══════════════════════════════════════════════════════════════

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function testCreateBriefing() {
  const result = createBriefing({
    date: "2026-04-22",
    title: "입학식 준비물, 체육복 세탁",
    description: "상세:\n1. 입학식 준비물 챙기기"
  });
  Logger.log(result.getContent());
}
