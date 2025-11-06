import "core-js/stable";
import "regenerator-runtime/runtime";

// Fix for Samsung TFLite crash
self.Module = {
  tfliteWasmSimdEnabled: false,
  tfliteWasmMultiThreadEnabled: false,
  tfliteXnnpackDelegateEnabled: false,
};

// Optional: hide TensorFlow info logs
const originalConsoleInfo = console.info;
console.info = function (...args) {
  if (!args[0]?.includes?.("TensorFlow Lite")) {
    originalConsoleInfo.apply(console, args);
  }
};

import * as THREE from "three";
import { MindARThree } from "mind-ar/dist/mindar-face-three.prod.js";

let mindarThree = null;
let cube = null;
let backgroundGroup = null;
let buildings = [];

const COLORS = { normal: 0x00ff00, alert: 0xff0000 };
const MOUTH_THRESHOLD = 0.5;
let backgroundSpeed = 0;
let targetSpeed = 0;
const MAX_SPEED = 0.5;
const ACCEL = 0.002;
const DECEL = 0.001;

const updateStatus = (msg) => {
  const el = document.querySelector("#status");
  if (el) el.textContent = msg;
};

// Limit camera resolution for Samsung (prevents WebGL crash)
async function getConstrainedCameraStream() {
  const constraints = {
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.error("Camera init failed:", err);
    updateStatus("Camera access denied: " + err.message);
    throw err;
  }
}

const createBackground = (scene) => {
  backgroundGroup = new THREE.Group();
  scene.add(backgroundGroup);

  const buildingGeom = new THREE.BoxGeometry(0.5, 1.5, 0.5);
  for (let i = 0; i < 20; i++) {
    const mat = new THREE.MeshPhongMaterial({
      color: new THREE.Color().setHSL(Math.random(), 0.5, 0.5),
    });
    const b = new THREE.Mesh(buildingGeom, mat);
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (3.5 + Math.random() * 1.5);
    const z = -2 - i * 2;
    b.scale.y = 1 + Math.random() * 1.5;
    b.position.set(x, 0, z);
    backgroundGroup.add(b);
    buildings.push(b);
  }
};

const updateBackground = (isBlowing) => {
  targetSpeed = isBlowing ? MAX_SPEED : 0;
  backgroundSpeed =
    backgroundSpeed < targetSpeed
      ? Math.min(backgroundSpeed + ACCEL, targetSpeed)
      : Math.max(backgroundSpeed - DECEL, targetSpeed);

  backgroundGroup.position.z += backgroundSpeed;

  buildings.forEach((b) => {
    if (b.position.z + backgroundGroup.position.z > 2) {
      b.position.z -= 40;
      const side = Math.random() > 0.5 ? 1 : -1;
      b.position.x = side * (3.5 + Math.random() * 1.5);
      b.scale.y = 1 + Math.random() * 1.5;
    }
  });

  const speedEl = document.querySelector("#speedometer");
  if (speedEl) {
    const pct = Math.round((backgroundSpeed / MAX_SPEED) * 100);
    speedEl.textContent = `Speed: ${pct}%`;
    speedEl.style.color =
      pct > 70 ? "#ff4444" : pct > 30 ? "#ffaa44" : "#44ff44";
  }
};

const handleBlendshapes = (blendshapes) => {
  const funnel = blendshapes.categories.find(
    (c) => c.categoryName === "mouthFunnel"
  );
  const pucker = blendshapes.categories.find(
    (c) => c.categoryName === "mouthPucker"
  );

  const f = funnel?.score || 0;
  const p = pucker?.score || 0;
  const blowing = f > MOUTH_THRESHOLD || p > MOUTH_THRESHOLD;

  cube.material.color.setHex(blowing ? COLORS.alert : COLORS.normal);
  updateStatus(
    blowing
      ? `🚀 MOVING! Funnel ${(f * 100).toFixed(0)}%, Pucker ${(p * 100).toFixed(
          0
        )}%`
      : `Funnel ${(f * 100).toFixed(0)}%, Pucker ${(p * 100).toFixed(0)}%`
  );
  return blowing;
};

async function setup() {
  mindarThree = new MindARThree({
    container: document.querySelector("#container"),
    maxTrack: 1,
    filterMinCF: 0.001,
    workerUrl: new URL("mindar-face-worker.js", import.meta.url).href,
    wasmUrl: new URL("mindar-face.wasm", import.meta.url).href,
  });

  const { scene } = mindarThree;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(0, 1, 1);
  scene.add(dir);

  try {
    const env = new THREE.CubeTextureLoader()
      .setPath("/textures/cubemap/")
      .load(["px.jpg", "nx.jpg", "py.jpg", "ny.jpg", "pz.jpg", "nz.jpg"]);
    scene.environment = env;
  } catch {
    console.warn("Env map skipped");
  }

  createBackground(scene);

  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const mat = new THREE.MeshPhysicalMaterial({
    color: COLORS.normal,
    metalness: 0.7,
    roughness: 0.3,
    clearcoat: 1.0,
  });
  cube = new THREE.Mesh(geo, mat);
  cube.userData.baseScale = 1;

  const anchor = mindarThree.addAnchor(0);
  anchor.group.add(cube);
  cube.position.set(0, 0.5, 0);
}

async function start() {
  updateStatus("Initializing...");
  await setup();

  const videoEl = document.querySelector("#camera-preview");
  videoEl.setAttribute("playsinline", true);
  videoEl.muted = true;

  const enable = async () => {
    document.body.removeEventListener("click", enable);
    updateStatus("Starting camera...");

    const stream = await getConstrainedCameraStream();
    videoEl.srcObject = stream;
    await videoEl.play();

    await mindarThree.start({ video: videoEl });
    const { renderer, camera } = mindarThree;

    updateStatus("Tracking started — blow to move 🚀");

    renderer.setAnimationLoop(() => {
      const est = mindarThree.getLatestEstimate();
      const blowing = est?.blendshapes
        ? handleBlendshapes(est.blendshapes)
        : false;

      if (est?.scale) {
        const inv = 1 / est.scale;
        cube.scale.setScalar(cube.userData.baseScale * inv);
      }

      updateBackground(blowing);
      renderer.render(mindarThree.scene, camera);
    });
  };

  document.body.addEventListener("click", enable);
  updateStatus("👆 Tap to start camera");
}

start();
