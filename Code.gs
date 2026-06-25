/**
 * 성경 암송 — 회원 버전 진행기록 서버 (Google Apps Script)
 * ------------------------------------------------------------
 * 사용 순서
 *  1) https://script.google.com → 새 프로젝트
 *  2) 이 코드 전체를 Code.gs 에 붙여넣기
 *  3) 함수 목록에서 setup 을 한 번 실행 → '성경암송진행기록' 시트 자동 생성
 *     (실행 로그에 스프레드시트 URL / ID 가 찍힘)
 *  4) 배포 → 새 배포 → 유형: 웹 앱
 *       - 실행 계정: 나
 *       - 액세스: 모든 사용자
 *     → 생성된 /exec URL 을 프런트엔드(app.js)의 POST_URL 에 넣기
 */

// setup() 실행 시 생성된 스프레드시트 ID 가 여기에 저장된다 (스크립트 속성).
var PROP_KEY = 'SHEET_ID';
var SHEET_NAME = '기록';            // 탭 이름
var SS_TITLE  = '성경암송진행기록';   // 스프레드시트 문서 이름

var HEADERS = ['일시', '구분', '소속', '세부', '성명', '구절No', '단계', '방식', '클라이언트ID'];

/** 최초 1회 실행: 스프레드시트 + 헤더 생성 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_KEY);
  var ss;

  if (id) {
    ss = SpreadsheetApp.openById(id);          // 이미 만들었으면 재사용
  } else {
    ss = SpreadsheetApp.create(SS_TITLE);      // 새 문서 생성
    props.setProperty(PROP_KEY, ss.getId());
  }

  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  sheet.setName(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  Logger.log('스프레드시트 이름: ' + ss.getName());
  Logger.log('URL: ' + ss.getUrl());
  Logger.log('ID : ' + ss.getId());
  return ss.getUrl();
}

/** 진행기록 저장 (회원 버전에서 POST 호출) */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.openById(
      PropertiesService.getScriptProperties().getProperty(PROP_KEY)
    );
    var sheet = ss.getSheetByName(SHEET_NAME);

    sheet.appendRow([
      new Date(),                       // 일시
      data.type || '',                  // 구분 (교구/교회학교)
      data.gu || data.bu || '',         // 소속 (교구명 또는 부서명)
      data.mok || data.grade || '',     // 세부 (목장 또는 학년)
      data.name || '',                  // 성명
      data.no || '',                    // 구절No
      data.stage || '',                 // 단계
      data.mode || 'typing',            // 방식 (typing/voice)
      data.cid || ''                    // 클라이언트ID
    ]);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** (선택) 헬스 체크용 */
function doGet() {
  return json({ ok: true, service: '성경암송진행기록' });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
