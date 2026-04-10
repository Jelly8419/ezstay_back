/**
 * setup.js
 * 각 테스트 파일 실행 전 공통 설정
 * - 환경변수 로드
 * - Firebase mock
 * - 외부 API mock (paytagClient, aligoClient, notificationService)
 */

'use strict';

process.env.TZ = 'Asia/Seoul';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.test') });

// ─── Firebase 전체 mock ───────────────────────────────────────────
// config/firebaseAdmin.js 가 요구하는 환경변수 세팅
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';

jest.mock('../../config/firebaseAdmin', () => ({
  createChatRoomMetadata: jest.fn().mockResolvedValue('test-chat-room-id'),
  sendSystemMessage:      jest.fn().mockResolvedValue(true),
  setChatWritableUntil:   jest.fn().mockResolvedValue(true),
  setReadOnly:            jest.fn().mockResolvedValue(true),
  getChatRoom:            jest.fn().mockResolvedValue(null),
}));

// ─── firebase-admin 직접 import 차단 ─────────────────────────────
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        set: jest.fn().mockResolvedValue(true),
        get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        update: jest.fn().mockResolvedValue(true),
      })),
    })),
  })),
  apps: [],
}));

// ─── PayTag PG mock ───────────────────────────────────────────────
jest.mock('../../utils/paytagClient', () => ({
  confirmPayment: jest.fn().mockResolvedValue({
    resultcode: '0000',
    recv_orderno: 'TEST_PG_ORDER_001',
    trandate: '20260410',
    amt: '500000',
    tran_key: 'test_tran_key',
    loginid: 'test_login',
  }),
  cancelPayment: jest.fn().mockResolvedValue({
    resultcode: '0000',
    recv_orderno: 'TEST_PG_ORDER_001',
  }),
  cancelOrder: jest.fn().mockResolvedValue({ resultcode: '0000' }),
  // 실제 로직이 필요한 순수 함수들은 그대로 사용
  extractCancelParams:        jest.requireActual('../../utils/paytagClient').extractCancelParams,
  mapPaymentMethod:           jest.requireActual('../../utils/paytagClient').mapPaymentMethod,
  mapContractPaymentMethod:   jest.requireActual('../../utils/paytagClient').mapContractPaymentMethod,
  mapEasyPayProvider:         jest.requireActual('../../utils/paytagClient').mapEasyPayProvider,
  getTestAmount:              jest.requireActual('../../utils/paytagClient').getTestAmount,
  isTestAmountMode:           jest.requireActual('../../utils/paytagClient').isTestAmountMode,
  validateConfig:             jest.fn(),
}));

// ─── 알리고 카카오톡 mock ─────────────────────────────────────────
jest.mock('../../utils/aligoClient', () => ({
  sendAlimtalk: jest.fn().mockResolvedValue({ success: true }),
  sendSms:      jest.fn().mockResolvedValue({ success: true }),
}), { virtual: true });

// ─── Bull 큐 mock (알림 큐) ───────────────────────────────────────
jest.mock('bull', () => {
  const mockQueue = {
    add:     jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    process: jest.fn(),
    on:      jest.fn(),
    close:   jest.fn().mockResolvedValue(true),
  };
  return jest.fn(() => mockQueue);
});

// ─── Redis mock ───────────────────────────────────────────────────
jest.mock('../../config/redis', () => ({
  get:    jest.fn().mockResolvedValue(null),
  set:    jest.fn().mockResolvedValue('OK'),
  del:    jest.fn().mockResolvedValue(1),
  exists: jest.fn().mockResolvedValue(0),
}), { virtual: true });
