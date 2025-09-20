// app.module.js — iPhone-safe version
import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
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

function setStatus(msg){
  statusEl.textContent = msg;
  console.log("[AMV]", msg);
}

function isiOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function pickMimeType(){
  // Prefer MP4 on Safari/iOS
  const mp4 = 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"';
  const webm_vp9 = 'video/webm;codecs=vp9,opus';
  const webm_vp8 = 'video/webm;codecs=vp8,opus';

  if (window.MediaRecorder) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mp4)) return mp4;
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(webm_vp9)) return webm_vp9;
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(webm_vp8)) return webm_vp8;
    return ''; // let the browser choose
  }
  return null;
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

async function readFileAudio(file){
  const arrayBuf = await file.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(arrayBuf.slice(0));
  return {ctx, buf};
}

function analyzeBeatsOffline(buf){
  const channel = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const hop = Math.floor(sr * 0.05);
  const energies = [];
  for (let i=0;i<channel.length;i+=hop){
    let s = 0;
    for (let j=0;j<hop && i+j<channel.length;j++){ const v = channel[i+j]; s += v*v; }
    energies.push(Math.sqrt(s/hop));
  }
  const win = 20;
  const peaks = [];
  for (let i=win;i<energies.length-win;i++){
    let avg = 0;
    for (let k=i-win;k<i+win;k++) avg += energies[k];
    avg /= (2*win);
    const e = energies[i];
    if (e > avg * 1.35){
      const t = (i*hop)/sr;
      peaks.push(t);
      i += 6;
    }
  }
  return peaks;
}

function storyboard(duration, lyrics){
  const cams = ["wide","medium","close"];
  const N = 12;
  const shots = [];
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
    const start = (i/N)*duration;
    const end   = ((i+1)/N)*duration;
    const isChorus = (i % 3 === 1) && chorusLine;
    const theme = isChorus ? chorusLine : (lines[i % (lines.length||1)] || "fun colorful scene");
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

async function setBgImageFromSpace(shot, style, spaceUrl){
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
        else if (data.data[0]?.data && data.data[0].data.startsWith("data:image/")) b64 = data.data[0].data;
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
  const near = 0.12;
  for (const bt of beatTimes){
    if (Math.abs(bt - tSec) < near){ bounce = 0.35; break; }
  }
  singer.position.y = 1.2 + bounce;
  renderer.render(scene, camera);
}

async function recordCanvasWithAudio_iOS(durationSec, audioEl, mimeType){
  // iOS-specific: build stream after user gesture, prefer MP4
  const recordedChunks = [];
  const stream = canvas.captureStream(30);

  // Create AudioContext AFTER user gesture
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === "suspended") { await actx.resume(); }

  const source = actx.createMediaElementSource(audioEl);
  const dest = actx.createMediaStreamDestination();
  source.connect(dest);
  source.connect(actx.destination);

  const mixed = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);

  let options = {};
  if (mimeType) options.mimeType = mimeType;
  const mr = new MediaRecorder(mixed, options);
  mr.ondataavailable = (e)=> { if (e.data && e.data.size) recordedChunks.push(e.data); };
  mr.start();
  await new Promise(r => setTimeout(r, durationSec*1000 + 700));
  mr.stop();
  await new Promise(r => mr.onstop = r);

  const type = mimeType && mimeType.includes("mp4") ? "video/mp4" : "video/webm";
  return new Blob(recordedChunks, {type});
}

genBtn.onclick = async () => {
  try{
    downloadEl.innerHTML = "";
    setStatus("Preparing...");

    const file = audioEl.files?.[0];
    if (!file){ setStatus("Please choose an audio file."); return; }

    // Decode the audio FIRST (this can be slow on mobile)
    setStatus("Loading audio...");
    const {buf} = await readFileAudio(file);
    const duration = buf.duration;

    setStatus("Analyzing beats...");
    const beatTimes = analyzeBeatsOffline(buf);

    setStatus("Building 3D scene...");
    if (!renderer) await setupThree();

    const objUrl = URL.createObjectURL(file);
    const hiddenAudio = new Audio(objUrl);
    hiddenAudio.crossOrigin = "anonymous";
    hiddenAudio.preload = "auto";
    hiddenAudio.loop = false;

    const shots = storyboard(duration, lyricsEl.value);
    const spaceUrl = spaceEl.value.trim();
    const style = styleEl.value.trim();

    if (spaceUrl){
      setStatus("Generating AI backgrounds…");
      for (let i=0;i<shots.length;i++){
        const ok = await setBgImageFromSpace(shots[i], style, spaceUrl);
        if (!ok) setBgColor(i);
        await new Promise(r=>setTimeout(r, 150));
      }
    }

    let startTime;
    running = true;
    function loop(ts){
      if (!running) return;
      if (!startTime) startTime = ts;
      const tSec = (ts - startTime)/1000;
      let idx = 0;
      for (let i=0;i<shots.length;i++){ if (tSec >= shots[i].start && tSec < shots[i].end){ idx = i; break; } }
      const cam = shots[idx].camera;
      camera.fov = cam==="close"? 35 : cam==="medium" ? 50 : 65;
      camera.updateProjectionMatrix();
      if (!spaceUrl) setBgColor(idx);
      animateFrame(tSec, beatTimes);
      if (tSec < duration) requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // iOS requires user gesture: we are in it now; unlock audio & start
    const mime = pickMimeType();
    if (!window.MediaRecorder){
      setStatus("MediaRecorder is not supported on this browser/device.");
      running = false;
      return;
    }
    setStatus(`Rendering to video… (${mime || 'auto mime'})`);

    // Start playback AFTER AudioContext is allowed by gesture
    await hiddenAudio.play();

    // iOS-safe recording
    const blob = await recordCanvasWithAudio_iOS(duration, hiddenAudio, mime);

    running = false;
    stopBtn.disabled = true; genBtn.disabled = false;

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
    setStatus("Error: " + (e?.message || e));
    running = false;
    stopBtn.disabled = true; genBtn.disabled = false;
  }
};

stopBtn.onclick = () => {
  running = false;
  stopBtn.disabled = true; genBtn.disabled = false;
  setStatus("Stopped");
};

setStatus(`Ready ${isiOS() ? "(iOS detected)" : ""}`);
