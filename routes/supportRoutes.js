const express = require('express');
const router = express.Router();
const noticeController = require('../controllers/noticeController');
const faqController = require('../controllers/faqController');
const inquiryController = require('../controllers/inquiryController');
const { authenticateToken } = require('../middleware/auth');

/**
 * 공지사항 API (사용자용)
 * 인증 불필요 - 모든 사용자가 조회 가능
 */

// 공지사항 목록 조회
router.get('/notices', noticeController.getNotices);

// 공지사항 상세 조회
router.get('/notices/:id', noticeController.getNoticeById);

/**
 * FAQ API (사용자용)
 * 인증 불필요 - 모든 사용자가 조회 가능
 */

// FAQ 카테고리 목록 조회
router.get('/faq/categories', faqController.getFAQCategories);

// FAQ 목록 조회
router.get('/faqs', faqController.getFAQs);

// FAQ 상세 조회
router.get('/faqs/:id', faqController.getFAQById);

/**
 * 문의 API (사용자용)
 * 인증 필요 - 로그인한 사용자만 접근 가능
 */

// 내 문의 목록 조회
router.get('/inquiries', authenticateToken, inquiryController.getMyInquiries);

// 내 문의 상세 조회
router.get('/inquiries/:id', authenticateToken, inquiryController.getMyInquiryById);

// 문의 등록
router.post('/inquiries', authenticateToken, inquiryController.createInquiry);

// 문의 수정 (답변 전에만 가능)
router.patch('/inquiries/:id', authenticateToken, inquiryController.updateInquiry);

// 문의 삭제 (답변 전에만 가능)
router.delete('/inquiries/:id', authenticateToken, inquiryController.deleteInquiry);

module.exports = router;
