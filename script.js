(function(){
  // ---- Config / State (mantengo nombres del original) ----
  const state = {
    file: null,
    publicId: null,            // ahora un id local (timestamp)
    originalUrl: null,         // blob / data URL
    enhancedUrl: null,         // blob / data URL resultante
    bgRemovedUrl: null,        // blob / data URL PNG con transparencia
    zoom: { original: 1, enhanced: 1 },
    pan: { original: {x:0,y:0}, enhanced: {x:0,y:0} },
    settings: { noise:50, sharpen:60, width:2400, improve:true, upscale:true },
    // modelos / runtimes
    bodyPixModel: null,        // BodyPix model instance
    ortSession: null,          // ONNX Runtime session (if loaded)
    onnxAvailable: false
  };

  // ---- DOM elements (IDs kept) ----
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

  // zoom/pan controls ids (keep for compatibility)
  const origZoomIn = document.getElementById("origZoomIn");
  const origZoomOut = document.getElementById("origZoomOut");
  const origReset = document.getElementById("origReset");
  const enhZoomIn = document.getElementById("enhZoomIn");
  const enhZoomOut = document.getElementById("enhZoomOut");
  const enhReset = document.getElementById("enhReset");

  const origCanvas = document.getElementById("originalCanvas") || null;
  const enhCanvas = document.getElementById("enhancedCanvas") || null;

  // Small helpers UI
  function showToast(msg, ok=false){
    if(!toast) { console.log("TOAST:", msg); return; }
    toast.textContent = msg;
    toast.style.borderColor = ok ? "rgba(124,240,201,0.50)" : "rgba(255,255,255,0.06)";
    toast.style.display = "block";
    setTimeout(()=> toast.style.display = "none", 2600);
  }
  function setProgress(pct){ if(progressBar) progressBar.style.width = (pct||0) + "%"; }
  function setBgProgress(pct){ if(bgProgressBar) bgProgressBar.style.width = (pct||0) + "%"; }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

  function triggerDownload(url, name="imagen.jpg"){
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function suggestFileName(originalName, suffix="enhanced"){
    const safe = (originalName || "imagen").replace(/\.[^/.]+$/, "");
    return `${safe}.${suffix}.jpg`;
  }

  // ---- Utilities to load external libs dynamically ----
  async function ensureBodyPix(){
    if(state.bodyPixModel) return state.bodyPixModel;
    // try global
    if(window.bodyPix) {
      state.bodyPixModel = await bodyPix.load({architecture:'MobileNetV1', outputStride:16, multiplier:0.75, quantBytes:2});
      return state.bodyPixModel;
    }
    // dynamically load TF/Y and BodyPix
    try{
      showToast("Cargando BodyPix (para quitar fondo)...", false);
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.11.0/dist/tf.min.js");
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/@tensorflow-models/body-pix@2.2.0/dist/body-pix.min.js");
      state.bodyPixModel = await bodyPix.load({architecture:'MobileNetV1', outputStride:16, multiplier:0.75, quantBytes:2});
      showToast("BodyPix listo", true);
      return state.bodyPixModel;
    }catch(e){
      console.error("No se pudo cargar BodyPix:", e);
      throw e;
    }
  }

  async function ensureOrt(){
    if(state.onnxAvailable) return true;
    // try global
    if(window.ort && ort.InferenceSession){
      state.onnxAvailable = true;
      return true;
    }
    // attempt to load
    try{
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js");
      state.onnxAvailable = true;
      return true;
    }catch(e){
      console.warn("onnxruntime-web no disponible:", e);
      state.onnxAvailable = false;
      return false;
    }
  }

  function loadScriptOnce(src){
    return new Promise((resolve,reject)=>{
      if(document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src; s.onload = ()=> resolve();
      s.onerror = (e)=> reject(e);
      document.head.appendChild(s);
    });
  }

  // ---- Local "upload" (replaces unsignedUpload) ----
  // We create a local publicId and store blob URLs in state.
  async function localUpload(file){
    // create object URL, store relevant metadata
    const id = "local_" + Date.now();
    const url = URL.createObjectURL(file);
    state.file = file;
    state.publicId = id;
    state.originalUrl = url;
    return { public_id: id, secure_url: url };
  }

  // ---- Transform helpers (replacements for buildTransformUrl / enhanceUrl / bgRemovalUrl) ----
  // These functions produce actual processed images (data URLs / blob URLs) using canvas or onnx if available.

  // helper: load image into ImageBitmap
  async function createImageBitmapFromUrl(url){
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await createImageBitmap(blob);
  }

  // canvas-based basic enhance: resize + unsharp mask + denoise simple
  function canvasEnhance(imageBitmap, opts={}){
    // opts: width, noise, sharpen, dpr
    const { width = state.settings.width, noise = state.settings.noise, sharpen = state.settings.sharpen, dpr = 2 } = opts;
    const scale = Math.min(1, width / imageBitmap.width); // limit or expand as needed
    const outW = Math.round(imageBitmap.width * scale * dpr);
    const outH = Math.round(imageBitmap.height * scale * dpr);

    // draw to canvas
    const c = document.createElement("canvas");
    c.width = outW; c.height = outH;
    const ctx = c.getContext("2d");
    // draw image (browser does interpolation)
    ctx.drawImage(imageBitmap, 0, 0, outW, outH);

    // Simple denoise: apply slight blur and mix based on noise parameter
    if(noise > 0 && noise < 100){
      const blurAmount = (100 - noise) / 120; // small blur if noise low
      if(blurAmount > 0.0001){
        // simple box blur by drawing scaled-down and up
        const tmp = document.createElement("canvas");
        tmp.width = Math.max(2, Math.round(outW * (1 - blurAmount)));
        tmp.height = Math.max(2, Math.round(outH * (1 - blurAmount)));
        const tctx = tmp.getContext("2d");
        tctx.drawImage(c, 0, 0, tmp.width, tmp.height);
        ctx.clearRect(0,0,outW,outH);
        ctx.drawImage(tmp, 0, 0, outW, outH);
      }
    }

    // Unsharp mask: convolution (approx)
    if(sharpen > 0){
      // apply a lightweight unsharp mask kernel by blending a sharpened version
      const imageData = ctx.getImageData(0,0,outW,outH);
      const data = imageData.data;
      // simple high-pass enhancement: for each pixel add a fraction of (pixel - blurred)
      // create a blurred version using canvas filter if available (fast)
      // fallback: skip heavy ops on very large images
      try{
        ctx.filter = 'blur(1px)';
        const blurCanvas = document.createElement("canvas");
        blurCanvas.width = outW; blurCanvas.height = outH;
        const bctx = blurCanvas.getContext("2d");
        bctx.filter = 'blur(1px)';
        bctx.drawImage(c,0,0);
        const blurred = bctx.getImageData(0,0,outW,outH).data;
        ctx.filter = 'none';
        const amount = (sharpen/100) * 1.6; // multiplier
        for(let i=0;i<data.length;i+=4){
          data[i] = clamp(data[i] + (data[i] - blurred[i]) * amount, 0, 255);
          data[i+1] = clamp(data[i+1] + (data[i+1] - blurred[i+1]) * amount, 0, 255);
          data[i+2] = clamp(data[i+2] + (data[i+2] - blurred[i+2]) * amount, 0, 255);
        }
        ctx.putImageData(imageData,0,0);
      }catch(e){
        // if anything fails, ignore sharpen
        console.warn("Fallback sharpen skipped:", e);
      }
    }

    // return blob URL (JPEG)
    return new Promise((resolve)=>{
      c.toBlob((blob)=>{
        const url = URL.createObjectURL(blob);
        resolve(url);
      },"image/jpeg",0.95);
    });
  }

  // ONNX-based enhance (attempt to run Real-ESRGAN-ish model)
  // Requires: state.ortSession to be set (user must have loaded model via UI)
  async function onnxEnhance(imageBitmap, opts={}){
    if(!state.onnxAvailable || !state.ortSession) {
      throw new Error("ONNX backend no disponible o sesión no creada.");
    }
    // NOTE: Implementing a generic Real-ESRGAN ONNX runner in-browser is non-trivial and model-specific.
    // Below we provide a minimal wrapper/attempt: resize image to model input, run session, and reconstruct.
    // Many Real-ESRGAN ONNX models expect NCHW float input range [-1,1] or [0,1]. You might need to adapt per-model.
    // This code attempts a reasonable generic flow but may need model-specific tweaks.

    const requiredInput = state.ortSession.inputNames && state.ortSession.inputNames[0];
    if(!requiredInput) throw new Error("Sesión ONNX sin inputs detectables.");

    // prepare canvas to get pixels
    const tmp = document.createElement("canvas");
    const ctx = tmp.getContext("2d");
    // choose model input size heuristically: if session has metadata, try to use it; fallback to 256
    let inputSize = 256;
    try{
      const meta = state.ortSession.metadata || {};
      // do nothing - metadata may not provide shape
    }catch(e){}
    // Draw original into tmp scaled to inputSize (square) preserving aspect ratio by letterbox
    const w = imageBitmap.width;
    const h = imageBitmap.height;
    inputSize = Math.min(512, Math.max(64, Math.round(Math.min(w,h)))); // conservative
    tmp.width = inputSize; tmp.height = inputSize;
    ctx.fillStyle = 'black'; ctx.fillRect(0,0,inputSize,inputSize);
    ctx.drawImage(imageBitmap, 0, 0, inputSize, inputSize);

    const imageData = ctx.getImageData(0,0,inputSize,inputSize);
    const data = imageData.data;

    // build Float32Array in NCHW: [1,3,H,W] in range [-1,1]
    const floatData = new Float32Array(1 * 3 * inputSize * inputSize);
    let offset = 0;
    for(let c=0;c<3;c++){
      for(let y=0;y<inputSize;y++){
        for(let x=0;x<inputSize;x++){
          const idx = (y*inputSize + x)*4;
          const v = data[idx + c] / 255.0;
          floatData[offset++] = (v - 0.5) * 2.0; // [-1,1]
        }
      }
    }

    const tensor = new ort.Tensor('float32', floatData, [1,3,inputSize,inputSize]);
    const feeds = {};
    feeds[requiredInput] = tensor;

    const out = await state.ortSession.run(feeds);
    // take first output
    const outName = Object.keys(out)[0];
    const outTensor = out[outName];
    // outTensor dims => [1,3,OH,OW]
    const [n,cOut,oh,ow] = outTensor.dims;
    const outData = outTensor.data;
    // convert to ImageData
    const outCanvas = document.createElement("canvas");
    outCanvas.width = ow; outCanvas.height = oh;
    const outCtx = outCanvas.getContext("2d");
    const outImageData = outCtx.createImageData(ow,oh);
    for(let y=0;y<oh;y++){
      for(let x=0;x<ow;x++){
        const i = y*ow + x;
        const r = ((outData[i] + 1) / 2) * 255;
        const g = ((outData[i + oh*ow] + 1) / 2) * 255;
        const b = ((outData[i + 2*oh*ow] + 1) / 2) * 255;
        const idx = i*4;
        outImageData.data[idx] = clamp(Math.round(r),0,255);
        outImageData.data[idx+1] = clamp(Math.round(g),0,255);
        outImageData.data[idx+2] = clamp(Math.round(b),0,255);
        outImageData.data[idx+3] = 255;
      }
    }
    outCtx.putImageData(outImageData,0,0);
    return new Promise((resolve)=> outCanvas.toBlob((blob)=> resolve(URL.createObjectURL(blob)),'image/png',1.0));
  }

  // Background removal using BodyPix: produces a PNG data URL with alpha channel
  async function bodypixRemoveBackground(imageBitmap, opts={}){
    const model = await ensureBodyPix();
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = imageBitmap.width;
    tempCanvas.height = imageBitmap.height;
    const tctx = tempCanvas.getContext("2d");
    tctx.drawImage(imageBitmap, 0, 0);

    // configure segmentation
    const segmentation = await model.segmentPerson(tempCanvas, {
      internalResolution: 'medium',
      segmentationThreshold: 0.7,
      maxDetections: 1,
      scoreThreshold: 0.3
    });

    // create output canvas with alpha where background is transparent
    const out = document.createElement("canvas");
    out.width = tempCanvas.width; out.height = tempCanvas.height;
    const ctx = out.getContext("2d");
    const imgData = tctx.getImageData(0,0,out.width,out.height);
    const data = imgData.data;
    const mask = segmentation.data; // 1 means person, 0 background

    // Apply mask: if mask==0 then alpha 0
    for(let i=0, p=0;i<data.length;i+=4, p++){
      const keep = mask[p] === 1;
      if(!keep){
        data[i+3] = 0; // alpha 0
      } // else leave pixel
    }
    ctx.putImageData(imgData,0,0);

    return new Promise((resolve)=>{
      out.toBlob((blob)=>{
        const url = URL.createObjectURL(blob);
        resolve(url);
      }, 'image/png');
    });
  }

  // warmImage: ensure image loads into <img> src (with cache-bust)
  function warmImage(url){
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = ()=> resolve();
      img.onerror = (e)=> reject(e);
      img.src = url + (url.includes("?") ? "&" : "?") + "cachebust=" + Date.now();
    });
  }

  // ---- File input handling (replaces original upload listener) ----
  fileInput.addEventListener("change", async (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    try{
      showToast("Preparando imagen local…");
      setProgress(10); setBgProgress(8);
      const res = await localUpload(f);
      originalImg.src = res.secure_url;
      originalInfo.textContent = `${f.name} • ${(f.size/1024/1024).toFixed(2)} MB`;
      setProgress(45); setBgProgress(35);
      clearBtn.disabled = false; enhanceBtn.disabled = false; bgRemoveBtn.disabled = false;
      showToast("Imagen lista (local).", true);
      await warmImage(originalImg.src);
    }catch(err){
      console.error(err);
      showToast("Falló la carga local.");
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

  // ---- ENHANCE (replaces enhanceBtn handler that used Cloudinary) ----
  enhanceBtn.addEventListener("click", async ()=>{
    if(!state.publicId || !state.originalUrl) return;
    try{
      enhanceBtn.disabled = true;
      setProgress(10); showToast("Mejorando imagen (local)...");
      // Prepare ImageBitmap
      const imgBitmap = await createImageBitmapFromUrl(state.originalUrl);
      // Try ONNX first if available and session created
      let finalUrl = null;
      if(state.onnxAvailable && state.ortSession){
        try{
          setProgress(25);
          finalUrl = await onnxEnhance(imgBitmap, { width: state.settings.width, dpr:2, noise: state.settings.noise, sharpen: state.settings.sharpen });
          setProgress(80);
        }catch(err){
          console.warn("ONNX enhance falló, fallback a canvas:", err);
          finalUrl = await canvasEnhance(imgBitmap, { width: state.settings.width, dpr:2, noise: state.settings.noise, sharpen: state.settings.sharpen });
        }
      } else {
        // Fallback canvas enhance
        finalUrl = await canvasEnhance(imgBitmap, { width: state.settings.width, dpr:2, noise: state.settings.noise, sharpen: state.settings.sharpen });
      }
      state.enhancedUrl = finalUrl;
      if(enhancedImg) enhancedImg.src = finalUrl;
      enhancedInfo.textContent = `Mejora local • ruido ${state.settings.noise} • nitidez ${state.settings.sharpen} • w ${state.settings.width}`;
      showToast("Calidad mejorada (local).", true);
      setProgress(100);
      setTimeout(()=>{ downloadBtn.disabled = false; if(autoDownloadSwitch && autoDownloadSwitch.checked) triggerDownload(finalUrl, suggestFileName(state.file?.name,"enhanced")); }, 200);
    }catch(err){
      console.error(err);
      showToast("Falló la mejora local.");
      setProgress(0);
    }finally{
      enhanceBtn.disabled = false;
    }
  });

  downloadBtn.addEventListener("click", ()=>{
    if(!state.enhancedUrl) return;
    triggerDownload(state.enhancedUrl, suggestFileName(state.file?.name,"enhanced"));
  });

  // ---- BG REMOVAL (replaces bgRemoveBtn handler) ----
  bgRemoveBtn.addEventListener("click", async ()=>{
    if(!state.publicId || !state.originalUrl) return;
    try{
      bgRemoveBtn.disabled = true;
      setBgProgress(12); showToast("Eliminando fondo (local)...");
      const imgBitmap = await createImageBitmapFromUrl(state.originalUrl);
      setBgProgress(28);
      const urlTry = await bodypixRemoveBackground(imgBitmap);
      setBgProgress(72);
      state.bgRemovedUrl = urlTry;
      // show result in original img (like original script)
      originalImg.src = urlTry;
      originalInfo.textContent = "Fondo eliminado (PNG)";
      setBgProgress(100); downloadBgBtn.disabled = false; showToast("Fondo eliminado.", true);
      if(autoDownloadSwitch && autoDownloadSwitch.checked) triggerDownload(urlTry, suggestFileName(state.file?.name,"no-bg"));
    }catch(err){
      console.error(err);
      showToast("No se pudo eliminar el fondo.");
      setBgProgress(0);
    }finally{
      bgRemoveBtn.disabled = false;
    }
  });

  downloadBgBtn.addEventListener("click", ()=>{
    if(!state.bgRemovedUrl) return;
    triggerDownload(state.bgRemovedUrl, suggestFileName(state.file?.name,"no-bg"));
  });

  // ---- Interactivity (zoom/pan) ----
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
    window.addEventListener("mouseup", ()=>{ dragging=false; if(imgEl) imgEl.style.cursor = "default"; });
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

  // Zoom buttons (same behavior)
  origZoomIn && origZoomIn.addEventListener("click", ()=>{ state.zoom.original = clamp(state.zoom.original+0.25,1,8); applyTransform(originalImg,state.zoom.original,state.pan.original); });
  origZoomOut && origZoomOut.addEventListener("click", ()=>{ state.zoom.original = clamp(state.zoom.original-0.25,1,8); applyTransform(originalImg,state.zoom.original,state.pan.original); });
  origReset && origReset.addEventListener("click", ()=>{ state.zoom.original=1; state.pan.original={x:0,y:0}; applyTransform(originalImg,1,state.pan.original); });

  enhZoomIn && enhZoomIn.addEventListener("click", ()=>{ state.zoom.enhanced = clamp(state.zoom.enhanced+0.25,1,8); applyTransform(enhancedImg,state.zoom.enhanced,state.pan.enhanced); });
  enhZoomOut && enhZoomOut.addEventListener("click", ()=>{ state.zoom.enhanced = clamp(state.zoom.enhanced-0.25,1,8); applyTransform(enhancedImg,state.zoom.enhanced,state.pan.enhanced); });
  enhReset && enhReset.addEventListener("click", ()=>{ state.zoom.enhanced=1; state.pan.enhanced={x:0,y:0}; applyTransform(enhancedImg,1,state.pan.enhanced); });

  // Keyboard shortcuts (same)
  window.addEventListener("keydown", (e)=>{
    const k = e.key.toLowerCase();
    if(k === "e" && !enhanceBtn.disabled) enhanceBtn.click();
    if(k === "b" && !bgRemoveBtn.disabled) bgRemoveBtn.click();
    if(k === "c" && !clearBtn.disabled) clearBtn.click();
    if(e.key === "Escape") { resetView(); fileInput.value = ""; }
  });

  // Quick improve: tweak settings briefly and enhance
  const quickImproveBtn = document.getElementById("quickImprove");
  quickImproveBtn && quickImproveBtn.addEventListener("click", ()=>{
    if(!state.publicId) return;
    const prev = {...state.settings};
    state.settings.noise = Math.max(25, state.settings.noise - 5);
    state.settings.sharpen = Math.min(80, state.settings.sharpen + 6);
    enhanceBtn.click();
    setTimeout(()=>{ state.settings = prev; }, 2000);
  });

  // Menu actions (preserve)
  const menuHome = document.getElementById("menuHome");
  const menuEditor = document.getElementById("menuEditor");
  const menuPresets = document.getElementById("menuPresets");
  const menuHelp = document.getElementById("menuHelp");
  menuHome && menuHome.addEventListener("click", ()=>{ window.scrollTo({top:0, behavior:"smooth"}); showToast("Inicio"); });
  menuEditor && menuEditor.addEventListener("click", ()=>{ const el = document.getElementById("paneOriginal"); el && el.scrollIntoView({behavior:"smooth", block:"center"}); showToast("Editor"); });
  menuPresets && menuPresets.addEventListener("click", ()=>{ showToast("Presets aún no configurados"); });
  menuHelp && menuHelp.addEventListener("click", ()=>{ showToast("Ayuda: usa E/B/C/ESC o revisa la documentación"); });

  // Ranges sync
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

  // ONNX model loader UI integration (optionally call this from your UI)
  // Expects a file input or URL. If you want to allow user to load a model file:
  async function loadOnnxFromUrl(url){
    try{
      showToast("Cargando modelo ONNX...");
      await ensureOrt();
      // fetch model arraybuffer
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      // create session
      const session = await ort.InferenceSession.create(arrayBuffer, { executionProviders: ['wasm','webgl','webgpu'].filter(Boolean) });
      state.ortSession = session;
      state.onnxAvailable = true;
      showToast("Modelo ONNX cargado", true);
      return session;
    }catch(e){
      console.error("Error cargando ONNX:", e);
      showToast("No se pudo cargar modelo ONNX");
      throw e;
    }
  }
  // If you want to let the user load model from an <input type=file> you can:
  async function loadOnnxFromFile(file){
    try{
      showToast("Cargando ONNX desde archivo...");
      await ensureOrt();
      const arrayBuffer = await file.arrayBuffer();
      const session = await ort.InferenceSession.create(arrayBuffer, { executionProviders: ['wasm','webgl','webgpu'].filter(Boolean) });
      state.ortSession = session;
      state.onnxAvailable = true;
      showToast("Modelo ONNX cargado localmente", true);
      return session;
    }catch(e){
      console.error("Error ONNX file:", e);
      showToast("ONNX local falló");
      throw e;
    }
  }

  // Expose helper methods to window for integration with rest of app
  window.EnhanceStar = {
    state,
    loadOnnxFromUrl,
    loadOnnxFromFile,
    ensureBodyPix,
    ensureOrt,
    canvasEnhance,
    onnxEnhance,
    bodypixRemoveBackground
  };

  // Init defaults
  resetView();
  showToast("Enhance Star (modo local) — carga una imagen para comenzar", true);

})();
