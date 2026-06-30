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

    // 관리자 통계 (비밀번호 필요)
    if (p.action === 'stats') {
      return json(getStats(p));
    }

    // 관리자 통계 - 참여자 현황 (비밀번호 필요)
    if (p.action === 'participants') {
      return json(getParticipants(p));
    }

    // 관리자 통계 - 구절별 현황 (비밀번호 필요)
    if (p.action === 'verses') {
      return json(getVerseStats(p));
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

/**
 * 관리자 비밀번호 설정 — 아래 따옴표 안을 원하는 비밀번호로 바꾼 뒤 이 함수를 1회 실행.
 * (실행 후에는 보안을 위해 다시 '여기에_비밀번호_입력'으로 되돌려 두어도 됩니다.
 *  비밀번호는 스크립트 속성에 저장되어 코드/저장소에는 남지 않습니다.)
 * 또는: 프로젝트 설정 → 스크립트 속성에서 키 'ADMIN_PW' 로 직접 등록해도 됩니다.
 */
function setAdminPassword() {
  PropertiesService.getScriptProperties().setProperty('ADMIN_PW', '여기에_비밀번호_입력');
}

/**
 * 기간별 사용현황 통계 — 구분(교구/교회학교)·소속별 집계.
 * 파라미터: pw(비밀번호), from(YYYY-MM-DD, 선택), to(YYYY-MM-DD, 선택)
 * 반환 list 항목: { gubun, sosok, newCount, participants, typing, voice, total }
 *   - newCount    : 해당 기간에 '처음' 참여한 인원(최초 활동일이 기간 내)
 *   - participants: 기간 내 활동한 고유 인원
 *   - typing/voice: 기간 내 타이핑/음성 통과 횟수, total = 둘의 합
 */
function getStats(p) {
  var pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PW');
  if (!pw) return { ok: false, error: 'no-password-set' };
  if (String(p.pw || '') !== pw) return { ok: false, error: 'unauthorized' };

  var from = p.from ? new Date(p.from + 'T00:00:00') : null;
  var to = p.to ? new Date(p.to + 'T23:59:59') : null;

  var values = getSheet_().getDataRange().getValues(); // 0행 헤더

  // 1) 각 사람의 '최초 활동 시각'(전체 기록 기준) — 신규 판정용
  var firstSeen = {};
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (String(r[7]) === 'test') continue;
    var when = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    var pkey = r[1] + '|' + r[2] + '|' + r[3] + '|' + r[4];
    if (!firstSeen[pkey] || when < firstSeen[pkey]) firstSeen[pkey] = when;
  }

  // 2) 기간 내 행을 구분|소속으로 집계
  var groups = {};
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var mode = String(r[7] || '');
    if (mode === 'test') continue;
    var when = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    if (from && when < from) continue;
    if (to && when > to) continue;

    var gubun = String(r[1] || '');
    var sosok = String(r[2] || '');
    var pkey = gubun + '|' + sosok + '|' + r[3] + '|' + r[4];
    var gkey = gubun + '|' + sosok;
    if (!groups[gkey]) groups[gkey] = { gubun: gubun, sosok: sosok, participants: {}, newp: {}, typing: 0, voice: 0 };
    var g = groups[gkey];
    g.participants[pkey] = true;
    if (mode === 'voice') g.voice++; else g.typing++;

    var fs = firstSeen[pkey];
    if (fs && (!from || fs >= from) && (!to || fs <= to)) g.newp[pkey] = true;
  }

  var list = Object.keys(groups).map(function (k) {
    var g = groups[k];
    return {
      gubun: g.gubun,
      sosok: g.sosok,
      newCount: Object.keys(g.newp).length,
      participants: Object.keys(g.participants).length,
      typing: g.typing,
      voice: g.voice,
      total: g.typing + g.voice
    };
  });
  list.sort(function (a, b) {
    if (a.gubun !== b.gubun) return a.gubun < b.gubun ? -1 : 1;
    return a.sosok < b.sosok ? -1 : (a.sosok > b.sosok ? 1 : 0);
  });

  return { ok: true, list: list };
}

/**
 * 참여자 현황 — 개인별 집계.
 * 파라미터: pw, from, to(선택), gubun(선택), sosok(선택)
 * 반환 list 항목: { gubun, sosok, sebu, name, typing, voice, total }
 */
function getParticipants(p) {
  var pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PW');
  if (!pw) return { ok: false, error: 'no-password-set' };
  if (String(p.pw || '') !== pw) return { ok: false, error: 'unauthorized' };

  var from = p.from ? new Date(p.from + 'T00:00:00') : null;
  var to = p.to ? new Date(p.to + 'T23:59:59') : null;
  var fGubun = (p.gubun && p.gubun !== '전체') ? String(p.gubun) : null;
  var fSosok = (p.sosok && p.sosok !== '전체') ? String(p.sosok) : null;

  var values = getSheet_().getDataRange().getValues();
  var people = {};
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var mode = String(r[7] || '');
    if (mode === 'test') continue;
    var when = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    if (from && when < from) continue;
    if (to && when > to) continue;

    var gubun = String(r[1] || ''), sosok = String(r[2] || ''), sebu = String(r[3] || ''), name = String(r[4] || '');
    if (fGubun && gubun !== fGubun) continue;
    if (fSosok && sosok !== fSosok) continue;

    var key = gubun + '|' + sosok + '|' + sebu + '|' + name;
    if (!people[key]) people[key] = { gubun: gubun, sosok: sosok, sebu: sebu, name: name, typing: 0, voice: 0 };
    if (mode === 'voice') people[key].voice++; else people[key].typing++;
  }

  var list = Object.keys(people).map(function (k) {
    var x = people[k]; x.total = x.typing + x.voice; return x;
  });
  list.sort(function (a, b) {
    if (a.gubun !== b.gubun) return a.gubun < b.gubun ? -1 : 1;
    if (a.sosok !== b.sosok) return a.sosok < b.sosok ? -1 : 1;
    if (a.sebu !== b.sebu) return a.sebu < b.sebu ? -1 : 1;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });
  return { ok: true, list: list };
}

/**
 * 구절별 현황 — 구절No별 집계.
 * 파라미터: pw, from, to(선택)
 * 반환 list 항목: { no, participants(고유 인원), count(참여횟수) }
 */
function getVerseStats(p) {
  var pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PW');
  if (!pw) return { ok: false, error: 'no-password-set' };
  if (String(p.pw || '') !== pw) return { ok: false, error: 'unauthorized' };

  var from = p.from ? new Date(p.from + 'T00:00:00') : null;
  var to = p.to ? new Date(p.to + 'T23:59:59') : null;

  var values = getSheet_().getDataRange().getValues();
  var groups = {};
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var mode = String(r[7] || '');
    if (mode === 'test') continue;
    var when = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    if (from && when < from) continue;
    if (to && when > to) continue;

    var no = r[5];
    if (no === '' || no === null || no === undefined) continue; // 구절No 없는 행 제외
    var nokey = String(no);
    var pkey = r[1] + '|' + r[2] + '|' + r[3] + '|' + r[4];
    if (!groups[nokey]) groups[nokey] = { no: no, participants: {}, count: 0 };
    groups[nokey].participants[pkey] = true;
    groups[nokey].count++;
  }

  var list = Object.keys(groups).map(function (k) {
    var g = groups[k];
    return { no: g.no, participants: Object.keys(g.participants).length, count: g.count };
  });
  list.sort(function (a, b) { return Number(a.no) - Number(b.no); });
  return { ok: true, list: list };
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
