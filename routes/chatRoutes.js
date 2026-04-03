const express = require('express');
const router = express.Router();
const {
  getCustomToken,
  createChatRoom,
  getMyChatRooms,
  getChatRoomDetail,
  getChatRoomByContractId,
  sendTestSystemMessage,
  notifyChatMessage,
  markChatAsRead
} = require('../controllers/chatController');
const { authenticateToken } = require('../middleware/auth');
const { chatReadLimiter, chatNotifyLimiter } = require('../middleware/rateLimiter');

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

// 시스템 메시지 테스트 발송 (개발/테스트용)
router.post('/rooms/:chatRoomId/system-message', authenticateToken, sendTestSystemMessage);

// 채팅 메시지 알림 요청 (프론트에서 메시지 전송 시 호출)
router.post('/rooms/:chatRoomId/notify', authenticateToken, chatNotifyLimiter, notifyChatMessage);

// 채팅방 읽음 처리 (프론트에서 채팅방 진입/포커스 시 호출)
router.post('/rooms/:chatRoomId/read', authenticateToken, chatReadLimiter, markChatAsRead);

module.exports = router;
