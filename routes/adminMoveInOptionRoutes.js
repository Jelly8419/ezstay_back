/**
 * adminMoveInOptionRoutes.js
 * 관리자 — 입주 준비 서비스 임차인 옵션 카탈로그 라우트
 *
 * Mount: /api/admin/move-in/options  (server.js 에서 마운트)
 * Auth:  authenticateAdmin (라우트 단위)
 */

const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/auth');
const {
  listOptions,
  getOption,
  createOption,
  updateOption,
  deactivateOption
} = require('../controllers/adminMoveInOptionController');

/**
 * @route GET /api/admin/move-in/options
 * @desc  옵션 카탈로그 목록 (페이지네이션 + 필터)
 */
router.get('/options', authenticateAdmin, listOptions);

/**
 * @route POST /api/admin/move-in/options
 * @desc  옵션 신규 등록
 */
router.post('/options', authenticateAdmin, createOption);

/**
 * @route GET /api/admin/move-in/options/:optionId
 * @desc  옵션 단건 조회 (활성 사용 라인 수 포함)
 */
router.get('/options/:optionId', authenticateAdmin, getOption);

/**
 * @route PATCH /api/admin/move-in/options/:optionId
 * @desc  옵션 수정 (부분 업데이트)
 */
router.patch('/options/:optionId', authenticateAdmin, updateOption);

/**
 * @route DELETE /api/admin/move-in/options/:optionId
 * @desc  옵션 비활성화 (Soft, is_active=false)
 */
router.delete('/options/:optionId', authenticateAdmin, deactivateOption);

module.exports = router;
