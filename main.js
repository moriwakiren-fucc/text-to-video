(function(){
  const textInput = document.getElementById('textInput');
  const textColor = document.getElementById('textColor');
  const textColorHex = document.getElementById('textColorHex');
  const bgColor = document.getElementById('bgColor');
  const bgColorHex = document.getElementById('bgColorHex');
  const fontSize = document.getElementById('fontSize');
  const fontSizeValue = document.getElementById('fontSizeValue');
  const alignGroup = document.getElementById('alignGroup');
  const clockDetail = document.getElementById('clockDetail');
  const clockMinutes = document.getElementById('clockMinutes');
  const clockWarning = document.getElementById('clockWarning');
  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext('2d');
  const generateBtn = document.getElementById('generateBtn');
  const statusText = document.getElementById('statusText');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const resultVideo = document.getElementById('resultVideo');
  const postActions = document.getElementById('postActions');
  const downloadBtn = document.getElementById('downloadBtn');
  const shareBtn = document.getElementById('shareBtn');
  const dimsTag = document.getElementById('dimsTag');
  const dimsNote = document.getElementById('dimsNote');

  const W = 720;
  let H = 240; // becomes 368 when clock is enabled
  let textAlign = 'left'; // 'left' | 'center'
  let clockMode = 'off';  // 'off' | 'stopwatch' | 'timer'
  let resolvedAvcCodec = null; // cached working AVC level string, reset on canvas size change
  let lastWebCodecsFailureReason = null;

  let lastBlob = null;
  let lastUrl = null;

  // ---------- Persisted settings (last-used values) ----------
  const STORAGE_KEY = 'textFrame.lastSettings.v1';

  function loadSavedSettings(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    } catch(e){
      console.warn('[TextFrame] 保存された設定の読み込みに失敗しました:', e);
      return null;
    }
  }

  function saveSettings(){
    try {
      const data = {
        text: textInput.value,
        textColor: textColor.value,
        bgColor: bgColor.value,
        fontSize: fontSize.value,
        textAlign: textAlign,
        clockMode: clockMode,
        clockMinutes: clockMinutes.value,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e){
      // 保存できなくても致命的ではないため、静かに無視する
      // (プライベートブラウズモードなどでは例外が出ることがある)
    }
  }

  function applySavedSettings(){
    const saved = loadSavedSettings();
    if(!saved) return;

    if(typeof saved.text === 'string') textInput.value = saved.text;

    if(typeof saved.textColor === 'string' && isValidHex(saved.textColor)){
      textColor.value = saved.textColor;
      textColorHex.value = saved.textColor.toUpperCase();
    }
    if(typeof saved.bgColor === 'string' && isValidHex(saved.bgColor)){
      bgColor.value = saved.bgColor;
      bgColorHex.value = saved.bgColor.toUpperCase();
    }
    if(saved.fontSize){
      const n = parseInt(saved.fontSize, 10);
      if(!isNaN(n) && n >= parseInt(fontSize.min,10) && n <= parseInt(fontSize.max,10)){
        fontSize.value = String(n);
        fontSizeValue.textContent = n + 'px';
      }
    }
    if(saved.textAlign === 'left' || saved.textAlign === 'center'){
      textAlign = saved.textAlign;
      [...alignGroup.querySelectorAll('button')].forEach(b => {
        b.classList.toggle('active', b.dataset.align === textAlign);
      });
    }
    if(saved.clockMode === 'off' || saved.clockMode === 'stopwatch' || saved.clockMode === 'timer'){
      clockMode = saved.clockMode;
      const radio = document.querySelector(`input[name="clockMode"][value="${clockMode}"]`);
      if(radio) radio.checked = true;
      const on = clockMode !== 'off';
      clockDetail.classList.toggle('visible', on);
      clockWarning.classList.toggle('visible', on);
    }
    if(saved.clockMinutes !== undefined && saved.clockMinutes !== null && saved.clockMinutes !== ''){
      const m = parseFloat(saved.clockMinutes);
      if(!isNaN(m) && m >= 0) clockMinutes.value = String(m);
    }
  }

  // ---------- Alignment toggle ----------
  alignGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-align]');
    if(!btn) return;
    textAlign = btn.dataset.align;
    [...alignGroup.querySelectorAll('button')].forEach(b => b.classList.toggle('active', b === btn));
    draw();
    saveSettings();
  });

  // ---------- Color sync ----------
  function isValidHex(v){
    return /^#([0-9A-Fa-f]{6})$/.test(v);
  }
  function bindColorPair(picker, hexField){
    picker.addEventListener('input', () => {
      hexField.value = picker.value.toUpperCase();
      draw();
      saveSettings();
    });
    hexField.addEventListener('input', () => {
      let v = hexField.value.trim();
      if(!v.startsWith('#')) v = '#' + v;
      if(isValidHex(v)){
        picker.value = v;
        draw();
        saveSettings();
      }
    });
    hexField.addEventListener('blur', () => {
      hexField.value = picker.value.toUpperCase();
    });
  }
  bindColorPair(textColor, textColorHex);
  bindColorPair(bgColor, bgColorHex);

  fontSize.addEventListener('input', () => {
    fontSizeValue.textContent = fontSize.value + 'px';
    draw();
    saveSettings();
  });
  textInput.addEventListener('input', () => {
    draw();
    saveSettings();
  });

  // ---------- Clock mode ----------
  document.querySelectorAll('input[name="clockMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      clockMode = e.target.value;
      const on = clockMode !== 'off';
      clockDetail.classList.toggle('visible', on);
      clockWarning.classList.toggle('visible', on);
      updateCanvasSize();
      draw();
      refreshEngineBadge();
      saveSettings();
    });
  });
  clockMinutes.addEventListener('input', () => {
    draw();
    saveSettings();
  });

  function updateCanvasSize(){
    // 368 is the nearest multiple of 16 at/above 360, which keeps the
    // canvas height H.264-encoder-friendly (VideoToolbox on iPadOS/Safari
    // rejects heights that aren't multiples of 16 for some AVC levels).
    const newH = clockMode !== 'off' ? 368 : 240;
    if(newH !== H) resolvedAvcCodec = null; // size changed, re-probe codec support
    H = newH;
    canvas.height = H;
    canvas.style.aspectRatio = `${W}/${H}`;
    dimsTag.textContent = `720×${H} / 1fps`;
    dimsNote.textContent = clockMode !== 'off'
      ? '時計はテキストの下に表示されます（720×368）'
      : '画像はそのまま動画のフレームになります';
  }

  // ---------- Text wrapping ----------
  function wrapText(text, maxWidth, size){
    const paragraphs = text.split('\n');
    const lines = [];
    ctx.font = `700 ${size}px "Hiragino Sans","Noto Sans JP",sans-serif`;
    paragraphs.forEach(p => {
      if(p === ''){ lines.push(''); return; }
      const chars = Array.from(p);
      let current = '';
      chars.forEach(ch => {
        const test = current + ch;
        if(ctx.measureText(test).width > maxWidth && current !== ''){
          lines.push(current);
          current = ch;
        } else {
          current = test;
        }
      });
      if(current !== '') lines.push(current);
    });
    return lines;
  }

  function formatClock(totalSeconds){
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  function getDurationSeconds(){
    const mins = parseFloat(clockMinutes.value);
    if(isNaN(mins) || mins < 0) return 0;
    return Math.round(mins * 60);
  }

  // elapsedSeconds: for stopwatch, seconds counted up from 0. For timer, seconds counted down from duration.
  function draw(elapsedSeconds){
    const bg = bgColor.value;
    const fg = textColor.value;
    const size = parseInt(fontSize.value, 10);
    const text = textInput.value || '';

    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,W,H);

    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';

    const padX = 24;
    const maxWidth = W - padX*2;

    // Reserve space for clock area if enabled
    const clockOn = clockMode !== 'off';
    const clockAreaHeight = clockOn ? 90 : 0;
    const textAreaHeight = H - clockAreaHeight;

    const lines = wrapText(text, maxWidth, size);
    const lineHeight = size * 1.2;
    let effSize = size;
    let effLines = lines;
    let effLineHeight = lineHeight;
    let effTotalHeight = lineHeight * lines.length;
    const maxHeight = textAreaHeight - 24;
    let guard = 0;
    while(effTotalHeight > maxHeight && effSize > 6 && guard < 40){
      effSize -= 2;
      effLines = wrapText(text, maxWidth, effSize);
      effLineHeight = effSize * 1.2;
      effTotalHeight = effLineHeight * effLines.length;
      guard++;
    }

    ctx.font = `700 ${effSize}px "Hiragino Sans","Noto Sans JP",sans-serif`;
    ctx.textAlign = textAlign === 'left' ? 'left' : 'center';
    const drawX = textAlign === 'left' ? padX : W/2;
    const startY = textAreaHeight/2 - effTotalHeight/2 + effLineHeight/2;
    effLines.forEach((line, i) => {
      ctx.fillText(line, drawX, startY + i*effLineHeight);
    });

    // Clock area
    if(clockOn){
      const duration = getDurationSeconds();
      let seconds;
      if(elapsedSeconds === undefined){
        // preview default: stopwatch shows 0:00, timer shows full duration
        seconds = clockMode === 'timer' ? duration : 0;
      } else {
        seconds = clockMode === 'timer' ? Math.max(0, duration - elapsedSeconds) : elapsedSeconds;
      }
      const label = formatClock(seconds);
      const clockFontSize = Math.max(28, Math.min(56, Math.floor(clockAreaHeight * 0.55)));
      ctx.font = `700 ${clockFontSize}px "JetBrains Mono","SFMono-Regular",Consolas,monospace`;
      ctx.textAlign = textAlign === 'left' ? 'left' : 'center';
      const clockY = textAreaHeight + clockAreaHeight/2;
      ctx.fillText(label, drawX, clockY);
    }
  }

  // 保存された前回の入力内容・設定があれば復元してから初期描画する
  applySavedSettings();
  updateCanvasSize();
  draw();

  // Show which encoding path this device will use
  async function refreshEngineBadge(){
    const webCodecsOk = await checkWebCodecsSupport();
    if(webCodecsOk){
      dimsNote.dataset.engine = 'webcodecs';
      if(statusText.dataset.engineNote === '1'){
        statusText.textContent = '';
        statusText.dataset.engineNote = '';
      }
    } else {
      dimsNote.dataset.engine = 'unsupported';
      const reason = lastWebCodecsFailureReason ? `（${lastWebCodecsFailureReason}）` : '';
      statusText.textContent = `この端末・ブラウザは MP4 生成に対応していません${reason}`;
      statusText.classList.add('err');
      statusText.dataset.engineNote = '1';
    }
  }
  refreshEngineBadge();

  // ---------- Encoding (WebCodecs + mp4-muxer) ----------
  // NOTE: support must be re-checked against the *current* W/H, since the
  // clock option changes canvas size (240 <-> 368) after the initial check.
  const AVC_LEVEL_CANDIDATES = ['1f', '28', '29', '2a']; // 3.1, 4.0, 4.1, 4.2
  async function findWorkingAvcCodec(){
    if(resolvedAvcCodec) return resolvedAvcCodec;
    if(!(window.VideoEncoder && window.Mp4Muxer)) return null;

    for(const level of AVC_LEVEL_CANDIDATES){
      const codec = `avc1.4200${level}`;
      const config = {
        codec,
        width: W,
        height: H,
        bitrate: 2_000_000,
        framerate: 1,
      };
      try {
        if(VideoEncoder.isConfigSupported){
          const result = await VideoEncoder.isConfigSupported(config);
          if(result && result.supported){
            resolvedAvcCodec = codec;
            return codec;
          }
        } else {
          const probe = new VideoEncoder({ output(){}, error(){} });
          probe.configure(config);
          probe.close();
          resolvedAvcCodec = codec;
          return codec;
        }
      } catch(e){
        // try next level
      }
    }
    return null;
  }

  async function checkWebCodecsSupport(){
    if(!(window.VideoEncoder && window.VideoFrame && window.Mp4Muxer)){
      lastWebCodecsFailureReason = 'このブラウザに VideoEncoder / VideoFrame API がありません';
      return false;
    }
    const codec = await findWorkingAvcCodec();
    if(!codec){
      lastWebCodecsFailureReason = `${W}×${H} に対応するH.264設定が見つかりませんでした`;
      return false;
    }
    lastWebCodecsFailureReason = null;
    return true;
  }

  // Frames are drawn synchronously to a VideoFrame built directly from the
  // 2D canvas (avoiding the per-frame await of createImageBitmap), so
  // thousands of frames encode in a couple of seconds rather than minutes.
  async function encodeFramesWebCodecs(frameCount, drawFrame, onProgress){
    const fps = 1;
    const codec = await findWorkingAvcCodec();
    if(!codec) throw new Error('no supported AVC codec configuration found');

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width: W,
        height: H,
      },
      fastStart: 'in-memory',
    });

    let pendingErr = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { pendingErr = e; }
    });

    encoder.configure({
      codec,
      width: W,
      height: H,
      bitrate: 2_000_000,
      framerate: fps,
    });

    const frameDurationUs = Math.round(1_000_000 / fps);
    const YIELD_EVERY = 25; // keep the UI responsive without slowing things down much

    // Some browsers don't support building a VideoFrame directly from a
    // canvas element. Detect that once, up front, and fall back to
    // createImageBitmap() only if needed.
    let useDirectCanvasFrame = true;
    try {
      drawFrame(0);
      const testFrame = new VideoFrame(canvas, { timestamp: 0, duration: frameDurationUs });
      testFrame.close();
    } catch(e){
      useDirectCanvasFrame = false;
    }

    for(let i = 0; i < frameCount; i++){
      drawFrame(i);

      let frame;
      if(useDirectCanvasFrame){
        frame = new VideoFrame(canvas, {
          timestamp: i * frameDurationUs,
          duration: frameDurationUs,
        });
      } else {
        const bitmap = await createImageBitmap(canvas);
        frame = new VideoFrame(bitmap, {
          timestamp: i * frameDurationUs,
          duration: frameDurationUs,
        });
        bitmap.close();
      }

      encoder.encode(frame, { keyFrame: (i % 30 === 0) });
      frame.close();

      if(pendingErr) throw pendingErr;

      if(onProgress && (i % 5 === 0 || i === frameCount - 1)) onProgress(i+1, frameCount);

      // Periodically back off so encoder queue can drain and avoid
      // "too many frames queued" errors on long videos, without stalling
      // every single frame.
      if(encoder.encodeQueueSize > 30){
        await new Promise(resolve => {
          encoder.addEventListener('dequeue', resolve, { once: true });
        });
      } else if(i % YIELD_EVERY === 0){
        await new Promise(r => setTimeout(r, 0));
      }
    }

    await encoder.flush();
    encoder.close();
    muxer.finalize();

    const { buffer } = muxer.target;
    return new Blob([buffer], { type: 'video/mp4' });
  }

  async function generateVideo(){
    statusText.classList.remove('err');

    const webCodecsOk = await checkWebCodecsSupport();
    if(!webCodecsOk){
      const reason = lastWebCodecsFailureReason ? `（${lastWebCodecsFailureReason}）` : '';
      statusText.textContent = `このブラウザ・端末は MP4 動画の生成に対応していません${reason}`;
      statusText.classList.add('err');
      return;
    }

    generateBtn.disabled = true;
    postActions.style.display = 'none';
    resultVideo.style.display = 'none';
    progressBar.classList.remove('visible');
    progressFill.style.width = '0%';

    try {
      let mp4Blob;

      if(clockMode === 'off'){
        statusText.textContent = '生成中…';
        draw();
        // For a single still frame, push it twice (t=0s, t=1s) so the
        // resulting file has a genuine 1-second duration.
        mp4Blob = await encodeFramesWebCodecs(2, () => draw());
      } else {
        const duration = getDurationSeconds();
        const frameCount = duration + 1; // +1 second (e.g. 3min => 181 frames)
        progressBar.classList.add('visible');
        statusText.textContent = `生成中… (0 / ${frameCount} フレーム)`;

        mp4Blob = await encodeFramesWebCodecs(frameCount, (i) => {
          draw(i);
        }, (done, total) => {
          const pct = Math.round(done/total*100);
          progressFill.style.width = pct + '%';
          statusText.textContent = `生成中… (${done} / ${total} フレーム)`;
        });
      }

      if(lastUrl) URL.revokeObjectURL(lastUrl);
      lastBlob = mp4Blob;
      lastUrl = URL.createObjectURL(mp4Blob);

      resultVideo.src = lastUrl;
      resultVideo.style.display = 'block';
      postActions.style.display = 'flex';
      statusText.textContent = `完了（${(mp4Blob.size/1024).toFixed(1)} KB, video/mp4）`;
    } catch(err){
      console.error(err);
      statusText.textContent = '生成に失敗しました: ' + (err && err.message ? err.message : String(err));
      statusText.classList.add('err');
    } finally {
      generateBtn.disabled = false;
      progressBar.classList.remove('visible');
      draw(); // restore preview to default state
    }
  }

  generateBtn.addEventListener('click', generateVideo);

  downloadBtn.addEventListener('click', () => {
    if(!lastBlob) return;
    const a = document.createElement('a');
    a.href = lastUrl;
    a.download = 'text-frame.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  shareBtn.addEventListener('click', async () => {
    if(!lastBlob) return;
    try {
      const file = new File([lastBlob], 'text-frame.mp4', {type: lastBlob.type});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        await navigator.share({
          files:[file],
          title:'Text Frame',
          text:'Text Frameで作成した動画です。'
        });
      } else if(navigator.share){
        await navigator.share({
          title:'Text Frame',
          text:'Text Frameで作成した動画です。',
          url: lastUrl
        });
      } else {
        statusText.textContent = 'この端末/ブラウザは共有シートに対応していません。ダウンロードをご利用ください。';
      }
    } catch(err){
      if(err.name !== 'AbortError'){
        console.error(err);
        statusText.textContent = '共有に失敗しました: ' + err.message;
        statusText.classList.add('err');
      }
    }
  });

  // ---------- Service Worker registration (offline support) ----------
  const offlineBadge = document.getElementById('offlineBadge');
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        const markReady = () => offlineBadge.classList.add('ready');
        if(reg.active) markReady();
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw && sw.addEventListener('statechange', () => {
            if(sw.state === 'activated') markReady();
          });
        });
      }).catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

})();
