import base64
from pathlib import Path
import streamlit as st

st.set_page_config(page_title="Auto 3D AMV — Embedded", layout="wide")

# Only THREE is needed now (we removed FontLoader/TextGeometry to avoid bare 'three' imports)
P_THREE = Path("vendor/three/build/three.module.js")

if not P_THREE.is_file():
    st.error(
        "Missing vendor file:\n\n- vendor/three/build/three.module.js\n\n"
        "Add it to your repo at that exact path and redeploy."
    )
    st.stop()

def data_url(path: Path, mime: str) -> str:
    b = path.read_bytes()
    b64 = base64.b64encode(b).decode("ascii")
    return f"data:{mime};base64,{b64}"

THREE_URL = data_url(P_THREE, "text/javascript")

HTML = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Auto 3D AMV — Embedded (No submodules)</title>
  <style>
    body {{ margin:0; font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif; background:#0b0f19; color:#e6eefc; }}
    .wrap {{ max-width: 1100px; margin: 0 auto; padding: 16px; }}
    header h1 {{ margin: 0 0 4px; font-size: 22px; }}
    header p {{ margin: 0 0 12px; color:#9bb3d6; }}
    .controls {{ display:flex; gap:12px; flex-wrap:wrap; }}
    .controls .col {{ flex:1; min-width: 280px; background:#111a2d; padding:12px; border-radius:12px; }}
    label {{ display:block; font-size:13px; color:#9bb3d6; margin: 8px 0 4px; }}
    input, textarea {{ width:100%; border:1px solid #22314f; border-radius:10px; background:#0e1526; color:#e6eefc; padding:8px; }}
    .btns {{ display:flex; gap:8px; margin-top:10px; }}
    button {{ background:#1f6feb; color:white; border:none; border-radius:10px; padding:10px 12px; font-weight:600; }}
    button[disabled] {{ opacity:0.5; }}
    .status {{ margin-top:8px; color:#9ed0ff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
    .download a {{ color:#7ee787; font-weight:600; }}
    .stage {{ margin-top: 12px; background:#050a16; border:1px solid #22314f; border-radius:12px; padding:10px; }}
    canvas#stage {{ width:100%; height:52vh; display:block; background:#000; }}
    pre#log {{ white-space:pre-wrap;background:#081022;color:#9ed0ff;padding:8px;border-radius:8px;min-height:60px;margin-top:10px }}
    footer small {{ color:#7a8fb6; }}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>🎬 Auto 3D AMV — Embedded (No Font modules)</h1>
      <p>All code embedded; using simple 3D character to avoid bare 'three' imports inside submodules.</p>
    </header>

    <section class="controls">
      <div class="col">
        <label>Project Title</label>
        <input id="title" placeholder="My Song"/>
        <label>Style Brief</label>
        <input id="style" value="Fun, upbeat, colorful 3D for kids; Pixar-like; classroom stage"/>
        <label>Lyrics (paste)</label>
        <textarea id="lyrics" rows="8" placeholder="Paste lyrics..."></textarea>
      </div>
      <div class="col">
        <label>Audio (WAV/MP3)</label>
        <input id="audio" type="file" accept=".wav,.mp3"/>
        <label>Hugging Face Space URL (optional override)</label>
        <input id="space" placeholder="https://huggingface.co/spaces/Nwt002tech/MuvidGen"/>
        <div class="btns">
          <button id="genBtn">Generate Full Video</button>
          <button id="stopBtn" disabled>Stop</button>
        </div>
        <div class="status" id="status">Page loaded…</div>
        <div class="download" id="download"></div>
      </div>
    </section>

    <section class="stage">
      <canvas id="stage"></canvas>
    </section>

    <section>
      <pre id="log"></pre>
    </section>

    <footer>
      <small>Default Space: https://nwt002tech-muvidgen.hf.space/ (overridable above)</small>
    </footer>
  </div>

  <script>
    // log helpers
    const statusEl = document.getElementById('status');
    const logEl = document.getElementById('log');
    function say(m){{ console.log("[AMV]", m); if (logEl) logEl.textContent += m + "\\n"; }}
    function setStatus(m){{ statusEl.textContent = m; say(m); }}
    window.addEventListener('error', e => {{
      setStatus("❌ Script error: " + (e.message||e.type));
      say((e.filename||"") + ":" + (e.lineno||""));
    }});
    window.addEventListener('unhandledrejection', e => {{
      setStatus("❌ Promise error: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
    }});
  </script>

  <!-- Load THREE from a data: URL (no bare specifiers anywhere) -->
  <script type="module">
    const THREE = await import("{THREE_URL}");

    const $ = (sel) => document.querySelector(sel);
    const titleEl = $("#title");
    const styleEl = $("#style");
    const lyricsEl = $("#lyrics");
    const audioEl = $("#audio");
    const spaceEl = $("#space");
    const genBtn = $("#genBtn");
    const stopBtn = $("#stopBtn");
    const downloadEl = $("#download");
    const canvas = $("#stage");

    let renderer, scene, camera, singer, bgMesh;
    let running = false, loopRAF = 0, progressTimer = 0;

    const DEFAULT_SPACE = "https://nwt002tech-muvidgen.hf.space/";

    function toHfSubdomain(u){{
      try{{
        if (!u) return DEFAULT_SPACE;
        const url = String(u).trim().replace(/\\/+$/,'');
        const m = url.match(/huggingface\\.co\\/spaces\\/([^\\/]+)\\/([^\\/]+)$/i);
        if (m) return `https://${{m[1]}}-${{m[2]}}.hf.space/`;
        return url + (url.endsWith('/') ? '' : '/');
      }}catch{{ return DEFAULT_SPACE; }}
    }}
    function pickMimeCandidates(){{
      const c = [
        'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ];
      return c.filter(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t));
    }}

    function onResize(){{
      const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 640;
      const h = canvas.clientHeight || Math.max(360, Math.floor(w * 9/16));
      renderer?.setSize(w, h, false);
      if (camera){{ camera.aspect = w/h; camera.updateProjectionMatrix(); }}
    }}

    async function setupThree(){{
      const {{
        WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight,
        PlaneGeometry, TorusGeometry, SphereGeometry, MeshStandardMaterial, MeshBasicMaterial, Mesh, Color, TextureLoader, SRGBColorSpace
      }} = THREE;

      renderer = new WebGLRenderer({{canvas, preserveDrawingBuffer: true}});
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      onResize();
      window.addEventListener('resize', onResize);

      scene = new Scene();
      camera = new PerspectiveCamera(60, 16/9, 0.1, 100);
      camera.position.set(0,6,10);
      camera.lookAt(0,1.5,0);
      scene.add(camera);

      const hemi = new HemisphereLight(0xffffff, 0x223355, 1.1);
      scene.add(hemi);
      const dir = new DirectionalLight(0xffffff, 1.2);
      dir.position.set(3,4,2);
      scene.add(dir);

      const stage = new Mesh(
        new PlaneGeometry(30,20),
        new MeshStandardMaterial({{color:0x0f1522, metalness:0.1, roughness:0.8}})
      );
      stage.rotation.x = -Math.PI/2;
      scene.add(stage);

      bgMesh = new Mesh(
        new PlaneGeometry(40,22),
        new MeshBasicMaterial({{color:0x1b2850}})
      );
      bgMesh.position.set(0,10,-10);
      scene.add(bgMesh);

      // Simple "character": sphere (head) + torus (halo/headset)
      const head = new Mesh(
        new SphereGeometry(1.1, 32, 24),
        new MeshStandardMaterial({{color:0x1ecb63, metalness:0.35, roughness:0.35}})
      );
      head.position.y = 1.4;

      const ring = new Mesh(
        new TorusGeometry(1.3, 0.08, 16, 64),
        new MeshStandardMaterial({{color:0xffc857, metalness:0.4, roughness:0.25}})
      );
      ring.rotation.x = Math.PI/2;
      ring.position.y = 1.4;

      singer = new THREE.Group();
      singer.add(head);
      singer.add(ring);
      scene.add(singer);

      setStatus("3D ready ✅");
    }}

    function setStatus(m){{ const el = document.getElementById('status'); el.textContent = m; console.log('[AMV]', m); }}
    function say(m){{ const log = document.getElementById('log'); if (log) log.textContent += m + "\\n"; console.log('[AMV]', m); }}

    async function decodeAudio(file){{
      const buf = await file.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') await ctx.resume();
      const audioBuf = await new Promise((res, rej)=> ctx.decodeAudioData(buf.slice(0), res, rej));
      return {{ ctx, audioBuf }};
    }}

    function analyzeBeatsOffline(audioBuf){{
      const ch = audioBuf.getChannelData(0);
      const sr = audioBuf.sampleRate;
      const hop = Math.floor(sr * 0.05);
      const energies = [];
      for (let i=0;i<ch.length;i+=hop){{ let s=0; for (let j=0;j<hop && i+j<ch.length;j++) s += ch[i+j]*ch[i+j]; energies.push(Math.sqrt(s/hop)); }}
      const win = 20, peaks = [];
      for (let i=win;i<energies.length-win;i++){{ let avg=0; for (let k=i-win;k<i+win;k++) avg += energies[k]; avg/=(2*win);
        if (energies[i] > avg*1.35){{ peaks.push((i*hop)/sr); i+=6; }} }}
      return peaks;
    }}

    function storyboard(duration, lyrics){{
      const cams = ["wide","medium","close"], N = 12, shots = [];
      const lines = (lyrics || "").split(/\\n+/).map(s=>s.trim()).filter(Boolean);
      const lower = lines.map(x=>x.toLowerCase());
      let chorus = "";
      for (let i=0;i<lower.length;i++){{ for (let j=i+1;j<lower.length;j++){{ if (lower[i] && lower[i] === lower[j] && lower[i].length >= 8){{ chorus = lines[i]; break; }} }} if (chorus) break; }}
      for (let i=0;i<N;i++){{ const start=(i/N)*duration, end=((i+1)/N)*duration;
        const theme = (i%3===1 && chorus) ? chorus : (lines[i%(lines.length||1)] || "fun colorful scene");
        shots.push({{start,end,camera:cams[i%3],theme}});
      }}
      return shots;
    }}

    function setBgColor(idx){{
      const hues = [200,160,260,300,120,210,180,30,340,80,20,240];
      const color = new THREE.Color().setHSL(hues[idx % hues.length]/360, 0.55, 0.32);
      bgMesh.material.map = null;
      bgMesh.material.color = color;
      bgMesh.material.needsUpdate = true;
    }}

    async function setBgImageFromSpace(theme, style, spaceUrlRaw){{
      const spaceUrl = toHfSubdomain(spaceUrlRaw || DEFAULT_SPACE);
      const prompt = (`${{style}}; ${{theme}}`).slice(0, 500);
      const endpoints = ["/api/predict", "/run/predict"];
      for (const ep of endpoints){{
        try{{
          const res = await fetch(spaceUrl.replace(/\\/$/,"") + ep, {{
            method:"POST", headers:{{"Content-Type":"application/json"}},
            body: JSON.stringify({{data:[prompt]}})
          }});
          if (!res.ok) continue;
          const data = await res.json();
          let b64 = null;
          if (Array.isArray(data.data)){{
            if (typeof data.data[0] === "string" && data.data[0].startsWith("data:image/")) b64 = data.data[0];
            else if (data.data[0]?.data?.startsWith?.("data:image/")) b64 = data.data[0].data;
          }}
          if (!b64) continue;
          const tx = await new THREE.TextureLoader().loadAsync(b64);
          tx.colorSpace = THREE.SRGBColorSpace;
          bgMesh.material.map = tx;
          bgMesh.material.needsUpdate = true;
          return true;
        }}catch(e){{}}
      }}
      return false;
    }}

    function animateFrame(tSec, beats){{
      singer.rotation.y = Math.sin(tSec*0.7)*0.25;
      let bounce=0; for (const bt of beats){{ if (Math.abs(bt - tSec) < 0.12){{ bounce = 0.35; break; }} }}
      singer.position.y = 1.2 + bounce;
      renderer.render(scene, camera);
    }}

    function startLoop(duration, beats, usingSpace){{
      let startTs; running = true;
      const N = 12;
      const tick = (ts)=>{{
        if (!running) return;
        if (!startTs) startTs = ts;
        const tSec = (ts - startTs)/1000;
        const idx = Math.min(N-1, Math.floor((tSec/duration)*N));
        const cam = ["wide","medium","close"][idx%3];
        camera.fov = cam==="close"?35 : cam==="medium"?50 : 65;
        camera.updateProjectionMatrix();
        if (!usingSpace) setBgColor(idx);
        animateFrame(tSec, beats);
        if (tSec < duration) loopRAF = requestAnimationFrame(tick);
      }};
      loopRAF = requestAnimationFrame(tick);
    }}
    function stopLoop(){{ running=false; if (loopRAF) cancelAnimationFrame(loopRAF); }}

    async function recordWithFallback(duration, audioEl){{
      if (!window.MediaRecorder) throw new Error("MediaRecorder not supported on this device.");
      const stream = canvas.captureStream(30);

      const actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") await actx.resume();
      const src = actx.createMediaElementSource(audioEl);
      const dest = actx.createMediaStreamDestination();
      src.connect(dest); src.connect(actx.destination);

      const mixed = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const types = (function(){{
        const c = [
          'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm'
        ];
        return c.filter(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t));
      }})();
      const tryList = types.length ? types : [''];

      const total = Math.max(1, Math.round(duration));
      let elapsed = 0;
      progressTimer = setInterval(()=>{{
        elapsed++;
        const mm = (n)=>String(Math.floor(n/60)).padStart(2,'0');
        const ss = (n)=>String(Math.floor(n%60)).padStart(2,'0');
        setStatus(`Rendering to video… ${{mm(elapsed)}}:${{ss(elapsed)}} / ${{mm(total)}}:${{ss(total)}}`);
      }}, 1000);

      try {{
        for (const type of tryList){{
          setStatus(`Rendering to video… (${{type || 'auto'}})`);
          const chunks = [];
          let gotData = false;
          let mr;
          try {{ mr = new MediaRecorder(mixed, type ? {{mimeType:type}} : {{}}); }}
          catch(e){{ continue; }}

          mr.ondataavailable = (e)=>{{ if (e.data && e.data.size){{ chunks.push(e.data); gotData=true; }} }};
          const done = new Promise((resolve)=>{{ mr.onstop = resolve; }});

          const onEnded = ()=>{{ try{{ mr.stop(); }}catch(_){{}} }};
          audioEl.addEventListener('ended', onEnded, {{once:true}});

          mr.start();
          await audioEl.play();

          const maxMs = duration*1000 + 5000;
          await Promise.race([
            done,
            new Promise(r=>setTimeout(r, maxMs).then(()=>{{ try{{ mr.stop(); }}catch(_ ){{ }} }}))
          ]);
          await done;

          if (gotData && chunks.length){{
            clearInterval(progressTimer);
            const outType = type && type.includes("mp4") ? "video/mp4" : (type || "video/webm");
            return new Blob(chunks, {{type: outType}});
          }}
        }}
        clearInterval(progressTimer);
        throw new Error("No supported recording mime type produced data on this device.");
      }} finally {{
        clearInterval(progressTimer);
      }}
    }}

    async function handleGenerate(){{
      try{{
        downloadEl.innerHTML = "";
        stopBtn.disabled = false; genBtn.disabled = true;

        const file = audioEl.files?.[0];
        if (!file){{ setStatus("Please choose an audio file."); stopBtn.disabled = true; genBtn.disabled = false; return; }}

        setStatus("Decoding audio…");
        const {{audioBuf}} = await decodeAudio(file);
        const duration = audioBuf.duration;

        setStatus("Analyzing beats…");
        const beats = analyzeBeatsOffline(audioBuf);

        setStatus("Building 3D scene…");
        if (!renderer) await setupThree();

        const shots = storyboard(duration, document.getElementById('lyrics').value);
        const effSpace = toHfSubdomain(document.getElementById('space')?.value?.trim() || DEFAULT_SPACE);

        setStatus("Generating AI backgrounds…");
        for (let i=0;i<shots.length;i++){{
          const ok = await setBgImageFromSpace(shots[i].theme, document.getElementById('style').value.trim(), effSpace);
          if (!ok) setBgColor(i);
          await new Promise(r=>setTimeout(r, 120));
        }}

        const audioURL = URL.createObjectURL(file);
        const hiddenAudio = new Audio(audioURL);
        hiddenAudio.crossOrigin = "anonymous";
        hiddenAudio.preload = "auto";

        startLoop(duration, beats, true);
        const blob = await recordWithFallback(duration, hiddenAudio);
        stopLoop();

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = (document.getElementById('title').value || "amv") + (blob.type.includes("mp4") ? ".mp4" : ".webm");
        a.textContent = "Download your video";
        document.getElementById('download').innerHTML = "";
        document.getElementById('download').appendChild(a);
        setStatus("Done ✔  (Long-press on iPhone to save)");
      }}catch(e){{
        console.error(e);
        stopLoop();
        setStatus("Error: " + (e?.message || e));
      }} finally {{
        stopBtn.disabled = true; genBtn.disabled = false;
      }}
    }}

    function handleStop(){{ stopLoop(); setStatus("Stopped by user"); }}

    const genBtn = document.getElementById('genBtn');
    const stopBtn = document.getElementById('stopBtn');
    const downloadEl = document.getElementById('download');

    genBtn?.addEventListener('click', handleGenerate);
    stopBtn?.addEventListener('click', handleStop);
    window.AMV_generate = handleGenerate;

    setStatus("Module loaded ✅");
  </script>
</body>
</html>
"""

st.components.v1.html(HTML, height=900, scrolling=True)
