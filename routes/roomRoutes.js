const express = require('express');
const router = express.Router();
const { createRoom, getRooms, getRoomById, getRoomsForMap } = require('../controllers/roomController');
const { validateRoomData } = require('../middleware/validation');
const { roomSearchLimiter } = require('../middleware/rateLimiter');
const { optionalAuth } = require('../middleware/auth');

router.post('/register', validateRoomData, createRoom);
router.get('/map', roomSearchLimiter, getRoomsForMap); // 지도 조회는 :id보다 먼저 선언
router.get('/', getRooms);
router.get('/:id', optionalAuth, getRoomById);

module.exports = router;