// 카카오톡 내장 브라우저로 열렸을 때, 외부 브라우저(크롬/사파리)로 유도.
// - 안드로이드: openExternal 스킴으로 자동 전환 시도
// - 아이폰: 자동 전환 불가(OS 제약) → "사파리로 열기" 안내 오버레이
// 일반 브라우저에서는 아무 동작도 하지 않는다.
(function () {
  var ua = navigator.userAgent || "";
  if (!/KAKAOTALK/i.test(ua)) return;

  var target = encodeURIComponent(location.href);
  var extUrl = "kakaotalk://web/openExternal?url=" + target;
  var isIOS = /iphone|ipad|ipod/i.test(ua);

  // 안드로이드는 자동으로 외부 브라우저 열기 시도 (한 번만)
  if (!isIOS) {
    try { location.href = extUrl; } catch (e) {}
  }

  function showOverlay() {
    if (document.getElementById("kakao-ext-overlay")) return;
    var d = document.createElement("div");
    d.id = "kakao-ext-overlay";
    d.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:rgba(13,27,62,0.97);color:#fff;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "text-align:center;padding:28px;font-family:'Noto Sans KR',sans-serif;";

    var btn = isIOS
      ? "<div style='margin-top:16px;font-size:14px;line-height:1.9;opacity:0.9;'>오른쪽 아래 <b>공유 아이콘</b> 또는 <b>⋯</b> →<br><b>‘Safari로 열기’</b> 를 눌러주세요.</div>"
      : "<a href='" + extUrl + "' style='display:inline-block;margin-top:18px;background:#c8a84b;color:#0d1b3e;font-weight:800;text-decoration:none;padding:13px 24px;border-radius:10px;font-size:15px;'>🔗 외부 브라우저로 열기</a>";

    d.innerHTML =
      "<div style='font-size:19px;font-weight:800;margin-bottom:10px;'>📖 오직 성경, 말씀이 답이다!</div>" +
      "<div style='font-size:14px;line-height:1.8;opacity:0.9;'>카카오톡 브라우저에서는 음성·캘린더 기능이 제한됩니다.<br>크롬·사파리에서 열어 주세요.</div>" +
      btn +
      "<a href='#' id='kakao-ext-stay' style='margin-top:22px;font-size:13px;color:rgba(255,255,255,0.65);'>이대로 계속하기 (일부 기능 제한)</a>";

    document.body.appendChild(d);
    document.getElementById("kakao-ext-stay").addEventListener("click", function (e) {
      e.preventDefault();
      d.remove();
    });
  }

  if (document.body) showOverlay();
  else document.addEventListener("DOMContentLoaded", showOverlay);
})();
