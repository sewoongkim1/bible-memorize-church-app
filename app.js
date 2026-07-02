// ============================================================
// 성경 암송 — 회원 버전(교구/교회학교 식별) app.js
// ============================================================
// 익명 버전과 동일한 암송 로직 + 진입(식별)·본인 기록 요약·서버 백업 추가
// ------------------------------------------------------------

// 말씀 데이터: 정적 verses.json 1순위, 실패 시 시트 API 폴백
const DATA_URL = "verses.json";
const API_URL = "https://script.google.com/macros/s/AKfycbzO4GDAy0hJBbZ-L3hVuZQI4cqnjiZdy2afUujnxmmAr8NAh1lJURhrfT37PaFanPR4PA/exec";

// 진행기록 저장 엔드포인트(Apps Script doPost). setup 후 배포한 /exec URL을 넣는다.
// 비어 있으면 서버 저장은 건너뛰고 localStorage만 사용한다.
const POST_URL = "https://script.google.com/macros/s/AKfycbyRcm6xnF-CdTj-wO2WYtxJOH-j2mcHWqzoS3pasMQ8MCt1qIeVJj0D5S4KqYmPtfWTGw/exec";

// 식별 항목 (summer-bible 등록 화면과 동일)
const GU_LIST = ["믿음", "소망", "사랑", "섬김", "은혜", "화평", "기쁨", "새가족"];
const BU_LIST = ["사랑부", "영아부", "유아부", "유치부", "유년부", "초등부", "중등부", "고등부", "청년부"];

let verses = []; // 화면에 쓰는 구절 데이터

// 화면 전환 시 보이는 로딩 표시 (로고 + "불러오는 중...")
const LOADING_HTML = `
  <div class="app-loading">
    <img class="al-logo" src="https://sewoongkim1.github.io/summer-bible/logo3.png" alt="" />
    <div class="al-text">불러오는 중...</div>
  </div>`;

// 스플래시 제거 — 광고 효과를 위해 시작 후 최소 2초는 유지한 뒤 사라진다.
const SPLASH_MIN_MS = 3000;
function dismissSplash() {
  const s = document.getElementById("splash");
  if (!s) return;
  const start = window.__splashStart || Date.now();
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - start));
  setTimeout(() => {
    s.classList.add("hide");
    setTimeout(() => { if (s.parentNode) s.parentNode.removeChild(s); }, 450);
  }, wait);
}

// ------------------------------------------------------------
// 데이터 로드 → 사용자 유무에 따라 진입/요약으로 분기
// ------------------------------------------------------------
async function loadVerses() {
  const appEl = document.getElementById("app");
  appEl.innerHTML = LOADING_HTML;

  for (const url of [DATA_URL, API_URL]) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.verses || !data.verses.length) throw new Error("데이터 없음");

      verses = data.verses;
      dismissSplash();
      routeAfterLoad();
      return;
    } catch (err) {
      if (url === API_URL) {
        dismissSplash();
        appEl.innerHTML = `<p class="error" style="text-align:center;padding:40px">연결 실패: ${err.message}</p>`;
      }
    }
  }
}

// 사용자 정보가 있으면 (서버 기록 동기화 후) 본인 기록 요약, 없으면 진입 화면
function routeAfterLoad() {
  maybeShowIntro(() => {
    if (loadUser()) enterAfterLogin();
    else renderEntryScreen();
  });
}

// 로그인 직후: 로컬 기록으로 요약 화면을 즉시 띄우고,
// 서버 동기화는 백그라운드로 진행한다(Apps Script 콜드 스타트로 화면이 지연되지 않도록).
async function enterAfterLogin() {
  renderSummary(); // 로컬 진행 기록으로 곧바로 표시

  // 서버에 더 높은 진도가 있으면 병합 후, 요약 화면이 아직 떠 있을 때만 갱신
  const changed = await syncProgress();
  if (changed && document.getElementById("go-list")) renderSummary();
}

// 서버(시트)의 본인 기록을 받아 로컬 진행과 더 높은 단계로 병합.
// 이를 통해 다른 기기/브라우저에서 로그인해도 진도가 따라온다.
async function syncProgress() {
  const u = loadUser();
  if (!u || !POST_URL) return false;

  const params = new URLSearchParams({ action: "progress", type: u.type, name: u.name });
  if (u.type === "교구") {
    params.set("gu", u.gu);
    params.set("mok", u.mok);
  } else {
    params.set("bu", u.bu);
    params.set("grade", u.grade);
  }

  try {
    const res = await fetch(POST_URL + "?" + params.toString(), { cache: "no-cache" });
    const data = await res.json();
    if (!data.ok || !data.progress) return false;

    const local = loadProgress();
    let changed = false;
    Object.keys(data.progress).forEach((no) => {
      const serverStage = Number(data.progress[no]);
      const cur = local[no]?.stage || 0;
      if (serverStage > cur) {
        local[no] = { stage: serverStage, passed: true };
        changed = true;
      }
    });
    if (changed) {
      try {
        localStorage.setItem(progressKey(), JSON.stringify(local));
      } catch {
        /* 저장 실패 무시 */
      }
    }
    return changed;
  } catch {
    /* 네트워크/CORS 오류 시 로컬 기록만으로 진행 */
    return false;
  }
}

// ------------------------------------------------------------
// 사용자 식별 정보 (localStorage)
//   key: "memorize-user"
//   교구:    { type:"교구",   gu, mok,  name, cid }
//   교회학교: { type:"교회학교", bu, grade, name, cid }
// ------------------------------------------------------------
const USER_KEY = "memorize-user";
const PRIVACY_CONSENT_KEY = "privacy-consent";

function hasPrivacyConsent() {
  try {
    return localStorage.getItem(PRIVACY_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

function savePrivacyConsent() {
  try {
    localStorage.setItem(PRIVACY_CONSENT_KEY, "1");
  } catch {
    /* 저장 실패 무시 */
  }
}

function loadUser() {
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY));
    return u && u.name ? u : null;
  } catch {
    return null;
  }
}

function saveUser(user) {
  if (!user.cid) {
    user.cid =
      (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
      "c" + Date.now().toString(36);
  }
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearUser() {
  localStorage.removeItem(USER_KEY);
}

// "사랑교구 3목장 김성도" / "초등부 김믿음"
function userLabel(u) {
  if (!u) return "";
  return u.type === "교구"
    ? `${u.gu}-${u.mok} ${u.name}`
    : `${u.bu} ${u.name}`;
}

// 로그인 정보를 2줄로: { l1: 소속, l2: 이름 + "성도님" }
function userLines(u) {
  if (!u) return { l1: "", l2: "" };
  const l1 =
    u.type === "교구"
      ? `${u.gu} ${u.mok}목장`
      : `${u.bu}${u.grade ? " " + u.grade : ""}`;
  return { l1, l2: `${u.name} 성도님` };
}

// ------------------------------------------------------------
// 진행 상태 (localStorage) + 서버 백업
//   사용자(신원)별로 분리 저장한다. 키 = "memorize-progress::" + 신원식별자
//   신원식별자: 교구  → g|교구|목장|이름,  교회학교 → s|부서|학년|이름
//   → 로그인 정보를 바꾸면 다른 사람의 기록이 보이지 않는다.
// ------------------------------------------------------------
const PROGRESS_KEY = "memorize-progress";

// 현재 사용자 신원에 해당하는 진행 기록 저장 키
function progressKey() {
  const u = loadUser();
  if (!u) return PROGRESS_KEY; // 사용자 없으면 기본 키(폴백)
  const id =
    u.type === "교구"
      ? `g|${u.gu}|${u.mok}|${u.name}`
      : `s|${u.bu}|${u.grade}|${u.name}`;
  return PROGRESS_KEY + "::" + id;
}

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(progressKey())) || {};
  } catch {
    return {};
  }
}

function saveProgress(no, stage, mode = "typing") {
  const progress = loadProgress();
  const prev = progress[no]?.stage || 0;
  if (stage > prev) {
    progress[no] = { stage, passed: true };
    try {
      localStorage.setItem(progressKey(), JSON.stringify(progress));
    } catch {
      /* 저장 실패(시크릿 모드 등) 무시 */
    }
  }
  // 완료(3단계)한 구절은 복습 일정에 등록
  if (stage === 3) ensureReviewScheduled(no);
  // 로컬 진행과 무관하게 통과 활동은 서버에 백업(집계용)
  postProgress(no, stage, mode);
}

function getPassedStage(no) {
  return loadProgress()[no]?.stage || 0;
}

// 통과 기록을 Apps Script로 전송 (text/plain → CORS 프리플라이트 회피)
function postProgress(no, stage, mode) {
  const u = loadUser();
  if (!u || !POST_URL) return; // URL 미설정 시 로컬만 사용
  const payload = Object.assign({}, u, { no, stage, mode });
  try {
    fetch(POST_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    /* 네트워크 오류는 무시 — 로컬 진행은 유지 */
  }
}

const STATUS_LABEL = {
  0: { cls: "status-none", text: "미시도" },
  1: { cls: "status-s1", text: "1단계 완료" },
  2: { cls: "status-s2", text: "2단계 완료" },
  3: { cls: "status-done", text: "암송 완료 🙌" },
};

// ------------------------------------------------------------
// 복습 모드(간격 반복) — 주 단위. 완료(3단계)한 구절을 잊기 전에 다시 암송.
//   key: "memorize-review::<사용자>" → { "7": { level:2, next:"2026-07-15" }, ... }
//   간격(일): 3일 → 1주 → 2주 → 1개월 → 2개월 (복습할수록 길어짐)
// ------------------------------------------------------------
const REVIEW_KEY = "memorize-review";
const REVIEW_INTERVALS = [3, 7, 14, 30, 60];

function reviewKey() {
  const u = loadUser();
  if (!u) return REVIEW_KEY;
  const id = u.type === "교구" ? `g|${u.gu}|${u.mok}|${u.name}` : `s|${u.bu}|${u.grade}|${u.name}`;
  return REVIEW_KEY + "::" + id;
}
function loadReview() {
  try { return JSON.parse(localStorage.getItem(reviewKey())) || {}; } catch { return {}; }
}
function saveReviewData(r) {
  try { localStorage.setItem(reviewKey(), JSON.stringify(r)); } catch {}
}
function ymdLocal(d) {
  const z = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
}
function afterDaysStr(days) { const d = new Date(); d.setDate(d.getDate() + days); return ymdLocal(d); }

// 완료(3단계) 시 복습 일정 시작 (이미 있으면 유지)
function ensureReviewScheduled(no) {
  const r = loadReview();
  if (!r[no]) { r[no] = { level: 0, next: afterDaysStr(REVIEW_INTERVALS[0]) }; saveReviewData(r); }
}
// 오늘까지 복습 예정인 구절No 목록
function dueReviewNos() {
  const r = loadReview(); const t = ymdLocal(new Date());
  return Object.keys(r).filter((no) => r[no] && r[no].next <= t).map(Number);
}
// 복습 완료 → 다음(더 긴) 간격으로
function advanceReview(no) {
  const r = loadReview();
  const level = Math.min(((r[no] && r[no].level) || 0) + 1, REVIEW_INTERVALS.length - 1);
  r[no] = { level, next: afterDaysStr(REVIEW_INTERVALS[level]) };
  saveReviewData(r);
}

// ------------------------------------------------------------
// 화면 0: 진입(식별) 화면 — 구분(교구/교회학교) 분기 입력
// ------------------------------------------------------------
function renderEntryScreen() {
  const u = loadUser() || { type: "교구" };
  const appEl = document.getElementById("app");

  appEl.innerHTML = `
    <div class="entry-header">
      <h2 class="entry-main-title">성경말씀 암송하기</h2>
      <p class="entry-sub-title">내가 주의 말씀을 내 마음에 두었나이다</p>
    </div>
    <div class="entry-screen">
      <div class="entry-card">
        <div class="login-help-row">
          <button class="login-help-btn" id="login-help">❓ 로그인 방법</button>
        </div>
        <div class="entry-field inline">
          <div class="entry-label">구분</div>
          <div class="radio-row" id="type-row">
            ${["교구", "교회학교"].map((t) => `
              <label class="radio-chip">
                <input type="radio" name="type" value="${t}" ${u.type === t ? "checked" : ""}/>
                <span>${t}</span>
              </label>`).join("")}
          </div>
        </div>

        <!-- 교구 분기 -->
        <div id="gu-fields">
          <div class="entry-field">
            <div class="entry-label">교구</div>
            <div class="radio-row wrap">
              ${GU_LIST.map((g) => `
                <label class="radio-chip">
                  <input type="radio" name="gu" value="${g}" ${u.gu === g ? "checked" : ""}/>
                  <span>${g}</span>
                </label>`).join("")}
            </div>
          </div>
          <div class="entry-field inline">
            <div class="entry-label">목장</div>
            <input class="entry-input" id="mok" inputmode="numeric" placeholder="예: 3" value="${u.mok || ""}"/>
          </div>
        </div>

        <!-- 교회학교 분기 -->
        <div id="school-fields" hidden>
          <div class="entry-field">
            <div class="entry-label">부서</div>
            <div class="radio-row wrap">
              ${BU_LIST.map((b) => `
                <label class="radio-chip">
                  <input type="radio" name="bu" value="${b}" ${u.bu === b ? "checked" : ""}/>
                  <span>${b}</span>
                </label>`).join("")}
            </div>
          </div>
          <div class="entry-field inline">
            <div class="entry-label">학년</div>
            <input class="entry-input" id="grade" placeholder="예: 3학년" value="${u.grade || ""}"/>
          </div>
        </div>

        <div class="entry-field inline">
          <div class="entry-label">성명</div>
          <input class="entry-input" id="name" placeholder="이름" value="${u.name || ""}"/>
        </div>

        <div class="privacy-box">
          <div class="privacy-title">개인정보 수집·이용 안내</div>
          <p>
            성경말씀 암송 앱은 개인 암송 진도 저장과 교회 내 참여 통계를 위해
            이름, 소속, 암송 진행 기록, 복습 및 도전 참여 기록을 저장합니다.
            수집된 정보는 암송 프로그램 운영 목적으로만 사용되며,
            운영 종료 또는 삭제 요청 시 정리됩니다.
          </p>
          <button class="privacy-more" id="privacy-more" type="button">자세히 보기</button>
          <label class="privacy-consent">
            <input type="checkbox" id="privacy-consent" ${hasPrivacyConsent() ? "checked" : ""}/>
            <span>위 개인정보 수집·이용 안내를 확인하고 동의합니다.</span>
          </label>
        </div>

        <div class="entry-error" id="entry-error" hidden></div>
        <button class="entry-submit" id="entry-submit">시작하기</button>
      </div>
    </div>
  `;

  document.getElementById("login-help").addEventListener("click", () => renderLoginHelp(renderEntryScreen));
  document.getElementById("privacy-more").addEventListener("click", () => renderPrivacyInfo(renderEntryScreen));

  const guFields = document.getElementById("gu-fields");
  const schoolFields = document.getElementById("school-fields");

  function applyType() {
    const type = document.querySelector('input[name="type"]:checked').value;
    const isGu = type === "교구";
    guFields.hidden = !isGu;
    schoolFields.hidden = isGu;
  }
  document.querySelectorAll('input[name="type"]').forEach((r) =>
    r.addEventListener("change", applyType)
  );
  applyType();

  document.getElementById("entry-submit").addEventListener("click", () => {
    const type = document.querySelector('input[name="type"]:checked').value;
    const name = document.getElementById("name").value.trim();
    const errEl = document.getElementById("entry-error");
    const fail = (msg) => {
      errEl.textContent = msg;
      errEl.hidden = false;
    };

    if (!name) return fail("이름을 입력해 주세요.");
    if (!document.getElementById("privacy-consent").checked) {
      return fail("개인정보 수집·이용 안내에 동의해 주세요.");
    }

    let user;
    if (type === "교구") {
      const gu = document.querySelector('input[name="gu"]:checked')?.value;
      const mok = document.getElementById("mok").value.trim();
      if (!gu) return fail("교구를 선택해 주세요.");
      if (!mok) return fail("목장을 입력해 주세요.");
      user = { type, gu, mok, name };
    } else {
      const bu = document.querySelector('input[name="bu"]:checked')?.value;
      const grade = document.getElementById("grade").value.trim();
      if (!bu) return fail("부서를 선택해 주세요.");
      if (!grade) return fail("학년을 입력해 주세요.");
      user = { type, bu, grade, name };
    }

    const prev = loadUser();
    if (prev && prev.cid) user.cid = prev.cid; // 기존 기기 식별자 유지
    savePrivacyConsent();
    saveUser(user);
    enterAfterLogin(); // 서버 기록 동기화 후 요약 화면
  });
}

// ------------------------------------------------------------
// 화면 1: 본인 기록 요약 (로그인 직후)
// ------------------------------------------------------------
function renderSummary() {
  stopSpeaking(); // 화면 전환 시 읽어주기 정지
  const u = loadUser();
  if (!u) return renderEntryScreen();

  const total = verses.length;
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  verses.forEach((v) => {
    counts[getPassedStage(v.no)]++;
  });
  const done = counts[3];
  const pct = total ? Math.round((done / total) * 100) : 0;
  // 이미 완료(3단계)한 구절을 복습 일정에 등록(과거 완료분도 포함, 중복 없음)
  verses.forEach((v) => { if (getPassedStage(v.no) === 3) ensureReviewScheduled(v.no); });
  const dueCount = dueReviewNos().length; // 오늘 복습할 구절 수

  const appEl = document.getElementById("app");
  appEl.innerHTML = `
<div class="summary-screen">
  <div class="summary-card">
    <div class="summary-headrow">
      <div class="summary-hello"><span class="summary-affil">${u.type === "교구" ? `${u.gu}-${u.mok}` : `${u.bu}${u.grade ? " " + u.grade : ""}`}</span> <span class="summary-user">${u.name}</span> <span class="summary-honor">성도님</span><br>환영합니다. 🙌</div>
      <div class="summary-icons">
        <button class="summary-icon" id="open-help-summary" aria-label="도움말" title="도움말">❓</button>
        <button class="summary-icon" id="open-settings" aria-label="설정" title="설정">⚙️</button>
      </div>
    </div>
    <div class="gauge-wrap">
      <div class="gauge-bar"><div class="gauge-fill" style="width:${pct}%"></div></div>
      <div class="gauge-sub">전체 ${total}구절 중 <b>${done}구절</b> 암송 완료</div>
    </div>
    <div class="stat-grid">
      <div class="stat-box status-done"><div class="stat-num">${counts[3]}</div><div class="stat-lbl">완료</div></div>
      <div class="stat-box status-s2"><div class="stat-num">${counts[2]}</div><div class="stat-lbl">2단계</div></div>
      <div class="stat-box status-s1"><div class="stat-num">${counts[1]}</div><div class="stat-lbl">1단계</div></div>
      <div class="stat-box status-none"><div class="stat-num">${counts[0]}</div><div class="stat-lbl">미시도</div></div>
    </div>
    <button class="summary-go" id="go-list">📖 암송하러 가기</button>
${dueCount > 0 ? `<button class="summary-go review-cta" id="go-review">📖 오늘 복습 (${dueCount}구절)</button>` : ""}
<button class="summary-go challenge-cta" id="go-challenge">🔥 오늘의 말씀 도전</button>
<button class="summary-help" id="open-ranking">🏆 도전 순위 보기</button>
  </div>
</div>
`;

  document.getElementById("go-list").addEventListener("click", renderVerseList);
  if (dueCount > 0) document.getElementById("go-review").addEventListener("click", startReview);
  document.getElementById("go-challenge").addEventListener("click", startChallenge);
  document.getElementById("open-ranking").addEventListener("click", () => renderRanking());
  document.getElementById("open-help-summary").addEventListener("click", () => renderHelp(renderSummary));
  document.getElementById("open-settings").addEventListener("click", renderSettings);
}

// 설정 화면 — 로그인 정보변경 · 알림 · 홈 화면 추가 · 공유 (요약에서 분리)
function renderSettings() {
  const appEl = document.getElementById("app");
  appEl.innerHTML = `
    <div class="summary-screen">
      <div class="summary-card">
        <div class="settings-head">
          <h2 class="rank-title">⚙️ 설정</h2>
          <button class="settings-back-btn" id="settings-back">← 뒤로</button>
        </div>
        <div class="setting-block">
          <div class="setting-label">🌙 화면 밝기</div>
          <div class="tts-rate-row" id="theme-row">
            <button data-theme="light">☀️ 밝게</button>
            <button data-theme="dark">🌙 어둡게</button>
          </div>
        </div>
        <div class="setting-block">
          <div class="setting-label">🔊 말씀 듣기 속도</div>
          <div class="tts-rate-row" id="tts-rate-row">
            <button data-rate="0.5">느리게</button>
            <button data-rate="0.7">보통</button>
            <button data-rate="0.9">조금 빠르게</button>
            <button data-rate="1.1">빠르게</button>
          </div>
          <button class="tts-preview" id="tts-preview">🔊 이 속도로 들어보기</button>
        </div>
        <button class="summary-install" id="change-user">👤 로그인 정보변경</button>
        <button class="summary-install" id="privacy-info">🔐 개인정보 안내 보기</button>
        <a class="summary-install" href="reminders.html">🔔 매일 암송 구절 알림 받기</a>
        <button class="summary-install" id="install-btn">⛪ 성경암송 — 홈 화면에 추가</button>
        <button class="summary-install" id="share-btn">🔗 성경암송 — 공유하기</button>
      </div>
    </div>`;
  document.getElementById("settings-back").addEventListener("click", () => { stopSpeaking(); renderSummary(); });
  document.getElementById("change-user").addEventListener("click", renderEntryScreen);
  document.getElementById("privacy-info").addEventListener("click", () => renderPrivacyInfo(renderSettings));
  document.getElementById("share-btn").addEventListener("click", shareApp);
  setupThemeSetting();
  setupTtsRate();
  setupInstallButton();
}

// 화면 밝기(다크 모드) 선택 UI
function setupThemeSetting() {
  const row = document.getElementById("theme-row");
  if (!row) return;
  const btns = Array.from(row.querySelectorAll("button"));
  const sync = () => {
    const dark = document.documentElement.classList.contains("dark");
    btns.forEach((b) => b.classList.toggle("on", b.dataset.theme === (dark ? "dark" : "light")));
  };
  sync();
  btns.forEach((b) => {
    b.addEventListener("click", () => {
      const dark = b.dataset.theme === "dark";
      document.documentElement.classList.toggle("dark", dark);
      try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (e) {}
      sync();
    });
  });
}

// 듣기(TTS) 속도 선택 UI
function setupTtsRate() {
  const row = document.getElementById("tts-rate-row");
  if (!row) return;
  const cur = getSpeakRate();
  const btns = Array.from(row.querySelectorAll("button"));
  // 현재 값과 가장 가까운 버튼을 활성화
  let nearest = btns[1];
  let best = Infinity;
  btns.forEach((b) => {
    const d = Math.abs(parseFloat(b.dataset.rate) - cur);
    if (d < best) { best = d; nearest = b; }
  });
  btns.forEach((b) => b.classList.toggle("on", b === nearest));
  btns.forEach((b) => {
    b.addEventListener("click", () => {
      const r = parseFloat(b.dataset.rate);
      setSpeakRate(r);
      btns.forEach((x) => x.classList.toggle("on", x === b));
      stopSpeaking();
      speakText("주의 말씀은 내 발에 등이요 내 길에 빛이니이다");
    });
  });
  const prev = document.getElementById("tts-preview");
  if (prev) prev.addEventListener("click", () => {
    stopSpeaking();
    speakText("주의 말씀은 내 발에 등이요 내 길에 빛이니이다");
  });
}

// PWA '홈 화면에 추가' 버튼 로직 (설정 화면)
function setupInstallButton() {
  const installBtn = document.getElementById("install-btn");
  if (!installBtn) return;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone;

  if (isInStandaloneMode) {
    installBtn.hidden = true; // 이미 설치됨
  } else if (isIOS) {
    installBtn.addEventListener("click", () => {
      alert(
        "📱 홈 화면에 추가하는 방법\n\n" +
        "① 하단 공유 버튼(□↑)을 누르세요\n" +
        "② 목록에서 \"홈 화면에 추가\"를 선택하세요\n" +
        "③ 오른쪽 위 \"추가\"를 눌러 완료!"
      );
    });
  } else if (window.__pwaInstallPrompt) {
    installBtn.addEventListener("click", async () => {
      window.__pwaInstallPrompt.prompt();
      const { outcome } = await window.__pwaInstallPrompt.userChoice;
      if (outcome === "accepted") {
        installBtn.hidden = true;
        window.__pwaInstallPrompt = null;
      }
    });
  } else {
    installBtn.addEventListener("click", () => {
      const ua = navigator.userAgent || "";
      if (/android/i.test(ua)) {
        alert(
          "📱 홈 화면에 추가하는 방법\n\n" +
          "① 브라우저 우측 상단 메뉴(⋮)를 누르세요\n" +
          "② \"홈 화면에 추가\"를 선택하세요\n" +
          "③ \"추가\"를 눌러 완료!"
        );
      } else {
        alert(
          "📱 홈 화면에 추가하는 방법\n\n" +
          "• iOS Safari: 공유 버튼(□↑) → 홈 화면에 추가\n" +
          "• Android Chrome: 메뉴(⋮) → 홈 화면에 추가"
        );
      }
    });
  }
}

// ------------------------------------------------------------
// 화면 2: 구절 목록
// ------------------------------------------------------------
function renderVerseList() {
  const u = loadUser();
  const appEl = document.getElementById("app");
  appEl.innerHTML = `
    <div class="list-nav">
      <button class="remind-cta nav-record" id="to-summary">← ${userLabel(u)} 성도님</button>
    </div>
    <div id="verse-list" class="verse-grid"></div>
  `;

  const listEl = document.getElementById("verse-list");
  document.getElementById("to-summary").addEventListener("click", renderSummary);

  [...verses].reverse().forEach((v) => {
    const passed = getPassedStage(v.no);
    const status = STATUS_LABEL[passed];

    const card = document.createElement("div");
    card.className = `verse-card ${status.cls}`;
    card.innerHTML = `
      <div class="verse-no">${String(v.no).padStart(2, "0")}</div>
      <div class="verse-ref">${v.refShort}</div>
      <div class="verse-hint">${v.hintText || ""}</div>
      <div class="verse-status ${status.cls}">${status.text}</div>
      <button class="card-listen" aria-label="${v.refShort} 듣기" title="듣기">🔊</button>
    `;
    card.addEventListener("click", () => startTest(v));
    // 듣기 버튼: 카드 클릭(테스트 시작)으로 번지지 않게 막고 본문을 읽어준다.
    // 빠르게 N번 클릭하면 N번 반복해서 읽어준다(2번 클릭 → 2번 듣기).
    const listenBtn = card.querySelector(".card-listen");
    let clickCount = 0;
    let clickTimer = null;
    listenBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clickCount++;
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        speakText(`${v.refFull}. ${v.text}`, null, clickCount);
        clickCount = 0;
      }, 350); // 350ms 안에 연속 클릭한 횟수만큼 반복
    });
    listEl.appendChild(card);
  });
}

// ------------------------------------------------------------
// 화면 3: 테스트 (익명 버전과 동일)
// ------------------------------------------------------------
function startTest(verse) {
  const passed = getPassedStage(verse.no);
  const startStage = passed >= 3 ? 1 : passed + 1;
  renderTestScreen(verse, startStage);
}

function renderTestScreen(verse, stage) {
  stopSpeaking(); // 화면 전환 시 읽어주기 정지
  const appEl = document.getElementById("app");
  const tokens = verse.text.trim().split(/\s+/);

  const blankRatio = stage === 1 ? 0.25 : stage === 2 ? 0.65 : 1.0;
  const blankFlags = pickBlankIndices(tokens, blankRatio);

  const blanks = [];
  const wordsHtml = tokens
    .map((word, i) => {
      if (blankFlags[i]) {
        const blankIndex = blanks.length;
        blanks.push(word);
        const width = Array.from(word).length + 1;
        return `<input class="word-input" data-blank="${blankIndex}" data-answer="${word}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="width:${width}em" />`;
      } else {
        return `<span class="word-fixed">${word}</span>`;
      }
    })
    .join(" ");

  const answerHtml = tokens
    .map((word, i) =>
      blankFlags[i] ? `<strong class="ans-word">${word}</strong>` : word
    )
    .join(" ");

  const sermonBanner = verse.url
    ? `<a class="sermon-banner" href="${verse.url}" target="_blank" rel="noopener">
         <span class="sermon-banner-icon">▶</span>
         <span class="sermon-banner-text">
           <span class="sermon-banner-title">${verse.sermonTitle || "설교 영상 보기"}</span>
         </span>
       </a>`
    : "";

  appEl.innerHTML = `
    <div class="test-screen">
      <div class="test-card">
        <div class="test-top">
          <div class="test-head">
            <div class="test-stage">${stage}단계</div>
            <div class="test-ref">${verse.refShort}</div>
          </div>
          <button class="back-btn" id="back-to-list-btn">← 목록</button>
        </div>
        <div class="test-sentence">${wordsHtml}</div>
        <div class="btn-row">
          <button class="answer-btn" id="show-answer-btn">보기</button>
          <button class="answer-btn" id="listen-answer-btn" aria-label="정답 음성으로 듣기">🔊 듣기</button>
          <button class="voice-btn" id="voice-toggle">🎤 암송시작</button>
        </div>
        <div id="result-area"></div>
        <div id="answer-panel" class="answer-panel" hidden>
          <div class="answer-title">정답</div>
          <div class="answer-text">${answerHtml}</div>
          <button class="back-to-test-btn" id="back-to-test-btn">돌아가서 계속하기</button>
        </div>

        <div id="voice-panel" class="voice-panel" hidden>
          <div class="voice-status" id="voice-status">🎙️ 듣고 있어요… <b>‘암송 종료’</b>를 누를 때까지 계속 들어요</div>
          <div class="voice-live" id="voice-live"></div>
        </div>
        <div id="voice-result" class="voice-result"></div>

        ${sermonBanner}
      </div>
    </div>
  `;

  document
    .getElementById("back-to-list-btn")
    .addEventListener("click", () => { stopSpeaking(); renderVerseList(); });

  // 시각장애인 등을 위한 '정답 듣기'(TTS): 출처 + 본문을 음성으로 읽어준다.
  const listenBtn = document.getElementById("listen-answer-btn");
  if (listenBtn) {
    listenBtn.addEventListener("click", () => {
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        stopSpeaking(); // 재생 중이면 정지(토글)
        listenBtn.textContent = "🔊 듣기";
        return;
      }
      listenBtn.textContent = "⏹ 정지";
      speakText(`${verse.refFull}. ${verse.text}`, () => {
        listenBtn.textContent = "🔊 듣기";
      });
    });
  }

  setupAnswerToggle();
  setupAutoCheck(verse, stage);
  setupVoice(verse, stage);
}

// ------------------------------------------------------------
// 음성 합성(TTS) — 구절을 한국어로 읽어준다(설치·권한 불필요)
// ------------------------------------------------------------
const SPEAK_RATE = 0.7; // 기본 읽기 속도(낮을수록 느림)
const TTS_RATE_KEY = "tts-rate"; // 사용자가 설정 화면에서 고른 듣기 속도
function getSpeakRate() {
  const v = parseFloat(localStorage.getItem(TTS_RATE_KEY));
  return v >= 0.4 && v <= 1.5 ? v : SPEAK_RATE;
}
function setSpeakRate(v) {
  try { localStorage.setItem(TTS_RATE_KEY, String(v)); } catch (e) {}
}

// text 를 times 번 연속해서 읽어준다. (빠르게 N번 클릭하면 N번 반복)
function speakText(text, onEnd, times = 1) {
  if (!("speechSynthesis" in window)) {
    alert("이 브라우저는 읽어주기(음성 합성)를 지원하지 않습니다.\n크롬·사파리에서 이용해 주세요.");
    if (onEnd) onEnd();
    return;
  }
  window.speechSynthesis.cancel(); // 중복 재생 방지
  const n = Math.max(1, times);
  for (let i = 0; i < n; i++) {
    const ut = new SpeechSynthesisUtterance(text);
    ut.lang = "ko-KR";
    ut.rate = getSpeakRate();
    ut.pitch = 1;
    if (onEnd && i === n - 1) {
      // 마지막 반복이 끝났을 때만 콜백
      ut.onend = onEnd;
      ut.onerror = onEnd;
    }
    window.speechSynthesis.speak(ut); // speak 는 큐에 쌓이므로 순서대로 N번 재생
  }
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  killVoice(); // 화면 전환 시 음성인식(입력)도 함께 중단
}

// 현재 활성 음성인식을 안전하게 중단(자동 재시작·뒤늦은 채점 방지)
let voiceKill = null;
function killVoice() {
  if (voiceKill) { try { voiceKill(); } catch (e) {} voiceKill = null; }
}

function setupAnswerToggle() {
  const showBtn = document.getElementById("show-answer-btn");
  const backBtn = document.getElementById("back-to-test-btn");
  const panel = document.getElementById("answer-panel");

  showBtn.addEventListener("click", () => {
    panel.hidden = false;
    showBtn.hidden = true;
  });

  backBtn.addEventListener("click", () => {
    panel.hidden = true;
    showBtn.hidden = false;
    const next = document.querySelector(".word-input:not([disabled])");
    if (next) next.focus();
  });
}

// ------------------------------------------------------------
// 음성 암송 (익명 버전과 동일, 통과 시 3단계 저장)
// ------------------------------------------------------------
const VOICE_PASS = 85;

function normalizeWords(s) {
  return String(s || "")
    .normalize("NFC") // 분리형(NFD) 한글도 완성형으로 맞춰 가-힣 범위에 매칭되게
    .replace(/[^가-힣a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// 인식기가 같은 말을 반복 출력하는 경우 대비: 연속 중복 단어/구를 정리
function collapseRepeats(s) {
  const a = [];
  String(s || "").trim().split(/\s+/).filter(Boolean).forEach((w) => {
    if (a[a.length - 1] !== w) a.push(w); // 연속 동일 단어 제거
  });
  // 직전과 동일한 2~4단어 구가 바로 반복되면 제거
  for (let k = 4; k >= 2; k--) {
    let i = 0;
    while (i + 2 * k <= a.length) {
      if (a.slice(i, i + k).join(" ") === a.slice(i + k, i + 2 * k).join(" ")) {
        a.splice(i + k, k);
      } else {
        i++;
      }
    }
  }
  return a.join(" ");
}

// 배열 LCS 길이
function lcsLen(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[n][m];
}

// 두 단어의 음절 유사도(0~1). 음성 인식의 유사 발음 오인 허용에 사용
function wordSim(a, b) {
  const A = Array.from(a), B = Array.from(b);
  if (!A.length && !B.length) return 1;
  return (2 * lcsLen(A, B)) / (A.length + B.length);
}

const WORD_SIM_PASS = 0.5; // 이 이상 비슷하면 같은 단어로 인정(마크 초록)

function scoreSpoken(answerText, spokenText) {
  const ans = normalizeWords(answerText);
  const said = normalizeWords(spokenText);
  const n = ans.length;
  const m = said.length;

  // 단어 정렬(LCS) — 단, 완전일치가 아니라 '유사하면' 일치로 본다(마크용)
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = wordSim(ans[i - 1], said[j - 1]) >= WORD_SIM_PASS
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const marks = new Array(n).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (wordSim(ans[i - 1], said[j - 1]) >= WORD_SIM_PASS) { marks[i - 1] = true; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }

  // 정확도는 음절(글자) 단위 LCS로 산정 → 1~2글자 오인은 부분 감점만(거의 같으면 높은 점수)
  const ansSyl = Array.from(ans.join(""));
  const saidSyl = Array.from(said.join(""));
  const accuracy = ansSyl.length
    ? Math.round((lcsLen(ansSyl, saidSyl) / ansSyl.length) * 100)
    : 0;

  return { accuracy, marks, ansWords: ans };
}

function setupVoice(verse, stage, onPass) {
  killVoice(); // 이전 화면에서 시작된 음성인식이 남아 있으면 중단
  const toggleBtn = document.getElementById("voice-toggle");
  const panel = document.getElementById("voice-panel");
  const statusEl = document.getElementById("voice-status");
  const liveEl = document.getElementById("voice-live");
  const resultEl = document.getElementById("voice-result");

  const ua = navigator.userAgent || "";
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (/KAKAOTALK/i.test(ua)) {
    toggleBtn.addEventListener("click", () => {
      resultEl.innerHTML =
        `<div class="voice-msg">카카오톡 브라우저에서는 음성 암송이 동작하지 않습니다.<br>아래 버튼으로 크롬·사파리에서 열어 사용해 주세요.</div>
         <a class="voice-btn" id="voice-ext" style="margin-top:10px;" href="kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}">🔗 외부 브라우저로 열기</a>`;
    });
    return;
  }

  if (!SR) {
    toggleBtn.addEventListener("click", () => {
      resultEl.innerHTML =
        `<div class="voice-msg">이 브라우저는 음성인식을 지원하지 않습니다.<br>크롬(안드로이드·PC)·사파리에서 이용하거나 타이핑으로 암송해 주세요.</div>`;
    });
    return;
  }

  let rec = null;
  let finalText = "";
  let stopped = false;
  let running = false;

  function setRunning(on) {
    running = on;
    panel.hidden = !on;
    if (on) {
      toggleBtn.textContent = "■ 암송 종료";
      toggleBtn.classList.remove("voice-btn");
      toggleBtn.classList.add("voice-stop");
    } else {
      toggleBtn.textContent = "🎤 암송시작";
      toggleBtn.classList.remove("voice-stop");
      toggleBtn.classList.add("voice-btn");
    }
  }

  function evaluateAndShow() {
    const heard = collapseRepeats(finalText); // 반복 정리된 인식 결과
    const { accuracy, marks, ansWords } = scoreSpoken(verse.text, heard);
    const wordsHtml = ansWords
      .map((w, i) => `<span class="${marks[i] ? "v-ok" : "v-no"}">${w}</span>`)
      .join(" ");
    const passed = accuracy >= VOICE_PASS;

    resultEl.innerHTML = `
      <div class="voice-summary"><span class="voice-pct ${passed ? "pass" : "fail"}">${accuracy}%</span> ${passed ? "음성 암송 통과! 🎉" : `조금 더! (통과 ${VOICE_PASS}%)`}</div>
      <div class="voice-words">${wordsHtml}</div>
      <div class="voice-heard">들린 내용: ${heard ? heard : "(인식 안 됨)"}</div>
    `;

    // 도전 모드: 통과 시 콜백으로 완료 처리(단계 네비 없음)
    if (onPass) { if (passed) onPass("voice"); return; }

    // (연습 모드) 저장 + 다음 단계 네비
    if (passed) saveProgress(verse.no, stage, "voice");
    const nav = !passed
      ? ""
      : stage < 3
      ? `<button class="next-btn" id="voice-next-stage">${stage + 1}단계로</button>`
      : `<div class="complete-badge">암송 완료 🙌</div>
         <button class="next-btn" id="voice-to-summary">내 기록 보기</button>`;
    const topArea = document.getElementById("result-area");
    if (topArea) topArea.innerHTML = nav;
    if (passed && stage < 3) {
      document
        .getElementById("voice-next-stage")
        .addEventListener("click", () => renderTestScreen(verse, stage + 1));
    } else if (passed) {
      document
        .getElementById("voice-to-summary")
        .addEventListener("click", renderSummary);
    }
  }

  function newSession() {
    const r = new SR();
    r.lang = "ko-KR";
    r.interimResults = true;
    r.continuous = true; // 계속 듣기(말이 끝나기 전에 멈추지 않도록)

    // 이 세션의 확정 텍스트. 확정 결과들을 '병합'해 중복을 막는다.
    let sessionFinal = "";

    r.onresult = (e) => {
      const finals = [];
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) {
          if (t) finals.push(t);
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      // 안드로이드는 확정 결과가 '점점 길어지며' 누적됨 → 앞을 포함하면 덮어쓰고,
      // 새 구간이면 이어붙여 중복을 제거한다.
      let merged = "";
      for (const f of finals) {
        if (!merged) merged = f;
        else if (f.startsWith(merged)) merged = f; // 성장형 → 대체
        else if (!merged.endsWith(f)) merged = (merged + " " + f).trim(); // 새 구간 → 추가
      }
      sessionFinal = merged;
      liveEl.textContent = (finalText + " " + merged + " " + interim).replace(/\s+/g, " ").trim();
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        stopped = true;
        statusEl.textContent = "마이크 권한이 필요합니다. 브라우저에서 마이크를 허용해 주세요.";
      }
    };
    r.onend = () => {
      // 세션 확정분 누적 후 반복 정리(세션 경계 중복까지 제거)
      finalText = collapseRepeats((finalText + " " + sessionFinal).replace(/\s+/g, " ").trim());
      sessionFinal = "";
      // 사용자가 '암송 종료'를 누르기 전까지는 자동 재시작해 계속 듣는다.
      if (!stopped) {
        try { rec = newSession(); rec.start(); return; } catch (e) {}
      }
      voiceKill = null; // 이 인식 세션 종료
      setRunning(false);
      evaluateAndShow();
    };
    return r;
  }

  toggleBtn.addEventListener("click", () => {
    if (!running) {
      finalText = "";
      stopped = false;
      resultEl.innerHTML = "";
      liveEl.textContent = "";
      statusEl.innerHTML = "🎙️ 듣고 있어요… 다 외우면 <b>‘암송 종료’</b>를 누르세요";
      setRunning(true);
      try {
        rec = newSession();
        rec.start();
        // 화면을 벗어나면 이 인식을 강제 종료(자동 재시작·뒤늦은 채점 방지)
        voiceKill = () => { stopped = true; if (rec) { try { rec.onend = null; rec.stop(); } catch (e) {} } };
      } catch (err) {
        setRunning(false);
        statusEl.textContent = "음성인식을 시작할 수 없습니다.";
      }
    } else {
      stopped = true;
      if (rec) rec.stop();
    }
  });
}

// 본문 토큰 중 빈칸 인덱스 선정 (글자 긴 단어 우선)
function pickBlankIndices(tokens, ratio) {
  const flags = new Array(tokens.length).fill(false);
  const candidates = tokens
    .map((word, i) => ({ i, len: word.length }))
    .sort((a, b) => b.len - a.len);
  const targetCount = Math.max(1, Math.round(tokens.length * ratio));
  candidates.slice(0, targetCount).forEach((c) => {
    flags[c.i] = true;
  });
  return flags;
}

// ------------------------------------------------------------
// 자동 채점 (익명 버전과 동일)
// ------------------------------------------------------------
function setupAutoCheck(verse, stage) {
  const inputs = Array.from(document.querySelectorAll(".word-input"));

  // 모바일 키보드(3벌식·iOS 등)는 한글을 NFD(자모 분리형)로 입력할 수 있어
  // NFC(완성형)로 정규화한 뒤 비교해야 정답 판정이 된다.
  const norm = (s) => String(s || "").trim().normalize("NFC");
  const len = (s) => Array.from(s).length;
  // 아이폰 천지인 등은 조합 중 낱자모(ㆍ U+318D, ㄱ~ㅣ 등 호환 자모)가 칸에 남는다.
  // 이게 남아 있으면 "아직 조합 중"으로 보고 오답 삭제를 하지 않는다.
  const isComposingJamo = (s) => /[ㄱ-ㆎᄀ-ᇿ]/.test(String(s || ""));

  function accept(input, idx) {
    input.value = norm(input.dataset.answer);
    input.classList.add("correct");
    input.classList.remove("wrong");
    input.disabled = true;

    const next = inputs.slice(idx + 1).find((inp) => !inp.disabled);
    if (next) next.focus();
    else checkAllComplete(inputs, verse, stage);
  }

  function markWrong(input) {
    input.classList.add("wrong");
    input.classList.remove("correct");
    setTimeout(() => {
      input.blur();
      input.value = "";
      input.classList.remove("wrong");
      input.focus();
    }, 400);
  }

  // 모바일 키보드에 가리지 않도록, 포커스된 입력 칸을 화면 중앙보다 약간 위로 올린다.
  function scrollIntoCenter(input) {
    // 키보드가 올라온 뒤 위치가 잡히도록 약간 지연
    setTimeout(() => {
      const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      const top = input.getBoundingClientRect().top;
      const target = vh / 2 - 80; // 화면 중앙보다 약 2cm(80px) 위
      window.scrollBy({ top: top - target, behavior: "smooth" });
    }, 250);
  }

  inputs.forEach((input, idx) => {
    let timer = null;

    // 정답이면 즉시 통과(조합 상태와 무관). 매 입력마다 검사.
    function checkAccept() {
      if (input.disabled) return false;
      if (norm(input.value) === norm(input.dataset.answer)) {
        clearTimeout(timer);
        accept(input, idx);
        return true;
      }
      return false;
    }

    // 오답 처리는 "입력이 멈춘 뒤"에만, 그리고
    //  - 칸에 조합 중 낱자모가 없고(천지인 등 조합 완료),
    //  - 글자 수가 정답보다 '많을 때'만 지운다.
    // (한글 받침/모음을 채우는 동안의 동일 글자수 중간 상태는 절대 지우지 않음)
    function scheduleWrongCheck() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (input.disabled) return;
        if (checkAccept()) return;
        if (isComposingJamo(input.value)) return; // 아직 조합 중
        const val = norm(input.value);
        const answer = norm(input.dataset.answer);
        if (val && len(val) > len(answer)) markWrong(input);
      }, 700);
    }

    // 입력/조합완료/키업 모두에서 정답을 확인(아이폰은 완료 신호가 늦거나 누락될 수 있음)
    function onChange() {
      if (!checkAccept()) scheduleWrongCheck();
    }
    input.addEventListener("compositionend", onChange);
    input.addEventListener("input", onChange);
    input.addEventListener("keyup", onChange);
    input.addEventListener("focus", () => scrollIntoCenter(input));
  });

  if (inputs[0]) inputs[0].focus();
}

function checkAllComplete(inputs, verse, stage) {
  const allCorrect = inputs.every((inp) => inp.classList.contains("correct"));
  if (!allCorrect) return;

  saveProgress(verse.no, stage, "typing");

  const resultEl = document.getElementById("result-area");
  resultEl.innerHTML = `
    ${
      stage < 3
        ? `<button class="next-btn" id="next-stage-btn">${stage + 1}단계로</button>`
        : `<div class="complete-badge">암송 완료 🙌</div>
           <button class="next-btn" id="to-summary-btn">내 기록 보기</button>`
    }
  `;

  if (stage < 3) {
    document
      .getElementById("next-stage-btn")
      .addEventListener("click", () => renderTestScreen(verse, stage + 1));
  } else {
    document
      .getElementById("to-summary-btn")
      .addEventListener("click", renderSummary);
  }
}

// ------------------------------------------------------------
// 공유하기 — Web Share API(모바일) 우선, 미지원 시 URL 복사
// ------------------------------------------------------------
function shareApp() {
  const shareUrl = "https://sewoongkim1.github.io/bible-memorize-church-app/";
  const shareTitle = "[고척교회]  오직 성경, 말씀이 답이다!";
  const shareText = "성경 말씀암송 앱입니다. 함께 말씀을 암송해요!";

  if (navigator.share) {
    navigator.share({ title: shareTitle, text: shareText, url: shareUrl }).catch(function() {});
    return;
  }
  // 클립보드 복사 폴백
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareUrl).then(function() {
      showShareToast("링크가 클립보드에 복사되었습니다! 📋");
    }).catch(function() {
      showShareToast(shareUrl);
    });
  } else {
    // execCommand 폴백 (구형 브라우저)
    const ta = document.createElement("textarea");
    ta.value = shareUrl;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); showShareToast("링크가 클립보드에 복사되었습니다! 📋"); }
    catch (e) { showShareToast(shareUrl); }
    document.body.removeChild(ta);
  }
}

// 공유 결과 토스트 메시지
function showShareToast(msg) {
  const existing = document.getElementById("share-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "share-toast";
  toast.className = "share-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function() { toast.classList.add("share-toast-show"); }, 10);
  setTimeout(function() {
    toast.classList.remove("share-toast-show");
    setTimeout(function() { toast.remove(); }, 400);
  }, 2800);
}

// ------------------------------------------------------------
// 카카오톡 인앱 브라우저 → 기본(외부) 브라우저로 열기 유도
//   안드로이드: 자동 전환(세션당 1회). 아이폰: 자동이 막히면 배너 버튼으로.
// ------------------------------------------------------------
function promptOpenExternal() {
  const ua = navigator.userAgent || "";
  if (!/KAKAOTALK/i.test(ua)) return; // 카톡 인앱 브라우저일 때만

  const url = location.href;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);

  // 안드로이드: 크롬 intent 스킴(자동 전환 성공률 높음, 미설치 시 fallback)
  const androidIntent =
    "intent://" +
    url.replace(/^https?:\/\//, "") +
    "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" +
    encodeURIComponent(url) +
    ";end";
  // iOS·기타: 카카오 공식 외부 열기 스킴(기본 브라우저)
  const kakaoExt = "kakaotalk://web/openExternal?url=" + encodeURIComponent(url);
  const ext = isAndroid ? androidIntent : kakaoExt;

  // 1) 세션당 1회 자동 전환 시도(실패 시 무한 리다이렉트 방지)
  try {
    if (!sessionStorage.getItem("kakaoExtTried2")) {
      sessionStorage.setItem("kakaoExtTried2", "1");
      location.href = ext;
    }
  } catch {
    location.href = ext;
  }

  // 2) 상단 안내 배너(자동 전환이 막힌 경우 수동 버튼/가이드)
  const bar = document.createElement("div");
  bar.className = "kakao-ext-bar";
  bar.innerHTML = `
    <span class="kakao-ext-msg">카카오톡에서는 음성 암송 등 일부 기능이 제한돼요.</span>
    <a class="kakao-ext-open" href="${ext}">기본 브라우저로 열기</a>
    <button type="button" class="kakao-ext-close" aria-label="닫기">✕</button>
    <span class="kakao-ext-hint">안 열리면 우측 ${isIOS ? "하단 공유 → ‘Safari로 열기’" : "⋮ → ‘다른 브라우저로 열기’"}</span>`;
  document.body.prepend(bar);
  bar.querySelector(".kakao-ext-close").addEventListener("click", () => bar.remove());
}

// ------------------------------------------------------------
// 시작
// ------------------------------------------------------------
// ----  PWA 홈 화면 추가: beforeinstallprompt 캡처 ----
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__pwaInstallPrompt = e;
  // 요약 화면이 이미 렌더링된 상태라면 버튼을 바로 활성화
  const btn = document.getElementById("install-btn");
  if (btn) btn.hidden = false;
});

window.addEventListener("appinstalled", () => {
  window.__pwaInstallPrompt = null;
  const btn = document.getElementById("install-btn");
  if (btn) btn.hidden = true;
});

// ------------------------------------------------------------
// 첫 방문 인트로 + 도움말
// ------------------------------------------------------------
const INTRO_KEY = "memorize-intro-seen";

function maybeShowIntro(next) {
  let seen = false;
  try { seen = localStorage.getItem(INTRO_KEY) === "1"; } catch {}
  if (seen) return next();
  renderIntro(next);
}

function markIntroSeen() {
  try { localStorage.setItem(INTRO_KEY, "1"); } catch {}
}

// 첫 방문 3슬라이드 인트로
function renderIntro(next) {
  const slides = [
    { icon: "📖", title: "성경말씀 암송하기", body: "성경 구절을 단계별로 직접 채우며 암송해요.<br>교구·교회학교로 로그인하면 내 진도가 저장돼요." },
    { icon: "✍️", title: "3단계로 익혀요", body: "① 빈칸 맛보기 (약 25%)<br>② 빈칸 늘리기 (약 65%)<br>③ 전체 암송 (100%)<br><br>맞으면 다음 칸으로, 틀리면 다시 입력해요." },
    { icon: "🔊", title: "듣고, 말하며 암송", body: "🔊 듣기로 말씀을 들어요 (빠르게 여러 번 누르면 반복).<br>🎤 음성 암송으로 직접 말해서 점검해요." },
  ];
  let idx = 0;
  const appEl = document.getElementById("app");

  function draw() {
    const s = slides[idx];
    const last = idx === slides.length - 1;
    appEl.innerHTML = `
      <div class="intro-screen">
        <div class="intro-card">
          <div class="intro-icon">${s.icon}</div>
          <div class="intro-title">${s.title}</div>
          <div class="intro-body">${s.body}</div>
          <div class="intro-dots">${slides.map((_, i) => `<span class="intro-dot ${i === idx ? "on" : ""}"></span>`).join("")}</div>
          <div class="intro-nav">
            <button class="intro-skip" id="intro-skip">건너뛰기</button>
            <button class="intro-next" id="intro-next">${last ? "시작하기" : "다음 ▸"}</button>
          </div>
        </div>
      </div>`;
    document.getElementById("intro-skip").addEventListener("click", done);
    document.getElementById("intro-next").addEventListener("click", () => {
      if (last) done();
      else { idx++; draw(); }
    });
  }
  function done() { markIntroSeen(); next(); }
  draw();
}

// 로그인 방법 안내 (교구/교회학교 탭으로 분리)
function renderLoginHelp(back) {
  const appEl = document.getElementById("app");
  const stepsFor = {
    교구: [
      '<b>구분</b>에서 <b>교구</b>를 선택하세요',
      '<b>교구</b>를 고르세요 (믿음·소망·사랑·섬김·은혜·화평·기쁨·새가족)',
      '<b>목장</b>을 적으세요 (예: 3목장 → 3, 남성목장 → 남성, 없으면 → 99)',
      '<b>이름</b>을 공백 없이 적으세요',
      '맨 아래 <b>시작하기</b>를 누르면 끝이에요! 🙌',
    ],
    교회학교: [
      '<b>구분</b>에서 <b>교회학교</b>를 선택하세요',
      '<b>부서</b>를 고르세요 (사랑부·영아부·유아부·유치부·유년부·초등부·중등부·고등부·청년부)',
      '<b>학년</b>을 적으세요 (예: 3학년)',
      '<b>이름</b>을 공백 없이 적으세요',
      '맨 아래 <b>시작하기</b>를 누르면 끝이에요! 🙌',
    ],
  };
  let tab = "교구";

  function draw() {
    const steps = stepsFor[tab]
      .map((t, i) => `<div class="lh-step"><span class="lh-no">${i + 1}</span><div>${t}</div></div>`)
      .join("");
    appEl.innerHTML = `
      <div class="help-screen">
        <div class="help-card">
          <div class="help-top">
            <h2 class="help-title">🔑 로그인 방법</h2>
            <button class="help-close" id="lh-close">✕ 닫기</button>
          </div>
          <p class="lh-intro">본인에게 맞는 탭을 고르고, 순서대로만 하시면 됩니다. 😊</p>
          <div class="lh-tabs">
            <button data-t="교구" class="${tab === "교구" ? "on" : ""}">교구</button>
            <button data-t="교회학교" class="${tab === "교회학교" ? "on" : ""}">교회학교</button>
          </div>
          <div class="login-steps">${steps}</div>
          <p class="lh-tip">💡 한 번 입력하면 다음부터는 자동으로 채워져요. 바꾸고 싶으면 <b>로그인 정보변경</b>에서 언제든 수정할 수 있어요.</p>
          <button class="help-go" id="lh-go">닫고 로그인하기</button>
        </div>
      </div>`;
    document.getElementById("lh-close").addEventListener("click", back);
    document.getElementById("lh-go").addEventListener("click", back);
    appEl.querySelectorAll(".lh-tabs button").forEach((b) =>
      b.addEventListener("click", () => { tab = b.dataset.t; draw(); })
    );
  }
  draw();
}

function renderPrivacyInfo(back) {
  const appEl = document.getElementById("app");
  appEl.innerHTML = `
    <div class="help-screen">
      <div class="help-card">
        <div class="help-top">
          <h2 class="help-title">🔐 개인정보 수집·이용 안내</h2>
          <button class="help-close" id="privacy-close">✕ 닫기</button>
        </div>
        <section class="help-section">
          <h3>수집 항목</h3>
          <ul>
            <li>이름</li>
            <li>교구/목장 또는 교회학교 부서/학년</li>
            <li>암송 진행 기록, 복습 및 도전 참여 기록</li>
            <li>기기 식별용 임의 ID</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>이용 목적</h3>
          <ul>
            <li>개인 암송 진도 저장과 기기 간 진도 동기화</li>
            <li>교구/부서별 참여 통계 확인</li>
            <li>암송 프로그램 운영, 격려, 보고 자료 작성</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>보관 기간</h3>
          <p>암송 프로그램 운영 기간 동안 보관하며, 운영 종료 또는 삭제 요청 시 확인 후 정리합니다.</p>
        </section>
        <section class="help-section">
          <h3>관리 주체</h3>
          <p>고척교회 제자양육부 신앙운동팀</p>
        </section>
        <button class="help-go" id="privacy-back">확인했습니다</button>
      </div>
    </div>`;
  document.getElementById("privacy-close").addEventListener("click", back);
  document.getElementById("privacy-back").addEventListener("click", back);
}

// 도움말 전체 화면 (onClose: 닫을 때 돌아갈 처리)
function renderHelp(onClose) {
  const appEl = document.getElementById("app");
  appEl.innerHTML = `
    <div class="help-screen">
      <div class="help-card">
        <div class="help-top">
          <h2 class="help-title">❓ 도움말</h2>
          <button class="help-close" id="help-close">✕ 닫기</button>
        </div>

        <section class="help-section">
          <h3>📖 이 앱은?</h3>
          <p>성경 구절을 단계별로 직접 채우며 암송하는 도구예요. 교구·교회학교로 로그인하면 개인별 진도가 저장되고, 다른 기기에서도 이어서 할 수 있어요.</p>
        </section>

        <section class="help-section">
          <h3>🙋 로그인 (정보 입력)</h3>
          <p>처음에 <b>구분(교구/교회학교)</b>을 고르고 정보를 입력해요. 교구는 <b>교구·목장·이름</b>, 교회학교는 <b>부서·학년·이름</b>이에요. 한 번 입력하면 다음부터는 그대로 이어집니다. <b>정보 변경</b>으로 언제든 바꿀 수 있어요.</p>
        </section>

        <section class="help-section">
          <h3>✍️ 3단계 학습</h3>
          <ul>
            <li><b>1단계</b> 빈칸 맛보기 — 일부 단어만 빈칸 (약 25%)</li>
            <li><b>2단계</b> 빈칸 늘리기 — 더 많은 빈칸 (약 65%)</li>
            <li><b>3단계</b> 전체 암송 — 출처만 보고 전체 입력</li>
          </ul>
          <p>맞으면 초록색으로 잠기고 다음 칸으로 이동해요. 틀리면 잠깐 빨갛게 표시된 뒤 다시 입력할 수 있어요. 모든 칸을 맞히면 다음 단계로 넘어가요.</p>
        </section>

        <section class="help-section">
          <h3>🔊 말씀 듣기</h3>
          <p>목록의 <b>🔊</b> 버튼이나 테스트 화면의 <b>🔊 듣기</b>로 말씀을 들을 수 있어요. <b>빠르게 여러 번 누르면 그 횟수만큼 반복</b>해서 읽어줘요.</p>
        </section>

        <section class="help-section">
          <h3>🎤 음성 암송</h3>
          <p><b>🎤 암송 시작</b>을 누르고 말씀을 소리 내어 외운 뒤 <b>■ 암송 종료</b>를 누르면 정확도를 알려줘요 (정확도가 충분히 높으면 통과). 크롬·사파리에서 마이크를 허용해 주세요.</p>
        </section>

        <section class="help-section">
          <h3>🏷️ 내 기록 & 진행 표시</h3>
          <p><b>기록보기</b>에서 전체 완료율과 단계별 개수를 한눈에 볼 수 있어요. 카드 배지는 <b>미시도 · 1단계 · 2단계 · 암송 완료 🙌</b>를 나타내요.</p>
        </section>

        <section class="help-section">
          <h3>📲 공유 & 홈 화면 추가</h3>
          <p>요약 화면의 <b>공유하기</b>로 가족·목장원들에게 링크를 보낼 수 있고, <b>홈 화면에 추가</b>로 앱처럼 바로 열 수 있어요.</p>
        </section>

        <section class="help-section">
          <h3>🔒 개인정보 안내</h3>
          <ul>
            <li><b>수집 항목</b>: 구분(교구/교회학교)·소속·목장/학년·이름과 암송·도전 기록뿐이에요. 연락처·주민번호 등 민감정보는 <b>받지 않습니다</b>.</li>
            <li><b>저장·용도</b>: 기록은 교회 내부 시트에 저장되어 <b>본인 진도 관리와 도전 순위</b>에만 쓰입니다. 외부에 공개하거나 다른 시스템과 연동하지 않아요.</li>
            <li><b>순위 공개 범위</b>: 도전 순위에는 <b>이름과 소속</b>만 표시됩니다(연락처 없음). 참여한 분만 표시돼요.</li>
            <li><b>변경·삭제</b>: 이름·소속은 <b>로그인 정보변경</b>에서 언제든 수정할 수 있어요. 기록 삭제가 필요하면 <b>교구 목사님 또는 제자양육부 신앙운동팀</b>에 요청해 주세요.</li>
          </ul>
        </section>

        <button class="help-go" id="help-go">닫고 시작하기</button>
      </div>
    </div>`;
  document.getElementById("help-close").addEventListener("click", onClose);
  document.getElementById("help-go").addEventListener("click", onClose);
}

// ============================================================
// 매일 말씀 암송 도전(챌린지) + 순위
// ============================================================
let challengeSession = []; // 이번 세션에 이미 나온 구절 no (중복 회피)

// 오늘 도전 완료 수 (이 기기, 새로고침에도 유지)
function challengeCountKey() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return "challenge-count-" + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate());
}
function bumpTodayChallenge() {
  const k = challengeCountKey();
  let n = 0;
  try { n = parseInt(localStorage.getItem(k) || "0", 10) || 0; } catch {}
  n++;
  try { localStorage.setItem(k, String(n)); } catch {}
  return n;
}

// 랜덤 구절 배정(세션 내 중복 회피, 모두 소진 시 리셋) → 도전 시작
function startChallenge() {
  if (!verses.length) return;
  let pool = verses.filter((v) => !challengeSession.includes(v.no));
  if (!pool.length) { challengeSession = []; pool = verses.slice(); }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  challengeSession.push(pick.no);
  renderChallenge(pick);
}

// 도전 화면 — 3단계(전체 빈칸) 고정 + 힌트 버튼 + 음성
function renderChallenge(verse) {
  const appEl = document.getElementById("app");
  const tokens = verse.text.trim().split(/\s+/);

  const wordsHtml = tokens
    .map((word) => {
      const width = Array.from(word).length + 1;
      return `<input class="word-input" data-answer="${word}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="width:${width}em" />`;
    })
    .join(" ");

  appEl.innerHTML = `
    <div class="test-screen">
      <div class="test-card">
        <div class="test-top">
          <div class="test-head">
            <div class="test-stage challenge-badge">🔥 도전</div>
            <div class="test-ref">${verse.refShort}</div>
          </div>
          <button class="back-btn" id="ch-exit">← 뒤로</button>
        </div>
        <div class="challenge-hint-line">출처만 보고 전체를 외워보세요!</div>
        <div class="test-sentence">${wordsHtml}</div>
        <div class="challenge-remain" id="ch-remain"></div>
        <div class="btn-row" style="flex-wrap:wrap;">
          <button class="answer-btn" id="hint-btn">💡 힌트</button>
          <button class="answer-btn" id="ch-shuffle">🔀 다른말씀</button>
          <button class="voice-btn" id="voice-toggle">🎤 암송시작</button>
        </div>
        <div id="result-area"></div>
        <div id="voice-panel" class="voice-panel" hidden>
          <div class="voice-status" id="voice-status">🎙️ 듣고 있어요… <b>‘암송 종료’</b>를 누를 때까지 계속 들어요</div>
          <div class="voice-live" id="voice-live"></div>
        </div>
        <div id="voice-result" class="voice-result"></div>
      </div>
    </div>`;

  document.getElementById("ch-exit").addEventListener("click", () => { stopSpeaking(); renderSummary(); });
  document.getElementById("ch-shuffle").addEventListener("click", () => { stopSpeaking(); startChallenge(); });
  setupHint();
  setupChallengeTyping(verse, (mode) => challengeComplete(verse, mode));
  setupVoice(verse, 3, () => challengeComplete(verse, "voice"));
}

// ------------------------------------------------------------
// 복습 화면 — 오늘 복습 대상 구절을 순서대로 3단계(전체 빈칸)로 다시 암송
// ------------------------------------------------------------
function startReview() {
  const dueNos = dueReviewNos();
  const queue = verses.filter((v) => dueNos.includes(v.no));
  if (!queue.length) { renderSummary(); return; }
  renderReview(queue, 0);
}

function renderReview(queue, idx) {
  const verse = queue[idx];
  const appEl = document.getElementById("app");
  const tokens = verse.text.trim().split(/\s+/);
  const wordsHtml = tokens
    .map((word) => {
      const width = Array.from(word).length + 1;
      return `<input class="word-input" data-answer="${word}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="width:${width}em" />`;
    })
    .join(" ");
  const answerHtml = tokens.map((word) => `<strong class="ans-word">${word}</strong>`).join(" ");

  appEl.innerHTML = `
    <div class="test-screen">
      <div class="test-card">
        <div class="test-top">
          <div class="test-head">
            <div class="test-stage review-badge">📖 복습</div>
            <div class="test-ref">${verse.refShort}</div>
          </div>
          <button class="back-btn" id="rv-exit">← 뒤로</button>
        </div>
        <div class="challenge-hint-line">복습 ${idx + 1} / ${queue.length} · 다시 외워볼까요?</div>
        <div class="test-sentence">${wordsHtml}</div>
        <div class="challenge-remain" id="ch-remain"></div>
        <div class="btn-row">
          <button class="answer-btn" id="show-answer-btn">보기</button>
          <button class="answer-btn" id="listen-answer-btn" aria-label="정답 음성으로 듣기">🔊 듣기</button>
          <button class="voice-btn" id="voice-toggle">🎤 암송시작</button>
        </div>
        <div id="result-area"></div>
        <div id="answer-panel" class="answer-panel" hidden>
          <div class="answer-title">정답</div>
          <div class="answer-text">${answerHtml}</div>
          <button class="back-to-test-btn" id="back-to-test-btn">돌아가서 계속하기</button>
        </div>
        <div id="voice-panel" class="voice-panel" hidden>
          <div class="voice-status" id="voice-status">🎙️ 듣고 있어요… <b>‘암송 종료’</b>를 누를 때까지 계속 들어요</div>
          <div class="voice-live" id="voice-live"></div>
        </div>
        <div id="voice-result" class="voice-result"></div>
      </div>
    </div>`;

  document.getElementById("rv-exit").addEventListener("click", () => { stopSpeaking(); renderSummary(); });
  setupAnswerToggle();
  // 정답 듣기(TTS)
  const listenBtn = document.getElementById("listen-answer-btn");
  if (listenBtn) {
    listenBtn.addEventListener("click", () => {
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        stopSpeaking();
        listenBtn.textContent = "🔊 듣기";
        return;
      }
      listenBtn.textContent = "⏹ 정지";
      speakText(`${verse.refFull}. ${verse.text}`, () => { listenBtn.textContent = "🔊 듣기"; });
    });
  }
  const onDone = (mode) => {
    postChallenge(verse, mode || "voice"); // 복습 완료도 도전 순위 데이터에 누적
    advanceReview(verse.no);
    reviewNext(queue, idx);
  };
  setupChallengeTyping(verse, onDone);
  setupVoice(verse, 3, onDone);
}

function reviewNext(queue, idx) {
  stopSpeaking();
  if (idx + 1 < queue.length) renderReview(queue, idx + 1);
  else renderReviewDone(queue.length);
}

function renderReviewDone(count) {
  const appEl = document.getElementById("app");
  appEl.innerHTML = `
    <div class="summary-screen">
      <div class="summary-card cd-card">
        <div class="cd-emoji">🎉</div>
        <div class="cd-title">복습 완료!</div>
        <div class="cd-sub">오늘 복습 ${count}구절을 마쳤어요. 잘하셨어요! 🙌</div>
        <div class="cd-count">다음 복습은 자동으로 안내됩니다.</div>
        <button class="summary-go" id="rv-home">기록 화면으로</button>
      </div>
    </div>`;
  document.getElementById("rv-home").addEventListener("click", renderSummary);
}

// 힌트: 현재(포커스된) 빈칸의 앞 글자를 한 글자씩 열어준다.
function setupHint() {
  const btn = document.getElementById("hint-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const inputs = Array.from(document.querySelectorAll(".word-input:not([disabled])"));
    if (!inputs.length) return;
    const target = inputs.includes(document.activeElement) ? document.activeElement : inputs[0];
    const ans = Array.from(target.dataset.answer);
    const maxReveal = Math.max(1, ans.length - 1); // 전체는 안 보여줌(마지막 글자는 직접 입력)
    const cur = target.placeholder ? Array.from(target.placeholder).length : 0;
    target.placeholder = ans.slice(0, Math.min(cur + 1, maxReveal)).join("");
    target.focus();
  });
}

// 타이핑 채점 — 전부 맞히면 onComplete 호출 (도전/복습 공용)
function setupChallengeTyping(verse, onComplete) {
  const inputs = Array.from(document.querySelectorAll(".word-input"));
  const remainEl = document.getElementById("ch-remain");
  let done = false;
  function updateRemain() {
    const left = inputs.filter((i) => !i.classList.contains("correct")).length;
    if (remainEl) {
      remainEl.textContent = left > 0 ? `남은 빈칸 ${left}개` : "모두 맞혔어요! 🎉";
      remainEl.classList.toggle("clear", left === 0);
    }
    return left;
  }
  function evaluate(input, idx, isComposing) {
    if (input.disabled) return;
    const val = input.value.trim();
    const answer = input.dataset.answer;
    if (val === answer) {
      input.value = answer;
      input.classList.add("correct");
      input.classList.remove("wrong");
      input.disabled = true;
      const left = updateRemain();
      // 남은 빈칸이 0이면 완료 (입력 순서와 무관하게 확실히 판정)
      if (left === 0 && !done) { done = true; onComplete("typing"); return; }
      const next = inputs.slice(idx + 1).find((inp) => !inp.disabled) || inputs.find((inp) => !inp.disabled);
      if (next) next.focus();
    } else if (!isComposing && Array.from(val).length >= Array.from(answer).length) {
      input.classList.add("wrong");
      input.classList.remove("correct");
      setTimeout(() => { input.blur(); input.value = ""; input.classList.remove("wrong"); input.focus(); }, 400);
    }
  }
  inputs.forEach((input, idx) => {
    let composing = false;
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; evaluate(input, idx, false); });
    input.addEventListener("input", (e) => { evaluate(input, idx, composing || e.isComposing); });
  });
  updateRemain();
  if (inputs[0]) inputs[0].focus();
}

// 도전 완료 처리 → 서버 기록 + 완료 화면
function challengeComplete(verse, mode) {
  stopSpeaking();
  const n = bumpTodayChallenge();
  postChallenge(verse, mode);
  renderChallengeDone(verse, mode, n);
}

// 도전 완료를 서버('도전기록' 탭)에 저장
function postChallenge(verse, mode) {
  const u = loadUser();
  if (!u || !POST_URL) return;
  const payload = Object.assign({}, u, { action: "challenge", no: verse.no, mode });
  try {
    fetch(POST_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch { /* 무시 */ }
}

function renderChallengeDone(verse, mode, todayCount) {
  const appEl = document.getElementById("app");
  appEl.innerHTML = `
    <div class="summary-screen">
      <div class="summary-card cd-card">
        <div class="cd-emoji">🎉</div>
        <div class="cd-title">도전 완료!</div>
        <div class="cd-sub">${verse.refShort} · ${mode === "voice" ? "음성" : "타이핑"} 암송</div>
        <div class="cd-count">오늘 <b>${todayCount}회</b> 완료</div>
        <button class="summary-go challenge-cta" id="cd-again">🔥 한 번 더 도전</button>
        <button class="summary-help" id="cd-rank">🏆 순위 보기</button>
        <button class="summary-change" id="cd-home">기록 화면으로</button>
      </div>
    </div>`;
  document.getElementById("cd-again").addEventListener("click", startChallenge);
  document.getElementById("cd-rank").addEventListener("click", () => renderRanking());
  document.getElementById("cd-home").addEventListener("click", renderSummary);
}

// ---- 순위 ----
function ymdKo(d) {
  const z = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
}
function rankRangeFor(key) {
  const now = new Date();
  if (key === "today") { const t = ymdKo(now); return { key, from: t, to: t }; }
  if (key === "week") { const w = new Date(now); w.setDate(w.getDate() - 6); return { key, from: ymdKo(w), to: ymdKo(now) }; }
  if (key === "all") { return { key, from: "", to: "" }; }
  const y = new Date(now); y.setDate(y.getDate() - 1); // 기본: 전일~당일
  return { key: "yday", from: ymdKo(y), to: ymdKo(now) };
}
async function callRanking(from, to) {
  const params = new URLSearchParams({ action: "ranking" });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const res = await fetch(POST_URL + "?" + params.toString(), { cache: "no-cache" });
  return res.json();
}

function renderRanking(range) {
  const r = range || rankRangeFor("yday");
  const u = loadUser();
  const appEl = document.getElementById("app");
  const tabs = [["today", "오늘"], ["yday", "전일~당일"], ["week", "이번주"], ["all", "전체"]];
  appEl.innerHTML = `
    <div class="rank-screen">
      <div class="list-nav">
        <button class="remind-cta nav-record" id="rk-back">← ${userLabel(u)} 성도님</button>
      </div>
      ${rankModeBar("rank")}
      <h2 class="rank-title">🏆 말씀 도전 순위</h2>
      <div class="rank-filter" id="rk-filter">
        ${tabs.map(([k, l]) => `<button data-k="${k}" class="${r.key === k ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <div class="rank-dates">
        <input type="date" id="rk-from" value="${r.from || ""}" />
        <span class="rd-sep">~</span>
        <input type="date" id="rk-to" value="${r.to || ""}" />
        <button class="rd-go" id="rk-go">조회</button>
      </div>
      <div id="rank-body"><p class="rank-msg">불러오는 중...</p></div>
    </div>`;
  document.getElementById("rk-back").addEventListener("click", renderSummary);
  wireRankMode();
  document.getElementById("rk-filter").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => renderRanking(rankRangeFor(b.dataset.k)))
  );
  document.getElementById("rk-go").addEventListener("click", () => {
    const from = document.getElementById("rk-from").value;
    const to = document.getElementById("rk-to").value;
    renderRanking({ key: "custom", from, to });
  });
  loadRankingBody(r);
}

async function loadRankingBody(r) {
  const body = document.getElementById("rank-body");
  const u = loadUser();
  const data = await callRanking(r.from, r.to).catch(() => ({ ok: false }));
  if (!data || !data.ok) { body.innerHTML = `<p class="rank-msg err">순위를 불러오지 못했습니다.</p>`; return; }

  const list = data.list || [];
  const keyOf = (g, s, sb, n) => g + "|" + s + "|" + sb + "|" + n;
  const myKey = u ? keyOf(u.type, u.gu || u.bu || "", u.mok || u.grade || "", u.name) : null;
  const me = myKey ? list.find((x) => keyOf(x.gubun, x.sosok, x.sebu, x.name) === myKey) : null;
  const medal = (n) => (n === 1 ? "🥇" : n === 2 ? "🥈" : n === 3 ? "🥉" : n);
  const soLabel = (x) => (x.gubun === "교구" ? `${x.sosok}교구 ${x.sebu}목장` : `${x.sosok} ${x.sebu}`);

  const myHtml = u
    ? `<div class="my-rank">
         <span class="mr-label">내 순위</span>
         ${me
            ? `<span class="mr-rank">${medal(me.rank)}</span><span class="mr-name">${u.name}</span><span class="mr-cnt">${me.count}회</span>`
            : `<span class="mr-name">${u.name}</span><span class="mr-cnt none">아직 기록 없음 — 도전해보세요! 🔥</span>`}
       </div>`
    : "";

  if (!list.length) {
    body.innerHTML = myHtml + `<p class="rank-msg">아직 도전 기록이 없어요.<br>첫 도전의 주인공이 되어보세요! 🔥</p>`;
    return;
  }

  const top = list.slice(0, 10);
  const rows = top.map((x) => {
    const isMe = keyOf(x.gubun, x.sosok, x.sebu, x.name) === myKey;
    return `<div class="rank-row ${x.rank <= 3 ? "top" : ""} ${isMe ? "me" : ""}">
      <span class="rk-no">${medal(x.rank)}</span>
      <span class="rk-name">${x.name}</span>
      <span class="rk-so">${soLabel(x)}</span>
      <span class="rk-cnt">${x.count}회</span>
    </div>`;
  }).join("");

  body.innerHTML = myHtml + `<div class="rank-list">${rows}</div>` +
    (list.length > 10 ? `<p class="rank-more">외 ${list.length - 10}명 참여</p>` : "");
}

// ---- 순위/내참여 모드 전환 바 ----
function rankModeBar(active) {
  return `<div class="rank-mode">
    <button class="${active === "rank" ? "on" : ""}" data-m="rank">🏆 전체 순위</button>
    <button class="${active === "mine" ? "on" : ""}" data-m="mine">📅 내 참여</button>
  </div>`;
}
function wireRankMode() {
  document.querySelectorAll(".rank-mode button").forEach((b) =>
    b.addEventListener("click", () => (b.dataset.m === "mine" ? renderMyRecord() : renderRanking()))
  );
}

// ---- 내 참여(주간/월간 달력) ----
function mdLabel(d) { return (d.getMonth() + 1) + "/" + d.getDate(); }
function weekRange(anchor) {
  const a = new Date(anchor); a.setHours(0, 0, 0, 0);
  const start = new Date(a); start.setDate(a.getDate() - a.getDay()); // 일요일
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { start, end };
}
function monthRange(anchor) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { start, end };
}
function shiftPeriod(s, dir) {
  const a = new Date(s.anchor);
  if (s.mode === "week") a.setDate(a.getDate() + 7 * dir);
  else a.setMonth(a.getMonth() + dir);
  return { mode: s.mode, anchor: a };
}
async function callMyDays(u, from, to) {
  const params = new URLSearchParams({ action: "mydays", type: u.type, name: u.name, from, to });
  if (u.type === "교구") { params.set("gu", u.gu); params.set("mok", u.mok); }
  else { params.set("bu", u.bu); params.set("grade", u.grade); }
  const res = await fetch(POST_URL + "?" + params.toString(), { cache: "no-cache" });
  return res.json();
}

function renderMyRecord(state) {
  const s = state || { mode: "week", anchor: new Date() };
  const u = loadUser();
  const appEl = document.getElementById("app");
  appEl.innerHTML = `
    <div class="rank-screen">
      <div class="list-nav">
        <button class="remind-cta nav-record" id="rk-back">← ${userLabel(u)} 성도님</button>
      </div>
      ${rankModeBar("mine")}
      <h2 class="rank-title">📅 나의 말씀 암송 참여</h2>
      <div class="myrec-ctrl">
        <div class="myrec-toggle">
          <button data-md="week" class="${s.mode === "week" ? "on" : ""}">주간</button>
          <button data-md="month" class="${s.mode === "month" ? "on" : ""}">월간</button>
        </div>
        <div class="myrec-nav">
          <button id="mr-prev">◀</button>
          <span id="mr-label">…</span>
          <button id="mr-next">▶</button>
        </div>
      </div>
      <div id="myrec-body"><p class="rank-msg">불러오는 중...</p></div>
    </div>`;
  document.getElementById("rk-back").addEventListener("click", renderSummary);
  wireRankMode();
  appEl.querySelectorAll(".myrec-toggle button").forEach((b) =>
    b.addEventListener("click", () => renderMyRecord({ mode: b.dataset.md, anchor: s.anchor }))
  );
  document.getElementById("mr-prev").addEventListener("click", () => renderMyRecord(shiftPeriod(s, -1)));
  document.getElementById("mr-next").addEventListener("click", () => renderMyRecord(shiftPeriod(s, 1)));
  loadMyRecord(s);
}

async function loadMyRecord(s) {
  const u = loadUser();
  const body = document.getElementById("myrec-body");
  const label = document.getElementById("mr-label");
  const { start, end } = s.mode === "week" ? weekRange(s.anchor) : monthRange(s.anchor);
  label.textContent = s.mode === "week"
    ? `${mdLabel(start)} ~ ${mdLabel(end)}`
    : `${start.getFullYear()}년 ${start.getMonth() + 1}월`;
  if (!u) { body.innerHTML = `<p class="rank-msg">로그인 정보가 없습니다.</p>`; return; }
  const data = await callMyDays(u, ymdKo(start), ymdKo(end)).catch(() => ({ ok: false }));
  if (!data || !data.ok) { body.innerHTML = `<p class="rank-msg err">기록을 불러오지 못했습니다.</p>`; return; }
  body.innerHTML = renderCalendar(start, end, data.days || {}, s.mode);
}

// 공휴일(빨강) — 2026년 대한민국 공휴일. 필요 시 여기 날짜를 추가/수정하세요.
const HOLIDAYS = new Set([
  "2026-01-01",                             // 신정
  "2026-02-16", "2026-02-17", "2026-02-18", // 설날 연휴
  "2026-03-01", "2026-03-02",               // 삼일절(+대체)
  "2026-05-05",                             // 어린이날
  "2026-05-24", "2026-05-25",               // 부처님오신날(+대체)
  "2026-06-06",                             // 현충일
  "2026-08-15", "2026-08-17",               // 광복절(+대체)
  "2026-09-24", "2026-09-25", "2026-09-26", // 추석 연휴
  "2026-10-03", "2026-10-05",               // 개천절(+대체)
  "2026-10-09",                             // 한글날
  "2026-12-25",                             // 성탄절
]);
function dayColorClass(d, key) {
  const dow = d.getDay();
  if (HOLIDAYS.has(key) || dow === 0) return "sun"; // 일요일·공휴일 빨강
  if (dow === 6) return "sat";                       // 토요일 파랑
  return "";
}

function renderCalendar(start, end, days, mode) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) dates.push(new Date(d));

  let participated = 0, missed = 0, total = 0;
  const cell = (d) => {
    const key = ymdKo(d);
    const cnt = days[key] || 0;
    const isFuture = d > today;
    const isToday = d.getTime() === today.getTime();
    let cls = "mc-cell";
    let mark = "";
    if (isFuture) { cls += " future"; mark = ""; }
    else {
      total++;
      if (cnt > 0) { cls += " done"; participated++; mark = `<div class="mc-cnt">✅ ${cnt}</div>`; }
      else { cls += " miss"; missed++; mark = `<div class="mc-cnt miss">·</div>`; }
    }
    if (isToday) cls += " today";
    return `<div class="${cls}"><div class="mc-day ${dayColorClass(d, key)}">${d.getDate()}</div>${mark}</div>`;
  };

  const head = `<div class="mc-week-head">${["일","월","화","수","목","금","토"].map((w, i) => `<span class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</span>`).join("")}</div>`;
  let cellsHtml = "";
  if (mode === "month") {
    const lead = new Date(start).getDay();
    cellsHtml = Array.from({ length: lead }, () => `<div class="mc-cell blank"></div>`).join("");
  }
  cellsHtml += dates.map(cell).join(""); // cell() 실행 중 카운터 집계

  const summary = `<div class="mc-summary">참여 <b class="done">${participated}일</b> · 미참여 <b class="miss">${missed}일</b> <span class="mc-sub">(지난 ${total}일 기준)</span></div>`;
  return summary + head + `<div class="mc-grid">${cellsHtml}</div>`;
}

promptOpenExternal();
loadVerses();
