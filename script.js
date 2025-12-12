<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Enhance Star — Local (sin Cloudinary)</title>
<style>
  :root{
    --bg:#0b0b0c; --card:#0f1113; --muted:#9aa3ad; --accent:#4fd6b6; --danger:#ff7b7b; --glass: rgba(255,255,255,0.03);
    --radius:12px; --pad:14px;
  }
  html,body{height:100%;margin:0;font-family:Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;color:#e6eef3;background:linear-gradient(180deg,#050506 0%, #0b0b0c 100%);}
  .loader-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(0deg, rgba(0,0,0,0.6), rgba(0,0,0,0.6));z-index:9999;}
  .loader-card{background:var(--card);padding:24px;border-radius:16px;border:1px solid rgba(255,255,255,0.03);width:360px;box-shadow:0 10px 30px rgba(2,6,23,0.6);text-align:center}
  .loader-title{font-weight:700;font-size:18px;margin-bottom:8px;color:#bff2dd}
  .progress{height:10px;background:rgba(255,255,255,0.03);border-radius:999px;overflow:hidden;margin-top:12px}
  .progress .bar{height:100%;width:0%;background:linear-gradient(90deg,var(--accent),#6fd3ff);}
  .app{max-width:1200px;margin:28px auto;padding:18px;display:flex;flex-direction:column;gap:18px}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .brand{display:flex;gap:12px;align-items:center}
  .brand .logo{width:46px;height:46px;border-radius:10px;background:linear-gradient(135deg,#0ff 0%, #6f8 100%);display:flex;align-items:center;justify-content:center;font-weight:800;color:#002}
  h1{margin:0;font-size:20px}
  .controls-row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .card{background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));border-radius:var(--radius);padding:var(--pad);box-shadow:0 6px 18px rgba(2,6,23,0.6);border:1px solid rgba(255,255,255,0.02)}
  .main-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .pane{min-height:360px;display:flex;flex-direction:column;gap:12px}
  .pane .title{font-weight:700;color:var(--accent)}
  .image-frame{background:var(--glass);border-radius:10px;padding:12px;min-height:260px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
  .image-frame img{max-width:100%;max-height:100%;transform-origin:center center;transition:transform .08s linear;cursor:grab; user-select:none}
  .overlay-info{position:absolute;left:12px;bottom:12px;background:rgba(0,0,0,0.5);padding:6px 10px;border-radius:10px;font-size:13px;color:var(--muted)}
  .btn{background:linear-gradient(180deg,var(--accent),#6fd3ff);border:none;padding:10px 14px;border-radius:10px;font-weight:700;cursor:pointer;color:#003;margin:0}
  .btn.secondary{background:transparent;border:1px solid rgba(255,255,255,0.06);color:var(--muted)}
  .btn.danger{background:linear-gradient(180deg,var(--danger),#ff9a9a);color:#300}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  label{font-size:13px;color:var(--muted)}
  input[type="range"]{width:180px}
  .settings{display:flex;flex-direction:column;gap:8px}
  footer{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:13px;padding:12px}
  .toast{position:fixed;right:18px;bottom:18px;background:#0c0f11;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.03);color:#dff;display:none;z-index:9999}
  .zoom-controls{display:flex;gap:6px;position:absolute;top:12px;right:12px}
  .zoom-controls button{padding:6px 8px;border-radius:8px;border:none;background:rgba(255,255,255,0.03);color:var(--muted);cursor:pointer}
  @media (max-width:980px){.main-grid{grid-template-columns:1fr}}
</style>
</head>
<body>

<!-- Loader -->
<div id="introLoader" class="loader-overlay" role="status" aria-live="polite">
  <div class="loader-card" role="presentation">
    <div class="loader-title">Enhance Star — Preparando editor local</div>
    <div style="font-size:13px;color:var(--muted)">Cargando (esto es local y no necesita internet)</div>
    <div class="progress" aria-hidden="false" style="margin-top:16px;">
      <div class="bar" id="loaderBar"></div>
    </div>
  </div>
</div>

<div class="app" id="app" role="application" aria-label="Enhance Star local">
  <header>
    <div class="brand">
      <div class="logo">ES</div>
      <div>
        <h1>Enhance Star — Local</h1>
        <div style="font-size:12px;color:var(--muted)">Mejoras y fondo sin servicios externos</div>
      </div>
    </div>

    <div class="controls-row">
      <label style="display:flex;gap:8px;align-items:center;color:var(--muted)"><input id="autoDownload" type="checkbox" /> Descargar auto</label>
      <button id="helpBtn" class="btn secondary">Ayuda</button>
    </div>
  </header>

  <div class="card">
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <input id="file" type="file" accept="image/*" />
      <button id="clearBtn" class="btn secondary" disabled>Limpiar</button>
      <button id="enhanceBtn" class="btn" disabled>✨ Mejorar (Upscale + Nitidez)</button>
      <button id="bgRemoveBtn" class="btn secondary" disabled>🪄 Quitar fondo (heurístico)</button>
      <button id="downloadBtn" class="btn secondary" disabled>⬇︎ Descargar mejorada</button>
      <button id="downloadBgBtn" class="btn secondary" disabled>⬇︎ Descargar sin fondo</button>

      <div style="margin-left:auto" class="row">
        <label>Escala: <span id="scaleLabel">2x</span></label>
        <input id="scaleRange" type="range" min="1" max="4" step="1" value="2" />
      </div>
    </div>

    <div style="margin-top:12px" class="main-grid">
      <div class="pane card">
        <div class="title">Original</div>
        <div class="image-frame" id="originalFrame">
          <div class="zoom-controls">
            <button id="origZoomIn">+</button>
            <button id="origZoomOut">−</button>
            <button id="origReset">⟲</button>
          </div>
          <img id="originalImg" alt="Imagen original" draggable="false" />
          <div class="overlay-info" id="originalInfo">Sin imagen</div>
        </div>
      </div>

      <div class="pane card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="title">Mejorada</div>
          <div style="font-size:13px;color:var(--muted)" id="enhancedInfo">Pendiente</div>
        </div>
        <div class="image-frame" id="enhancedFrame">
          <div class="zoom-controls">
            <button id="enhZoomIn">+</button>
            <button id="enhZoomOut">−</button>
            <button id="enhReset">⟲</button>
          </div>
          <img id="enhancedImg" alt="Imagen mejorada" draggable="false" />
          <div class="overlay-info" id="enhancedOverlay">—</div>
        </div>

        <div style="margin-top:10px" class="settings">
          <div class="row">
            <label>Nitidez: <span id="sharpenLabel">1.4</span></label>
            <input id="sharpenRange" type="range" min="0.6" max="3" step="0.1" value="1.4" />
          </div>
          <div class="row">
            <label>Suavizado (reduce ruido): <span id="denoiseLabel">0.6</span></label>
            <input id="denoiseRange" type="range" min="0" max="1.5" step="0.1" value="0.6" />
          </div>
        </div>
      </div>
    </div>
  </div>

  <footer class="card">
    <div>Enhance Star — Local • Creado por ti</div>
    <div>© <span id="year"></span></div>
  </footer>
</div>

<div id="toast" class="toast" role="status" aria-live="polite"></div>

<script>
(function(){
  // Elements
  const introLoader = document.getElementById('introLoader');
  const loaderBar = document.getElementById('loaderBar');
  const fileInput = document.getElementById('file');
  const clearBtn = document.getElementById('clearBtn');
  const enhanceBtn = document.getElementById('enhanceBtn');
  const bgRemoveBtn = document.getElementById('bgRemoveBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadBgBtn = document.getElementById('downloadBgBtn');
  const originalImg = document.getElementById('originalImg');
  const enhancedImg = document.getElementById('enhancedImg');
  const originalInfo = document.getElementById('originalInfo');
  const enhancedInfo = document.getElementById('enhancedInfo');
  const enhancedOverlay = document.getElementById('enhancedOverlay');
  const toast = document.getElementById('toast');
  const autoDownload = document.getElementById('autoDownload');
  const scaleRange = document.getElementById('scaleRange');
  const scaleLabel = document.getElementById('scaleLabel');
  const sharpenRange = document.getElementById('sharpenRange');
  const sharpenLabel = document.getElementById('sharpenLabel');
  const denoiseRange = document.getElementById('denoiseRange');
  const denoiseLabel = document.getElementById('denoiseLabel');
  const yearSpan = document.getElementById('year'); yearSpan.textContent = new Date().getFullYear();

  let state = {
    file: null,
    originalDataUrl: null,
    enhancedDataUrl: null,
    noBgDataUrl: null,
    scale: parseInt(scaleRange.value,10) || 2,
    sharpen: parseFloat(sharpenRange.value) || 1.4,
    denoise: parseFloat(denoiseRange.value) || 0.6,
    zoom: { original:1, enhanced:1 },
    pan: { original:{x:0,y:0}, enhanced:{x:0,y:0} }
  };

  // small safe toast
  function showToast(msg, ok=false){
    toast.textContent = msg;
    toast.style.display = 'block';
    toast.style.borderColor = ok ? 'rgba(79,214,182,0.5)' : 'rgba(255,255,255,0.03)';
    setTimeout(()=> { toast.style.display = 'none'; }, 2600);
  }

  // loader animation simple
  function fakeLoader(){
    let w = 0;
    const id = setInterval(()=> {
      w += Math.floor(Math.random()*8)+2;
      if(w>100) w=100;
      loaderBar.style.width = w + '%';
      if(w>=100){ clearInterval(id); setTimeout(()=> introLoader.style.display='none',350); }
    },140);
  }
  // start loader quickly
  fakeLoader();

  // Helpers: canvas operations (safe, synchronous)
  function createImageFromDataUrl(dataUrl){
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = ()=> resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function readFileAsDataURL(file){
    return new Promise((res,rej)=>{
      const r = new FileReader();
      r.onload = ()=> res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function downloadDataUrl(dataUrl, filename='image.jpg'){
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Simple image processing functions using canvas
  function createCanvas(w,h){ const c = document.createElement('canvas'); c.width=w; c.height=h; return c; }

  // gaussian blur (box approximation) - simple iterative box blur to approximate denoise
  function boxBlur(imageData, w, h, radius){
    if(radius <= 0) return imageData;
    // Convert to Uint32? We'll do naive separable box blur for RGBA
    const pixels = imageData.data;
    const tmp = new Uint8ClampedArray(pixels.length);
    const iarr = 1 / (radius*2 + 1);
    // horizontal
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        let r=0,g=0,b=0,a=0;
        for(let dx=-radius; dx<=radius; dx++){
          const sx = Math.min(w-1, Math.max(0, x+dx));
          const idx = (y*w + sx)*4;
          r += pixels[idx]; g += pixels[idx+1]; b += pixels[idx+2]; a += pixels[idx+3];
        }
        const idx2 = (y*w + x)*4;
        tmp[idx2] = Math.round(r * iarr);
        tmp[idx2+1] = Math.round(g * iarr);
        tmp[idx2+2] = Math.round(b * iarr);
        tmp[idx2+3] = Math.round(a * iarr);
      }
    }
    // vertical
    const out = new Uint8ClampedArray(pixels.length);
    for(let x=0;x<w;x++){
      for(let y=0;y<h;y++){
        let r=0,g=0,b=0,a=0;
        for(let dy=-radius; dy<=radius; dy++){
          const sy = Math.min(h-1, Math.max(0, y+dy));
          const idx = (sy*w + x)*4;
          r += tmp[idx]; g += tmp[idx+1]; b += tmp[idx+2]; a += tmp[idx+3];
        }
        const idx2 = (y*w + x)*4;
        out[idx2] = Math.round(r * iarr);
        out[idx2+1] = Math.round(g * iarr);
        out[idx2+2] = Math.round(b * iarr);
        out[idx2+3] = Math.round(a * iarr);
      }
    }
    return new ImageData(out, w, h);
  }

  // Unsharp mask-ish: sharpen kernel adjustable by amount
  function sharpenImage(imageData, amount){
    if(amount <= 1) return imageData;
    const w = imageData.width, h = imageData.height;
    const src = imageData.data;
    const out = new Uint8ClampedArray(src.length);
    // simple Laplacian kernel with center weight
    const k = [
      0, -1, 0,
      -1, 5, -1,
      0, -1, 0
    ];
    // modify center based on amount
    const center = (amount - 1) * 2 + 1; // map to something reasonable
    k[4] = center + 4; // baseline strengthen
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        let r=0,g=0,b=0,a=0;
        for(let ky=-1; ky<=1; ky++){
          for(let kx=-1; kx<=1; kx++){
            const sx = Math.min(w-1, Math.max(0, x+kx));
            const sy = Math.min(h-1, Math.max(0, y+ky));
            const idx = (sy*w + sx)*4;
            const kval = k[(ky+1)*3 + (kx+1)];
            r += src[idx] * kval;
            g += src[idx+1] * kval;
            b += src[idx+2] * kval;
            a += src[idx+3] * kval;
          }
        }
        const idx2 = (y*w + x)*4;
        out[idx2] = Math.min(255, Math.max(0, Math.round(r)));
        out[idx2+1] = Math.min(255, Math.max(0, Math.round(g)));
        out[idx2+2] = Math.min(255, Math.max(0, Math.round(b)));
        out[idx2+3] = src[idx2+3];
      }
    }
    return new ImageData(out, w, h);
  }

  // Heuristic background removal: sample corners average color, then alpha-out similar pixels
  function removeBackgroundHeuristic(imageData, threshold=48){
    const w = imageData.width, h = imageData.height;
    const data = imageData.data;
    // sample 4 corners area (6x6)
    function sampleArea(sx, sy, sw, sh){
      let r=0,g=0,b=0,c=0;
      for(let y=sy; y<Math.min(h, sy+sh); y++){
        for(let x=sx; x<Math.min(w, sx+sw); x++){
          const idx = (y*w + x)*4;
          r += data[idx]; g+=data[idx+1]; b+=data[idx+2]; c++;
        }
      }
      return {r:Math.round(r/c), g:Math.round(g/c), b:Math.round(b/c)};
    }
    const s = 8;
    const corners = [
      sampleArea(0,0,s,s),
      sampleArea(w-s,0,s,s),
      sampleArea(0,h-s,s,s),
      sampleArea(w-s,h-s,s,s)
    ];
    // average corner
    let cr=0,cg=0,cb=0;
    corners.forEach(c=>{cr+=c.r; cg+=c.g; cb+=c.b;});
    cr = Math.round(cr/4); cg = Math.round(cg/4); cb = Math.round(cb/4);

    // now create new imageData with alpha removed where distance < threshold
    const out = new Uint8ClampedArray(data.length);
    for(let i=0;i<data.length;i+=4){
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      const d = Math.sqrt((r-cr)**2 + (g-cg)**2 + (b-cb)**2);
      const alpha = d < threshold ? 0 : a;
      out[i] = r; out[i+1] = g; out[i+2] = b; out[i+3] = alpha;
    }
    return new ImageData(out, w, h);
  }

  // PROCESS: upscale + denoise + sharpen (all local)
  async function processEnhance(dataUrl, scale=2, denoiseAmount=0.6, sharpenAmount=1.4){
    // load img
    const img = await createImageFromDataUrl(dataUrl);
    // upscale canvas
    const sw = img.naturalWidth, sh = img.naturalHeight;
    const tw = Math.max(1, Math.round(sw * scale)), th = Math.max(1, Math.round(sh * scale));
    // draw original at larger canvas with smoothing enabled
    const c = createCanvas(tw, th);
    const ctx = c.getContext('2d');
    // enable image smoothing (browser's best) to help with upscale
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, tw, th);

    // get image data
    let id = ctx.getImageData(0,0,tw,th);

    // denoise: box blur approximation depending on denoiseAmount
    const radius = Math.round(denoiseAmount * 4); // map 0..1.5 -> 0..6
    if(radius > 0){
      id = boxBlur(id, tw, th, radius);
      ctx.putImageData(id, 0, 0);
    }

    // sharpen: amount mapping
    const sharpenFactor = Math.max(0.6, sharpenAmount);
    id = sharpenImage(id, sharpenFactor);
    ctx.putImageData(id, 0, 0);

    return c.toDataURL('image/jpeg', 0.95);
  }

  // remove background
  async function processRemoveBg(dataUrl, threshold=48){
    const img = await createImageFromDataUrl(dataUrl);
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = createCanvas(w,h);
    const ctx = c.getContext('2d');
    ctx.drawImage(img,0,0,w,h);
    let id = ctx.getImageData(0,0,w,h);
    id = removeBackgroundHeuristic(id, threshold);
    // put to canvas with alpha
    const c2 = createCanvas(w,h);
    const ctx2 = c2.getContext('2d');
    ctx2.putImageData(id,0,0);
    // convert to PNG to preserve alpha
    return c2.toDataURL('image/png');
  }

  // UI wiring
  fileInput.addEventListener('change', async (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    try{
      showToast('Cargando imagen…');
      const dataUrl = await readFileAsDataURL(f);
      state.file = f;
      state.originalDataUrl = dataUrl;
      originalImg.src = dataUrl;
      originalInfo.textContent = `${f.name} • ${(f.size/1024/1024).toFixed(2)} MB • ${new Date().toLocaleDateString()}`;
      enhanceBtn.disabled = false; clearBtn.disabled = false; bgRemoveBtn.disabled = false;
      enhancedImg.src = ''; enhancedInfo.textContent = 'Pendiente';
      downloadBtn.disabled = true; downloadBgBtn.disabled = true;
      state.enhancedDataUrl = null; state.noBgDataUrl = null;
    }catch(err){
      console.error(err);
      showToast('Error leyendo archivo', false);
    }
  });

  clearBtn.addEventListener('click', ()=>{
    fileInput.value = '';
    state = Object.assign(state, { file:null, originalDataUrl:null, enhancedDataUrl:null, noBgDataUrl:null });
    originalImg.src = ''; enhancedImg.src = ''; originalInfo.textContent = 'Sin imagen'; enhancedInfo.textContent = 'Pendiente';
    enhanceBtn.disabled = true; bgRemoveBtn.disabled = true; clearBtn.disabled = true; downloadBtn.disabled = true; downloadBgBtn.disabled = true;
    showToast('Limpieza completa', true);
  });

  enhanceBtn.addEventListener('click', async ()=>{
    if(!state.originalDataUrl) return;
    try{
      enhanceBtn.disabled = true; bgRemoveBtn.disabled = true;
      showToast('Procesando mejora…');
      const scale = parseInt(scaleRange.value,10) || 2;
      const denoise = parseFloat(denoiseRange.value) || 0.6;
      const sharpen = parseFloat(sharpenRange.value) || 1.4;
      state.scale = scale; state.denoise = denoise; state.sharpen = sharpen;
      scaleLabel.textContent = scale + 'x'; denoiseLabel.textContent = denoise; sharpenLabel.textContent = sharpen;
      // do processing
      const out = await processEnhance(state.originalDataUrl, scale, denoise, sharpen);
      state.enhancedDataUrl = out;
      enhancedImg.src = out;
      enhancedInfo.textContent = `Escala ${scale}x • nitidez ${sharpen} • suavizado ${denoise}`;
      enhancedOverlay.textContent = `W:${Math.round((state.originalDataUrl?0:0))}`; // placeholder
      downloadBtn.disabled = false;
      if(autoDownload.checked){ downloadDataUrl(out, suggestFileName(state.file?.name, 'enhanced')); }
      showToast('Mejora completa', true);
    }catch(err){
      console.error(err);
      showToast('Falló la mejora localmente', false);
    }finally{
      enhanceBtn.disabled = false; bgRemoveBtn.disabled = false;
    }
  });

  bgRemoveBtn.addEventListener('click', async ()=>{
    if(!state.originalDataUrl) return;
    try{
      bgRemoveBtn.disabled = true; enhanceBtn.disabled = true;
      showToast('Procesando eliminación de fondo…');
      const out = await processRemoveBg(state.originalDataUrl, 52);
      state.noBgDataUrl = out;
      // show in original pane (user wanted original with bg removed sometimes)
      originalImg.src = out;
      originalInfo.textContent = 'Fondo heurísticamente eliminado (PNG)';
      downloadBgBtn.disabled = false;
      if(autoDownload.checked){ downloadDataUrl(out, suggestFileName(state.file?.name,'no-bg')); }
      showToast('Fondo eliminado (heurístico)', true);
    }catch(err){
      console.error(err);
      showToast('No se pudo eliminar el fondo (método heurístico)', false);
    }finally{
      bgRemoveBtn.disabled = false; enhanceBtn.disabled = false;
    }
  });

  downloadBtn.addEventListener('click', ()=>{ if(state.enhancedDataUrl) downloadDataUrl(state.enhancedDataUrl, suggestFileName(state.file?.name,'enhanced')); });
  downloadBgBtn.addEventListener('click', ()=>{ if(state.noBgDataUrl) downloadDataUrl(state.noBgDataUrl, suggestFileName(state.file?.name,'no-bg')); });

  function suggestFileName(originalName, suffix){
    const safe = (originalName || 'imagen').replace(/\.[^/.]+$/, '');
    return `${safe}.${suffix}.png`;
  }

  // Sync controls
  scaleRange.addEventListener('input', ()=>{ scaleLabel.textContent = scaleRange.value + 'x'; });
  sharpenRange.addEventListener('input', ()=>{ sharpenLabel.textContent = sharpenRange.value; });
  denoiseRange.addEventListener('input', ()=>{ denoiseLabel.textContent = denoiseRange.value; });

  // Interactive zoom & pan for both images
  function makeInteractive(imgEl, key){
    let dragging=false, last = {x:0,y:0};
    imgEl.addEventListener('wheel', (ev)=>{
      ev.preventDefault();
      const delta = Math.sign(ev.deltaY) * -0.12;
      state.zoom[key] = Math.max(0.25, Math.min(8, (state.zoom[key] || 1) + delta));
      applyTransform(imgEl, state.zoom[key], state.pan[key]);
    }, { passive:false });

    imgEl.addEventListener('mousedown', (e)=>{
      dragging = true; last = {x:e.clientX, y:e.clientY}; imgEl.style.cursor='grabbing';
    });
    window.addEventListener('mouseup', ()=>{ dragging=false; imgEl.style.cursor='grab'; });
    imgEl.addEventListener('mousemove', (e)=>{
      if(!dragging) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = {x:e.clientX, y:e.clientY};
      state.pan[key].x += dx; state.pan[key].y += dy;
      applyTransform(imgEl, state.zoom[key], state.pan[key]);
    });
    // mobile: touch pan
    let touchLast = null;
    imgEl.addEventListener('touchstart', (e)=>{ if(e.touches.length===1){ touchLast = {x:e.touches[0].clientX, y:e.touches[0].clientY}; }});
    imgEl.addEventListener('touchmove', (e)=>{ if(e.touches.length===1 && touchLast){ const dx = e.touches[0].clientX - touchLast.x; const dy = e.touches[0].clientY - touchLast.y; touchLast = {x:e.touches[0].clientX, y:e.touches[0].clientY}; state.pan[key].x += dx; state.pan[key].y += dy; applyTransform(imgEl, state.zoom[key], state.pan[key]); }}, {passive:false});
    imgEl.addEventListener('touchend', ()=>{ touchLast = null; });
  }

  function applyTransform(imgEl, zoom, pan){
    imgEl.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  }

  // init zoom state
  state.zoom.original = 1; state.zoom.enhanced = 1;
  state.pan.original = {x:0,y:0}; state.pan.enhanced = {x:0,y:0};
  makeInteractive(originalImg, 'original');
  makeInteractive(enhancedImg, 'enhanced');

  // zoom buttons
  document.getElementById('origZoomIn').addEventListener('click', ()=>{ state.zoom.original = Math.min(8, state.zoom.original+0.25); applyTransform(originalImg, state.zoom.original, state.pan.original); });
  document.getElementById('origZoomOut').addEventListener('click', ()=>{ state.zoom.original = Math.max(0.25, state.zoom.original-0.25); applyTransform(originalImg, state.zoom.original, state.pan.original); });
  document.getElementById('origReset').addEventListener('click', ()=>{ state.zoom.original = 1; state.pan.original = {x:0,y:0}; applyTransform(originalImg, state.zoom.original, state.pan.original); });

  document.getElementById('enhZoomIn').addEventListener('click', ()=>{ state.zoom.enhanced = Math.min(8, state.zoom.enhanced+0.25); applyTransform(enhancedImg, state.zoom.enhanced, state.pan.enhanced); });
  document.getElementById('enhZoomOut').addEventListener('click', ()=>{ state.zoom.enhanced = Math.max(0.25, state.zoom.enhanced-0.25); applyTransform(enhancedImg, state.zoom.enhanced, state.pan.enhanced); });
  document.getElementById('enhReset').addEventListener('click', ()=>{ state.zoom.enhanced = 1; state.pan.enhanced = {x:0,y:0}; applyTransform(enhancedImg, state.zoom.enhanced, state.pan.enhanced); });

  // keyboard shortcuts minimal
  window.addEventListener('keydown', (e)=>{
    if(e.key.toLowerCase()==='e' && !enhanceBtn.disabled) enhanceBtn.click();
    if(e.key.toLowerCase()==='b' && !bgRemoveBtn.disabled) bgRemoveBtn.click();
    if(e.key.toLowerCase()==='c' && !clearBtn.disabled) clearBtn.click();
  });

  // small helper: disable/enable buttons safe state
  function setAllDisabled(v){
    [enhanceBtn,bgRemoveBtn,clearBtn,downloadBtn,downloadBgBtn].forEach(b=>b.disabled = v);
  }

  // final: hide loader safely if something crashed
  setTimeout(()=> { try{ introLoader.style.display='none'; }catch(e){} }, 2000);

  // expose for debugging
  window.EnhanceStarLocal = { state };

})(); // IIFE
</script>

</body>
</html>
