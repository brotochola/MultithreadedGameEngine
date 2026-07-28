// Deprecated entry — pthread pool must spawn box2d_wasm.js, not this file.
// index.html loads box2d_wasm.js directly (physics_post.js is appended there).
console.error(
  "[physics] physics.worker.js is not the worker entry. Use box2d_wasm.js instead.",
);
postMessage({
  type: "ERROR",
  message:
    "Wrong worker URL: use box2d_wasm.js (not physics.worker.js). Rebuild WASM after physics_post.js changes.",
});
