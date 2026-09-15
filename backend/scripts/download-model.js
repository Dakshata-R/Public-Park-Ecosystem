'use strict';

/**
 * Download and verify the MobileNetV2 checkpoint (~14 MB) into
 * `backend/.cache/mobilenet-v2/`.
 *
 * The API downloads it on first use anyway; running this during a deployment
 * build means the first image analysis after a deploy does not wait for it,
 * and a blocked download fails the build loudly instead of a user request.
 *
 *   npm run model:download
 */

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const vision = require('../src/services/vision.service');

vision
  .loadModel()
  .then(() => {
    const state = vision.modelState();
    console.log(`MobileNetV2 ready (${state.source}, TensorFlow.js backend: ${state.backend}).`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`Model download failed: ${err.message}`);
    process.exit(1);
  });
