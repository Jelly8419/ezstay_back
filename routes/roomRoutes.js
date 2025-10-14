const express = require('express');
const router = express.Router();
const { createRoom, getRooms, getRoomById, getRoomsForMap } = require('../controllers/roomController');
const { validateRoomData } = require('../middleware/validation');

router.post('/register', validateRoomData, createRoom);
router.get('/map', getRoomsForMap); // 지도 조회는 :id보다 먼저 선언
router.get('/', getRooms);
router.get('/:id', getRoomById);

module.exports = router;