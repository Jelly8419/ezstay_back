const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const scheduleController = require('../controllers/scheduleController');

// 모든 라우트에 인증 미들웨어 적용
router.use(authenticateToken);

/**
 * Phase 1: 필수 기능
 */

// 통합 일정 조회 (방 정보, 계약, 불가 기간 한 번에 조회)
router.get('/rooms/:roomId/schedule', scheduleController.getSchedule);

// 계약 불가 기간 생성
router.post('/rooms/:roomId/blocked-periods', scheduleController.createBlockedPeriod);

// 계약 불가 기간 삭제
router.delete('/rooms/:roomId/blocked-periods/:blockedId', scheduleController.deleteBlockedPeriod);

/**
 * Phase 2: 부가 기능
 */

// 계약 불가 기간 부분 해제 (기간 분할)
router.post('/rooms/:roomId/blocked-periods/unblock', scheduleController.unblockPeriod);

// 방의 계약 목록 조회
router.get('/rooms/:roomId/contracts', scheduleController.getContracts);

// 방의 계약 불가 기간 목록 조회 (Phase 1의 통합 조회와 별도)
router.get('/rooms/:roomId/blocked-periods', scheduleController.getBlockedPeriods);

// 방 기본 정보 조회
router.get('/rooms/:roomId/schedule-info', scheduleController.getRoomScheduleInfo);

module.exports = router;
