const express = require('express');
const router = express.Router();
const { createRoom, getRooms, getRoomById } = require('../controllers/roomController');
const { validateRoomData } = require('../middleware/validation');

router.post('/register', validateRoomData, createRoom);
router.get('/', getRooms);
router.get('/:id', getRoomById);

module.exports = router;