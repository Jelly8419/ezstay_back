/**
 * guestMoveInInviteController.js
 * 입주 준비 서비스 — 임차인 비로그인 진입 / bind
 *
 * Routes:
 *   GET  /api/guest/move-in/invite/:token       (optionalAuth)
 *   POST /api/guest/move-in/invite/:token/bind  (authenticateToken 필요)
 *
 * 비로그인 미리보기 (GET):
 *   - 토큰 유효성 + 만료 검증
 *   - 케이스 + 옵션 카탈로그 + 결제 마감일 응답
 *   - 청소 정보 / 비밀번호 절대 노출 X (serializer 강제)
 *   - 로그인 + phone 매칭된 경우 detail_address 풀 노출
 *
 * Bind (POST):
 *   - 로그인 필수
 *   - User.phoneNumber == case.guestPhone 확인 후 guestUserId 갱신
 *   - 이미 다른 유저로 bound 되어 있으면 거절 (보안)
 */

'use strict';

const {
  MoveInCase,
  MoveInPaymentRequest,
  MoveInOption
} = require('../models');
const {
  ErrorCodes,
  success,
  error
} = require('../utils/responseHelper');
const {
  serializeGuestCase,
  serializeOption
} = require('../utils/moveInGuestSerializer');
const { isSamePhone } = require('../utils/phoneHelper');
const { autoBindByPhone } = require('../services/moveInGuestBindService');

/**
 * 활성 옵션 카탈로그 조회 (정렬: displayOrder, id)
 */
async function loadActiveOptions() {
  const options = await MoveInOption.findAll({
    where: { isActive: true },
    order: [['displayOrder', 'ASC'], ['id', 'ASC']]
  });
  return options.map(serializeOption);
}

/**
 * 토큰 만료 검증 헬퍼
 * @returns {boolean} true=만료
 */
function isTokenExpired(paymentRequest) {
  if (!paymentRequest?.expiresAt) return false;
  return new Date(paymentRequest.expiresAt).getTime() < Date.now();
}

/**
 * GET /api/guest/move-in/invite/:token
 * 비로그인/로그인 모두 진입 가능 (optionalAuth)
 */
const getInvitePreview = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_TOKEN_INVALID, 400);
    }

    const paymentRequest = await MoveInPaymentRequest.findOne({
      where: { token },
      include: [{ model: MoveInCase, as: 'case' }]
    });

    if (!paymentRequest || !paymentRequest.case) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_TOKEN_INVALID, 404);
    }

    if (isTokenExpired(paymentRequest)) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_TOKEN_EXPIRED, 410);
    }

    const caseRow = paymentRequest.case;

    // 로그인 + phone 매칭 시 풀 정보 노출
    const phoneMatched = !!(req.user && isSamePhone(req.user.phoneNumber, caseRow.guestPhone));
    const includeSensitive = phoneMatched;

    // 옵션 카탈로그
    const options = await loadActiveOptions();

    // 응답 직렬화 — 청소/비밀번호 자동 차단
    const data = serializeGuestCase(caseRow, {
      includeSensitive,
      guestOrders: [] // 비로그인 시점에선 주문 미조회 (Phase 6 에서 보강)
    });

    return success(res, {
      ...data,
      options,
      // PRD 6.3: 로그인했지만 phone 불일치인 경우 결제 불가 안내
      paymentEligibility: {
        loggedIn: !!req.user,
        phoneMatched,
        canPay: phoneMatched
      }
    }, '입주 준비 서비스 정보를 조회했습니다.');
  } catch (err) {
    console.error('[guestMoveInInvite.preview] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * POST /api/guest/move-in/invite/:token/bind
 * 로그인 필수. phone 일치 시 guestUserId 갱신.
 */
const bindInvite = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_TOKEN_INVALID, 400);
    }
    if (!req.user) {
      return error(res, ErrorCodes.UNAUTHORIZED, 401);
    }

    const paymentRequest = await MoveInPaymentRequest.findOne({
      where: { token },
      include: [{ model: MoveInCase, as: 'case' }]
    });

    if (!paymentRequest || !paymentRequest.case) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_TOKEN_INVALID, 404);
    }

    if (isTokenExpired(paymentRequest)) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_TOKEN_EXPIRED, 410);
    }

    const caseRow = paymentRequest.case;

    // phone 검증
    if (!isSamePhone(req.user.phoneNumber, caseRow.guestPhone)) {
      return error(res, ErrorCodes.MOVE_IN_GUEST_PHONE_MISMATCH, 403);
    }

    // 이미 다른 유저로 bound? (보안 — 임대인이 phone 변경했다가 되돌렸을 때 등의 엣지)
    if (caseRow.guestUserId && caseRow.guestUserId !== req.user.id) {
      return error(res, ErrorCodes.FORBIDDEN, 403, '이미 다른 계정에 연결된 케이스입니다.');
    }

    // bind (idempotent — 이미 같은 userId 면 NOOP)
    if (caseRow.guestUserId !== req.user.id) {
      await caseRow.update({ guestUserId: req.user.id });
    }

    // 같은 phone 의 다른 미연결 케이스도 함께 bind (PRD 4.4 — 메뉴 자동 노출 위해)
    const { boundCount } = await autoBindByPhone(req.user.id, req.user.phoneNumber);

    return success(res, {
      requestId: caseRow.id,
      bound: true,
      additionalBoundCount: boundCount
    }, '계정과 입주 준비 요청이 연결되었습니다.');
  } catch (err) {
    console.error('[guestMoveInInvite.bind] error:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  getInvitePreview,
  bindInvite
};
