/**
 * moveInPaymentRequestController.js
 * 임차인 옵션 결제 요청 발송 (임대인용)
 *
 * PRD 9절:
 *  - 9.1 자동 발송: 케이스 생성 시 sendGuestPaymentRequest=true이면 자동 발송
 *  - 9.2 수동/재발송: 상세 페이지에서 결제 요청 보내기/다시 보내기/링크 복사
 *
 * PRD 10.1: 임대인에게 임차인 결제 완료 여부 비노출 → status는 NOT_SENT/SENT만
 *
 * ⚠️ TODO: 알림톡 발송
 *   - 현재 알리고에 청소 결제 요청용 알림톡 템플릿이 등록되지 않은 상태
 *   - 템플릿 등록 후 services/alimtalkService 의 sendAlimtalk 연동 필요
 *   - 등록 예정 템플릿: MOVE_IN_PAYMENT_REQUEST (게스트에게 결제 링크 안내)
 *   - 변수: 임차인이름, 입주일, 퇴실일, 결제링크
 */
const { sequelize, MoveInCase, MoveInPaymentRequest } = require('../models');
const { ErrorCodes, success, error } = require('../utils/responseHelper');
const moveInCaseService = require('../services/moveInCaseService');

const GUEST_PAYMENT_PAGE_URL = process.env.GUEST_MOVE_IN_PAYMENT_URL
  || 'https://ezstay.kr/move-in/payment';

/**
 * 토큰을 기반으로 임차인 결제 페이지 URL 빌드
 */
function buildPaymentLink(token) {
  return `${GUEST_PAYMENT_PAGE_URL}/${token}`;
}

/**
 * 케이스 + 본인 검증 + paymentRequest 로드 헬퍼
 */
async function loadCaseWithRequest(caseId, hostId, transaction = null) {
  const opts = transaction ? { transaction } : {};
  return MoveInCase.findOne({
    where: { id: caseId, hostId },
    include: [{ model: MoveInPaymentRequest, as: 'paymentRequest' }],
    ...opts
  });
}

/**
 * 알림톡 발송 시뮬레이션 (TODO: 실제 발송 연동)
 *
 * 현재는 항상 성공으로 가정. 실제 연동 시:
 *   - alimtalkService.sendAlimtalk(...) 호출
 *   - 실패 시 throw → 호출 측에서 NOT_SENT 유지
 *
 * @returns {Promise<{ success: boolean, mock: boolean }>}
 */
async function dispatchPaymentRequestNotification({ caseRow, token }) {
  // TODO(알림톡 등록 후): 아래 주석 해제 + 템플릿 등록
  // const { sendAlimtalk } = require('../services/alimtalkService');
  // await sendAlimtalk('MOVE_IN_PAYMENT_REQUEST',
  //   { phoneNumber: caseRow.guestPhone },
  //   {
  //     guestName: caseRow.guestName,
  //     checkInDate: caseRow.checkInDate,
  //     checkOutDate: caseRow.checkOutDate,
  //     paymentLink: buildPaymentLink(token)
  //   }
  // );
  console.log(
    `[MoveIn][TODO] 알림톡 미연동 — 발송 스킵: caseId=${caseRow.id}, ` +
    `phone=${caseRow.guestPhone}, link=${buildPaymentLink(token)}`
  );

  // 인앱 알림 — 임차인이 이미 EZstay 가입돼 있으면 알림함에 기록 (PRD 5.3)
  // best-effort: 알림 실패가 발송 자체를 막지 않음
  if (caseRow.guestUserId) {
    try {
      const NotificationService = require('../services/notificationService');
      await NotificationService.create({
        userId: caseRow.guestUserId,
        userMode: 'guest',
        type: 'MOVE_IN_PAYMENT_REQUEST',
        title: '입주 준비 결제 요청',
        message: '임대인이 입주 준비 서비스 결제를 요청했어요. 옵션을 선택해 결제해주세요.',
        metadata: {
          caseId: caseRow.id,
          checkInDate: caseRow.checkInDate,
          checkOutDate: caseRow.checkOutDate
        }
      });
    } catch (notifyErr) {
      console.error('[MoveIn] 인앱 알림 생성 실패:', notifyErr.message);
    }
  }

  return { success: true, mock: true };
}

/**
 * POST /api/host/move-in/cases/:caseId/payment-request/send
 * 임차인 결제 요청 발송 (최초)
 *
 * - status=NOT_SENT 일 때만 동작
 * - 발송 성공 시 status=SENT, sentAt 기록
 */
const sendPaymentRequest = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const hostId = req.user.id;
    const { caseId } = req.params;

    const caseRow = await loadCaseWithRequest(caseId, hostId, transaction);
    if (!caseRow) {
      await transaction.rollback();
      return error(res, ErrorCodes.NOT_FOUND, 404, '케이스를 찾을 수 없습니다.');
    }

    let request = caseRow.paymentRequest;
    // 이론적으로 케이스 생성 시 항상 발급되지만, 누락된 경우 안전 처리
    if (!request) {
      request = await MoveInPaymentRequest.create({
        caseId: caseRow.id,
        token: moveInCaseService.generateRequestToken(),
        status: 'NOT_SENT',
        expiresAt: moveInCaseService.calculateTokenExpiresAt(caseRow.checkOutDate)
      }, { transaction });
    }

    if (request.status === 'SENT') {
      await transaction.rollback();
      return error(
        res,
        ErrorCodes.VALIDATION_ERROR,
        400,
        '이미 발송된 요청입니다. 재발송은 /resend 엔드포인트를 사용하세요.'
      );
    }

    // 알림톡 발송 시도
    let dispatched;
    try {
      dispatched = await dispatchPaymentRequestNotification({ caseRow, token: request.token });
    } catch (notifyErr) {
      // 발송 실패 시 status 유지 (재시도 가능)
      await transaction.rollback();
      console.error('알림톡 발송 실패:', notifyErr);
      return error(res, ErrorCodes.INTERNAL_ERROR, 500, '알림톡 발송에 실패했습니다.');
    }

    const now = new Date();
    await request.update({
      status: 'SENT',
      sentAt: now
    }, { transaction });

    await transaction.commit();

    return success(res, {
      caseId: caseRow.id,
      status: request.status,
      sentAt: now,
      paymentLink: buildPaymentLink(request.token),
      _note: dispatched.mock
        ? '⚠️ 알림톡 템플릿 미등록 상태 — 실제 발송 없이 상태만 SENT로 변경되었습니다.'
        : undefined
    }, '결제 요청이 발송되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('결제 요청 발송 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * POST /api/host/move-in/cases/:caseId/payment-request/resend
 * 재발송
 *
 * PRD 9.2 정책:
 *  - 동일 케이스의 기존 토큰 재사용 (휴대폰 번호 변경은 케이스 수정 API에서 새 토큰 발급)
 *  - resendCount++, lastResentAt 갱신
 *  - status가 NOT_SENT여도 재시도 가능 (이전 발송 실패 케이스)
 */
const resendPaymentRequest = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const hostId = req.user.id;
    const { caseId } = req.params;

    const caseRow = await loadCaseWithRequest(caseId, hostId, transaction);
    if (!caseRow) {
      await transaction.rollback();
      return error(res, ErrorCodes.NOT_FOUND, 404, '케이스를 찾을 수 없습니다.');
    }

    let request = caseRow.paymentRequest;
    if (!request) {
      // 누락된 경우 새로 발급
      request = await MoveInPaymentRequest.create({
        caseId: caseRow.id,
        token: moveInCaseService.generateRequestToken(),
        status: 'NOT_SENT',
        expiresAt: moveInCaseService.calculateTokenExpiresAt(caseRow.checkOutDate)
      }, { transaction });
    }

    let dispatched;
    try {
      dispatched = await dispatchPaymentRequestNotification({ caseRow, token: request.token });
    } catch (notifyErr) {
      await transaction.rollback();
      console.error('알림톡 재발송 실패:', notifyErr);
      return error(res, ErrorCodes.INTERNAL_ERROR, 500, '알림톡 재발송에 실패했습니다.');
    }

    const now = new Date();
    await request.update({
      status: 'SENT',
      sentAt: request.sentAt ?? now,
      lastResentAt: now,
      resendCount: request.resendCount + 1
    }, { transaction });

    await transaction.commit();

    return success(res, {
      caseId: caseRow.id,
      status: request.status,
      sentAt: request.sentAt,
      lastResentAt: now,
      resendCount: request.resendCount,
      paymentLink: buildPaymentLink(request.token),
      _note: dispatched.mock
        ? '⚠️ 알림톡 템플릿 미등록 상태 — 실제 발송 없이 카운트만 증가했습니다.'
        : undefined
    }, '결제 요청이 재발송되었습니다.');
  } catch (err) {
    await transaction.rollback();
    console.error('결제 요청 재발송 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * GET /api/host/move-in/cases/:caseId/payment-request/link
 * 결제 링크 URL 조회 (복사용)
 */
const getPaymentRequestLink = async (req, res) => {
  try {
    const hostId = req.user.id;
    const { caseId } = req.params;

    const caseRow = await loadCaseWithRequest(caseId, hostId);
    if (!caseRow) {
      return error(res, ErrorCodes.NOT_FOUND, 404, '케이스를 찾을 수 없습니다.');
    }

    if (!caseRow.paymentRequest) {
      return error(res, ErrorCodes.NOT_FOUND, 404, '결제 요청 토큰이 없습니다.');
    }

    return success(res, {
      caseId: caseRow.id,
      paymentLink: buildPaymentLink(caseRow.paymentRequest.token),
      status: caseRow.paymentRequest.status,
      expiresAt: caseRow.paymentRequest.expiresAt
    });
  } catch (err) {
    console.error('결제 링크 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500);
  }
};

module.exports = {
  sendPaymentRequest,
  resendPaymentRequest,
  getPaymentRequestLink,
  // 내부 유틸 export (Phase 4 케이스 생성 시 자동 발송 연결용)
  _dispatchPaymentRequestNotification: dispatchPaymentRequestNotification,
  _buildPaymentLink: buildPaymentLink
};
