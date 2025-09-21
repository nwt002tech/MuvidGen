// app.module.js — local-module build with progress + iOS-safe recording
import * as THREE from 'three';
import { FontLoader } from './vendor/three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from './vendor/three/examples/jsm/geometries/TextGeometry.js';

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
let running = false, loopRAF = 0, progressTimer = 0;

// Hard-coded default Space (you can still override in the input)
const DEFAULT_SPACE_HFSP = "https://nwt002tech-muvidgen.hf.space/";

function setStatus(msg){ statusEl.textContent = msg; console.log("[AMV]", msg); }

// Convert /spaces/{user}/{space} -> https://{user}-{space}.hf.space/
function toHfSubdomain(u){
  try{
    if (!u) return DEFAULT_SPACE_HFSP;
    const url = String(u).trim().replace(/\/+$/,'');
    const m = url.match(/huggingface\.co\/spaces\/([^/]+)\/([^/]+)$/i);
    if (m) return `https://${m[1]}-${m[2]}.hf.space/`;
    return url + (url.endsWith('/') ? '' : '/');
  }catch{ return DEFAULT_SPACE_HFSP; }
}

function isiOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function pickMimeCandidates(){
  const c = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  return c.filter(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t));
}

function onResize(){
  const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 640;
  const h = canvas.clientHeight || Math.max(360, Math.floor(w * 9/16));
  renderer?.setSize(w, h, false);
  if (camera){ camera.aspect = w/h; camera.updateProjectionMatrix(); }
}

async function setupThree(){
  renderer = new THREE.WebGLRenderer({canvas, preserveDrawingBuffer: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  onResize();
  window.addEventListener('resize', onResize);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 16/9, 0.1, 100);
  camera.position.set(0,6,10);
  camera.lookAt(0,1.5,0);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x223355, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(3,4,2);
  scene.add(dir);

  const stage = new THREE.Mesh(
    new THREE.PlaneGeometry(30,20),
    new THREE.MeshStandardMaterial({color:0x0f1522, metalness:0.1, roughness:0.8})
  );
  stage.rotation.x = -Math.PI/2;
  scene.add(stage);

  bgMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(40,22),
    new THREE.MeshBasicMaterial({color:0x1b2850})
  );
  bgMesh.position.set(0,10,-10);
  scene.add(bgMesh);

  // Local font file
  const font = await new Promise((res, rej)=>{
    new FontLoader().load('./vendor/three/examples/fonts/helvetiker_regular.typeface.json', res, undefined, rej);
  });

  const textGeo = new TextGeometry("A", {
    font, size:1.6, height:0.35,
    curveSegments:8, bevelEnabled:true, bevelThickness:0.04, bevelSize:0.03
  });
  textGeo.center();
  singer = new THREE.Mesh(
    textGeo,
    new THREE.MeshStandardMaterial({color:0x1ecb63, metalness:0.3, roughness:0.35})
  );
  singer.position.y = 1.2;
  scene.add(singer);

  setStatus("3D ready ✅");
}

async function decodeAudio(file){
  const buf = await file.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume();
  const audioBuf = await new Promise((res, rej)=> ctx.decodeAudioData(buf.slice(0), res, rej));
  return { ctx, audioBuf };
}

function analyzeBeatsOffline(audioBuf){
  const ch = audioBuf.getChannelData(0);
  const sr = audioBuf.sampleRate;
  const hop = Math.floor(sr * 0.05);
  const energies = [];
  for (let i=0;i<ch.length;i+=hop){
    let s=0; for (let j=0;j<hop && i+j<ch.length;j++) s += ch[i+j]*ch[i+j];
    energies.push(Math.sqrt(s/hop));
  }
  const win = 20, peaks = [];
  for (let i=win;i<energies.length-win;i++){
    let avg=0; for (let k=i-win;k<i+win;k++) avg += energies[k]; avg/=(2*win);
    if (energies[i] > avg*1.35){ peaks.push((i*hop)/sr); i+=6; }
  }
  return peaks;
}

function storyboard(duration, lyrics){
  const cams = ["wide","medium","close"], N = 12, shots = [];
  const lines = (lyrics || "").split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const lower = lines.map(x=>x.toLowerCase());
  let chorus = "";
  for (let i=0;i<lower.length;i++){
    for (let j=i+1;j<lower.length;j++){
      if (lower[i] && lower[i] === lower[j] && lower[i].length >= 8){ chorus = lines[i]; break; }
    }
    if (chorus) break;
  }
  for (let i=0;i<N;i++){
    const start=(i/N)*duration, end=((i+1)/N)*duration;
    const theme = (i%3===1 && chorus) ? chorus : (lines[i%(lines.length||1)] || "fun colorful scene");
    shots.push({start,end,camera:cams[i%3],theme: theme});
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

async function setBgImageFromSpace(theme, style, spaceUrlRaw){
  const spaceUrl = toHfSubdomain(spaceUrlRaw || DEFAULT_SPACE_HFSP);
  const prompt = (`${style}; ${theme}`).slice(0, 500);
  const endpoints = ["/api/predict", "/run/predict"];
  for (const ep of endpoints){
    try{
      const res = await fetch(spaceUrl.replace(/\/$/,"") + ep, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({data:[prompt]})
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

function animateFrame(tSec, beats){
  singer.rotation.y = Math.sin(tSec*0.7)*0.2;
  let bounce=0;
  for (const bt of beats){ if (Math.abs(bt - tSec) < 0.12){ bounce = 0.35; break; } }
  singer.position.y = 1.2 + bounce;
  renderer.render(scene, camera);
}

function startLoop(duration, beats, usingSpace){
  let startTs;
  running = true;
  const N = 12;
  const tick = (ts)=>{
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
  };
  loopRAF = requestAnimationFrame(tick);
}
function stopLoop(){ running=false; if (loopRAF) cancelAnimationFrame(loopRAF); }

async function recordWithFallback(duration, audioEl){
  if (!window.MediaRecorder) throw new Error("MediaRecorder not supported on this device.");
  const stream = canvas.captureStream(30);

  const actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === "suspended") await actx.resume();
  const src = actx.createMediaElementSource(audioEl);
  const dest = actx.createMediaStreamDestination();
  src.connect(dest);
  src.connect(actx.destination);

  const mixed = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const types = pickMimeCandidates();
  const tryList = types.length ? types : [''];

  const total = Math.max(1, Math.round(duration));
  let elapsed = 0;
  progressTimer = setInterval(()=>{
    elapsed++;
    const mm = (n)=>String(Math.floor(n/60)).padStart(2,'0');
    const ss = (n)=>String(Math.floor(n%60)).padStart(2,'0');
    setStatus(`Rendering to video… ${mm(elapsed)}:${ss(elapsed)} / ${mm(total)}:${ss(total)}`);
  }, 1000);

  try {
    for (const type of tryList){
      setStatus(`Rendering to video… (${type || 'auto'})`);
      const chunks = [];
      let gotData = false;
      let mr;
      try { mr = new MediaRecorder(mixed, type ? {mimeType:type} : {}); }
      catch(e){ continue; }

      mr.ondataavailable = (e)=>{ if (e.data && e.data.size){ chunks.push(e.data); gotData=true; } };
      const done = new Promise((resolve)=>{ mr.onstop = resolve; });

      const onEnded = ()=>{ try{ mr.stop(); }catch(_){} };
      audioEl.addEventListener('ended', onEnded, {once:true});

      mr.start();
      await audioEl.play();

      const maxMs = duration*1000 + 5000;
      await Promise.race([
        done,
        new Promise(r=>setTimeout(r, maxMs).then(()=>{ try{ mr.stop(); }catch(_){ } }))
      ]);
      await done;

      if (gotData && chunks.length){
        clearInterval(progressTimer);
        const outType = type && type.includes("mp4") ? "video/mp4" : (type || "video/webm");
        return new Blob(chunks, {type: outType});
      }
    }
    clearInterval(progressTimer);
    throw new Error("No supported recording mime type produced data on this device.");
  } finally {
    clearInterval(progressTimer);
  }
}

// Main handler
async function handleGenerate(){
  try{
    downloadEl.innerHTML = "";
    stopBtn.disabled = false; genBtn.disabled = true;

    const file = audioEl.files?.[0];
    if (!file){ setStatus("Please choose an audio file."); stopBtn.disabled = true; genBtn.disabled = false; return; }

    setStatus("Decoding audio…");
    const {audioBuf} = await decodeAudio(file);
    const duration = audioBuf.duration;

    setStatus("Analyzing beats…");
    const beats = analyzeBeatsOffline(audioBuf);

    setStatus("Building 3D scene…");
    if (!renderer) await setupThree();

    const shots = storyboard(duration, lyricsEl.value);
    const effSpace = toHfSubdomain(spaceEl?.value?.trim() || DEFAULT_SPACE_HFSP);
    if (spaceEl) spaceEl.value = effSpace;

    setStatus("Generating AI backgrounds…");
    for (let i=0;i<shots.length;i++){
      const ok = await setBgImageFromSpace(shots[i].theme, styleEl.value.trim(), effSpace);
      if (!ok) setBgColor(i);
      await new Promise(r=>setTimeout(r, 120));
    }

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
    a.download = (titleEl.value || "amv") + (blob.type.includes("mp4") ? ".mp4" : ".webm");
    a.textContent = "Download your video";
    downloadEl.innerHTML = "";
    downloadEl.appendChild(a);
    setStatus("Done ✔  (Long-press on iPhone to save)");
  }catch(e){
    console.error(e);
    stopLoop();
    setStatus("Error: " + (e?.message || e));
  } finally {
    stopBtn.disabled = true; genBtn.disabled = false;
  }
}

function handleStop(){
  stopLoop();
  setStatus("Stopped by user");
}

genBtn?.addEventListener('click', handleGenerate);
window.AMV_generate = handleGenerate;        // fallback inline onclick
stopBtn?.addEventListener('click', handleStop);

setStatus(`Module loaded ✅ ${isiOS()? "(iOS detected)" : ""}`);
