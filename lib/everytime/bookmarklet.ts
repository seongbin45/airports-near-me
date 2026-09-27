// 에브리타임 공유 시간표를 사용자 브라우저에서 한 번 읽어 복사하는 북마클릿 (docs/EVERYTIME.md).
//
// 왜 이 방식인가: 서버에서 에브리타임을 부르면 403 "abnormal access"로 막히고, 그걸 넘으려면 헤더 위조 같은 차단 우회가 필요하다.
// 대신 사용자가 자기 브라우저에서 공유 페이지(everytime.kr/@…)를 열고 이 북마크를 누르면, 그 페이지가 스스로 하는 것과
// 같은 요청을 진짜 브라우저가 한 번 보낸다. 헤더는 브라우저가 붙이는 그대로다. 받은 XML은 가공하지 않고 복사만 한다 —
// 해석은 앱(lib/everytime/xml.ts)이 해서, 구조가 바뀌어도 사용자가 북마크를 다시 만들 필요가 없게 한다.
//
// grab()은 문자열로 직렬화되어 다른 사이트에서 돈다. 그래서 바깥 변수·import를 참조하면 안 되고(자기완결),
// async/await 대신 then을 쓴다(변환 도구가 헬퍼를 바깥에 끌어오지 않게).

/* eslint-disable no-var -- 직렬화되어 다른 페이지에서 도는 코드. 가장 보수적인 문법만 쓴다 */
export function grab(): void {
  var ID = 'airports-near-me-everytime';
  var m = /^\/@([A-Za-z0-9]+)\/?$/.exec(location.pathname);
  if (location.hostname !== 'everytime.kr' || !m) {
    alert('에브리타임 시간표 공유 링크(everytime.kr/@…) 페이지에서 눌러 주세요.');
    return;
  }
  var identifier = m[1];
  var url = 'https://api.everytime.kr/find/timetable/table/friend';
  var body = function () { return new URLSearchParams({ identifier: identifier, friendInfo: 'true' }); };

  function show(text: string, note: string) {
    var old = document.getElementById(ID);
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = ID;
    box.setAttribute('style', 'position:fixed;z-index:2147483647;left:12px;right:12px;bottom:12px;max-width:560px;margin:0 auto;padding:14px;border-radius:14px;background:#fffdfa;color:#2b2622;box-shadow:0 6px 24px rgba(0,0,0,.25);font:14px/1.5 sans-serif');
    var p = document.createElement('div');
    p.textContent = note;
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    ta.setAttribute('style', 'width:100%;height:96px;margin:8px 0;font:12px monospace');
    var copy = document.createElement('button');
    copy.textContent = '복사';
    copy.setAttribute('style', 'min-height:40px;padding:0 16px;border-radius:20px;border:none;background:#2f62c4;color:#fff;font-weight:600;margin-right:8px');
    copy.onclick = function () {
      ta.select();
      var done = function () { p.textContent = '복사했어요. 공항 찾기로 돌아가 붙여넣어 주세요.'; };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { document.execCommand('copy'); done(); });
      else { document.execCommand('copy'); done(); }
    };
    var close = document.createElement('button');
    close.textContent = '닫기';
    close.setAttribute('style', 'min-height:40px;padding:0 16px;border-radius:20px;border:1px solid #e2d8cc;background:#fffdfa');
    close.onclick = function () { box.remove(); };
    box.appendChild(p); box.appendChild(ta); box.appendChild(copy); box.appendChild(close);
    document.body.appendChild(box);
  }

  function received(xml: string) {
    var out = 'ETX1\n' + xml;
    var fallback = function () { show(out, '아래 내용을 [복사]한 뒤 공항 찾기에 붙여넣어 주세요.'); };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(out).then(function () {
        show(out, '시간표를 복사했어요. 공항 찾기로 돌아가 붙여넣어 주세요.');
      }, fallback);
    } else fallback();
  }

  function request(credentials: RequestCredentials) {
    return fetch(url, { method: 'POST', body: body(), credentials: credentials }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  // 페이지의 요청이 쿠키를 싣는지 확인하지 못했다(UNVERIFIED). 기본값으로 먼저, 막히면 쿠키를 실어 한 번 더.
  request('same-origin')
    .catch(function () { return request('include'); })
    .then(received)
    .catch(function (e: Error) {
      alert('시간표를 불러오지 못했어요 (' + e.message + '). 공개 범위가 "전체 공개"인지 확인해 주세요.');
    });
}
/* eslint-enable no-var */

/** 북마크에 넣을 주소. grab의 소스를 그대로 싣는다 */
export const BOOKMARKLET = `javascript:${encodeURIComponent(`(${grab.toString()})()`)}`;
