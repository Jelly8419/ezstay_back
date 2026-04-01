const admin = require('firebase-admin');

/**
 * Firebase Admin SDK 초기화
 * Firestore 및 Authentication 사용을 위한 설정
 */

let firebaseApp;

const initializeFirebase = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // 환경변수 검증
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
      throw new Error('Firebase 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.');
    }

    // Private Key 포맷 처리 (환경변수에서 \n을 실제 개행문자로 변환)
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

    // Firebase Admin SDK 초기화
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey
      }),
      projectId: process.env.FIREBASE_PROJECT_ID
    });

    console.log('✅ Firebase Admin SDK 초기화 성공');
    return firebaseApp;
  } catch (error) {
    console.error('❌ Firebase Admin SDK 초기화 실패:', error.message);
    throw error;
  }
};

/**
 * Firestore 인스턴스 가져오기
 */
const getFirestore = () => {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return admin.firestore();
};

/**
 * Firebase Auth 인스턴스 가져오기
 */
const getAuth = () => {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return admin.auth();
};

/**
 * Firebase Custom Token 생성
 * @param {string} uid - 사용자 ID (백엔드 DB의 User ID)
 * @param {object} additionalClaims - 추가 클레임 (선택사항)
 * @returns {Promise<string>} Custom Token
 */
const createCustomToken = async (uid, additionalClaims = {}) => {
  try {
    const auth = getAuth();
    const customToken = await auth.createCustomToken(String(uid), additionalClaims);
    return customToken;
  } catch (error) {
    console.error('Firebase Custom Token 생성 실패:', error);
    throw error;
  }
};

/**
 * Firestore에 채팅방 메타데이터 생성
 * @param {string} chatRoomId - 채팅방 ID (예: contract_123)
 * @param {object} metadata - 채팅방 메타데이터
 */
const createChatRoomMetadata = async (chatRoomId, metadata) => {
  try {
    const db = getFirestore();
    await db.collection('chatRooms').doc(chatRoomId).set({
      ...metadata,
      hostId: String(metadata.hostId),
      guestId: String(metadata.guestId),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageText: null,
      lastMessageSenderId: null,
      lastMessageAt: null,
      unreadCount: {
        [String(metadata.hostId)]: 0,
        [String(metadata.guestId)]: 0
      }
    });
    console.log(`✅ 채팅방 메타데이터 생성 완료: ${chatRoomId}`);
  } catch (error) {
    console.error('Firestore 채팅방 메타데이터 생성 실패:', error);
    throw error;
  }
};

/**
 * Firestore에서 채팅방 메타데이터 조회
 * @param {string} chatRoomId - 채팅방 ID
 * @returns {Promise<object|null>} 채팅방 메타데이터
 */
const getChatRoomMetadata = async (chatRoomId) => {
  try {
    const db = getFirestore();
    const doc = await db.collection('chatRooms').doc(chatRoomId).get();

    if (!doc.exists) {
      return null;
    }

    return {
      id: doc.id,
      ...doc.data()
    };
  } catch (error) {
    console.error('Firestore 채팅방 메타데이터 조회 실패:', error);
    throw error;
  }
};

/**
 * Firestore에서 사용자의 채팅방 목록 조회
 * @param {number} userId - 사용자 ID
 * @returns {Promise<Array>} 채팅방 목록
 */
const getUserChatRooms = async (userId) => {
  try {
    const db = getFirestore();

    // hostId 또는 guestId가 일치하는 채팅방 조회
    const hostRoomsSnapshot = await db.collection('chatRooms')
      .where('hostId', '==', userId)
      .orderBy('updatedAt', 'desc')
      .get();

    const guestRoomsSnapshot = await db.collection('chatRooms')
      .where('guestId', '==', userId)
      .orderBy('updatedAt', 'desc')
      .get();

    const rooms = [];

    hostRoomsSnapshot.forEach(doc => {
      rooms.push({ id: doc.id, ...doc.data() });
    });

    guestRoomsSnapshot.forEach(doc => {
      rooms.push({ id: doc.id, ...doc.data() });
    });

    // updatedAt 기준으로 재정렬 (최신순)
    rooms.sort((a, b) => {
      const aTime = a.updatedAt?._seconds || 0;
      const bTime = b.updatedAt?._seconds || 0;
      return bTime - aTime;
    });

    return rooms;
  } catch (error) {
    console.error('Firestore 사용자 채팅방 목록 조회 실패:', error);
    throw error;
  }
};

/**
 * 채팅방 비활성화 (계약 완료/취소 시)
 * @param {string} chatRoomId - 채팅방 ID
 */
const deactivateChatRoom = async (chatRoomId) => {
  try {
    const db = getFirestore();
    await db.collection('chatRooms').doc(chatRoomId).update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ 채팅방 비활성화 완료: ${chatRoomId}`);
  } catch (error) {
    console.error('Firestore 채팅방 비활성화 실패:', error);
    throw error;
  }
};

/**
 * 채팅 쓰기 마감 시각 설정 (보증금 반환 완료 시점 + 24H)
 * @param {string} chatRoomId - 채팅방 ID
 * @param {Date} depositReturnedAt - 보증금 반환 완료 시점
 */
const setChatWritableUntil = async (chatRoomId, depositReturnedAt) => {
  try {
    const db = getFirestore();
    const writableUntil = new Date(); // 로컬 테스트용: 즉시 종료 (원래: depositReturnedAt + 24H)

    // 문서 존재 여부 확인 — 없으면 스킵 (Firestore 미생성 채팅방)
    const doc = await db.collection('chatRooms').doc(chatRoomId).get();
    if (!doc.exists) {
      console.warn(`⚠️ Firestore 채팅방 문서 없음, 스킵: ${chatRoomId}`);
      return;
    }

    await db.collection('chatRooms').doc(chatRoomId).update({
      chatWritableUntil: admin.firestore.Timestamp.fromDate(writableUntil),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ 채팅 쓰기 마감 시각 설정 완료: ${chatRoomId} → ${writableUntil.toISOString()}`);
  } catch (error) {
    console.error('Firestore 채팅 쓰기 마감 시각 설정 실패:', error);
    throw error;
  }
};

/**
 * 시스템 메시지 발송
 * @param {string} chatRoomId - 채팅방 ID (예: contract_123)
 * @param {string} text - 메시지 내용
 * @param {string} systemMessageType - 시스템 메시지 타입
 * @param {object} metadata - 추가 메타데이터 (선택)
 * @returns {Promise<object>} 생성된 시스템 메시지 정보
 */
const sendSystemMessage = async (chatRoomId, text, systemMessageType, metadata = {}) => {
  try {
    const db = getFirestore();

    // 채팅방 문서 존재 여부 확인
    const chatRoomRef = db.collection('chatRooms').doc(chatRoomId);
    const chatRoomDoc = await chatRoomRef.get();
    if (!chatRoomDoc.exists) {
      console.warn(`⚠️ 채팅방이 존재하지 않아 시스템 메시지 발송 스킵: ${chatRoomId}`);
      return null;
    }

    const systemMessage = {
      chatRoomId,
      senderId: null,
      senderName: '시스템',
      text,
      type: 'system',
      systemMessageType,
      metadata,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),  // 프론트엔드 호환
      createdAt: admin.firestore.FieldValue.serverTimestamp(),  // 백엔드 호환 (유지)
      readBy: []
    };

    // messages 서브컬렉션에 추가
    const messageRef = await chatRoomRef
      .collection('messages')
      .add(systemMessage);

    // 채팅방 메타데이터 업데이트 (마지막 메시지 정보)
    await chatRoomRef.update({
      lastMessageText: text,
      lastMessageSenderId: null,
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ 시스템 메시지 발송 완료: ${chatRoomId} - ${systemMessageType}`);
    return {
      id: messageRef.id,
      ...systemMessage
    };
  } catch (error) {
    console.error('시스템 메시지 발송 실패:', error);
    throw error;
  }
};

module.exports = {
  initializeFirebase,
  getFirestore,
  getAuth,
  createCustomToken,
  createChatRoomMetadata,
  getChatRoomMetadata,
  getUserChatRooms,
  deactivateChatRoom,
  setChatWritableUntil,
  sendSystemMessage
};
