(function(){
  // ===========================
  // Enhance Star — U2NET + ESRGAN (JS only)
  // Reemplaza Cloudinary por procesamiento local con ONNX (U2NET para máscara + ESRGAN para upscale).
  // DEBES proporcionar URLs a los modelos .onnx (ver constantes más abajo).
  // ===========================

  // ------- CONFIG: pon aquí las URLs de tus modelos ONNX -------
  // Puedes dejar vacíos para usar fallback (canvas enhance + BodyPix fallback para máscara).
  const MODEL_U2NET_URL = "";     // ejemplo: "https://mi-cdn.com/models/u2net.onnx"
  const MODEL_ESRGAN_URL = "";    // ejemplo: "https://mi-cdn.com/models/esrgan.onnx"
  // Si los dejas vacíos el script seguirá funcionando pero con fallback menos potente.

  // ------- Estado -------
  const state = {
    file: null,
    publicId: null,
    originalUrl: null,
    enhancedUrl: null,
    bgRemovedUrl: null,
    zoom: { original: 1, enhanced: 1 },
    pan: { original: {x:0,y:0}, enhanced: {x:0,y:0} },
    settings: { noise:50, sharpen:60, width:2400, improve:true, upscale:2 },
    ort: null,
    u2netSession: null,
    esrganSession: null
  };

  // ------- DOM (IDs from tu HTML original) -------
  const fileInput = document.getElementById("file");
  const clearBtn = document.getElementById("clearBtn");
  const enhanceBtn = document.getElementById("enhanceBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const progressBar = document.getElementById("progressBar");

  const originalImg = document.getElementById("originalImg");
  const enhancedImg = document.getElementById("enhancedImg");
  const originalInfo = document.getElementById("originalInfo");
  const enhancedInfo = document.getElementById("enhancedInfo");

  const bgRemoveBtn = document.getElementById("bgRemoveBtn");
  const bgProgressBar = document.getElementById("bgProgressBar");
  const downloadBgBtn = document.getElementById("downloadBgBtn");

  const noiseRange = document.getElementById("noiseRange");
  const noiseNumber = document.getElementById("noiseNumber");
  const sharpenRange = document.getElementById("sharpenRange");
  const sharpenNumber = document.getElementById("sharpenNumber");
  const widthRange = document.getElementById("widthRange");
  const widthNumber = document.getElementById("widthNumber");
  const improveSwitch = document.getElementById("improveSwitch");
  const upscaleSwitch = document.getElementById("upscaleSwitch");
  const toast = document.getElementById("toast");
  const autoDownloadSwitch = document.getElementById("autoDownload");

  const origZoomIn = document.getElementById("origZoomIn");
  const origZoomOut = document.getElementById("origZoomOut");
  const origReset = document.getElementById("origReset");
  const enhZoomIn = document.getElementById("enhZoomIn");
  const enhZoomOut = document.getElementById("enhZoomOut");
  const enhReset = document.getElementById("enhReset");

  // small helpers
  function showToast(msg, ok=false){
    if(toast){
      toast.textContent = msg;
      toast.style.borderColor = ok ? "rgba(124,240,201,0.50)" : "rgba(255,255,255,0.06)";
      toast.style.display = "block";
      setTimeout(()=> toast.style.display = "none", 2600);
    } else {
      console.log("TOAST:", msg);
    }
  }
  function setProgress(pct){ if(progressBar) progressBar.style.width = (pct||0) + "%"; }
  function setBgProgress(pct){ if(bgProgressBar) bgProgressBar.style.width = (pct||0) + "%"; }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function triggerDownload(url, name="imagen.jpg"){ const a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); }
  function suggestFileName(originalName, suffix="enhanced"){ const safe = (originalName || "imagen").replace(/\.[^/.]+$/, ""); return `${safe}.${suffix}.jpg`; }

  // ---------------- utilities to load onnxruntime-web dynamically ----------------
  async function ensureOrt(){
    if(state.ort) return state.ort;
    // try global ort
    if(window.ort){
      state.ort = ort;
      return state.ort;
    }
    // load script
    try{
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js");
      state.ort = window.ort;
      return state.ort;
    }catch(e){
      console.error("No se pudo cargar onnxruntime-web:", e);
      throw e;
    }
  }
  function loadScriptOnce(src){
    return new Promise((resolve,reject)=>{
      if(document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src; s.onload = ()=> resolve(); s.onerror = (e)=> reject(e);
      document.head.appendChild(s);
    });
  }

  // ---------------- local upload (no Cloudinary) ----------------
  async function localUpload(file){
    const id = "local_" + Date.now();
    const url = URL.createObjectURL(file);
    state.file = file;
    state.publicId = id;
    state.originalUrl = url;
    return { public_id: id, secure_url: url };
  }

  async function createImageBitmapFromUrl(url){
    // fetch blob to avoid tainting crossOrigin issues in canvas later
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await createImageBitmap(blob);
  }

  // ----------------- ONNX model loading helpers -----------------
  // load ONNX session from URL (returns ort.InferenceSession)
  async function loadOrCreateSession(url, options = {}){
    await ensureOrt();
    try{
      // ort supports creating session from URL directly in recent versions;
      // but to be safe we fetch and pass arrayBuffer to create
      const resp = await fetch(url);
      const arrayBuffer = await resp.arrayBuffer();
      const session = await ort.InferenceSession.create(arrayBuffer, {
        executionProviders: ['webgl','wasm','webgpu'].filter(Boolean),
        graphOptimizationLevel: 'all'
      });
      return session;
    }catch(e){
      console.error("Error cargando modelo ONNX:", e);
      throw e;
    }
  }

  // ----------------- U2NET runner (mask generation) -----------------
  // NOTES:
  // - U2NET typical input: [1,3,320,320] float32 in [0,1] or normalized.
  // - Output usually [1,1,320,320] grayscale map (higher = foreground).
  // This function is generic but may need tweaks si tu modelo usa otra normalización.
  async function runU2NET(session, imageBitmap){
    // determine input size from session inputs if possible
    const inputName = session.inputNames && session.inputNames[0];
    // try to infer shape, fallback to 320
    let inputSize = 320;
    try{
      const shape = session.inputNames && session.inputNames.length ? session.inputNames.map(n=>session.inputNames) : null;
      // we don't rely on metadata here; default 320 (U2NET common)
    }catch(e){}
    // prepare canvas to resize to square inputSize
    const canvas = document.createElement("canvas");
    canvas.width = inputSize;
    canvas.height = inputSize;
    const ctx = canvas.getContext("2d");
    // draw with cover: fit shorter side
    const iw = imageBitmap.width, ih = imageBitmap.height;
    // draw image centered and scaled to cover the square
    const scale = Math.max(inputSize/iw, inputSize/ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(imageBitmap, (inputSize - dw)/2, (inputSize - dh)/2, dw, dh);

    const imgData = ctx.getImageData(0,0,inputSize,inputSize).data;
    // create float array NCHW [1,3,H,W], normalized to [0,1]
    const floatData = new Float32Array(1*3*inputSize*inputSize);
    let ptr = 0;
    for(let c=0;c<3;c++){
      for(let y=0;y<inputSize;y++){
        for(let x=0;x<inputSize;x++){
          const i = (y*inputSize + x)*4;
          // channel order: R,G,B
          const v = imgData[i + c] / 255.0;
          floatData[ptr++] = v;
        }
      }
    }
    const inputTensor = new ort.Tensor('float32', floatData, [1,3,inputSize,inputSize]);
    const feeds = {};
    feeds[inputName] = inputTensor;
    const results = await session.run(feeds);
    // take first output
    const outName = Object.keys(results)[0];
    const outTensor = results[outName];
    // outTensor.dims e.g. [1,1,320,320]
    const [n, ch, h, w] = outTensor.dims;
    const outData = outTensor.data; // float32
    // create mask canvas then resize to original image size
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = inputSize; maskCanvas.height = inputSize;
    const mctx = maskCanvas.getContext("2d");
    const maskImageData = mctx.createImageData(inputSize, inputSize);
    // If outData is [1,1,H,W], outData[i] maps directly
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const idx = y*w + x;
        // clamp 0..1
        const val = clamp(outData[idx], 0, 1);
        const v = Math.round(val * 255);
        const p = (y*w + x)*4;
        maskImageData.data[p] = v;
        maskImageData.data[p+1] = v;
        maskImageData.data[p+2] = v;
        maskImageData.data[p+3] = 255;
      }
    }
    mctx.putImageData(maskImageData, 0, 0);
    // resize mask to original image size
    const outMaskCanvas = document.createElement("canvas");
    outMaskCanvas.width = imageBitmap.width;
    outMaskCanvas.height = imageBitmap.height;
    const outCtx = outMaskCanvas.getContext("2d");
    outCtx.drawImage(maskCanvas, 0, 0, outMaskCanvas.width, outMaskCanvas.height);
    return outMaskCanvas; // returns canvas with grayscale mask (0..255)
  }

  // ----------------- Compose mask onto original to create transparent PNG -----------------
  async function composeMaskToPNG(imageBitmap, maskCanvas){
    const out = document.createElement("canvas");
    out.width = imageBitmap.width;
    out.height = imageBitmap.height;
    const ctx = out.getContext("2d");
    // draw original
    const tmp = document.createElement("canvas");
    tmp.width = out.width; tmp.height = out.height;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(imageBitmap, 0, 0, out.width, out.height);
    const origData = tctx.getImageData(0,0,out.width,out.height);
    const maskData = maskCanvas.getContext("2d").getImageData(0,0,out.width,out.height).data;
    const d = origData.data;
    for(let i=0, p=0;i<d.length;i+=4, p+=4){
      // mask value: maskData[p] (0..255)
      // threshold & soften
      const alpha = maskData[p]/255; // 0..1
      // apply simple threshold/refine: keep alpha as-is or apply a smoothstep around 0.5
      const refined = Math.pow(alpha, 0.9); // slight smoothing
      d[i+3] = Math.round(refined * 255);
    }
    ctx.putImageData(origData, 0, 0);
    return new Promise((resolve)=> out.toBlob((blob)=> resolve(URL.createObjectURL(blob)), 'image/png'));
  }

  // ----------------- ESRGAN runner -----------------
  // NOTE: ESRGAN models differ. This implementation attempts a generic flow:
  // - Resize/crop input to model expected input if needed
  // - Normalize to [-1,1], provide NCHW
  // - Run and convert output back to image
  async function runESRGAN(session, imageBitmap){
    const inputName = session.inputNames && session.inputNames[0];
    // choose safe small input footprint to avoid OOM — scale the smallest side to 128..512 depending on memory
    const maxSide = Math.min(Math.max(Math.min(imageBitmap.width, imageBitmap.height), 128), 512);
    const inW = maxSide;
    const inH = Math.round(imageBitmap.height * (inW / imageBitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = inW; canvas.height = inH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(imageBitmap, 0, 0, inW, inH);
    const imgData = ctx.getImageData(0,0,inW,inH).data;
    // create NCHW float32 [-1,1]
    const floatData = new Float32Array(1*3*inH*inW);
    let ptr = 0;
    for(let c=0;c<3;c++){
      for(let y=0;y<inH;y++){
        for(let x=0;x<inW;x++){
          const i = (y*inW + x)*4;
          const v = imgData[i + c] / 255.0;
          floatData[ptr++] = v * 2 - 1; // to [-1,1]
        }
      }
    }
    const inputTensor = new ort.Tensor('float32', floatData, [1,3,inH,inW]);
    const feeds = {}; feeds[inputName] = inputTensor;
    const results = await session.run(feeds);
    const outName = Object.keys(results)[0];
    const out = results[outName];
    // out.dims e.g. [1,3,oh,ow]
    const [n,ch,oh,ow] = out.dims;
    const outData = out.data;
    // convert to canvas
    const outCanvas = document.createElement("canvas");
    outCanvas.width = ow; outCanvas.height = oh;
    const outCtx = outCanvas.getContext("2d");
    const imageData = outCtx.createImageData(ow,oh);
    // outData layout: channel-major: [R-plane, G-plane, B-plane]
    const planeSize = oh*ow;
    for(let y=0;y<oh;y++){
      for(let x=0;x<ow;x++){
        const i = y*ow + x;
        // note: some models output in [-1,1], others in [0,1] — clamp/convert carefully
        const r = clamp(Math.round(((outData[i] + 1)/2)*255), 0, 255);
        const g = clamp(Math.round(((outData[i + planeSize] + 1)/2)*255), 0, 255);
        const b = clamp(Math.round(((outData[i + 2*planeSize] + 1)/2)*255), 0, 255);
        const idx = (y*ow + x)*4;
        imageData.data[idx] = r;
        imageData.data[idx+1] = g;
        imageData.data[idx+2] = b;
        imageData.data[idx+3] = 255;
      }
    }
    outCtx.putImageData(imageData, 0, 0);
    return new Promise((resolve)=> outCanvas.toBlob((blob)=> resolve(URL.createObjectURL(blob)), 'image/png'));
  }

  // ----------------- Canvas-based fallback enhance (fast but lower quality) -----------------
  function canvasEnhance(imageBitmap, opts={}){
    const { width = state.settings.width, noise = state.settings.noise, sharpen = state.settings.sharpen, upscale = state.settings.upscale } = opts;
    // scale by upscale factor
    const outW = Math.round(imageBitmap.width * (upscale || 1));
    const outH = Math.round(imageBitmap.height * (upscale || 1));
    const canvas = document.createElement("canvas");
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imageBitmap, 0, 0, outW, outH);

    // optional unsharp: simple convolution is heavy — use canvas filters if available
    try {
      ctx.filter = `contrast(${1+ (sharpen/300)})`;
      const tmp = document.createElement("canvas");
      tmp.width = outW; tmp.height = outH;
      const tctx = tmp.getContext("2d");
      tctx.filter = ctx.filter;
      tctx.drawImage(canvas, 0, 0);
      ctx.filter = 'none';
      ctx.clearRect(0,0,outW,outH);
      ctx.drawImage(tmp,0,0);
    } catch(e){
      // ignore
    }

    return new Promise((resolve)=> canvas.toBlob((blob)=> resolve(URL.createObjectURL(blob)),'image/jpeg',0.95));
  }

  // ----------------- warmImage helper -----------------
  function warmImage(url){
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = ()=> resolve();
      img.onerror = (e)=> reject(e);
      img.src = url + (url.includes("?") ? "&" : "?") + "cachebust=" + Date.now();
    });
  }

  // ----------------- Event handlers (upload / enhance / bg remove) -----------------
  fileInput.addEventListener("change", async (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    try{
      showToast("Subiendo imagen local…");
      setProgress(10); setBgProgress(8);
      const res = await localUpload(f);
      originalImg.src = res.secure_url;
      originalInfo.textContent = `${f.name} • ${(f.size/1024/1024).toFixed(2)} MB`;
      setProgress(45); setBgProgress(35);
      clearBtn.disabled = false; enhanceBtn.disabled = false; bgRemoveBtn.disabled = false;
      await warmImage(originalImg.src);
      showToast("Imagen lista (local)", true);
    }catch(err){
      console.error(err);
      showToast("Falló la carga local");
    }finally{
      setTimeout(()=>{ setProgress(0); setBgProgress(0); }, 700);
    }
  });

  clearBtn.addEventListener("click", ()=>{
    resetView(); fileInput.value = "";
    showToast("Limpieza completa", true);
  });

  function resetView(){
    if(originalImg) originalImg.src = ""; if(enhancedImg) enhancedImg.src = "";
    state.file = null; state.publicId = null; state.originalUrl = null; state.enhancedUrl = null; state.bgRemovedUrl = null;
    originalInfo.textContent = "Sin imagen"; enhancedInfo.textContent = "Pendiente";
    setProgress(0); setBgProgress(0);
    enhanceBtn.disabled = true; clearBtn.disabled = true; downloadBtn.disabled = true; bgRemoveBtn.disabled = true; downloadBgBtn.disabled = true;
    state.zoom.original = 1; state.zoom.enhanced = 1;
    state.pan.original = {x:0,y:0}; state.pan.enhanced = {x:0,y:0};
  }

  // ENHANCE: tries ESRGAN if loaded else canvasEnhance
  enhanceBtn.addEventListener("click", async ()=>{
    if(!state.publicId || !state.originalUrl) return;
    try{
      enhanceBtn.disabled = true;
      setProgress(10); showToast("Mejorando… (U2NET+ESRGAN fallback canvas) ");
      const imgBitmap = await createImageBitmapFromUrl(state.originalUrl);

      let finalUrl = null;
      // try ESRGAN session if present
      if(!state.esrganSession && MODEL_ESRGAN_URL){
        try{
          setProgress(20); state.esrganSession = await loadOrCreateSession(MODEL_ESRGAN_URL); setProgress(28);
        }catch(e){
          console.warn("No se pudo cargar ESRGAN ONNX:", e);
        }
      }

      if(state.esrganSession){
        try{
          setProgress(35);
          finalUrl = await runESRGAN(state.esrganSession, imgBitmap);
          setProgress(80);
        }catch(err){
          console.warn("ESRGAN fallo, fallback a canvas:", err);
          finalUrl = await canvasEnhance(imgBitmap, { width: state.settings.width, noise: state.settings.noise, sharpen: state.settings.sharpen, upscale: state.settings.upscale });
        }
      } else {
        finalUrl = await canvasEnhance(imgBitmap, { width: state.settings.width, noise: state.settings.noise, sharpen: state.settings.sharpen, upscale: state.settings.upscale });
      }

      state.enhancedUrl = finalUrl;
      enhancedImg.src = finalUrl;
      enhancedInfo.textContent = `Mejora local • ruido ${state.settings.noise} • nitidez ${state.settings.sharpen} • w ${state.settings.width}`;
      showToast("Imagen mejorada (local)", true);
      setProgress(100);
      setTimeout(()=>{ downloadBtn.disabled = false; if(autoDownloadSwitch && autoDownloadSwitch.checked) triggerDownload(finalUrl, suggestFileName(state.file?.name,"enhanced")); }, 200);
    }catch(e){
      console.error(e);
      showToast("Error durante la mejora.");
      setProgress(0);
    }finally{
      enhanceBtn.disabled = false;
    }
  });

  downloadBtn.addEventListener("click", ()=>{
    if(!state.enhancedUrl) return;
    triggerDownload(state.enhancedUrl, suggestFileName(state.file?.name,"enhanced"));
  });

  // BACKGROUND REMOVAL: U2NET if available else try BodyPix if loaded as fallback
  bgRemoveBtn.addEventListener("click", async ()=>{
    if(!state.publicId || !state.originalUrl) return;
    try{
      bgRemoveBtn.disabled = true;
      setBgProgress(12); showToast("Eliminando fondo… (U2NET si está cargado)");
      const imgBitmap = await createImageBitmapFromUrl(state.originalUrl);

      // try load u2net session if not loaded and URL provided
      if(!state.u2netSession && MODEL_U2NET_URL){
        try{
          setBgProgress(18);
          state.u2netSession = await loadOrCreateSession(MODEL_U2NET_URL);
          setBgProgress(28);
        }catch(e){
          console.warn("No se pudo cargar U2NET:", e);
        }
      }

      if(state.u2netSession){
        // run U2NET
        const maskCanvas = await runU2NET(state.u2netSession, imgBitmap);
        setBgProgress(60);
        const pngUrl = await composeMaskToPNG(imgBitmap, maskCanvas);
        state.bgRemovedUrl = pngUrl;
        originalImg.src = pngUrl;
        originalInfo.textContent = "Fondo eliminado (U2NET)";
        setBgProgress(100);
        downloadBgBtn.disabled = false;
        showToast("Fondo eliminado (U2NET)", true);
        if(autoDownloadSwitch && autoDownloadSwitch.checked) triggerDownload(pngUrl, suggestFileName(state.file?.name,"no-bg"));
      } else {
        // fallback: try BodyPix (if TF + body-pix already loaded on page) or inform user
        if(window.bodyPix){
          setBgProgress(18);
          const tmpCanvas = await fallbackBodyPixRemove(imgBitmap);
          const pngUrl = await composeMaskToPNG(imgBitmap, tmpCanvas);
          state.bgRemovedUrl = pngUrl;
          originalImg.src = pngUrl;
          originalInfo.textContent = "Fondo eliminado (BodyPix fallback)";
          setBgProgress(100);
          downloadBgBtn.disabled = false;
          showToast("Fondo eliminado (BodyPix fallback)", true);
          if(autoDownloadSwitch && autoDownloadSwitch.checked) triggerDownload(pngUrl, suggestFileName(state.file?.name,"no-bg"));
        } else {
          throw new Error("No hay modelo U2NET ni BodyPix disponibles. Provee MODEL_U2NET_URL o carga BodyPix.");
        }
      }
    }catch(err){
      console.error(err);
      showToast("No se pudo eliminar el fondo. Revisa consola.");
      setBgProgress(0);
    }finally{
      bgRemoveBtn.disabled = false;
    }
  });

  downloadBgBtn.addEventListener("click", ()=>{
    if(!state.bgRemovedUrl) return;
    triggerDownload(state.bgRemovedUrl, suggestFileName(state.file?.name,"no-bg"));
  });

  // fallback BodyPix removal if BodyPix is present
  async function fallbackBodyPixRemove(imageBitmap){
    // assume window.bodyPix model exists (user loaded tfjs+bodypix)
    const model = window._bodypixModelInstance;
    if(!model){
      // try to load quickly
      if(window.bodyPix){
        window._bodypixModelInstance = await bodyPix.load({architecture:'MobileNetV1', outputStride:16, multiplier:0.75, quantBytes:2});
      } else {
        throw new Error("BodyPix no disponible.");
      }
    }
    const m = window._bodypixModelInstance;
    const tmp = document.createElement("canvas");
    tmp.width = imageBitmap.width; tmp.height = imageBitmap.height;
    const tctx = tmp.getContext("2d"); tctx.drawImage(imageBitmap,0,0);
    const segmentation = await m.segmentPerson(tmp, { internalResolution:'medium', segmentationThreshold:0.7 });
    // create mask canvas
    const out = document.createElement("canvas"); out.width = tmp.width; out.height = tmp.height;
    const ctx = out.getContext("2d");
    const imgData = tctx.getImageData(0,0,out.width,out.height);
    const data = imgData.data;
    const mask = segmentation.data;
    for(let i=0,p=0;i<data.length;i+=4,p++){
      const keep = mask[p] === 1;
      if(!keep) data[i+3] = 0;
    }
    ctx.putImageData(imgData,0,0);
    return out;
  }

  // ----------------- Interactivity (zoom/pan) -----------------
  function makeInteractive(imgEl, key){
    if(!imgEl) return;
    let dragging = false, last = {x:0,y:0};
    imgEl.addEventListener("wheel", (e)=>{
      e.preventDefault();
      const delta = Math.sign(e.deltaY) * -0.08;
      const next = clamp(state.zoom[key] + delta, 1, 8);
      state.zoom[key] = next;
      applyTransform(imgEl, state.zoom[key], state.pan[key]);
    }, { passive:false });

    imgEl.addEventListener("mousedown", (e)=>{
      dragging = true; last = {x:e.clientX, y:e.clientY}; imgEl.style.cursor = "grabbing";
    });
    window.addEventListener("mouseup", ()=>{ dragging=false; imgEl.style.cursor = "default"; });
    imgEl.addEventListener("mousemove", (e)=>{
      if(!dragging) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = {x:e.clientX, y:e.clientY};
      state.pan[key].x += dx; state.pan[key].y += dy;
      applyTransform(imgEl, state.zoom[key], state.pan[key]);
    });
  }
  function applyTransform(imgEl, zoom, pan){
    if(!imgEl) return;
    imgEl.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  }
  makeInteractive(originalImg, "original");
  makeInteractive(enhancedImg, "enhanced");

  origZoomIn && origZoomIn.addEventListener("click", ()=>{ state.zoom.original = clamp(state.zoom.original+0.25,1,8); applyTransform(originalImg,state.zoom.original,state.pan.original); });
  origZoomOut && origZoomOut.addEventListener("click", ()=>{ state.zoom.original = clamp(state.zoom.original-0.25,1,8); applyTransform(originalImg,state.zoom.original,state.pan.original); });
  origReset && origReset.addEventListener("click", ()=>{ state.zoom.original=1; state.pan.original={x:0,y:0}; applyTransform(originalImg,1,state.pan.original); });

  enhZoomIn && enhZoomIn.addEventListener("click", ()=>{ state.zoom.enhanced = clamp(state.zoom.enhanced+0.25,1,8); applyTransform(enhancedImg,state.zoom.enhanced,state.pan.enhanced); });
  enhZoomOut && enhZoomOut.addEventListener("click", ()=>{ state.zoom.enhanced = clamp(state.zoom.enhanced-0.25,1,8); applyTransform(enhancedImg,state.zoom.enhanced,state.pan.enhanced); });
  enhReset && enhReset.addEventListener("click", ()=>{ state.zoom.enhanced=1; state.pan.enhanced={x:0,y:0}; applyTransform(enhancedImg,1,state.pan.enhanced); });

  // keyboard shortcuts
  window.addEventListener("keydown", (e)=>{
    const k = e.key.toLowerCase();
    if(k === "e" && !enhanceBtn.disabled) enhanceBtn.click();
    if(k === "b" && !bgRemoveBtn.disabled) bgRemoveBtn.click();
    if(k === "c" && !clearBtn.disabled) clearBtn.click();
    if(e.key === "Escape") { resetView(); fileInput.value = ""; }
  });

  // ranges link (same as original)
  function link(rangeEl, numEl, key){
    if(!rangeEl || !numEl) return;
    const sync = (val)=>{ rangeEl.value = val; numEl.value = val; state.settings[key] = parseInt(val,10); };
    rangeEl.addEventListener("input",(e)=> sync(e.target.value));
    numEl.addEventListener("input",(e)=>{ const v = clamp(parseInt(e.target.value||0,10), parseInt(rangeEl.min,10), parseInt(rangeEl.max,10)); sync(v); });
  }
  link(noiseRange, noiseNumber, "noise");
  link(sharpenRange, sharpenNumber, "sharpen");
  link(widthRange, widthNumber, "width");
  improveSwitch && improveSwitch.addEventListener("change",(e)=> state.settings.improve = e.target.checked);
  upscaleSwitch && upscaleSwitch.addEventListener("change",(e)=> state.settings.upscale = e.target.checked);

  // expose helpers for console debugging / UI hooking
  window.EnhanceStar = {
    state,
    loadU2NET: async (url)=> { state.u2netSession = await loadOrCreateSession(url); return state.u2netSession; },
    loadESRGAN: async (url)=> { state.esrganSession = await loadOrCreateSession(url); return state.esrganSession; },
    runU2NET,
    runESRGAN,
    canvasEnhance
  };

  // init UI defaults
  resetView();
  showToast("Enhance Star ready — carga una imagen. Si quieres mejores resultados, pega URLs de U2NET/ESRGAN en las constantes.", true);

})();
