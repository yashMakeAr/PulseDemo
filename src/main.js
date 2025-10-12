// Polyfills for Safari & older browsers (ensures async/await, Promises, etc. work)
import "core-js/stable";
import "regenerator-runtime/runtime";

import * as THREE from "three";
import { MindARThree } from "mind-ar/dist/mindar-face-three.prod.js";

let mindarThree = null;
let cube = null;
let originalColor = 0x00ff00;
let alertColor = 0xff0000;

const MOUTH_BLOW_THRESHOLD = 0.5;

// Background movement variables
let backgroundSpeed = 0;
let targetSpeed = 0;
const MAX_SPEED = 0.5;
const ACCELERATION = 0.002;
const DECELERATION = 0.001;

// Background elements
let backgroundGroup = null;
let buildings = [];

const createBackground = (scene) => {
  backgroundGroup = new THREE.Group();
  scene.add(backgroundGroup);

  const buildingGeometry = new THREE.BoxGeometry(0.5, 1.5, 0.5);
  const buildingCount = 20;

  for (let i = 0; i < buildingCount; i++) {
    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color().setHSL(Math.random(), 0.5, 0.5),
    });
    const building = new THREE.Mesh(buildingGeometry, material);

    const side = Math.random() > 0.5 ? 1 : -1;
    const xPos = side * (3.5 + Math.random() * 1.5);
    const zPos = -2 - i * 2;

    building.scale.y = 1 + Math.random() * 1.5; // random height for variation
    building.position.set(xPos, 0, zPos);
    backgroundGroup.add(building);
    buildings.push(building);
  }
};

const updateBackground = (isBlowing) => {
  targetSpeed = isBlowing ? MAX_SPEED : 0;

  // Smooth acceleration/deceleration for consistent animation across browsers
  if (backgroundSpeed < targetSpeed) {
    backgroundSpeed = Math.min(backgroundSpeed + ACCELERATION, targetSpeed);
  } else if (backgroundSpeed > targetSpeed) {
    backgroundSpeed = Math.max(backgroundSpeed - DECELERATION, targetSpeed);
  }

  backgroundGroup.position.z += backgroundSpeed;

  // Reset buildings once they move out of view
  buildings.forEach((building) => {
    if (building.position.z + backgroundGroup.position.z > 2) {
      building.position.z -= 40;
      const side = Math.random() > 0.5 ? 1 : -1;
      building.position.x = side * (3.5 + Math.random() * 1.5);
      building.scale.y = 1 + Math.random() * 1.5;
    }
  });

  updateSpeedIndicator(backgroundSpeed);
};

const updateSpeedIndicator = (speed) => {
  const speedometer = document.querySelector("#speedometer");
  if (!speedometer) return;

  const percentage = Math.round((speed / MAX_SPEED) * 100);
  speedometer.textContent = `Speed: ${percentage}%`;

  // Dynamic color feedback
  if (percentage > 70) speedometer.style.color = "#ff4444";
  else if (percentage > 30) speedometer.style.color = "#ffaa44";
  else speedometer.style.color = "#44ff44";
};

const setup = async () => {
  // Added Safari-safe worker & wasm paths
  mindarThree = new MindARThree({
    container: document.querySelector("#container"),
    maxTrack: 1,
    filterMinCF: 0.001,
    workerUrl: new URL("mindar-face-worker.js", import.meta.url).href,
    wasmUrl: new URL("mindar-face.wasm", import.meta.url).href,
  });

  const { scene } = mindarThree;

  // Lighting setup
  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  scene.add(light);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(0, 1, 1);
  scene.add(directionalLight);

  // Environment map with try-catch for Safari texture loading issues
  try {
    const envTexture = new THREE.CubeTextureLoader()
      .setPath("/textures/cubemap/")
      .load(
        ["px.jpg", "nx.jpg", "py.jpg", "ny.jpg", "pz.jpg", "nz.jpg"],
        () => console.log("Env map loaded"),
        undefined,
        (err) => console.warn("Env map load failed:", err)
      );
    scene.environment = envTexture;
  } catch (e) {
    console.warn("Safari texture issue:", e);
  }

  // Background setup
  createBackground(scene);

  // Cube setup
  const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const material = new THREE.MeshPhysicalMaterial({
    color: originalColor,
    metalness: 0.8,
    roughness: 0.2,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    reflectivity: 1.0,
    envMapIntensity: 1.0,
    emissive: new THREE.Color(0x00ff00),
    emissiveIntensity: 0.3,
  });

  cube = new THREE.Mesh(geometry, material);
  cube.userData.baseScale = 1;

  const anchor = mindarThree.addAnchor(0);
  anchor.group.add(cube);
  cube.position.set(0, 0.5, 0);

  updateStatus("Setup complete. Tap to start camera...");
};

const start = async () => {
  try {
    if (!mindarThree) await setup();

    const videoEl = document.querySelector("#camera-preview");

    // Safari autoplay fix: muted + playsinline
    videoEl.setAttribute("playsinline", true);
    videoEl.setAttribute("autoplay", true);
    videoEl.muted = true;

    // Safari camera permission workaround — needs user gesture
    const enableCamera = async () => {
      document.body.removeEventListener("click", enableCamera);
      await mindarThree.start();

      const { renderer, camera, video } = mindarThree;

      updateStatus("Tracking active. Blow to move forward!");

      // Keep video preview (your camera) visible at bottom-left only
      if (video && videoEl) {
        videoEl.srcObject = video.srcObject || video.captureStream();
        try {
          await videoEl.play();
        } catch (e) {
          console.warn("Safari blocked video.play():", e);
        }
      }

      // Hide the internal MindAR video (so only your preview shows)
      if (video) video.style.display = "none";

      // Main animation loop
      renderer.setAnimationLoop(() => {
        const estimate = mindarThree.getLatestEstimate();
        let isBlowing = false;

        if (estimate && estimate.blendshapes) {
          isBlowing = handleBlendshapes(estimate.blendshapes);
        }

        // Keep cube scale consistent based on face distance
        if (estimate && typeof estimate.scale === "number") {
          const invScale = 1 / estimate.scale;
          cube.scale.setScalar(cube.userData.baseScale * invScale);
        }

        updateBackground(isBlowing);
        renderer.render(mindarThree.scene, camera);
      });
    };

    // Attach the user interaction listener
    document.body.addEventListener("click", enableCamera);
    updateStatus("👆 Tap anywhere to enable camera");
  } catch (err) {
    console.error(err);
    updateStatus("Error: " + err.message);
  }
};

const handleBlendshapes = (blendshapes) => {
  const funnel = blendshapes.categories.find(
    (c) => c.categoryName === "mouthFunnel"
  );
  const pucker = blendshapes.categories.find(
    (c) => c.categoryName === "mouthPucker"
  );

  const funnelScore = funnel ? funnel.score : 0;
  const puckerScore = pucker ? pucker.score : 0;

  const isBlowing =
    funnelScore > MOUTH_BLOW_THRESHOLD || puckerScore > MOUTH_BLOW_THRESHOLD;

  if (isBlowing) {
    cube.material.color.setHex(alertColor);
    cube.material.metalness = 1;
    cube.material.roughness = 0.05;
    updateStatus(
      `🚀 MOVING FORWARD! Funnel: ${(funnelScore * 100).toFixed(
        0
      )}%, Pucker: ${(puckerScore * 100).toFixed(0)}%`
    );
  } else {
    cube.material.color.setHex(originalColor);
    cube.material.metalness = 0.5;
    cube.material.roughness = 0.5;
    updateStatus(
      `Funnel: ${(funnelScore * 100).toFixed(0)}%, Pucker: ${(
        puckerScore * 100
      ).toFixed(0)}%`
    );
  }

  return isBlowing;
};

const updateStatus = (msg) => {
  const statusEl = document.querySelector("#status");
  if (statusEl) statusEl.textContent = msg;
};

// Start on load
start();
