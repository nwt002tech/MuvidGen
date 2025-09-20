// app.module.js — iPhone-safe recorder with progress, audio-ended stop, and codec fallback
import * as THREE from 'three';
import { FontLoader } from 'https://unpkg.com/three@0.161.0/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'https://unpkg.com/three@0.161.0/examples/jsm/geometries/TextGeometry.js';

const $ = (sel) => document.querySelector(sel);
const titleEl = $("#title");
const styleEl = $("#style");
const lyricsEl = $("#lyrics");
const audioEl = $("#audio");
const spaceEl = $("#space");
const genBtn = $("#genBtn");
const stopBtn = $("#stopBtn");
const statusEl = $("#status");
const downloadEl = $("#download");
const canvas = $("#stage");

let renderer, scene, camera, singer, bgMesh;
let running = false;
let loopRAF = 0;

const DEFAULT_SPACE_HFSP = "https://nwt002tech-muvidgen.hf.space/";

function toHfSubdomain(u){
  try{
    if (!u) return DEFAULT_SPACE_HFSP;
    const url = String(u).trim().replace(/\/+$/,'');
    const m = url.match(/huggingface\.co\/spaces\/([^/]+)\/([^/]+)$/i);
    if (m) return `https://${m[1]}-${m[2]}.hf.space/`;
    return url + (url.endsWith('/') ? '' : '/');
  }catch{ return DEFAULT_SPACE_HFSP; }
}

function setStatus(msg){
  statusEl.textContent = msg;
  // console.log for debug if you need it:
  console.log("[AMV]", msg);
}
setStatus("Module loaded ✅");

audioEl?.addEventListener('change', () => {
  if (audioEl.files?.[0]) setStatus(`Audio selected: ${audioEl.files[0].name}`);
});

function isiOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function pickMimeCandidates(){
  // Try MP4 first for iOS, then WebM variants
  const c = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  return c.filter(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t));
}

async function setupThree() {
  renderer = new THREE.WebGLRenderer({canvas, preserveDrawingBuffer: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  onResize();
  window.addEventListener('resize', onResize);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, canvas.clientWidth/canvas.clientHeight, 0.1, 100);
  camera.position.set(0, 6, 10);
  camera.lookAt(0, 1.5, 0);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x223355, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(3,4,2);
  scene.add(dir);

  const stageGeo = new THREE.PlaneGeometry(30, 20);
  const stageMat = new THREE.MeshStandardMaterial({color: 0x0f1522, metalness: 0.1, roughness: 0.8});
  const stage = new THREE.Mesh(stageGeo, stageMat);
  stage.rotation.x = -Math.PI/2;
  stage.position.y = 0;
  scene.add(stage);

  const bgGeo = new THREE.PlaneGeometry(40, 22);
  const bgMat = new THREE.MeshBasicMaterial({color: 0x1b2850});
  bgMesh = new THREE.Mesh(bgGeo, bgMat);
  bgMesh.position.set(0, 10, -10);
  scene.add(bgMesh);

  const font = await new Promise((res, rej) => {
    new FontLoader().load(
      "https://unpkg.com/three@0.161.0/examples/fonts/helvetiker_regular.typeface.json",
      res, undefined, rej
    );
  });

  const textGeo = new TextGeometry("A", {
    font, size: 1.6, height: 0.35,
    curveSegments: 8, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03
  });
  textGeo.center();
  const textMat = new THREE.MeshStandardMaterial({color: 0x1ecb63, metalness: 0.3, roughness: 0.35});
  singer = new THREE.Mesh(textGeo, textMat);
  singer.position.y = 1.2;
  scene.add(singer);
}

function onResize(){
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer?.setSize(w, h, false);
  if (camera){ camera.aspect = w/h; camera.updateProjectionMatrix(); }
}

async function decodeAudio(file){
  const buf = await file.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume();
  const audioBuf = await ctx.decodeAudioData(buf.slice(0));
  return { ctx, audioBuf };
}

function analyzeBeatsOffline(audioBuf){
  const channel = audioBuf.getChannelData(0);
  const sr = audioBuf.sampleRate;
  const hop = Math.floor(sr * 0.05);
  const energies = [];
  for (let i=0;i<channel.length;i+=hop){
    let s = 0; for (let j=0;j<hop && i+j<channel.length;j++) s += channel[i+j]*channel[i+j];
    energies.push(Math.sqrt(s/hop));
  }
  const win = 20, peaks = [];
  for (let i=win;i<energies.length-win;i++){
    let avg=0; for (let k=i-win;k<i+win;k++) avg += energies[k]; avg /= (2*win);
    if (energies[i] > avg*1.35){ peaks.push((i*hop)/sr); i+=6; }
  }
  return peaks;
}

function storyboard(duration, lyrics){
  const cams = ["wide","medium","close"], N = 12, shots = [];
  const lines = (lyrics || "").split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const lower = lines.map(x=>x.toLowerCase());
  let chorusLine = "";
  for (let i=0;i<lower.length;i++){
    for (let j=i+1;j<lower.length;j++){
      if (lower[i] && lower[i] === lower[j] && lower[i].length >= 8){ chorusLine = lines[i]; break; }
    }
    if (chorusLine) break;
  }
  for (let i=0;i<N;i++){
    const start=(i/N)*duration, end=((i+1)/N)*duration;
    const theme = (i%3===1 && chorusLine) ? chorusLine : (lines[i%(lines.length||1)] || "fun colorful scene");
    shots.push({ id:`shot_${String(i+1).padStart(2,"0")}`, start, end, camera: cams[i%3], theme });
  }
  return shots;
}

function setBgColor(idx){
  const hues = [200,160,260,300,120,210,180,30,340,80,20,240];
  const color = new THREE.Color().setHSL(hues[idx % hues.length]/360, 0.55, 0.32);
  bgMesh.material.map = null;
  bgMesh.material.color = color;
  bgMesh.material.needsUpdate = true;
}

async function setBgImageFromSpace(shot, style, spaceUrlRaw){
  const spaceUrl = toHfSubdomain(spaceUrlRaw || DEFAULT_SPACE_HFSP);
  const prompt = `${style}; ${shot.theme}`.slice(0, 500);
  const endpoints = ["/api/predict", "/run/predict"];
  for (const ep of endpoints){
    try{
      const res = await fetch(spaceUrl.replace(/\/$/,"") + ep, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({data: [prompt]})
      });
      if (!res.ok) continue;
      const data = await res.json();
      let b64 = null;
      if (Array.isArray(data.data)){
        if (typeof data.data[0] === "string" && data.data[0].startsWith("data:image/")) b64 = data.data[0];
        else if (data.data[0]?.data?.startsWith?.("data:image/")) b64 = data.data[0].data;
      }
      if (!b64) continue;
      const tx = await new THREE.TextureLoader().loadAsync(b64);
      tx.colorSpace = THREE.SRGBColorSpace;
      bgMesh.material.map = tx;
      bgMesh.material.needsUpdate = true;
      return true;
    }catch(e){ /* try next endpoint */ }
  }
  return false;
}

function animateFrame(tSec, beatTimes){
  singer.rotation.y = Math.sin(tSec*0.7)*0.2;
  let bounce = 0;
  for (const bt of beatTimes){ if (Math.abs(bt - tSec) < 0.12){ bounce = 0.35; break; } }
  singer.position.y = 1.2 + bounce;
  renderer.render(scene, camera);
}

function startRenderLoop(duration, beatTimes, usingSpace){
  let startTime;
  running = true;
  const tick = (ts)=>{
    if (!running) return;
    if (!startTime) startTime = ts;
    const tSec = (ts - startTime)/1000;
    // Which shot?
    const N = 12;
    const shotIdx = Math.min(N-1, Math.floor((tSec / duration) * N));
    const cam = ["wide","medium","close"][shotIdx % 3];
    camera.fov = cam==="close"?35:cam==="medium"?50:65;
    camera.updateProjectionMatrix();
    if (!usingSpace) setBgColor(shotIdx);
    animateFrame(tSec, beatTimes);
    if (tSec < duration) loopRAF = requestAnimationFrame(tick);
  };
  loopRAF = requestAnimationFrame(tick);
}

function stopRenderLoop(){
  running = false;
  if (loopRAF) cancelAnimationFrame(loopRAF);
}

async function recordWithFallback(duration, audioEl){
  if (!window.MediaRecorder){
    throw new Error("MediaRecorder not supported on this device.");
  }
  const stream = canvas.captureStream(30);
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === "suspended") await actx.resume();
  const src = actx.createMediaElementSource(audioEl);
  const dest = actx.createMediaStreamDestination();
  src.connect(dest);
  src.connect(actx.destination);

  // Merge audio+video
  const mixed = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);

  const candidates = pickMimeCandidates();
  // If none advertised, try empty options (let browser choose)
  const tryList = candidates.length ? candidates : [''];

  // We'll stop on audio end; also show live progress
  const total = Math.max(1, Math.round(duration));
  let elapsed = 0;
  const progressTimer = setInterval(()=>{
    elapsed++;
    const mm = (n)=>String(Math.floor(n/60)).padStart(2,'0');
    const ss = (n)=>String(Math.floor(n%60)).padStart(2,'0');
    setStatus(`Rendering to video… ${mm(elapsed)}:${ss(elapsed)} / ${mm(total)}:${ss(total)}`);
  }, 1000);

  try {
    for (let i=0;i<tryList.length;i++){
      const type = tryList[i];
      setStatus(`Rendering to video… (${type || 'auto'})`);
      const chunks = [];
      let gotData = false;

      const opts = type ? {mimeType:type} : {};
      let mr;
      try {
        mr = new MediaRecorder(mixed, opts);
      } catch(e) {
        // Try next type
        continue;
      }

      mr.ondataavailable = (e)=>{ if (e.data && e.data.size){ chunks.push(e.data); gotData = true; } };
      const done = new Promise((resolve)=>{ mr.onstop = resolve; });

      // Stop when audio ends (more reliable on iOS)
      const onEnded = ()=>{ try{ mr.stop(); }catch(_){} };
      audioEl.addEventListener('ended', onEnded, {once:true});

      mr.start();
      await audioEl.play();  // must be after user gesture
      // Safety watchdog: if for some reason 'ended' never fires (e.g., short file decode mismatch)
      const maxMs = (duration * 1000) + 5000;
      await Promise.race([
        done,
        new Promise(r=>setTimeout(r, maxMs).then(()=>{ try{ mr.stop(); }catch(_){}; }))
      ]);
      await done;

      // Build blob if we got data
      if (gotData && chunks.length){
        clearInterval(progressTimer);
        const outType = type && type.includes("mp4") ? "video/mp4" : (type || "video/webm");
        return new Blob(chunks, {type: outType});
      }
      // else try next candidate
    }
    clearInterval(progressTimer);
    throw new Error("No supported recording mime type produced data on this device.");
  } finally {
    clearInterval(progressTimer);
  }
}

async function handleGenerate(){
  try{
    downloadEl.innerHTML = "";
    stopBtn.disabled = false; genBtn.disabled = true;

    const file = audioEl.files?.[0];
    if (!file){ setStatus("Please choose an audio file."); stopBtn.disabled = true; genBtn.disabled = false; return; }

    setStatus("Loading audio…");
    const {audioBuf} = await decodeAudio(file);
    const duration = audioBuf.duration;

    setStatus("Analyzing beats…");
    const beatTimes = analyzeBeatsOffline(audioBuf);

    setStatus("Building 3D scene…");
    if (!renderer) await setupThree();

    const audioURL = URL.createObjectURL(file);
    const hiddenAudio = new Audio(audioURL);
    hiddenAudio.crossOrigin = "anonymous";
    hiddenAudio.preload = "auto";

    const shots = storyboard(duration, lyricsEl.value);
    const override = spaceEl?.value?.trim();
    const effectiveSpace = toHfSubdomain(override || DEFAULT_SPACE_HFSP);
    if (spaceEl) spaceEl.value = effectiveSpace;

    setStatus("Generating AI backgrounds…");
    for (let i=0;i<shots.length;i++){
      const ok = await setBgImageFromSpace(shots[i], styleEl.value.trim(), effectiveSpace);
      if (!ok) setBgColor(i);
      await new Promise(r=>setTimeout(r, 120));
    }

    // Render + record
    startRenderLoop(duration, beatTimes, true);
    const blob = await recordWithFallback(duration, hiddenAudio);
    stopRenderLoop();

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (titleEl.value || "amv") + (blob.type.includes("mp4") ? ".mp4" : ".webm");
    a.textContent = "Download your video";
    downloadEl.innerHTML = "";
    downloadEl.appendChild(a);
    setStatus("Done ✔");
  }catch(e){
    console.error(e);
    stopRenderLoop();
    setStatus("Error: " + (e?.message || e));
  } finally {
    stopBtn.disabled = true; genBtn.disabled = false;
  }
}

function handleStop(){
  stopRenderLoop();
  setStatus("Stopped by user");
}

genBtn?.addEventListener('click', handleGenerate);
window.AMV_generate = handleGenerate; // inline fallback
stopBtn?.addEventListener('click', handleStop);

setStatus(`Ready ${isiOS() ? "(iOS detected)" : ""}`);
