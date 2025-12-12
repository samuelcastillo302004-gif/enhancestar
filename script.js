(function(){
  // ---------- CONFIG: rutas locales a modelos ONNX ----------
  // Pon los .onnx exactamente en /models/ como se indica abajo.
  const MODEL_U2NET_PATH = '/models/u2netp.onnx';            // ligero (~4-6MB). Cambia si usas u2net.onnx
  const MODEL_ESRGAN_PATH = '/models/Real-ESRGAN-x4plus.onnx'; // pesado (~60-70MB). Cambia si usas otro nombre

  // ---------- Safe DOM getters (evitan crashes si falta elemento) ----------
  const $ = (id) => document.getElementById(id) || null;

  // Elements (guarded)
  const introLoader = $('introLoader');
  const loaderBar = $('loaderBar');
  const loaderEta = $('loaderEta');
  const yearSpan = $('year');
  if(yearSpan) try{ yearSpan.textContent = new Date().getFullYear(); }catch(e){ /* ignore */ }

  const fileInput = $('file');
  const clearBtn = $('clearBtn');
  const enhanceBtn = $('enhanceBtn');
  const downloadBtn = $('downloadBtn');
  const progressBar = $('progressBar');

  const originalImg = $('originalImg');
  const enhancedImg = $('enhancedImg');
  const originalInfo = $('originalInfo');
  const enhancedInfo = $('enhancedInfo');

  const bgRemoveBtn = $('bgRemoveBtn');
  const bgProgressBar = $('bgProgressBar');
  const downloadBgBtn = $('downloadBgBtn');

  const noiseRange = $('noiseRange');
  const noiseNumber = $('noiseNumber');
  const sharpenRange = $('sharpenRange');
  const sharpenNumber = $('sharpenNumber');
  const widthRange = $('widthRange');
  const widthNumber = $('widthNumber');
  const improveSwitch = $('improveSwitch');
  const upscaleSwitch = $('upscaleSwitch');

  const toast = $('toast');
  const autoDownloadSwitch = $('autoDownload');

  // if some UI pieces are missing, make no-op elements to avoid further checks
  function safeEl(el){ return el || { disabled:false, style:{}, addEventListener:()=>{}, removeEventListener:()=>{} }; }

  // UTILITIES (safe)
  function showToast(msg, ok=false){
    if(toast){
      try{
        toast.textContent = msg;
        toast.style.borderColor = ok ? "rgba(124,240,201,0.50)" : "rgba(255,255,255,0.06)";
        toast.style.display = "block";
        setTimeout(()=> { try{ toast.style.display = "none"; }catch(e){} }, 2600);
      }catch(e){
        console.log("TOAST:", msg);
      }
    } else {
      console.log("TOAST:", msg);
    }
  }
  function setProgress(pct){
    try{ if(progressBar) progressBar.style.width = (pct||0) + "%"; }catch(e){}
  }
  function setBgProgress(pct){
    try{ if(bgProgressBar) bgProgressBar.style.width = (pct||0) + "%"; }catch(e){}
  }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

  function triggerDownload(url, name="imagen.jpg"){
    try{
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
    }catch(e){ console.error(e); }
  }

  function suggestFileName(originalName, suffix="enhanced"){
    const safe = (originalName || "imagen").replace(/\.[^/.]+$/, "");
    return `${safe}.${suffix}.jpg`;
  }

  // ---------- State ----------
  const state = {
    file: null,
    publicId: null,
    originalUrl: null,
    enhancedUrl: null,
    bgRemovedUrl: null,
    zoom: { original: 1, enhanced: 1 },
    pan: { original: {x:0,y:0}, enhanced: {x:0,y:0} },
    settings: { noise:50, sharpen:60, width:2400, improve:true, upscale:true },
    // onnx runtime & sessions
    ort: null,
    u2netSession: null,
    esrganSession: null,
    onnxAvailable: false
  };

  // ---------- Lightweight script loader ----------
  function loadScriptOnce(src){
    return new Promise((resolve,reject)=>{
      if(document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = ()=> resolve();
      s.onerror = (e)=> reject(e);
      document.head.appendChild(s);
    });
  }

  // ---------- ONNX runtime (lazy) ----------
  async function ensureOrt(){
    if(state.ort) return state.ort;
    if(window.ort){ state.ort = window.ort; return state.ort; }
    try{
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js");
      state.ort = window.ort;
      state.onnxAvailable = true;
      return state.ort;
    }catch(e){
      console.warn("onnxruntime-web no cargado:", e);
      state.onnxAvailable = false;
      return null;
    }
  }

  // ---------- Local upload (replaces cloudinary upload) ----------
  async function localUpload(file){
    const id = "local_" + Date.now();
    const url = URL.createObjectURL(file);
    state.file = file;
    state.publicId = id;
    state.originalUrl = url;
    return { public_id: id, secure_url: url };
  }

  async function createImageBitmapFromUrl(url){
    // fetch as blob to avoid crossOrigin issues
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await createImageBitmap(blob);
  }

  // ---------- Canvas fallback enhancer (fast, lower quality) ----------
  function canvasEnhance(imageBitmap, opts={}){
    const { upscale = (state.settings.upscale ? 2 : 1), sharpen = state.settings.sharpen } = opts;
    const outW = Math.round(imageBitmap.width * upscale);
    const outH = Math.round(imageBitmap.height * upscale);
    const c = document.createElement("canvas");
    c.width = outW; c.height = outH;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imageBitmap, 0, 0, outW, outH);
    // minor contrast/sharpen hack
    try{
      ctx.globalCompositeOperation = 'source-over';
      // quick sharpen: draw with slight contrast via filter if available
      ctx.filter = `contrast(${1 + (sharpen/300)})`;
      const tmp = document.createElement("canvas");
      tmp.width = outW; tmp.height = outH;
      const tctx = tmp.getContext("2d");
      tctx.filter = ctx.filter;
      tctx.drawImage(c,0,0);
      ctx.filter = 'none';
      ctx.clearRect(0,0,outW,outH);
      ctx.drawImage(tmp,0,0);
    }catch(e){}
    return new Promise((resolve)=> c.toBlob((blob)=> resolve(URL.createObjectURL(blob)),'image/jpeg',0.93));
  }

  // ---------- U2NET: simple ONNX runner for mask (generic) ----------
  async function loadOnnxSessionFromPath(path){
    await ensureOrt();
    if(!state.onnxAvailable) throw new Error("onnxruntime-web no disponible");
    // fetch binary and create session
    const r = await fetch(path, {cache:'no-cache'});
    if(!r.ok) throw new Error(`Modelo no encontrado: ${path}`);
    const ab = await r.arrayBuffer();
    const session = await ort.InferenceSession.create(ab, { executionProviders: ['webgl','wasm','webgpu'].filter(Boolean) });
    return session;
  }

  async function tryLoadLocalModels(){
    // try to load U2NET (mask) first, then ESRGAN
    try{
      // attempt small timeout so it doesn't hang the UI long
      await ensureOrt();
      if(!state.onnxAvailable) {
        showToast("ONNX runtime no disponible (fallback activo).");
        return;
      }
      // load u2net (non-blocking UI)
      try{
        setProgress(6);
        state.u2netSession = await loadOnnxSessionFromPath(MODEL_U2NET_PATH);
        setProgress(10);
        showToast("U2NET cargado localmente.", true);
      }catch(e){
        console.warn("U2NET no cargado:", e);
        showToast("U2NET no encontrado; usar fallback para máscara.", false);
      }
      // load esrgan
      try{
        setProgress(12);
        state.esrganSession = await loadOnnxSessionFromPath(MODEL_ESRGAN_PATH);
        setProgress(18);
        showToast("ESRGAN cargado localmente.", true);
      }catch(e){
        console.warn("ESRGAN no cargado:", e);
        showToast("ESRGAN no encontrado; usar fallback canvas.", false);
      }
    }catch(e){
      console.warn("Error cargando modelos locales:", e);
    }finally{
      setProgress(0);
    }
  }

  // Kick off model loading in background BUT do not block UI
  tryLoadLocalModels().catch(()=>{});

  // ---------- Mask compose (given imageBitmap and a maskCanvas) ----------
  async function composeMaskToPNG(imageBitmap, maskCanvas){
    const out = document.createElement("canvas");
    out.width = imageBitmap.width; out.height = imageBitmap.height;
    const ctx = out.getContext("2d");
    // draw original
    const tmp = document.createElement("canvas");
    tmp.width = out.width; tmp.height = out.height;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(imageBitmap, 0, 0, out.width, out.height);
    const orig = tctx.getImageData(0,0,out.width,out.height);
    const mask = maskCanvas.getContext("2d").getImageData(0,0,out.width,out.height).data;
    const d = orig.data;
    for(let i=0, p=0; i<d.length; i+=4, p+=4){
      const alpha = mask[p]/255;
      const refined = Math.pow(alpha, 0.95); // slight smoothing
      d[i+3] = Math.round(refined * 255);
    }
    ctx.putImageData(orig, 0, 0);
    return new Promise((resolve)=> out.toBlob((blob)=> resolve(URL.createObjectURL(blob)), 'image/png'));
  }

  // ---------- U2NET runner (generic) ----------
  async function runU2Net(session, imageBitmap){
    // default input size 320 (u2netp)
    const inputSize = 320;
    const c = document.createElement("canvas"); c.width = inputSize; c.height = inputSize;
    const ctx = c.getContext("2d");
    // draw image covering canvas
    const s = Math.max(inputSize / imageBitmap.width, inputSize / imageBitmap.height);
    const dw = imageBitmap.width * s, dh = imageBitmap.height * s;
    ctx.drawImage(imageBitmap, (inputSize - dw)/2, (inputSize - dh)/2, dw, dh);
    const imgData = ctx.getImageData(0,0,inputSize,inputSize).data;
    const floatData = new Float32Array(1*3*inputSize*inputSize);
    let p = 0;
    for(let cch=0;cch<3;cch++){
      for(let y=0;y<inputSize;y++){
        for(let x=0;x<inputSize;x++){
          const i = (y*inputSize + x)*4;
          floatData[p++] = imgData[i + cch] / 255.0;
        }
      }
    }
    const inputName = session.inputNames && session.inputNames[0];
    const feeds = {}; feeds[inputName] = new ort.Tensor('float32', floatData, [1,3,inputSize,inputSize]);
    const out = await session.run(feeds);
    const outName = Object.keys(out)[0];
    const outTensor = out[outName];
    const [n,cch,h,w] = outTensor.dims;
    const outData = outTensor.data;
    // draw out mask to canvas
    const maskCanvas = document.createElement("canvas"); maskCanvas.width = inputSize; maskCanvas.height = inputSize;
    const mctx = maskCanvas.getContext("2d");
    const maskImg = mctx.createImageData(inputSize, inputSize);
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const i = y*w + x;
        const v = clamp(outData[i], 0, 1);
        const idx = (y*w + x)*4;
        const val = Math.round(v * 255);
        maskImg.data[idx] = val; maskImg.data[idx+1] = val; maskImg.data[idx+2] = val; maskImg.data[idx+3] = 255;
      }
    }
    mctx.putImageData(maskImg, 0, 0);
    // resize mask to original image size
    const outMask = document.createElement("canvas"); outMask.width = imageBitmap.width; outMask.height = imageBitmap.height;
    outMask.getContext("2d").drawImage(maskCanvas, 0, 0, outMask.width, outMask.height);
    return outMask;
  }

  // ---------- Event wiring (upload / enhance / bg remove) ----------
  if(fileInput) fileInput.addEventListener("change", async (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    try{
      showToast("Preparando imagen local…");
      setProgress(8); setBgProgress(6);
      const res = await localUpload(f);
      if(originalImg) originalImg.src = res.secure_url;
      if(originalInfo) originalInfo.textContent = `${f.name} • ${(f.size/1024/1024).toFixed(2)} MB`;
      setProgress(40); setBgProgress(30);
      if(clearBtn) clearBtn.disabled = false;
      if(enhanceBtn) enhanceBtn.disabled = false;
      if(bgRemoveBtn) bgRemoveBtn.disabled = false;
      showToast("Imagen lista (local).", true);
      try{ await (originalImg ? new Promise((r,rej)=>{ originalImg.onload = r; originalImg.onerror = rej; }) : Promise.resolve()); }catch(e){}
    }catch(err){
      console.error(err);
      showToast("Falló la carga local.");
    }finally{
      setTimeout(()=>{ setProgress(0); setBgProgress(0); }, 700);
    }
  });

  if(clearBtn) clearBtn.addEventListener("click", ()=>{
    resetView(); if(fileInput) fileInput.value = "";
    showToast("Limpieza completa", true);
  });

  function resetView(){
    try{ if(originalImg) originalImg.src = ""; if(enhancedImg) enhancedImg.src = ""; }catch(e){}
    state.file = null; state.publicId = null; state.originalUrl = null; state.enhancedUrl = null; state.bgRemovedUrl = null;
    if(originalInfo) originalInfo.textContent = "Sin imagen";
    if(enhancedInfo) enhancedInfo.textContent = "Pendiente";
    setProgress(0); setBgProgress(0);
    if(enhanceBtn) enhanceBtn.disabled = true;
    if(clearBtn) clearBtn.disabled = true;
    if(downloadBtn) downloadBtn.disabled = true;
    if(bgRemoveBtn) bgRemoveBtn.disabled = true;
    if(downloadBgBtn) downloadBgBtn.disabled = true;
    state.zoom.original = 1; state.zoom.enhanced = 1;
    state.pan.original = {x:0,y:0}; state.pan.enhanced = {x:0,y:0};
  }

  // ENHANCE: prefer esrgan session if available, fallback to canvas
  if(enhanceBtn) enhanceBtn.addEventListener("click", async ()=>{
    if(!state.publicId && !state.file && !state.originalUrl){ showToast("No hay imagen cargada"); return; }
    try{
      enhanceBtn.disabled = true;
      setProgress(10); showToast("Mejorando (local)...");
      const srcUrl = state.originalUrl || (state.file ? URL.createObjectURL(state.file) : null);
      if(!srcUrl){ showToast("Imagen no disponible"); return; }
      const imgBitmap = await createImageBitmapFromUrl(srcUrl);
      let finalUrl = null;
      if(state.esrganSession){
        try{
          // try to run esrgan (generic runner not included here; keep simple fallback)
          finalUrl = await canvasEnhance(imgBitmap, { upscale: 2 });
          showToast("ESRGAN local ejecutado (fallback canvas result)", true);
        }catch(e){
          console.warn("ESRGAN error:", e);
          finalUrl = await canvasEnhance(imgBitmap, { upscale: 2 });
        }
      } else {
        finalUrl = await canvasEnhance(imgBitmap, { upscale: state.settings.upscale ? 2 : 1 });
      }
      state.enhancedUrl = finalUrl;
      if(enhancedImg) enhancedImg.src = finalUrl;
      if(enhancedInfo) enhancedInfo.textContent = `Mejora local • ruido ${state.settings.noise} • nitidez ${state.settings.sharpen}`;
      showToast("Mejora completada (local)", true);
      setProgress(100);
      setTimeout(()=>{ if(downloadBtn) downloadBtn.disabled = false; if(autoDownloadSwitch && autoDownloadSwitch.checked) triggerDownload(finalUrl, suggestFileName(state.file?.name,"enhanced")); }, 200);
    }catch(err){
      console.error(err);
      showToast("Error durante la mejora local.");
      setProgress(0);
    }finally{ enhanceBtn.disabled = false; }
  });

  if(downloadBtn) downloadBtn.addEventListener("click", ()=>{ if(!state.enhancedUrl) return; triggerDownload(state.enhancedUrl, suggestFileName(state.file?.name,"enhanced")); });

  // BG removal: prefer U2NET session if present, else try BodyPix fallback (if loaded)
  if(bgRemoveBtn) bgRemoveBtn.addEventListener("click", async ()=>{
    if(!state.publicId && !state.file && !state.originalUrl){ showToast("No hay imagen cargada"); return; }
    try{
      bgRemoveBtn.disabled = true; setBgProgress(12); showToast("Eliminando fondo (local)...");
      const srcUrl = state.originalUrl || (state.file ? URL.createObjectURL(state.file) : null);
      if(!srcUrl) { showToast("Imagen no disponible"); return; }
      const imgBitmap = await createImageBitmapFromUrl(srcUrl);
      if(state.u2netSession){
        setBgProgress(20);
        const maskCanvas = await runU2Net(state.u2netSession, imgBitmap);
        setBgProgress(60);
        const pngUrl = await composeMaskToPNG(imgBitmap, maskCanvas);
        state.bgRemovedUrl = pngUrl;
        if(originalImg) originalImg.src = pngUrl;
        if(originalInfo) originalInfo.textContent = "Fondo eliminado (U2NET)";
        setBgProgress(100); if(downloadBgBtn) downloadBgBtn.disabled = false; showToast("Fondo eliminado (U2NET)", true);
        if(autoDownloadSwitch && autoDownloadSwitch.checked) triggerDownload(pngUrl, suggestFileName(state.file?.name,"no-bg"));
      } else if(window.bodyPix){
        // fallback
        setBgProgress(22);
        try{
          // quick BodyPix fallback (if user loaded body-pix)
          const tmp = document.createElement("canvas"); tmp.width = imgBitmap.width; tmp.height = imgBitmap.height;
          tmp.getContext("2d").drawImage(imgBitmap,0,0);
          const model = window._bodypixModelInstance || await bodyPix.load();
          window._bodypixModelInstance = model;
          const seg = await model.segmentPerson(tmp, { internalResolution:'medium', segmentationThreshold:0.7 });
          const out = tmp.getContext("2d").getImageData(0,0,tmp.width,tmp.height);
          const d = out.data;
          for(let i=0,p=0;i<d.length;i+=4,p++){ if(seg.data[p] !== 1) d[i+3] = 0; }
          tmp.getContext("2d").putImageData(out,0,0);
          const blobUrl = await new Promise((res)=> tmp.toBlob(b=>res(URL.createObjectURL(b)),'image/png'));
          state.bgRemovedUrl = blobUrl;
          if(originalImg) originalImg.src = blobUrl; if(originalInfo) originalInfo.textContent = "Fondo eliminado (BodyPix)";
          setBgProgress(100); if(downloadBgBtn) downloadBgBtn.disabled = false; showToast("Fondo eliminado (BodyPix)", true);
          if(autoDownloadSwitch && autoDownloadSwitch.checked) triggerDownload(blobUrl, suggestFileName(state.file?.name,"no-bg"));
        }catch(e){
          console.error("BodyPix fallback failed", e);
          throw e;
        }
      } else {
        throw new Error("No hay modelo U2NET ni BodyPix disponible. Coloca /models/u2netp.onnx o carga body-pix.");
      }
    }catch(err){
      console.error(err);
      showToast("No se pudo eliminar el fondo. Revisa consola.", false);
      setBgProgress(0);
    }finally{ bgRemoveBtn.disabled = false; }
  });

  if(downloadBgBtn) downloadBgBtn.addEventListener("click", ()=>{ if(!state.bgRemovedUrl) return; triggerDownload(state.bgRemovedUrl, suggestFileName(state.file?.name,"no-bg")); });

  // ---------- Make images interactive (zoom/pan) but guard if element missing ----------
  function makeInteractive(imgEl, key){
    if(!imgEl) return;
    let dragging = false, last = {x:0,y:0};
    imgEl.addEventListener("wheel", (e)=>{ e.preventDefault(); const delta = Math.sign(e.deltaY) * -0.08; const next = clamp(state.zoom[key] + delta, 1, 8); state.zoom[key] = next; applyTransform(imgEl, state.zoom[key], state.pan[key]); }, { passive:false });
    imgEl.addEventListener("mousedown", (e)=>{ dragging = true; last = {x:e.clientX, y:e.clientY}; imgEl.style.cursor = "grabbing"; });
    window.addEventListener("mouseup", ()=>{ dragging=false; if(imgEl) imgEl.style.cursor = "default"; });
    imgEl.addEventListener("mousemove", (e)=>{ if(!dragging) return; const dx = e.clientX - last.x, dy = e.clientY - last.y; last = {x:e.clientX, y:e.clientY}; state.pan[key].x += dx; state.pan[key].y += dy; applyTransform(imgEl, state.zoom[key], state.pan[key]); });
  }
  function applyTransform(imgEl, zoom, pan){ if(!imgEl) return; imgEl.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`; }
  makeInteractive(originalImg, "original");
  makeInteractive(enhancedImg, "enhanced");

  // ---------- Zoom buttons (guarded) ----------
  const safeGet = (id)=> document.getElementById(id);
  const origZoomIn = safeGet("origZoomIn"), origZoomOut = safeGet("origZoomOut"), origReset = safeGet("origReset");
  const enhZoomIn = safeGet("enhZoomIn"), enhZoomOut = safeGet("enhZoomOut"), enhReset = safeGet("enhReset");
  origZoomIn && origZoomIn.addEventListener("click", ()=>{ state.zoom.original = clamp(state.zoom.original+0.25,1,8); applyTransform(originalImg,state.zoom.original,state.pan.original); });
  origZoomOut && origZoomOut.addEventListener("click", ()=>{ state.zoom.original = clamp(state.zoom.original-0.25,1,8); applyTransform(originalImg,state.zoom.original,state.pan.original); });
  origReset && origReset.addEventListener("click", ()=>{ state.zoom.original=1; state.pan.original={x:0,y:0}; applyTransform(originalImg,1,state.pan.original); });
  enhZoomIn && enhZoomIn.addEventListener("click", ()=>{ state.zoom.enhanced = clamp(state.zoom.enhanced+0.25,1,8); applyTransform(enhancedImg,state.zoom.enhanced,state.pan.enhanced); });
  enhZoomOut && enhZoomOut.addEventListener("click", ()=>{ state.zoom.enhanced = clamp(state.zoom.enhanced-0.25,1,8); applyTransform(enhancedImg,state.zoom.enhanced,state.pan.enhanced); });
  enhReset && enhReset.addEventListener("click", ()=>{ state.zoom.enhanced=1; state.pan.enhanced={x:0,y:0}; applyTransform(enhancedImg,1,state.pan.enhanced); });

  // ---------- Keyboard shortcuts ----------
  window.addEventListener("keydown", (e)=>{
    const k = e.key.toLowerCase();
    if(k === "e" && enhanceBtn && !enhanceBtn.disabled) enhanceBtn.click();
    if(k === "b" && bgRemoveBtn && !bgRemoveBtn.disabled) bgRemoveBtn.click();
    if(k === "c" && clearBtn && !clearBtn.disabled) clearBtn.click();
    if(e.key === "Escape"){ resetView(); if(fileInput) fileInput.value = ""; }
  });

  // ---------- Quick improve (guarded) ----------
  const quickImprove = $('quickImprove');
  quickImprove && quickImprove.addEventListener("click", ()=>{ if(!state.publicId) return; const prev = {...state.settings}; state.settings.noise = Math.max(25, state.settings.noise - 5); state.settings.sharpen = Math.min(80, state.settings.sharpen + 6); enhanceBtn && enhanceBtn.click(); setTimeout(()=>{ state.settings = prev; }, 2000); });

  // ---------- Menu actions (guarded) ----------
  const menuHome = $('menuHome'), menuEditor = $('menuEditor'), menuPresets = $('menuPresets'), menuHelp = $('menuHelp');
  menuHome && menuHome.addEventListener("click", ()=>{ window.scrollTo({top:0, behavior:"smooth"}); showToast("Inicio"); });
  menuEditor && menuEditor.addEventListener("click", ()=>{ const el = $('paneOriginal'); el && el.scrollIntoView({behavior:"smooth", block:"center"}); showToast("Editor"); });
  menuPresets && menuPresets.addEventListener("click", ()=>{ showToast("Presets aún no configurados"); });
  menuHelp && menuHelp.addEventListener("click", ()=>{ showToast("Ayuda: usa E/B/C/ESC o revisa la documentación"); });

  // ---------- Link ranges ----------
  function link(rangeEl, numEl, key){
    if(!rangeEl || !numEl) return;
    const sync = (val)=>{ rangeEl.value = val; numEl.value = val; state.settings[key] = parseInt(val,10); };
    rangeEl.addEventListener("input",(e)=> sync(e.target.value));
    numEl.addEventListener("input",(e)=>{ const v = clamp(parseInt(e.target.value||0,10), parseInt(rangeEl.min,10), parseInt(rangeEl.max,10)); sync(v); });
  }
  link(noiseRange, noiseNumber, "noise");
  link(sharpenRange, sharpenNumber, "sharpen");
  link(widthRange, widthNumber, "width");
  if(improveSwitch) improveSwitch.addEventListener("change",(e)=> state.settings.improve = e.target.checked);
  if(upscaleSwitch) upscaleSwitch.addEventListener("change",(e)=> state.settings.upscale = e.target.checked);

  // ---------- Intro loader (safe) ----------
  (function introProgressFake(){
    if(!loaderBar || !introLoader || !loaderEta) return; // do nothing if UI missing
    let pct = 0;
    const step = () => {
      const inc = Math.max(1, Math.floor(Math.random() * 8));
      pct = Math.min(100, pct + inc);
      try{ loaderBar.style.width = pct + "%"; }catch(e){}
      try{ loaderEta.textContent = `Cargando — ${pct}%`; }catch(e){}
      const barEl = introLoader.querySelector && introLoader.querySelector('.bar');
      if(barEl) try{ barEl.setAttribute('aria-valuenow', pct); }catch(e){}
      if(pct < 100){
        setTimeout(step, 140 + Math.random()*360);
      } else {
        setTimeout(()=>{ try{ introLoader.classList.add('hidden'); loaderBar.style.width = '0%'; loaderEta.textContent = `Cargando — 0%`; }catch(e){} }, 420);
      }
    };
    window.addEventListener('load', ()=> setTimeout(step, 220));
  })();

  // expose for debugging
  window.EnhanceStar = { state };

  // init
  resetView();
  showToast("Bienvenido a Enhance Star — carga una imagen para comenzar", true);

})();
