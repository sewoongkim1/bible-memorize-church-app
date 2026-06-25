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
const POST_URL = "https://script.google.com/macros/s/AKfycbwT_ttuV6_wGGqqnmz7-D9ubnSuEmemmkSm7jwOQh0R9xoK97VPthUrAzkHbza7pIJ-Zw/exec";

// 식별 항목 (summer-bible 등록 화면과 동일)
const GU_LIST = ["믿음", "소망", "사랑", "섬김", "은혜", "화평", "기쁨", "새가족"];
const BU_LIST = ["사랑부", "영아부", "유아부", "유치부", "유년부", "초등부", "중등부", "고등부", "청년부"];

let verses = []; // 화면에 쓰는 구절 데이터

// ------------------------------------------------------------
// 데이터 로드 → 사용자 유무에 따라 진입/요약으로 분기
// ------------------------------------------------------------
async function loadVerses() {
  const appEl = document.getElementById("app");
  appEl.innerHTML = "<p style='text-align:center;padding:40px'>불러오는 중...</p>";

  for (const url of [DATA_URL, API_URL]) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.verses || !data.verses.length) throw new Error("데이터 없음");

      verses = data.verses;
      routeAfterLoad();
      return;
    } catch (err) {
      if (url === API_URL) {
        appEl.innerHTML = `<p class="error" style="text-align:center;padding:40px">연결 실패: ${err.message}</p>`;
      }
    }
  }
}

// 사용자 정보가 있으면 (서버 기록 동기화 후) 본인 기록 요약, 없으면 진입 화면
function routeAfterLoad() {
  if (loadUser()) enterAfterLogin();
  else renderEntryScreen();
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
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(local));
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
    ? `${u.gu}교구 ${u.mok}목장 ${u.name}`
    : `${u.bu} ${u.name}`;
}

// 로그인 정보를 2줄로: { l1: 소속, l2: 이름 + "성도님" }
function userLines(u) {
  if (!u) return { l1: "", l2: "" };
  const l1 =
    u.type === "교구"
      ? `${u.gu}교구 ${u.mok}목장`
      : `${u.bu}${u.grade ? " " + u.grade : ""}`;
  return { l1, l2: `${u.name} 성도님` };
}

// ------------------------------------------------------------
// 진행 상태 (localStorage) + 서버 백업
//   key: "memorize-progress" → { "1": { stage: 2, passed: true }, ... }
// ------------------------------------------------------------
const PROGRESS_KEY = "memorize-progress";

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {};
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
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      /* 저장 실패(시크릿 모드 등) 무시 */
    }
  }
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

        <div class="entry-field">
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
          <div class="entry-field">
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
          <div class="entry-field">
            <div class="entry-label">학년</div>
            <input class="entry-input" id="grade" placeholder="예: 3학년" value="${u.grade || ""}"/>
          </div>
        </div>

        <div class="entry-field">
          <div class="entry-label">성명</div>
          <input class="entry-input" id="name" placeholder="이름" value="${u.name || ""}"/>
        </div>

        <div class="entry-error" id="entry-error" hidden></div>
        <button class="entry-submit" id="entry-submit">시작하기</button>
      </div>
    </div>
  `;

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
    saveUser(user);
    enterAfterLogin(); // 서버 기록 동기화 후 요약 화면
  });
}

// ------------------------------------------------------------
// 화면 1: 본인 기록 요약 (로그인 직후)
// ------------------------------------------------------------
function renderSummary() {
  const u = loadUser();
  if (!u) return renderEntryScreen();

  const total = verses.length;
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  verses.forEach((v) => {
    counts[getPassedStage(v.no)]++;
  });
  const done = counts[3];
  const pct = total ? Math.round((done / total) * 100) : 0;

  // 다음에 도전할 구절(미완료 중 가장 앞 회차)
  const next = verses.find((v) => getPassedStage(v.no) < 3);

  const appEl = document.getElementById("app");
  appEl.innerHTML = `
    <div class="summary-screen">
      <div class="summary-card">
        <div class="summary-hello"><span class="summary-user">${userLabel(u)} 성도님</span>,<br>환영합니다 🙌</div>

        <div class="gauge-wrap">
          <div class="gauge-bar"><div class="gauge-fill" style="width:${pct}%"></div></div>
          <div class="gauge-sub">전체 ${total}구절 중 <b>${done}구절</b> 암송 완료</div>
        </div>

        <div class="stat-grid">
          <div class="stat-box status-done"><div class="stat-num">${counts[3]}</div><div class="stat-lbl">암송 완료</div></div>
          <div class="stat-box status-s2"><div class="stat-num">${counts[2]}</div><div class="stat-lbl">2단계</div></div>
          <div class="stat-box status-s1"><div class="stat-num">${counts[1]}</div><div class="stat-lbl">1단계</div></div>
          <div class="stat-box status-none"><div class="stat-num">${counts[0]}</div><div class="stat-lbl">미시도</div></div>
        </div>

        ${next ? `<div class="summary-next">다음 도전: <b>${next.refShort}</b></div>` : `<div class="summary-next">🎉 모든 구절을 완료했어요!</div>`}

        <button class="summary-go" id="go-list">암송하러 가기</button>
        <button class="summary-change" id="change-user">정보 변경</button>
      </div>
    </div>
  `;

  document.getElementById("go-list").addEventListener("click", renderVerseList);
  document.getElementById("change-user").addEventListener("click", renderEntryScreen);
}

// ------------------------------------------------------------
// 화면 2: 구절 목록
// ------------------------------------------------------------
function renderVerseList() {
  const u = loadUser();
  const appEl = document.getElementById("app");
  appEl.innerHTML = `
    <div class="list-nav">
      <button class="nav-btn" id="to-summary">← 내 기록</button>
      <span class="nav-user"><span class="nav-user-l1">${userLines(u).l1}</span><span class="nav-user-l2">${userLines(u).l2}</span></span>
    </div>
    <span class="page-title">오직 성경(Sola Scriptura), 오직 은혜(Sola Gratia)</span>
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
    `;
    card.addEventListener("click", () => startTest(v));
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
          <button class="answer-btn" id="show-answer-btn">정답 보기</button>
          <button class="voice-btn" id="voice-toggle">🎤 암송 시작</button>
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
    .addEventListener("click", renderVerseList);

  setupAnswerToggle();
  setupAutoCheck(verse, stage);
  setupVoice(verse, stage);
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

function scoreSpoken(answerText, spokenText) {
  const ans = normalizeWords(answerText);
  const said = normalizeWords(spokenText);
  const n = ans.length;
  const m = said.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        ans[i - 1] === said[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const marks = new Array(n).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (ans[i - 1] === said[j - 1]) { marks[i - 1] = true; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  const accuracy = n ? Math.round((dp[n][m] / n) * 100) : 0;
  return { accuracy, marks, ansWords: ans };
}

function setupVoice(verse, stage) {
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
      toggleBtn.textContent = "🎤 암송 시작";
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
    if (passed) saveProgress(verse.no, stage, "voice"); // 현재 단계 기준으로 저장

    // 통과 시 빈칸 테스트와 동일하게 다음 단계로 진행(마지막 단계면 완료)
    const nav = !passed
      ? ""
      : stage < 3
      ? `<button class="next-btn" id="voice-next-stage">${stage + 1}단계로</button>`
      : `<div class="complete-badge">암송 완료 🙌</div>
         <button class="next-btn" id="voice-to-summary">내 기록 보기</button>`;

    resultEl.innerHTML = `
      <div class="voice-summary"><span class="voice-pct ${passed ? "pass" : "fail"}">${accuracy}%</span> ${passed ? "음성 암송 통과! 🎉" : `조금 더! (통과 ${VOICE_PASS}%)`}</div>
      <div class="voice-words">${wordsHtml}</div>
      <div class="voice-heard">들린 내용: ${heard ? heard : "(인식 안 됨)"}</div>
    `;

    // 다음단계 버튼은 빈칸 테스트와 동일하게 상단(result-area) 한 곳으로 통일
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
    r.continuous = true;

    // 이 세션에서 확정된 텍스트. 매 onresult마다 results 전체로부터 '다시 구성'한다.
    // (안드로이드 크롬은 continuous 모드에서 확정 결과를 반복 전송 → += 누적 시 중복됨)
    let sessionFinal = "";

    r.onresult = (e) => {
      let fin = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t + " ";
        else interim += t;
      }
      sessionFinal = fin;
      liveEl.textContent = (finalText + fin + interim).replace(/\s+/g, " ").trim();
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        stopped = true;
        statusEl.textContent = "마이크 권한이 필요합니다. 브라우저에서 마이크를 허용해 주세요.";
      }
    };
    r.onend = () => {
      // 세션 확정분을 누적
      finalText = (finalText + " " + sessionFinal).replace(/\s+/g, " ").trim();
      sessionFinal = "";
      // 재시작 루프는 사용하지 않는다(세션 간 음성 중복 인식 방지).
      // 인식이 끝나면(자동 종료 또는 '암송 종료') 곧바로 채점.
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
promptOpenExternal();
loadVerses();
