const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const { getActivePromotions } = require('../controllers/promotionController');

/**
 * 진행 중인 프로모션 이벤트 조회
 * - 비로그인 가능 (배너/모달 노출용)
 * - 로그인 시 본인 참여 여부 포함
 */
router.get('/active', optionalAuth, getActivePromotions);

module.exports = router;
