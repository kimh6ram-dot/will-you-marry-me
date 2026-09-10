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

  // <br> 로 줄바꿈 위치를 고정한다(카드에만 들어가는 고정 문구라 안전).
  var CLOSING = '두 사람의 새로운 시작을<br>마음속으로 축복해주세요!';
  var NOTE = '※ 실제 혼인 여부와는 무관합니다.';
  var MESSAGE_FALLBACK = '오랜 덕질 끝에 결실을 맺게 되었습니다.';
  var NAME_FALLBACK = { groom: '최애', bride: '나' };

  /* 대표 사진 정책
     ------------------------------------------------------------------
     운영자가 제공하는 인물·캐릭터 사진은 없다. 대표 사진은 오직
     사용자가 STEP 01 에서 자기 기기에서 직접 고른 이미지 하나뿐이고,
     FileReader 로 읽어 이 페이지의 메모리(state.photo)에만 담는다.
     서버 전송·localStorage·DB 기록이 전부 없으므로 페이지를 닫으면
     이미지 데이터는 남지 않는다.
     이미지를 고르지 않으면 CSS 기본값(웨딩홀 배경 사진)이 그대로 보인다. */

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
    view: '미리보기 모드 · 이 브라우저에 저장된 청첩장입니다.'
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
      // 1. 인사말 + 두 사람 이름 (가로 한 줄, 가운데 하트)
      '<p class="inv__greet">저희 드디어 결혼합니다 !</p>',
      '<p class="inv__pair">',
        '<span class="inv__name" data-groom></span>',
        '<span class="inv__heart" aria-hidden="true"></span>',
        '<span class="inv__name" data-bride></span>',
      '</p>',

      // 2. 이름과 사진을 가르는 작은 장식선
      '<span class="inv__rule" aria-hidden="true"></span>',

      // 3. 대표 사진 — 위에 꽃을 겹치지 않는다
      '<div class="inv__frame"><div class="inv__photo" data-photo></div></div>',

      // 4. 일시 · 장소를 한 블록 2열로
      '<div class="inv__info">',
        '<div class="inv__col">',
          '<p class="inv__lbl">예식 일시</p>',
          '<p class="inv__val" data-when></p>',
        '</div>',
        '<div class="inv__col">',
          '<p class="inv__lbl">예식 장소</p>',
          '<p class="inv__val" data-place></p>',
        '</div>',
      '</div>',

      // 5. 모시는 글 — 정보가 아니라 감정. 영문 라벨을 떼서
      //    '항목'이 아니라 '인사말'로 읽히게 한다.
      '<div class="inv__msg">',
        '<p class="inv__quote">',
          '<span class="inv__q">\u201C</span>',
          '<span data-message></span>',
          '<span class="inv__q">\u201D</span>',
        '</p>',
        // 맺음말도 모시는 글과 같은 결로 읽히도록 이 블록 안에 올려 둔다
        '<p class="inv__quote inv__quote--sub">', CLOSING, '</p>',
      '</div>',

      // 6. 하단 마무리 반짝이
      '<span class="inv__divider" aria-hidden="true"></span>',

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
   * @param {{reactions?: boolean, photo?: string}} opts
   *   reactions=true 면 하객 버튼 노출.
   *   photo 는 사용자가 이 기기에서 고른 이미지의 dataURL (없으면 기본 배경).
   */
  function mountCard(mount, opts) {
    opts = opts || {};
    mount.innerHTML = CARD_HTML;
    var card = $('[data-card]', mount);
    if (opts.reactions) $('[data-guest]', card).hidden = false;
    setupPhoto(card, opts.photo);
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
     넘어오는 값은 언제나 dataURL 한 장이다 — 사용자가 고른 사진이거나,
     신부용 템플릿에 그 사진을 합성한 결과(facefit.js 가 캔버스에서
     미리 납작하게 만들어 둔다)다. 레이어가 없으므로 html2canvas 가
     화면과 다르게 그릴 여지가 없다.
     값이 없으면 아무것도 하지 않는다 → CSS 기본값(웨딩홀 배경)이 채운다. */
  function setupPhoto(card, photo) {
    var box = $('[data-photo]', card);
    if (!box || !photo) return;
    box.style.backgroundImage = 'url("' + photo + '")';
    box.style.backgroundPosition = 'center';
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

  /* =================================================================
     8. index.html — STEP 01 ~ 04
     ================================================================= */

  function initCreate() {
    /* 이 화면이 들고 있는 값. 전부 메모리에만 있고 서버로 나가지 않는다.
         photo     업로드 이미지 dataURL
         template  무작위로 정해진 신부용 템플릿(FaceFit 항목). 없으면 null
         crop      얼굴 맞추기 결과 — 원본 사진에서 잘라낼 원 {cx, cy, r} */
    var state = {
      role: 'bride', me: '', fav: '', when: '', where: '', message: '',
      photo: null,
      template: null,
      crop: null
    };

    mountGallery($('#gallery-showcase'));

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

    // --- STEP 01: 사진(선택) ---------------------------------------
    // 파일은 FileReader 로 이 브라우저 안에서만 읽는다. 서버 전송 없음.
    // 청첩장 없이도(사진을 고르지 않아도) 다음 단계로 갈 수 있다.
    var photoInput = $('#input-photo');
    var photoBtn = $('#btn-photo');
    var photoClear = $('#btn-photo-clear');
    var photoThumb = $('#photo-thumb');

    function setPhoto(dataUrl) {
      state.photo = dataUrl || null;
      var on = !!state.photo;
      photoThumb.hidden = !on;
      photoThumb.style.backgroundImage = on ? 'url("' + state.photo + '")' : '';
      photoClear.hidden = !on;
      photoBtn.textContent = on ? '이미지 변경' : '이미지 추가';
      if (typeof syncFitUI === 'function') syncFitUI();
    }

    if (photoInput && photoBtn) {
      photoBtn.addEventListener('click', function () { photoInput.click(); });

      photoInput.addEventListener('change', function () {
        var file = photoInput.files && photoInput.files[0];
        // 같은 파일을 다시 골라도 change 가 뜨도록 즉시 비운다.
        photoInput.value = '';
        if (!file) return;

        if (file.type.indexOf('image/') !== 0) {
          toast('이미지 파일만 넣을 수 있어요.');
          return;
        }

        var reader = new FileReader();
        reader.onload = function () { setPhoto(String(reader.result)); };
        reader.onerror = function () { toast('이미지를 불러오지 못했습니다. 다른 파일로 시도해 주세요.'); };
        reader.readAsDataURL(file);
      });

      photoClear.addEventListener('click', function () { setPhoto(null); });
    }

    /* --- STEP 01: 얼굴 맞추기 --------------------------------------
       편집 화면에는 업로드 사진과 고정된 원 하나뿐이다. 웨딩 템플릿은
       보여 주지 않는다 — 사용자는 '얼굴을 원에 넣는 일'만 하면 된다.
       그 결과(원본 사진의 어느 원을 잘랐는가)를 facefit.js 가 템플릿별
       구멍 좌표에 맞춰 자동 배치한다. */

    var fitBlock = $('#fit-block');
    var fitCrop = $('#fit-crop');
    var fitScale = $('#fit-scale');
    var fitReset = $('#fit-reset');
    var cropper = null;

    /* 조작할 때마다 '잘라낸 원'만 갱신해 둔다. 어떤 템플릿에 끼워질지는
       결과 화면에서 정해지므로 여기서는 합성하지 않는다. */
    function updateCrop() {
      if (cropper) state.crop = cropper.crop();
    }

    if (fitCrop && window.FaceFit) {
      cropper = window.FaceFit.createCropper(fitCrop, updateCrop);
    }

    /* 역할에 쓸 템플릿이 있고 사진도 올렸을 때만 편집 영역을 연다.
       어떤 템플릿이 걸릴지는 결과 화면에서 정해진다. */
    function syncFitUI() {
      var hasTpl = !!(window.FaceFit && window.FaceFit.listFor(state.role).length);
      var on = !!(hasTpl && state.photo && cropper);

      if (fitBlock) fitBlock.hidden = !on;
      if (!on) { state.crop = null; return; }

      if (fitScale) fitScale.value = 100;
      cropper.load(state.photo).then(updateCrop);
    }

    if (fitScale) {
      fitScale.addEventListener('input', function () {
        if (cropper) cropper.zoom(Number(fitScale.value));
      });
    }

    if (fitReset) {
      fitReset.addEventListener('click', function () {
        if (!cropper) return;
        fitScale.value = 100;
        cropper.reset();
      });
    }

    // 역할 라디오는 제출 전에도 바뀌므로 바로 반응해야 한다
    $$('input[name="role"]').forEach(function (r) {
      r.addEventListener('change', function () {
        state.role = r.value;
        syncFitUI();
      });
    });

    syncFitUI();

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

      /* DB 에는 텍스트(이름·일시·장소·문구)만 저장한다.
         사용자가 고른 이미지는 어떤 형태로도 서버에 보내지 않는다. */
      var row = {
        groom: iAmGroom ? state.me : state.fav,
        bride: iAmGroom ? state.fav : state.me,
        when_label: state.when,
        place_label: state.where,
        message_label: state.message
      };

      var notice = $('#notice-03');
      makeBtn.disabled = true;
      setText(notice, '청첩장을 만드는 중입니다.');

      db().from('invitations').insert(row).select().single()
        .then(function (res) {
          if (res.error) throw res.error;
          setText(notice, '');
          showResult(res.data);
        })
        .catch(function (err) {
          setText(notice, '만들기에 실패했습니다. 잠시 후 다시 시도해 주세요.');
          if (window.console) console.error('[invitations.insert]', err);
        })
        .then(function () { makeBtn.disabled = false; });
    });

    // --- STEP 04: 완성된 청첩장 -----------------------------------
    /* 링크 공유는 제공하지 않는다. 완성 화면에서 할 수 있는 일은
       '이미지 저장' 하나뿐이다. */
    /* 카드에 넣을 대표 사진 한 장을 만든다.
       역할에 템플릿이 있으면 그중 하나를 '이 자리에서' 무작위로 뽑아
       얼굴을 끼운다 — 청첩장을 만들 때마다 다른 사진이 걸린다.
       템플릿이 없으면(신랑) 업로드 사진을 그대로 쓴다.
       어느 쪽이든 DB 가 아니라 이 기기의 메모리에서만 나온다. */
    function buildCardPhoto() {
      var list = window.FaceFit ? window.FaceFit.listFor(state.role) : [];

      if (list.length && state.photo && state.crop) {
        state.template = list[Math.floor(Math.random() * list.length)];
        return window.FaceFit
          .toDataURL(state.template, state.photo, state.crop)
          .catch(function () { return state.photo; });   // 실패하면 원본으로
      }
      return Promise.resolve(state.photo);
    }

    function showResult(row) {
      goto('step-04');

      buildCardPhoto().then(function (photo) {
        var card = mountCard($('#invite-mount'), {
          reactions: false, photo: photo
        });
        fillCard(card, row);
        wireSave(card, $('#btn-save'), $('#notice-04'));
      });
    }

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
        stateEl.hidden = true;
        body.hidden = false;
        renderInvite(res.data, id, client);
      })
      .catch(function (err) {
        setText(stateEl, '청첩장을 찾지 못했습니다. 링크가 만료되었거나 잘못된 주소입니다.');
        if (window.console) console.error('[invitations.select]', err);
      });
  }

  function renderInvite(row, id, client) {
    /* 만든 사람이 고른 이미지는 그 기기 밖으로 나가지 않으므로
       하객 화면의 사진 자리는 기본 배경(웨딩홀)으로 보인다. */
    var card = mountCard($('#invite-mount'), { reactions: true });
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
