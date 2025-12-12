<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Mejorador de Fotos IA (Sin Cloudinary)</title>
<style>
    body {
        font-family: Arial, sans-serif;
        background: #0d0d0d;
        color: #fff;
        margin: 0;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    h1 {
        text-align: center;
        color: #00c8ff;
    }

    .card {
        background: #111;
        padding: 20px;
        border-radius: 15px;
        box-shadow: 0 0 15px #000;
    }

    button {
        background: #00c8ff;
        border: none;
        padding: 12px 18px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 16px;
        margin-top: 10px;
        color: #000;
        font-weight: bold;
    }

    button:hover { background: #009ac2; }

    img {
        max-width: 100%;
        border-radius: 10px;
        margin-top: 10px;
    }

    .preview {
        display: flex;
        gap: 20px;
        flex-wrap: wrap;
        justify-content: center;
    }

    .img-box {
        background: #222;
        padding: 15px;
        border-radius: 12px;
        width: 45%;
        min-width: 250px;
    }

    @media (max-width: 600px) {
        .img-box { width: 100%; }
        body { padding: 10px; }
    }
</style>
</head>
<body>

<h1>Mejorador de Fotos con IA (Sin Cloudinary)</h1>

<div class="card">
    <input type="file" id="fileInput" accept="image/*">
    <button onclick="processImage()">Procesar Imagen</button>
</div>

<div class="preview">
    <div class="img-box">
        <h3>Original</h3>
        <img id="originalImg" src="">
    </div>

    <div class="img-box">
        <h3>Mejorada</h3>
        <img id="enhancedImg" src="">
    </div>

    <div class="img-box">
        <h3>Sin Fondo</h3>
        <img id="bgRemovedImg" src="">
    </div>
</div>

<script>
async function readFileAsBase64(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}

async function callReplicate(modelVersion, input) {
    const res = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
            "Authorization": "Token TU_API_KEY",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            version: modelVersion,
            input
        })
    });

    let prediction = await res.json();

    // Esperar a que termine
    while (prediction.status !== "succeeded" && prediction.status !== "failed") {
        await new Promise(r => setTimeout(r, 1000));
        const check = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
            headers: { "Authorization": "Token TU_API_KEY" }
        });
        prediction = await check.json();
    }

    return prediction.output;
}

async function processImage() {
    const file = document.getElementById("fileInput").files[0];
    if (!file) return alert("Selecciona una imagen");

    const base64 = await readFileAsBase64(file);
    document.getElementById("originalImg").src = base64;

    // --------------------------
    // MODELO 1: MEJORAR CALIDAD
    // --------------------------
    const enhanced = await callReplicate(
        "9282c8841f2ed61a5f03bb1410401d233a7cdc26a2711ebf94d88e4f1f52b7f5", // RealESRGAN
        { image: base64 }
    );

    document.getElementById("enhancedImg").src = enhanced;

    // --------------------------
    // MODELO 2: REMOVER FONDO
    // --------------------------
    const removed = await callReplicate(
        "5c50d2ee7941cc9ac3b6758abc4304c3f1a515a6a39aea66e68132c0a9c604a5", // Rembg
        { image: base64 }
    );

    document.getElementById("bgRemovedImg").src = removed;
}
</script>

</body>
</html>
