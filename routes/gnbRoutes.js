const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getBadgeStatus } = require('../controllers/notificationController');

/**
 * @route   GET /api/gnb/badge-status
 * @desc    GNB 배지 상태 조회 (알림 읽지 않은 수 + 채팅 레드닷)
 * @access  Private
 * @query   userMode (optional): 'guest' | 'host' (없으면 둘 다 조회)
 */
router.get('/badge-status', authenticateToken, getBadgeStatus);

module.exports = router;
