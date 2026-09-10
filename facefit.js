/* ===================================================================
   최애 청첩장 — facefit.js (얼굴 크롭 + 템플릿 합성)
   -------------------------------------------------------------------
   두 가지 일을 한다. 둘은 서로 모른다.

     1) 크로퍼  — 업로드 사진만 놓고, 고정된 원 안에 얼굴을 맞추게 한다.
                  결과는 '원본 사진의 어느 원을 잘랐는가'(cx, cy, r) 하나뿐.
     2) 합성    — 그 원을 각 템플릿의 얼굴 구멍에 끼워 넣는다.

   그래서 편집 화면에는 웨딩 템플릿이 나오지 않는다. 사용자는 자기
   사진만 보며 얼굴을 맞추고, 템플릿별 좌표는 아래 표가 알아서 맞춘다.

   합성 원리:
   템플릿을 먼저 깔고, 얼굴 구멍 자리에만 타원 클리핑을 걸어 얼굴을
   얹는다. 구멍은 원본 PNG 의 투명 영역을 픽셀 단위로 스캔해 얻은
   좌표라 눈대중 보정이 필요 없다.

   템플릿은 assets/templates.js 의 data URI 를 쓴다 — 경로 이미지는
   file:// 에서 캔버스를 오염시켜 toDataURL() 이 막히기 때문이다.

   왜 canvas 인가:
   미리보기 · 결과 카드 · 저장 이미지가 모두 같은 함수로 그려진 '납작한
   이미지 한 장'이 된다. html2canvas 가 레이어와 transform 을 해석할
   필요가 없어 저장본이 화면과 어긋나지 않는다.

   업로드 이미지는 이 파일 안에서도 밖으로 나가지 않는다 — FileReader 가
   만든 dataURL 을 메모리에서 캔버스로 그릴 뿐이다.
   =================================================================== */

(function () {
  'use strict';

  /* =================================================================
     1. 템플릿별 얼굴 구멍 좌표
     -------------------------------------------------------------------
     원본 이미지 대비 백분율. 실제 PNG 의 투명 영역을 픽셀 단위로 스캔해
     얻은 값이라 눈대중 보정이 필요 없다. 템플릿을 추가하면 여기에 한 줄
     넣으면 되고, 크로퍼 쪽은 손댈 필요가 없다.
     ================================================================= */

  var FACE_SLOTS = {
    'final_women_01': { x: 32.97, y: 14.07, width: 16.04, height: 35.19, shape: 'ellipse' },
    'final_women_02': { x: 24.79, y: 9.72,  width: 14.27, height: 27.87, shape: 'ellipse' }
  };

  /* 역할별 템플릿. 신랑용을 만들면 groom 배열에 같은 모양으로 넣는다. */
  var TEMPLATES = {
    bride: [{ key: 'final_women_01' }, { key: 'final_women_02' }],
    groom: []
  };

  /* 실제 그림은 인라인 데이터에서 꺼낸다(assets/templates.js). */
  function srcOf(tpl) {
    return (window.WED_TEMPLATES || {})[tpl.key] || '';
  }

  function slotOf(tpl) { return FACE_SLOTS[tpl.key]; }

  /* 카드 사진칸과 같은 비율(16:9). 템플릿 원본도 1920×1080 이라
     늘이거나 잘라내지 않고 그대로 채워진다. */
  var RATIO = 16 / 9;

  /* 저장본 기준 해상도. 카드 사진칸이 가장 큰 화면에서도 334px 이므로
     1280 이면 3배 저장(≈1000px)에도 충분하다. */
  var OUT_W = 1280;

  /* =================================================================
     2. 이미지 로더 — 같은 파일을 두 번 받지 않게 캐시한다
     ================================================================= */

  var cache = {};

  function loadImage(src) {
    if (cache[src]) return cache[src];

    cache[src] = new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('load failed')); };
      im.src = src;
    });

    return cache[src];
  }

  /* =================================================================
     3. 합성 — 잘라낸 얼굴 원을 템플릿 구멍에 끼운다
     -------------------------------------------------------------------
     crop = { cx, cy, r } — 원본 사진 픽셀 좌표. 편집기 크기와 무관하므로
     작은 미리보기와 큰 저장본이 똑같은 결과가 된다.
     ================================================================= */

  function paint(canvas, tplImg, photoImg, crop) {
    var W = canvas.width;
    var H = canvas.height;
    var ctx = canvas.getContext('2d');
    var slot = tplImg._slot;

    ctx.clearRect(0, 0, W, H);

    // 템플릿을 먼저 깐다. 얼굴 자리는 검게 비어 있다.
    ctx.drawImage(tplImg, 0, 0, W, H);

    if (photoImg && crop && slot) {
      var hx = slot.x / 100 * W;
      var hy = slot.y / 100 * H;
      var hw = slot.width / 100 * W;
      var hh = slot.height / 100 * H;

      var cxh = hx + hw / 2;
      var cyh = hy + hh / 2;

      // 잘라낸 원(정사각형 2r)이 구멍을 빈틈없이 덮도록 키운다
      var side = crop.r * 2;
      var sc = Math.max(hw / side, hh / side);
      var dw = side * sc;
      var dh = side * sc;

      ctx.save();

      /* 구멍 모양(타원)으로만 얼굴이 보이게 자른다. 반지름을 아주 조금
         키워 JPEG 로 굳은 구멍 가장자리의 검은 테를 덮는다. */
      ctx.beginPath();
      ctx.ellipse(cxh, cyh, hw / 2 + 1, hh / 2 + 1, 0, 0, Math.PI * 2);
      ctx.clip();

      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        photoImg,
        crop.cx - crop.r, crop.cy - crop.r, side, side,   // 원본에서 자를 곳
        cxh - dw / 2, cyh - dh / 2, dw, dh                // 구멍 중앙에 배치
      );

      ctx.restore();
    }
  }

  function prepare(tpl) {
    return loadImage(srcOf(tpl)).then(function (im) {
      im._slot = slotOf(tpl);
      return im;
    });
  }

  /** 합성 결과를 주어진 캔버스에 그린다. */
  function render(canvas, tpl, photo, crop) {
    var jobs = [prepare(tpl)];
    if (photo) jobs.push(loadImage(photo));

    return Promise.all(jobs).then(function (res) {
      paint(canvas, res[0], res[1] || null, crop);
      return canvas;
    });
  }

  /** 결과 카드·저장에 쓸 한 장짜리 이미지(dataURL). */
  function toDataURL(tpl, photo, crop) {
    var c = document.createElement('canvas');
    c.width = OUT_W;
    c.height = Math.round(OUT_W / RATIO);
    return render(c, tpl, photo, crop).then(function () {
      return c.toDataURL('image/jpeg', 0.92);
    });
  }

  /* =================================================================
     4. 크로퍼 — 사진만 놓고 고정된 원에 얼굴을 맞춘다
     -------------------------------------------------------------------
     움직이는 것은 사진이고 원은 고정이다. 화면에 보이는 것은 업로드
     사진뿐이라 '무엇을 맞추는 중인지'가 분명하다.
     ================================================================= */

  var GUIDE = 0.34;   // 편집 박스 한 변 대비 원 반지름

  function createCropper(canvas, onChange) {
    var img = null;
    var view = { scale: 1, base: 1, ox: 0, oy: 0 };

    function size() { return canvas.width; }         // 정사각형이다
    function radius() { return size() * GUIDE; }

    function draw() {
      var S = size();
      var ctx = canvas.getContext('2d');
      var R = radius();

      ctx.clearRect(0, 0, S, S);

      if (img) {
        var dw = img.naturalWidth * view.scale;
        var dh = img.naturalHeight * view.scale;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, S / 2 - dw / 2 + view.ox, S / 2 - dh / 2 + view.oy, dw, dh);
      }

      // 원 바깥만 어둡게 — 사각형과 원을 한 경로에 넣고 evenodd 로 뚫는다
      ctx.fillStyle = 'rgba(24, 21, 18, .55)';
      ctx.beginPath();
      ctx.rect(0, 0, S, S);
      ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2);
      ctx.fill('evenodd');

      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      ctx.lineWidth = Math.max(2, S / 220);
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, R, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* 화면에서 움직인 거리를 캔버스 좌표로 환산한다(CSS 크기와 다르다) */
    function toCanvasPx(px) {
      var rect = canvas.getBoundingClientRect();
      return rect.width ? px * (canvas.width / rect.width) : px;
    }

    var dragging = false, lastX = 0, lastY = 0;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', function (e) {
      if (!img) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      view.ox += toCanvasPx(e.clientX - lastX);
      view.oy += toCanvasPx(e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
      draw();
      if (onChange) onChange();
    });

    function stop(e) {
      if (!dragging) return;
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 이미 놓임 */ }
    }
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);

    return {
      /** 사진을 올린다. 처음에는 편집 박스를 꽉 채우게 놓는다. */
      load: function (dataUrl) {
        if (!dataUrl) { img = null; draw(); return Promise.resolve(); }
        return loadImage(dataUrl).then(function (im) {
          img = im;
          var S = size();
          view.base = Math.max(S / im.naturalWidth, S / im.naturalHeight);
          view.scale = view.base;
          view.ox = 0;
          view.oy = 0;
          draw();
          if (onChange) onChange();
        });
      },

      /** 슬라이더 값(100~300)을 배율로 반영한다. */
      zoom: function (percent) {
        if (!img) return;
        view.scale = view.base * (percent / 100);
        draw();
        if (onChange) onChange();
      },

      reset: function () {
        if (!img) return;
        view.scale = view.base;
        view.ox = 0;
        view.oy = 0;
        draw();
        if (onChange) onChange();
      },

      /** 지금 원 안에 들어온 영역을 '원본 사진 좌표'로 돌려준다. */
      crop: function () {
        if (!img) return null;
        var S = size();
        var dw = img.naturalWidth * view.scale;
        var dh = img.naturalHeight * view.scale;
        var dx = S / 2 - dw / 2 + view.ox;
        var dy = S / 2 - dh / 2 + view.oy;
        return {
          cx: (S / 2 - dx) / view.scale,
          cy: (S / 2 - dy) / view.scale,
          r: radius() / view.scale
        };
      },

      redraw: draw
    };
  }

  window.FaceFit = {
    FACE_SLOTS: FACE_SLOTS,
    listFor: function (role) { return TEMPLATES[role] || []; },
    createCropper: createCropper,
    render: render,
    toDataURL: toDataURL,
    RATIO: RATIO
  };
})();
