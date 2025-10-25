const express = require('express');
const router = express.Router();
const {
  getCustomToken,
  createChatRoom,
  getMyChatRooms,
  getChatRoomDetail,
  getChatRoomByContractId
} = require('../controllers/chatController');
const { authenticateToken } = require('../middleware/auth');

/**
 * 채팅 API 라우트
 * Base: /api/chats
 */

// Firebase Custom Token 발급 (클라이언트 Firebase 로그인용)
router.get('/custom-token', authenticateToken, getCustomToken);

// 채팅방 생성 (계약 승인 시 자동 호출)
router.post('/rooms', authenticateToken, createChatRoom);

// 내 채팅방 목록 조회
router.get('/rooms', authenticateToken, getMyChatRooms);

// 채팅방 상세 정보 조회
router.get('/rooms/:chatRoomId', authenticateToken, getChatRoomDetail);

// 계약 ID로 채팅방 조회
router.get('/contracts/:contractId/room', authenticateToken, getChatRoomByContractId);

module.exports = router;
