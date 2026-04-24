const express = require('express');
const router = express.Router();
const { getLaunchStatus } = require('../controllers/systemController');

/**
 * 서비스 런칭 여부 조회 (프론트 초기화 시 1회 호출)
 * - 비로그인 가능
 * - LAUNCH_HOST_2026.startAt 값으로 파생
 */
router.get('/launch-status', getLaunchStatus);

module.exports = router;
