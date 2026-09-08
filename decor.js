/* ===================================================================
   최애 청첩장 — decor.js (장식 · 애니메이션 전용)
   -------------------------------------------------------------------
   app.js(기능 로직)와 완전히 분리되어 있다. 이 파일을 통째로 지워도
   입력 · 캐릭터 매칭 · 공유 · 저장은 그대로 동작한다.

   중요 — 캡처 오염 방지:
   장식 레이어(.stage)는 .shell 의 '형제'로 만든다. 청첩장 카드(.inv)의
   조상이 되면 html2canvas 가 저장 이미지에 장식을 함께 그려버린다.

   레이어 구성(뒤 → 앞):
     .stage         웨딩홀 사진 배경 + 반짝이            (z-index 0)
     .shell         콘텐츠 · 청첩장 카드                 (z-index 1)
     .stage--front  카드 위를 스쳐 지나가는 반짝이        (z-index 3)

   꽃 · 잎 · 부케 · 꽃잎 · 샹들리에 SVG 는 전부 걷어냈다. 분위기는
   assets 의 웨딩홀 사진 한 장이 담당하고 장식은 반짝이 몇 개뿐이다.

   성능:
   전부 position:fixed + transform/opacity 애니메이션. filter:blur 는
   비싸므로 쓰지 않고 radial-gradient 로 번짐을 만든다.
   =================================================================== */

(function () {
  'use strict';

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var narrow = window.innerWidth < 430;

  /* '있는 듯 없는 듯' — 뒤 3개, 앞 2개면 충분하다. 요소는 재사용되므로
     동시에 켜지는 반짝이는 많아야 두어 개다. */
  var N = narrow
    ? { twBack: 3, twFront: 1 }
    : { twBack: 3, twFront: 2 };

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* =================================================================
     반짝일 자리 — 아무 데나 뿌리지 않는다.
     제목 주변 · 대표 사진 근처 · 하단 장식선 근처, 딱 그 정도만.
     [left%, top%, 크기(px)]
     ================================================================= */

  /* 뒤 레이어 — 제목 좌우와 사진 언저리 */
  var SPOTS_BACK = [
    [17, 15, 13], [82, 18, 12],     // 제목 양옆
    [26, 44, 11], [75, 47, 12],     // 대표 사진 근처
    [50, 74, 10]                    // 하단 장식선 언저리
  ];

  /* 앞 레이어 — 카드 위를 아주 가끔 스친다 */
  var SPOTS_FRONT = [
    [21, 30, 11], [79, 34, 10], [50, 62, 9]
  ];

  /* =================================================================
     장식 레이어 만들기
     ================================================================= */

  function twMarkup(n) {
    var s = '';
    for (var i = 0; i < n; i++) {
      // 세 겹: 부드러운 번짐 + 밝은 중심 + 4갈래 작은 반짝이
      s += '<span class="tw">' +
             '<i class="tw__bloom"></i>' +
             '<i class="tw__core"></i>' +
             '<i class="tw__flare"></i>' +
           '</span>';
    }
    return s;
  }

  /* 장식이 붙는 자리 — 모바일 청첩장 한 장(.mobile-page) 안쪽.
     body 에 붙이면 PC 에서 브라우저 폭만큼 꽃이 벌어진다. 여전히 .shell 의
     '형제'라서 청첩장 카드(.inv)의 조상이 되지 않는다(캡처 오염 없음). */
  function stageMount() {
    return document.querySelector('.mobile-page') || document.body;
  }

  function buildStage() {
    if (document.querySelector('.stage')) return;

    /* --- 뒤 레이어 --- */
    var back = document.createElement('div');
    back.className = 'stage';
    back.setAttribute('aria-hidden', 'true');

    var html =
      '<div class="stage__hall"></div>' +
      '<div class="stage__vignette"></div>';

    if (!reduce) html += twMarkup(N.twBack);

    back.innerHTML = html;
    var page = stageMount();
    page.insertBefore(back, page.firstChild);

    if (reduce) return;

    /* --- 앞 레이어 (카드 위를 스치는 빛) --- */
    var front = document.createElement('div');
    front.className = 'stage stage--front';
    front.setAttribute('aria-hidden', 'true');
    front.innerHTML = twMarkup(N.twFront);
    stageMount().appendChild(front);

    // 뜸하게 — 하나 꺼지고 한참 뒤에 다른 하나가 켜지는 정도
    startTwinkle(back.querySelectorAll('.tw'), SPOTS_BACK, 1500, 3200);
    startTwinkle(front.querySelectorAll('.tw'), SPOTS_FRONT, 2600, 5200);
  }

  /* =================================================================
     트윙클 스케줄러
     -------------------------------------------------------------------
     고정 주기로 깜빡이면 '깜빡이는 장식'처럼 보인다. 무작위 간격으로
     하나씩 터뜨려서 여기저기서 빛이 찰나에 튀는 리듬을 만든다.
     요소는 재사용하므로 DOM 은 늘어나지 않는다.
     ================================================================= */

  function startTwinkle(pool, spots, gapMin, gapMax) {
    if (!pool.length) return;
    var list = Array.prototype.slice.call(pool);

    function fire() {
      var el = list[Math.floor(Math.random() * list.length)];

      if (!el.classList.contains('is-on')) {
        var s = spots[Math.floor(Math.random() * spots.length)];
        var dur = rand(1.4, 2.4);

        el.style.left = s[0] + '%';
        el.style.top = s[1] + '%';
        el.style.setProperty('--sz', Math.round(s[2] * rand(0.85, 1.15)) + 'px');
        el.style.setProperty('--dur', dur.toFixed(2) + 's');
        el.style.setProperty('--rot', Math.round(rand(-30, 30)) + 'deg');
        el.classList.add('is-on');

        setTimeout(function () { el.classList.remove('is-on'); }, dur * 1000 + 60);
      }

      setTimeout(fire, rand(gapMin, gapMax));
    }

    setTimeout(fire, rand(0, 400));
  }

  /* =================================================================
     스크롤 등장 — opacity + translateY
     JS 가 켜졌을 때만 숨긴다. 스크립트가 죽어도 콘텐츠는 보인다.
     청첩장 카드(.inv)는 자체 등장 모션이 있으므로 제외한다.
     ================================================================= */

  var REVEAL = ['.head', '.field', '.pick', '.actions', '.gallery',
                '.card', '.linkmgr', '.share', '.hint'];

  function setupReveal(root) {
    if (reduce || !('IntersectionObserver' in window)) return;

    var targets = [];
    REVEAL.forEach(function (sel) {
      Array.prototype.forEach.call((root || document).querySelectorAll(sel), function (el) {
        if (el.closest('.inv')) return;         // 청첩장 내부는 건드리지 않는다
        if (el.dataset.revealed) return;
        el.dataset.revealed = '1';
        el.classList.add('reveal');
        targets.push(el);
      });
    });
    if (!targets.length) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    /* 이미 화면 안에 있는 요소는 관찰에 맡기지 않고 바로 띄운다.
       첫 화면(특히 '청첩장 만들기' 버튼)은 관찰 타이밍에 따라 숨은 채로
       남을 수 있어서, 접힘선 위 콘텐츠는 절대 IO 에 의존시키지 않는다. */
    requestAnimationFrame(function () {
      var vh = window.innerHeight || 0;
      targets.forEach(function (t) {
        if (t.getBoundingClientRect().top < vh * 0.98) t.classList.add('is-in');
        else io.observe(t);
      });
    });

    /* 안전망 — 어떤 이유로든 관찰이 동작하지 않으면 강제로 드러낸다. */
    setTimeout(function () {
      targets.forEach(function (t) {
        if (t.getBoundingClientRect().top < (window.innerHeight || 0)) {
          t.classList.add('is-in');
        }
      });
    }, 1500);
  }

  function watch() {
    if (!('MutationObserver' in window)) return;
    var mo = new MutationObserver(function () {
      clearTimeout(watch._t);
      watch._t = setTimeout(function () { setupReveal(document); }, 60);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* =================================================================
     부팅
     ================================================================= */

  function init() {
    buildStage();
    setupReveal(document);
    watch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
