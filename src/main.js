import "./style.css";
import * as THREE from "three";
import { MindARThree } from "mind-ar/dist/mindar-face-three.prod.js";

let mindarThree = null;
let cube = null;
let originalColor = 0x00ff00;
let alertColor = 0xff0000;

const MOUTH_BLOW_THRESHOLD = 0.2;

const setup = async () => {
  // Initialize MindAR but DO NOT append video to DOM
  mindarThree = new MindARThree({
    container: document.querySelector("#container"),
    // hide video, only use for tracking
    maxTrack: 1,
    filterMinCF: 0.001,
  });

  const { renderer, scene, camera } = mindarThree;

  // Add lighting
  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  scene.add(light);

  // Create cube
  const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const material = new THREE.MeshPhongMaterial({ color: originalColor });
  cube = new THREE.Mesh(geometry, material);

  // Anchor for face tracking
  const anchor = mindarThree.addAnchor(0); // first face
  anchor.group.add(cube);

  cube.position.set(0, 0.5, 0);

  updateStatus("Setup complete. Starting camera...");
};

const start = async () => {
  try {
    if (!mindarThree) await setup();

    await mindarThree.start();
    const { renderer, scene, camera, video } = mindarThree;

    updateStatus("Tracking active. Open your mouth to change cube color!");

    // Mirror camera feed to the small video preview
    const videoEl = document.querySelector("#camera-preview");
    if (video && videoEl) {
      videoEl.srcObject = video.srcObject || video.captureStream();
    }

    // Hide MindAR internal video (prevent rendering behind cube)
    video.style.display = "none";

    // Animation loop
    renderer.setAnimationLoop(() => {
      const estimate = mindarThree.getLatestEstimate();
      if (estimate && estimate.blendshapes)
        handleBlendshapes(estimate.blendshapes);

      renderer.render(scene, camera);
    });
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

  if (
    funnelScore > MOUTH_BLOW_THRESHOLD ||
    puckerScore > MOUTH_BLOW_THRESHOLD
  ) {
    cube.material.color.setHex(alertColor);
    updateStatus(
      `Blowing Air! Funnel: ${(funnelScore * 100).toFixed(0)}%, Pucker: ${(
        puckerScore * 100
      ).toFixed(0)}%`
    );
  } else {
    cube.material.color.setHex(originalColor);
    updateStatus(
      `Tracking... Funnel: ${(funnelScore * 100).toFixed(0)}%, Pucker: ${(
        puckerScore * 100
      ).toFixed(0)}%`
    );
  }
};

const updateStatus = (msg) => {
  const statusEl = document.querySelector("#status");
  if (statusEl) statusEl.textContent = msg;
};

start();
