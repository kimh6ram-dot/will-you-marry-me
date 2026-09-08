/* ===================================================================
   최애 청첩장 — app.js (세 페이지 공용)
   -------------------------------------------------------------------
   index.html   data-page="create"  STEP 01~04 (만들기 → 완성된 청첩장)
   invite.html  data-page="invite"  링크로 받은 청첩장 열람 + 하객 반응
   result.html  data-page="result"  제작자용 반응 집계

   청첩장 마크업은 CARD_HTML 한 곳에만 있고 index/invite 가 함께 쓴다.
   문구를 고칠 일이 생기면 여기만 고치면 두 화면에 같이 반영된다.
   =================================================================== */

(function () {
  'use strict';

  /* =================================================================
     1. 문구 · 이미지 테이블
     ================================================================= */

  var CLOSING = '두 사람의 새로운 시작을 마음속으로 축복해주세요.';
  var NOTE = '※ 실제 혼인 여부와는 무관합니다.';
  var MESSAGE_FALLBACK = '오랜 덕질 끝에 결실을 맺게 되었습니다.';
  var NAME_FALLBACK = { groom: '최애', bride: '나' };

  /* '나'의 역할에 따라 쓰는 대표 사진.
     bride = 내가 신부(여자) / groom = 내가 신랑(남자).
     한 벌 중 하나를 무작위로 골라 DB(photo_key)에 저장한다 —
     하객이 링크로 열었을 때도 같은 사진이 보여야 하기 때문이다. */
  var PHOTO_SETS = {
    bride: ['wedding-04', 'wedding-05'],
    groom: ['wedding-01', 'wedding-02', 'wedding-03']
  };
  var PHOTO_FALLBACK = 'wedding-04';

  /* 최애 이름이 아래 캐릭터와 일치하면 전용 사진을 쓴다.
     일치하지 않으면 위 PHOTO_SETS 의 기존 로직이 그대로 돌아간다.
     키는 공백을 모두 지운 형태 — '고죠 사토루', '고죠사토루',
     '고죠  사토루' 가 전부 같은 키가 된다. */
  var CHARACTER_PHOTOS = {
    '하울':       'howl',
    '고죠사토루':  'gojo',
    '나나미켄토':  'nanami',
    '리바이':     'levi',
    '로이드포저':  'loid',
    '토모에':     'tomoe',
    '하쿠':       'haku',
    '렌고쿠쿄주로': 'rengoku'
  };

  /* 이름 비교용 정규화 — 앞뒤 공백을 자르고 내부 공백을 모두 지운다.
     \s 는 일반 공백뿐 아니라 전각 공백·탭도 잡는다. */
  function normalizeFavoriteName(name) {
    return String(name == null ? '' : name).trim().replace(/\s+/g, '');
  }

  /** 최애 이름에 대응하는 캐릭터 키. 없으면 null. */
  function characterKeyFor(name) {
    return CHARACTER_PHOTOS[normalizeFavoriteName(name)] || null;
  }

  /* 캐릭터 사진은 1장당 130~170KB 라 전부 미리 받지 않는다.
     매칭됐을 때만 해당 파일 하나를 불러온다. */
  function loadCharacterPhoto(key) {
    return new Promise(function (resolve) {
      if (!key) return resolve(null);
      if (window.CHAR_PHOTOS && window.CHAR_PHOTOS[key]) return resolve(key);

      var s = document.createElement('script');
      s.src = 'assets/characters/' + key + '.js';
      s.onload = function () {
        resolve(window.CHAR_PHOTOS && window.CHAR_PHOTOS[key] ? key : null);
      };
      s.onerror = function () { resolve(null); };   // 실패해도 기존 사진으로 계속 간다
      document.head.appendChild(s);
    });
  }

  // 이 장소를 고르면 직접 입력칸이 펼쳐지고, 청첩장에는 입력값이 들어간다.
  var CUSTOM_PLACE = '애니에 나오는 장소';

  /* 사례 갤러리. 사용자가 고르는 요소가 아니라 분위기 설명용이다.
     pos 는 세로로 자를 때 인물이 잘리지 않는 기준점(원본 비율이 제각각이다). */
  var GALLERY = [
    { src: 'assets/wedding-03.png', cap: '미쿠와 함께',    pos: '50% 20%' },
    { src: 'assets/wedding-05.png', cap: '클라우스와 함께', pos: '58% 30%' },
    { src: 'assets/wedding-04.png', cap: '요이치와 함께',   pos: '50% 24%' }
  ];

  // 반응 key 는 DB 컬럼명과 같아야 한다(RPC 인자로 그대로 넘어감).
  var REACTIONS = [
    { key: 'cheer',  echo: '축하 감사합니다. 신랑에게는 알리지 않겠습니다.' },
    { key: 'sense',  echo: '정중히 접수되었습니다. 접수 즉시 반려되었습니다.' },
    { key: 'donate', echo: '정신머리 1개가 기부되었습니다. 끝내 사용되지 않았습니다.' }
  ];
  var ALREADY_ECHO = '이미 한 번 전하셨습니다. 마음은 충분히 전달되었습니다.';

  /* =================================================================
     2. 작은 도구들
     ================================================================= */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  function param(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function absUrl(page, id) {
    var base = window.location.href.replace(/[^/]*$/, '');
    return base + page + '?id=' + encodeURIComponent(id);
  }

  // 사용자 입력은 항상 textContent 로만 넣는다(HTML 주입 방지).
  function setText(el, value) { if (el) el.textContent = value; }

  /* =================================================================
     3. Supabase 클라이언트 (미설정 시 localStorage 폴백)
     ================================================================= */

  var _client = null;
  var IS_LOCAL = false;

  function db() {
    if (_client) return _client;

    var url = window.SUPA_URL, key = window.SUPA_ANON;
    var ready = url && key &&
      url.indexOf('YOUR-PROJECT') < 0 && key.indexOf('YOUR-ANON') < 0 &&
      window.supabase && typeof window.supabase.createClient === 'function';

    if (ready) {
      _client = window.supabase.createClient(url, key);
    } else {
      IS_LOCAL = true;
      _client = localClient();
    }
    return _client;
  }

  /* config.js 가 아직 비어 있을 때의 폴백. 실제 클라이언트와 호출 모양이
     같아서 각 페이지 코드는 어느 쪽에 붙었는지 몰라도 된다.
     단 이 브라우저 안에서만 유효하므로 배너로 알린다. */
  function localClient() {
    var KEY = 'wym:local:invitations';

    function all() {
      try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
      catch (e) { return {}; }
    }
    function save(map) { localStorage.setItem(KEY, JSON.stringify(map)); }
    function ok(data) { return Promise.resolve({ data: data, error: null }); }
    function fail(msg) { return Promise.resolve({ data: null, error: { message: msg } }); }

    function uuid() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    }

    return {
      from: function () {
        var pending = null, wantId = null;
        var q = {
          insert: function (row) { pending = row; return q; },
          select: function () { return q; },
          eq: function (_col, value) { wantId = value; return q; },
          single: function () {
            var map = all();
            if (pending) {
              var row = Object.assign({}, pending, {
                id: uuid(), cheer: 0, sense: 0, donate: 0,
                created_at: new Date().toISOString()
              });
              map[row.id] = row; save(map); pending = null;
              return ok(row);
            }
            return map[wantId] ? ok(map[wantId]) : fail('not found');
          }
        };
        return q;
      },

      rpc: function (name, args) {
        if (name !== 'bump_reaction') return fail('unknown function');
        if (['cheer', 'sense', 'donate'].indexOf(args.p_reaction) < 0) return fail('invalid reaction');
        var map = all(), row = map[args.p_id];
        if (!row) return fail('not found');
        row[args.p_reaction] += 1; save(map);
        return ok([Object.assign({}, row)]);
      }
    };
  }

  var LOCAL_MSG = {
    share: '미리보기 모드 · 이 링크는 지금 이 브라우저에서만 열립니다. ' +
           '다른 사람에게 보내려면 config.js 에 Supabase 값을 넣어 주세요.',
    view:  '미리보기 모드 · 이 브라우저에 저장된 청첩장입니다. ' +
           'config.js 에 Supabase 값을 넣으면 링크 공유와 집계가 켜집니다.'
  };

  /* 미리보기 모드 배너. 첫 화면에는 띄우지 않는다 — 아직 링크가 없어서
     경고할 것이 없고 첫인상만 해친다. */
  function markLocalMode(container, message) {
    if (!IS_LOCAL || !container || $('#banner-local', container)) return;
    var el = document.createElement('p');
    el.className = 'banner';
    el.id = 'banner-local';
    el.textContent = message;
    container.insertBefore(el, container.firstChild);
  }

  /* =================================================================
     4. 갤러리 — 사례 사진 (분위기 설명용, 선택 요소 아님)
     ================================================================= */

  function mountGallery(el) {
    if (!el) return;
    el.innerHTML = GALLERY.map(function (g) {
      // 배경 이미지로 그린다(비율 유지 + html2canvas 호환).
      return '<figure class="shot">' +
               '<div class="shot__img" style="background-image:url(\'' + g.src + '\');' +
                 'background-position:' + g.pos + '"></div>' +
               '<figcaption class="shot__cap">' + g.cap + '</figcaption>' +
             '</figure>';
    }).join('');
  }

  /* =================================================================
     5. 청첩장 카드 — index(STEP 04) / invite 공용
     ================================================================= */

  var CARD_HTML = [
    '<article class="inv" data-card>',
      // 1. 이름 — 청첩장에서 가장 먼저 읽혀야 하는 정보
      '<p class="inv__eyebrow">WE ARE GETTING MARRIED</p>',
      '<p class="inv__pair">',
        '<span class="inv__name" data-groom></span>',
        '<span class="inv__amp">&amp;</span>',
        '<span class="inv__name" data-bride></span>',
      '</p>',

      // 2. 이름과 사진을 가르는 작은 장식선
      '<span class="inv__rule" aria-hidden="true"></span>',

      // 3. 대표 사진 — 위에 꽃을 겹치지 않는다
      '<div class="inv__frame"><div class="inv__photo" data-photo></div></div>',

      // 4. 일시 · 장소를 한 블록 2열로
      '<div class="inv__info">',
        '<div class="inv__col">',
          '<p class="inv__lbl">WEDDING DAY</p>',
          '<p class="inv__val" data-when></p>',
        '</div>',
        '<div class="inv__col">',
          '<p class="inv__lbl">PLACE</p>',
          '<p class="inv__val" data-place></p>',
        '</div>',
      '</div>',

      // 5. MESSAGE — 정보가 아니라 감정. 위계를 다르게 준다.
      '<div class="inv__msg">',
        '<p class="inv__lbl">MESSAGE</p>',
        '<p class="inv__quote">',
          '<span class="inv__q">\u201C</span>',
          '<span data-message></span>',
          '<span class="inv__q">\u201D</span>',
        '</p>',
      '</div>',

      // 6. 하단 마무리 반짝이
      '<span class="inv__divider" aria-hidden="true"></span>',

      '<p class="inv__closing">', CLOSING, '</p>',
      '<p class="inv__note">', NOTE, '</p>',

      '<div class="guest" data-guest hidden>',
        '<p class="guest__legend">GUEST</p>',
        '<div class="guest__row">',
          '<button class="gbtn" type="button" data-react="cheer">',
            '<span>축하합니다</span><span class="gbtn__count" data-count="cheer">0</span>',
          '</button>',
          '<button class="gbtn" type="button" data-react="sense">',
            '<span>정신 차리세요</span><span class="gbtn__count" data-count="sense">0</span>',
          '</button>',
        '</div>',
        '<button class="gbtn gbtn--wide" type="button" data-react="donate">',
          '<span>정신머리 기부하기</span><span class="gbtn__count" data-count="donate">0</span>',
        '</button>',
        '<p class="guest__echo" data-echo role="status">&nbsp;</p>',
      '</div>',

      '<p class="inv__mark">@ccojik.dh</p>',
    '</article>'
  ].join('');

  /**
   * 청첩장을 mount 안에 그리고 카드 루트를 돌려준다.
   * @param {Element} mount
   * @param {{reactions?: boolean}} opts  reactions=true 면 하객 버튼 노출
   */
  function mountCard(mount, opts) {
    opts = opts || {};
    mount.innerHTML = CARD_HTML;
    var card = $('[data-card]', mount);
    if (opts.reactions) $('[data-guest]', card).hidden = false;
    setupPhoto(card, opts.photoKey, opts.charKey);
    return card;
  }

  /** 데이터를 청첩장에 조판한다. data = invitations 테이블 한 행 */
  function fillCard(card, data) {
    setText($('[data-groom]', card), data.groom || NAME_FALLBACK.groom);
    setText($('[data-bride]', card), data.bride || NAME_FALLBACK.bride);
    setText($('[data-when]', card), data.when_label);
    setText($('[data-place]', card), data.place_label);
    // message_label 은 나중에 추가된 컬럼 → 예전 행에는 없을 수 있다.
    setText($('[data-message]', card), data.message_label || MESSAGE_FALLBACK);
    paintCounts(card, data);
  }

  function paintCounts(card, counts) {
    REACTIONS.forEach(function (r) {
      var el = $('[data-count="' + r.key + '"]', card);
      if (el) el.textContent = String(counts[r.key] || 0);
    });
  }

  /* 대표 사진을 넣는다.
     hero-photos.js 의 data URI 를 쓴다 — 파일 경로 이미지는 file:// 에서
     캔버스를 오염시켜 '이미지 저장'이 실패하기 때문이다. 파일이 없으면
     원본 PNG 로 폴백하고, 그마저 없으면 사진 영역을 접는다. */
  function setupPhoto(card, key, charKey) {
    var box = $('[data-photo]', card);
    if (!box) return;

    // 1순위: 캐릭터 전용 사진 / 2순위: 기존 사진 로직
    var chosen = charKey && window.CHAR_PHOTOS && window.CHAR_PHOTOS[charKey];
    if (chosen) {
      box.style.backgroundImage = 'url("' + chosen.data + '")';
      box.style.backgroundPosition = chosen.pos;
      return;
    }

    key = key || PHOTO_FALLBACK;
    var shot = window.HERO_PHOTOS && window.HERO_PHOTOS[key];

    if (shot) {
      box.style.backgroundImage = 'url("' + shot.data + '")';
      box.style.backgroundPosition = shot.pos;
      return;
    }

    var src = 'assets/' + key + '.png';
    var probe = new Image();
    probe.onload = function () { box.style.backgroundImage = 'url("' + src + '")'; };
    probe.onerror = function () { box.classList.add('is-missing'); };
    probe.src = src;
  }

  /* =================================================================
     6. 이미지 저장 (html2canvas)
     ================================================================= */

  function wireSave(card, btn, notice) {
    if (!btn) return;

    btn.addEventListener('click', function () {
      if (typeof window.html2canvas !== 'function') {
        setText(notice, '저장 기능을 불러오지 못했습니다. 화면을 캡처해 주세요.');
        return;
      }

      btn.disabled = true;
      setText(notice, '청첩장을 이미지로 만드는 중입니다.');
      card.classList.add('is-capturing');

      window.html2canvas(card, {
        backgroundColor: '#FFFFFF',
        scale: Math.min(window.devicePixelRatio || 1, 2) * 1.5,
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY
      }).then(function (canvas) {
        return downloadCanvas(canvas, buildFileName(card));
      }).then(function (ok) {
        setText(notice, ok
          ? '저장했습니다. 스토리에 공유해 보세요.'
          : '새 창에 열었습니다. 이미지를 길게 눌러 저장해 주세요.');
      }).catch(function (err) {
        setText(notice, '저장에 실패했습니다. 화면을 캡처해 주세요.');
        if (window.console) console.error('[html2canvas]', err);
      }).then(function () {
        card.classList.remove('is-capturing');
        btn.disabled = false;
      });
    });
  }

  function buildFileName(card) {
    var safe = function (s) { return (s || '').replace(/[\\/:*?"<>|\s]/g, '') || 'name'; };
    return 'wedding-' +
      safe($('[data-bride]', card).textContent) + '-' +
      safe($('[data-groom]', card).textContent) + '.png';
  }

  // a[download] 가 막힌 환경(주로 iOS Safari)에서는 새 창으로 폴백한다.
  function downloadCanvas(canvas, filename) {
    return new Promise(function (resolve) {
      var url = canvas.toDataURL('image/png');
      var a = document.createElement('a');

      if (typeof a.download === 'undefined') {
        window.open(url, '_blank');
        resolve(false);
        return;
      }

      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      resolve(true);
    });
  }

  /* =================================================================
     7. 복사 · 토스트
     ================================================================= */

  // navigator.clipboard 는 https/localhost 에서만 동작 → execCommand 폴백을 둔다.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) {
      return false;
    }
  }

  var toastTimer = null;

  function toast(message, ms) {
    var el = $('#toast');
    if (!el) return;
    setText(el, message);
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('is-on'); });

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-on');
      setTimeout(function () { el.hidden = true; }, 240);
    }, ms || 2400);
  }

  /* =================================================================
     8. index.html — STEP 01 ~ 04
     ================================================================= */

  function initCreate() {
    var state = { role: 'bride', me: '', fav: '', when: '', where: '', message: '' };

    mountGallery($('#gallery-showcase'));
    mountGallery($('#gallery-04'));

    function goto(stepId) {
      $$('.step').forEach(function (el) {
        var on = el.id === stepId;
        el.classList.toggle('is-active', on);
        el.hidden = !on;
      });
      window.scrollTo(0, 0);
    }

    $$('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () { goto(btn.getAttribute('data-goto')); });
    });

    // --- STEP 01: 이름 --------------------------------------------
    $('#form-01').addEventListener('submit', function (e) {
      e.preventDefault();
      var fav = $('#input-groom').value.trim();
      var me = $('#input-bride').value.trim();
      var notice = $('#notice-01');

      if (!fav || !me) {
        setText(notice, '두 사람의 이름을 모두 적어 주세요.');
        (!fav ? $('#input-groom') : $('#input-bride')).focus();
        return;
      }

      setText(notice, '');
      state.role = $('input[name="role"]:checked').value;
      state.fav = fav;
      state.me = me;
      goto('step-02');
    });

    // --- STEP 02: 일시 · 장소 --------------------------------------
    var placeBox = $('#place-custom');
    var placeInput = $('#input-place');
    var placeError = $('#error-place');

    /* '애니에 나오는 장소' 일 때만 입력칸을 펼친다.
       숨길 때 값을 지우지 않으므로 다시 고르면 입력값이 남아 있다. */
    function syncPlace() {
      var on = $('input[name="where"]:checked').value === CUSTOM_PLACE;
      placeBox.hidden = !on;
      if (!on) clearPlaceError();
    }

    function clearPlaceError() {
      placeError.hidden = true;
      placeInput.classList.remove('is-error');
    }

    $$('input[name="where"]').forEach(function (r) {
      r.addEventListener('change', syncPlace);
    });
    placeInput.addEventListener('input', clearPlaceError);
    syncPlace();

    $('#form-02').addEventListener('submit', function (e) {
      e.preventDefault();

      var where = $('input[name="where"]:checked').value;

      if (where === CUSTOM_PLACE) {
        var typed = placeInput.value.trim();
        if (!typed) {
          placeError.hidden = false;
          placeInput.classList.add('is-error');
          placeInput.focus();
          return;
        }
        // 청첩장에는 선택지 이름이 아니라 실제 입력한 장소가 들어간다.
        where = typed;
      }

      state.when = $('input[name="when"]:checked').value;
      state.where = where;
      goto('step-03');
    });

    // --- STEP 03: 문구 → 저장 → STEP 04 ---------------------------
    var makeBtn = $('#btn-make');

    $('#form-03').addEventListener('submit', function (e) {
      e.preventDefault();
      state.message = $('input[name="message"]:checked').value;

      // 내가 신랑이면 groom 자리에 내 이름, 아니면 최애가 groom.
      var iAmGroom = state.role === 'groom';
      var set = PHOTO_SETS[state.role] || PHOTO_SETS.bride;

      var row = {
        groom: iAmGroom ? state.me : state.fav,
        bride: iAmGroom ? state.fav : state.me,
        when_label: state.when,
        place_label: state.where,
        message_label: state.message,
        photo_key: set[Math.floor(Math.random() * set.length)],
        // 최애가 목록에 있으면 전용 사진 키. 없으면 null → 기존 로직 유지.
        character_key: characterKeyFor(state.fav)
      };

      var notice = $('#notice-03');
      makeBtn.disabled = true;
      setText(notice, '청첩장을 만드는 중입니다.');

      db().from('invitations').insert(row).select().single()
        .then(function (res) {
          if (res.error) throw res.error;
          setText(notice, '');
          // 캐릭터 사진을 먼저 받아둔 뒤 그려야 첫 렌더부터 전용 사진이 보인다.
          return loadCharacterPhoto(res.data.character_key).then(function () {
            setText(notice, '');
            showResult(res.data, res.data.id);
          });
        })
        .catch(function (err) {
          setText(notice, '만들기에 실패했습니다. 잠시 후 다시 시도해 주세요.');
          if (window.console) console.error('[invitations.insert]', err);
        })
        .then(function () { makeBtn.disabled = false; });
    });

    // --- STEP 04: 완성된 청첩장 -----------------------------------
    var shareUrl = '';

    function showResult(row, id) {
      var card = mountCard($('#invite-mount'), {
        reactions: false, photoKey: row.photo_key, charKey: row.character_key
      });
      fillCard(card, row);
      wireSave(card, $('#btn-save'), $('#notice-04'));

      if (id) {
        shareUrl = absUrl('invite.html', id);
        $('#share-block').hidden = false;
        setText($('#url-invite'), shareUrl);
        setText($('#url-result'), absUrl('result.html', id));
        markLocalMode($('#step-04'), LOCAL_MSG.share);
      }

      goto('step-04');
    }

    // 공유: 네이티브 공유 시트가 있으면 그쪽, 없으면 링크 복사
    $('#btn-share').addEventListener('click', function () {
      if (!shareUrl) return;

      if (navigator.share) {
        navigator.share({ title: '청첩장', url: shareUrl })
          .catch(function () { /* 사용자가 취소한 경우 — 조용히 넘어간다 */ });
        return;
      }

      copyText(shareUrl).then(function (ok) {
        toast(ok
          ? '링크를 복사했습니다. 하객에게 보내주세요.'
          : '복사에 실패했습니다. 링크를 길게 눌러 복사해 주세요.');
      });
    });

    $$('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = $('#' + btn.getAttribute('data-copy'));
        copyText(target.textContent).then(function (ok) {
          toast(ok ? '집계 링크를 복사했습니다.' : '복사에 실패했습니다.');
        });
      });
    });
  }

  /* =================================================================
     9. invite.html — 하객 화면
     ================================================================= */

  function initInvite() {
    var id = param('id');
    var stateEl = $('#invite-state');
    var body = $('#invite-body');

    mountGallery($('#gallery-invite'));

    if (!id) {
      setText(stateEl, '청첩장 주소가 올바르지 않습니다. 받으신 링크를 다시 확인해 주세요.');
      return;
    }

    var client = db();
    markLocalMode($('.shell'), LOCAL_MSG.view);

    client.from('invitations').select('*').eq('id', id).single()
      .then(function (res) {
        if (res.error || !res.data) throw (res.error || new Error('not found'));
        return loadCharacterPhoto(res.data.character_key).then(function () {
          stateEl.hidden = true;
          body.hidden = false;
          renderInvite(res.data, id, client);
        });
      })
      .catch(function (err) {
        setText(stateEl, '청첩장을 찾지 못했습니다. 링크가 만료되었거나 잘못된 주소입니다.');
        if (window.console) console.error('[invitations.select]', err);
      });
  }

  function renderInvite(row, id, client) {
    var card = mountCard($('#invite-mount'), {
      reactions: true, photoKey: row.photo_key, charKey: row.character_key
    });
    fillCard(card, row);
    wireSave(card, $('#btn-save'), $('#notice-save'));
    wireReactions(card, id, client);
    document.title = row.bride + ' & ' + row.groom + ' 청첩장';
  }

  function wireReactions(card, id, client) {
    var echo = $('[data-echo]', card);

    // 한 브라우저에서 반응 종류별 1회. 가벼운 중복 방지이지 인증은 아니다.
    var storeKey = function (kind) { return 'wym:' + id + ':' + kind; };

    REACTIONS.forEach(function (r) {
      var btn = $('[data-react="' + r.key + '"]', card);
      if (localStorage.getItem(storeKey(r.key))) btn.classList.add('is-picked');

      btn.addEventListener('click', function () {
        if (localStorage.getItem(storeKey(r.key))) {
          setText(echo, ALREADY_ECHO);
          return;
        }

        btn.disabled = true;
        client.rpc('bump_reaction', { p_id: id, p_reaction: r.key })
          .then(function (res) {
            if (res.error) throw res.error;
            // RPC 가 setof 를 반환하므로 배열로 온다.
            var counts = Array.isArray(res.data) ? res.data[0] : res.data;
            if (!counts) throw new Error('empty rpc result');

            localStorage.setItem(storeKey(r.key), '1');
            paintCounts(card, counts);
            btn.classList.add('is-picked');
            setText(echo, r.echo);
          })
          .catch(function (err) {
            setText(echo, '전달에 실패했습니다. 잠시 후 다시 눌러 주세요.');
            if (window.console) console.error('[bump_reaction]', err);
          })
          .then(function () { btn.disabled = false; });
      });
    });
  }

  /* =================================================================
     10. result.html — 반응 집계
     ================================================================= */

  function initResult() {
    var id = param('id');
    var stateEl = $('#result-state');
    var body = $('#result-body');

    if (!id) {
      setText(stateEl, '주소가 올바르지 않습니다. 만들 때 저장해 둔 링크를 확인해 주세요.');
      return;
    }

    var client = db();
    markLocalMode($('.shell'), LOCAL_MSG.view);

    var btn = $('#btn-refresh');

    function load(isRefresh) {
      if (isRefresh) {
        btn.disabled = true;
        setText($('#notice-result'), '불러오는 중입니다.');
      }

      return client.from('invitations').select('*').eq('id', id).single()
        .then(function (res) {
          if (res.error || !res.data) throw (res.error || new Error('not found'));
          paint(res.data);
          stateEl.hidden = true;
          body.hidden = false;
          setText($('#notice-result'), '');
        })
        .catch(function (err) {
          if (body.hidden) {
            setText(stateEl, '반응을 찾지 못했습니다. 잘못된 주소입니다.');
          } else {
            setText($('#notice-result'), '새로 불러오지 못했습니다.');
          }
          if (window.console) console.error('[result.select]', err);
        })
        .then(function () { btn.disabled = false; });
    }

    function paint(row) {
      REACTIONS.forEach(function (r) {
        setText($('[data-tally="' + r.key + '"]'), String(row[r.key] || 0));
      });
      var total = REACTIONS.reduce(function (sum, r) { return sum + (row[r.key] || 0); }, 0);
      setText($('[data-tally="total"]'), String(total));

      setText($('#result-names'), row.groom + ' & ' + row.bride);
      setText($('#result-when'), row.when_label);
      setText($('#result-place'), row.place_label);
      $('#link-invite').href = absUrl('invite.html', row.id);
    }

    btn.addEventListener('click', function () { load(true); });
    load(false);
  }

  /* =================================================================
     11. 부팅 — body[data-page] 로 분기
     ================================================================= */

  var PAGES = { create: initCreate, invite: initInvite, result: initResult };
  var page = document.body.getAttribute('data-page');
  if (PAGES[page]) PAGES[page]();
})();
