/**
 * moveInGuestBindService.js
 * 입주 준비 서비스 - 임차인(게스트) 자동 매칭
 *
 * 핵심 책임:
 *   가입/본인인증 등으로 User.phoneNumber 가 채워지거나 변경되는 시점에 호출.
 *   같은 phone 으로 등록된 미연결 MoveInCase 의 guestUserId 를 채워준다.
 *   (PRD 4.4 / 10.2)
 *
 * 동작:
 *   UPDATE move_in_cases
 *      SET guest_user_id = :userId
 *    WHERE guest_phone (정규화) = :phone (정규화)
 *      AND guest_user_id IS NULL
 *
 * 안전성:
 *   - phone/userId 누락 시 NOOP (예외 throw 안 함 — best-effort)
 *   - 호출 실패가 가입 자체를 막으면 안 되므로, 호출처에서 try/catch 로 감싸 사용
 *   - 부모 트랜잭션이 있으면 그대로 사용, 없으면 단일 update
 *
 * 정규화:
 *   - phoneHelper.normalizePhone 으로 양쪽 비교 시 동일 형식 보장 (Q1: B+C 혼합)
 *   - 그러나 이미 저장된 guest_phone 이 raw 형식이라면 매칭 안 될 수 있음
 *     → MoveInCase 생성/수정 시점에서도 정규화 저장으로 일관성 확보 (Option C 부분)
 */

'use strict';

const { Op } = require('sequelize');
const { MoveInCase, User } = require('../models');
const { normalizePhone } = require('../utils/phoneHelper');

/**
 * phone 으로 미연결 케이스를 현재 userId 로 자동 bind.
 *
 * @param {number|null} userId
 * @param {string|null} phone
 * @param {Transaction|null} [transaction]
 * @returns {Promise<{ boundCount: number, normalizedPhone: string|null }>}
 */
async function autoBindByPhone(userId, phone, transaction = null) {
  const normalizedPhone = normalizePhone(phone);

  if (!userId || !normalizedPhone) {
    return { boundCount: 0, normalizedPhone };
  }

  const opts = transaction ? { transaction } : {};

  // raw 데이터 호환을 위해 정규화 후 동일하게 매칭되는 모든 가능한 형태를 OR 로 처리.
  // 다만 raw 가 다양할 수 있어 안전한 방법은 양쪽 모두 정규화하여 비교하는 것.
  // → MoveInCase 생성/수정 시점에서도 정규화 저장하므로, 이후로는 단순 동등 비교만으로 충분.
  // → 과거 데이터(하이픈 포함 등) 호환은 추가 마이그레이션 단계에서 처리 권장.
  const [boundCount] = await MoveInCase.update(
    { guestUserId: userId },
    {
      where: {
        guestPhone: normalizedPhone,
        guestUserId: { [Op.is]: null }
      },
      ...opts
    }
  );

  return { boundCount, normalizedPhone };
}

/**
 * 안전 호출 헬퍼 — 가입/본인인증 컨트롤러에서 부담없이 호출하도록.
 * 내부에서 try/catch + console.error 처리. 가입 자체를 절대 막지 않음.
 *
 * @param {number|null} userId
 * @param {string|null} phone
 * @param {Transaction|null} [transaction]
 * @returns {Promise<{ boundCount: number }>}
 */
async function safeAutoBindByPhone(userId, phone, transaction = null) {
  try {
    const r = await autoBindByPhone(userId, phone, transaction);
    if (r.boundCount > 0) {
      console.log(
        `[moveInGuestBind] userId=${userId} phone=${r.normalizedPhone} bound=${r.boundCount}`
      );
    }
    return { boundCount: r.boundCount };
  } catch (err) {
    console.error('[moveInGuestBind] autoBindByPhone failed:', err.message);
    return { boundCount: 0 };
  }
}

/**
 * 반대 방향 — 케이스 생성 시점에 이미 가입된 임차인이 있다면 그 즉시 bind.
 * (임대인이 케이스 등록 시 호출)
 *
 * @param {string|null} guestPhone (정규화된 형식 권장)
 * @returns {Promise<{ userId: number|null }>}
 */
async function findGuestUserIdByPhone(guestPhone, transaction = null) {
  const normalized = normalizePhone(guestPhone);
  if (!normalized) return { userId: null };

  const opts = transaction ? { transaction } : {};
  const user = await User.findOne({
    where: {
      phoneNumber: normalized,
      phoneVerified: true
    },
    attributes: ['id'],
    ...opts
  });
  return { userId: user ? user.id : null };
}

module.exports = {
  autoBindByPhone,
  safeAutoBindByPhone,
  findGuestUserIdByPhone
};
