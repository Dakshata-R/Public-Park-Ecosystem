'use strict';

const express = require('express');
const controller = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { auth } = require('../validators/schemas');

const router = express.Router();

router.post('/register', validate({ body: auth.register }), controller.register);
router.post('/login', validate({ body: auth.login }), controller.login);

router.get('/me', requireAuth, controller.me);
router.patch('/me', requireAuth, validate({ body: auth.updateMe }), controller.updateMe);
router.post('/change-password', requireAuth, validate({ body: auth.changePassword }), controller.changePassword);

module.exports = router;
