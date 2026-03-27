/**
 * Notification Routes
 * 알림 관련 API 라우팅
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');

/**
 * @route   GET /api/notifications
 * @desc    알림 목록 조회
 * @access  Private
 * @query   userMode (required): 'guest' | 'host'
 *          page (optional): 페이지 번호 (기본: 1)
 *          limit (optional): 페이지 당 개수 (기본: 20, 최대: 50)
 */
router.get('/', authenticateToken, notificationController.getNotifications);

/**
 * @route   PATCH /api/notifications/mark-all-read
 * @desc    전체 알림 읽음 처리
 * @access  Private
 * @query   userMode (optional): 'guest' | 'host' (없으면 전체)
 */
router.patch('/mark-all-read', authenticateToken, notificationController.markAllAsRead);


module.exports = router;
