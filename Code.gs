/**
 * 성경 암송 — 회원 버전 진행기록 서버 (Google Apps Script)
 * ------------------------------------------------------------
 * 사용 순서
 *  1) https://script.google.com → 이 코드 전체를 Code.gs 에 붙여넣기 → 저장
 *  2) (선택) setup 실행 → 로그에 시트 URL 표시.  실행을 깜빡해도 첫 요청 때 자동 생성됨.
 *  3) 배포 → 배포 관리 → 편집(연필) → 버전 "새 버전" → 액세스: 모든 사용자 → 배포
 *  4) /exec URL 을 app.js 의 POST_URL 에 입력
 *
 * 점검:
 *   GET  …/exec            → { ok, ss(파일명), url(실제 데이터가 쌓이는 시트), rows }
 *   GET  …/exec?test=1     → 테스트 행 1개 추가 후 { ok, wrote:true }
 */

var PROP_KEY = 'SHEET_ID';
var SHEET_NAME = '기록';
var SS_TITLE = '성경암송진행기록';
var HEADERS = ['일시', '구분', '소속', '세부', '성명', '구절No', '단계', '방식', '클라이언트ID'];

/** 시트 핸들을 얻는다. 없으면 스프레드시트+헤더를 자동 생성(지연 초기화). */
function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_KEY);
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create(SS_TITLE);
    props.setProperty(PROP_KEY, ss.getId());
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 한 줄 기록 */
function appendRow_(data) {
  getSheet_().appendRow([
    new Date(),                     // 일시
    data.type || '',                // 구분 (교구/교회학교)
    data.gu || data.bu || '',       // 소속 (교구명 또는 부서명)
    data.mok || data.grade || '',   // 세부 (목장 또는 학년)
    data.name || '',                // 성명
    data.no || '',                  // 구절No
    data.stage || '',               // 단계
    data.mode || 'typing',          // 방식
    data.cid || ''                  // 클라이언트ID
  ]);
}

/** 최초 1회 실행용(선택) — 시트를 미리 만들고 URL 로그 */
function setup() {
  var ss = getSheet_().getParent();
  Logger.log('파일명: ' + ss.getName());
  Logger.log('URL: ' + ss.getUrl());
  return ss.getUrl();
}

/** 회원 버전에서 통과 시 POST */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    appendRow_(data);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** 점검 + 테스트 기록 + 본인 진행 조회 */
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};

    // 본인 기록 조회: 식별 조합으로 필터 → 구절별 최고 단계 반환
    if (p.action === 'progress') {
      return json({ ok: true, progress: getProgressFor_(p) });
    }

    // 진단용: 시트 원본 값 그대로 반환 (저장 값 vs 조회 키 대조)
    if (p.action === 'dump') {
      return json({ ok: true, rows: getSheet_().getDataRange().getValues() });
    }

    if (p.test === '1') {
      appendRow_({ type: '교구', gu: '사랑', mok: '0', name: 'GET테스트', no: 0, stage: 1, mode: 'test', cid: 'gettest' });
      return json({ ok: true, wrote: true });
    }

    var sheet = getSheet_();
    var ss = sheet.getParent();
    return json({ ok: true, ss: ss.getName(), url: ss.getUrl(), rows: sheet.getLastRow() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** 식별 조합과 일치하는 행을 모아 { 구절No: 최고단계 } 로 반환 */
function getProgressFor_(p) {
  var type = String(p.type || '');
  var sosok = String(p.gu || p.bu || '');     // 소속 = 교구명 또는 부서명
  var sebu = String(p.mok || p.grade || '');  // 세부 = 목장 또는 학년
  var name = String(p.name || '');
  if (!type || !sosok || !sebu || !name) return {};

  var values = getSheet_().getDataRange().getValues(); // 0행은 헤더
  var out = {};
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    // 열: 0 일시, 1 구분, 2 소속, 3 세부, 4 성명, 5 구절No, 6 단계
    if (String(r[1]) === type && String(r[2]) === sosok &&
        String(r[3]) === sebu && String(r[4]) === name) {
      var no = r[5];
      var stage = parseInt(r[6], 10);
      if ((no === '' && no !== 0) || isNaN(stage)) continue;
      var key = String(no);
      if (!out[key] || stage > out[key]) out[key] = stage;
    }
  }
  return out;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
