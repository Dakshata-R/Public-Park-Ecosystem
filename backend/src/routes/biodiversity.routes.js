'use strict';

const express = require('express');
const controller = require('../controllers/biodiversity.controller');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idParam, listQuery } = require('../validators/common');
const { biodiversity } = require('../validators/schemas');

const router = express.Router();

// --- Indices (the mathematical core of the module) -------------------------
router.get('/indices', controller.getIndices);
router.post('/indices/preview', validate({ body: biodiversity.previewIndices }), controller.previewIndices);
router.get('/compare', controller.compareParks);
router.get('/seasonality', controller.getSeasonality);

// --- Species catalogue -----------------------------------------------------
router.get('/species', validate({ query: listQuery }), controller.species.list);
router.get('/species/:id', validate({ params: idParam }), controller.species.getOne);
router.get('/species/:id/observations', validate({ params: idParam }), controller.getSpeciesObservations);

router.post('/species', requireAuth, requireRole('ecologist'), validate({ body: biodiversity.createSpecies }), controller.species.create);
router.patch('/species/:id', requireAuth, requireRole('ecologist'), validate({ params: idParam, body: biodiversity.updateSpecies }), controller.species.update);
router.delete('/species/:id', requireAuth, requireRole('admin'), validate({ params: idParam }), controller.species.remove);

// --- Observations ----------------------------------------------------------
router.get('/observations', validate({ query: listQuery }), controller.observations.list);
router.get('/observations/:id', validate({ params: idParam }), controller.observations.getOne);

// Any signed-in user may record a sighting; only an ecologist can verify one,
// because verification is what admits the record into the indices.
router.post('/observations', requireAuth, validate({ body: biodiversity.createObservation }), controller.observations.create);
router.patch('/observations/:id', requireAuth, requireRole('ecologist'), validate({ params: idParam, body: biodiversity.updateObservation }), controller.observations.update);
router.delete('/observations/:id', requireAuth, requireRole('ecologist'), validate({ params: idParam }), controller.observations.remove);
router.post(
  '/observations/:id/verify',
  requireAuth,
  requireRole('ecologist'),
  validate({ params: idParam, body: biodiversity.verifyObservation }),
  controller.verifyObservation
);

module.exports = router;
