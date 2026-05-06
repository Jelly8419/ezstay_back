/**
 * moveInCaseService.js
 * 입주 준비 등록 (Case) 도메인 서비스
 *
 * - 날짜 겹침 검증 (PRD 16절: 등록 불가 차단)
 * - room_snapshot 빌드
 * - 토큰 발급
 */
const crypto = require('crypto');
const { Op } = require('sequelize');
const { MoveInCase } = require('../models');

/**
 * 동일 방의 날짜가 겹치는 케이스가 존재하는지 확인.
 * 겹침 정의: [checkInDate, checkOutDate) 구간이 다른 케이스와 교차
 *
 * @param {Object} params
 * @param {number} params.moveInRoomId
 * @param {string} params.checkInDate  - 'YYYY-MM-DD'
 * @param {string} params.checkOutDate - 'YYYY-MM-DD'
 * @param {number} [params.excludeCaseId] - 수정 시 자기 자신 제외
 * @param {Object} [transaction]
 * @returns {Promise<MoveInCase|null>} 겹치는 케이스가 있으면 첫 번째 케이스 반환
 */
async function findOverlappingCase({ moveInRoomId, checkInDate, checkOutDate, excludeCaseId }, transaction = null) {
  const where = {
    moveInRoomId,
    checkInDate: { [Op.lt]: checkOutDate },
    checkOutDate: { [Op.gt]: checkInDate }
  };
  if (excludeCaseId) {
    where.id = { [Op.ne]: excludeCaseId };
  }
  return MoveInCase.findOne({
    where,
    transaction: transaction ?? undefined
  });
}

/**
 * MoveInRoom 인스턴스 → 케이스에 락인할 스냅샷 JSON
 * - 비밀번호는 암호문 그대로 보관 (필요 시 cryptoHelper.decrypt 사용)
 */
function buildRoomSnapshot(room) {
  return {
    id: room.id,
    roomName: room.roomName,
    address: room.address,
    detailAddress: room.detailAddress,
    areaPyeong: Number(room.areaPyeong),
    livingRoomCount: room.livingRoomCount,
    roomCount: room.roomCount,
    bathroomCount: room.bathroomCount,
    bedCount: room.bedCount,
    beds: room.beds,
    commonEntrancePassword: room.commonEntrancePassword, // 암호문 그대로
    doorLockPassword: room.doorLockPassword,             // 암호문 그대로
    cleaningSuppliesAvailable: room.cleaningSuppliesAvailable,
    cleaningSuppliesLocation: room.cleaningSuppliesLocation,
    memo: room.memo,
    snapshotAt: new Date().toISOString()
  };
}

/**
 * 결제 요청 토큰 생성 (UUID v4)
 */
function generateRequestToken() {
  return crypto.randomUUID();
}

/**
 * 토큰 만료시각 계산 (퇴실일+1일 23:59:59 KST → Date 객체)
 * @param {string} checkOutDate 'YYYY-MM-DD'
 * @returns {Date}
 */
function calculateTokenExpiresAt(checkOutDate) {
  // KST로 퇴실일+1일 23:59:59
  const expires = new Date(`${checkOutDate}T23:59:59+09:00`);
  expires.setDate(expires.getDate() + 1);
  return expires;
}

module.exports = {
  findOverlappingCase,
  buildRoomSnapshot,
  generateRequestToken,
  calculateTokenExpiresAt
};
