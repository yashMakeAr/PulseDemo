import "core-js/stable";
import "regenerator-runtime/runtime";
import * as THREE from "three";
import { MindARThree } from "mind-ar/dist/mindar-face-three.prod.js";

// CRITICAL: Disable XNNPACK to prevent Samsung crashes
if (typeof window !== "undefined") {
  window.MEDIAPIPE_DISABLE_XNNPACK = true;
}

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

// Detect if device is likely to have issues (Samsung, high-res displays)
const isProblematicDevice = () => {
  const ua = navigator.userAgent.toLowerCase();
  const isSamsung = ua.includes("samsung") || ua.includes("sm-");
  const isHighDPI = window.devicePixelRatio > 2;
  return isSamsung || isHighDPI;
};

// Adaptive camera constraints based on device
async function getConstrainedCameraStream() {
  const problematic = isProblematicDevice();

  const constraints = {
    video: {
      facingMode: "user",
      // Lower resolution for problematic devices
      width: { ideal: problematic ? 480 : 640 },
      height: { ideal: problematic ? 360 : 480 },
      frameRate: { ideal: 30, max: 30 }, // Limit frame rate
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

  // Reduce geometry complexity for better performance
  const buildingGeom = new THREE.BoxGeometry(0.5, 1.5, 0.5, 1, 1, 1);

  for (let i = 0; i < 20; i++) {
    const mat = new THREE.MeshPhongMaterial({
      color: new THREE.Color().setHSL(Math.random(), 0.5, 0.5),
      flatShading: true, // Better performance
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
  const problematic = isProblematicDevice();

  mindarThree = new MindARThree({
    container: document.querySelector("#container"),
    maxTrack: 1,
    // More conservative filtering for problematic devices
    filterMinCF: problematic ? 0.01 : 0.001,
    filterBeta: problematic ? 10 : 1000,
    workerUrl: new URL("mindar-face-worker.js", import.meta.url).href,
    wasmUrl: new URL("mindar-face.wasm", import.meta.url).href,
  });

  const { renderer, scene } = mindarThree;

  // Optimize renderer for mobile
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2x
  renderer.powerPreference = "high-performance";

  // Disable antialiasing on problematic devices for better performance
  if (problematic) {
    renderer.antialias = false;
  }

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(0, 1, 1);
  scene.add(dir);

  // Skip environment map on problematic devices to reduce memory
  if (!problematic) {
    try {
      const env = new THREE.CubeTextureLoader()
        .setPath("/textures/cubemap/")
        .load(["px.jpg", "nx.jpg", "py.jpg", "ny.jpg", "pz.jpg", "nz.jpg"]);
      scene.environment = env;
    } catch {
      console.warn("Env map skipped");
    }
  }

  createBackground(scene);

  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3, 1, 1, 1); // Simplified geometry

  // Use simpler material on problematic devices
  const mat = problematic
    ? new THREE.MeshPhongMaterial({
        color: COLORS.normal,
        shininess: 30,
      })
    : new THREE.MeshPhysicalMaterial({
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

  try {
    await setup();
  } catch (err) {
    console.error("Setup failed:", err);
    updateStatus("Setup failed: " + err.message);
    return;
  }

  const videoEl = document.querySelector("#camera-preview");
  videoEl.setAttribute("playsinline", true);
  videoEl.setAttribute("webkit-playsinline", true); // iOS fix
  videoEl.muted = true;

  const enable = async () => {
    document.body.removeEventListener("click", enable);
    updateStatus("Starting camera...");

    try {
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
    } catch (err) {
      console.error("Start failed:", err);
      updateStatus("Failed to start: " + err.message);
    }
  };

  document.body.addEventListener("click", enable);
  updateStatus("👆 Tap to start camera");
}

// Add error boundary
window.addEventListener("error", (e) => {
  console.error("Global error:", e.error);
  updateStatus("Error: " + e.message);
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection:", e.reason);
  updateStatus("Error: " + e.reason);
});

start();
