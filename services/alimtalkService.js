/**
 * AlimtalkService - 카카오 알림톡 발송 핵심 서비스
 *
 * 역할:
 * - 중복 발송 방지 (event_name + contract_id + receiver_id)
 * - 템플릿 조회 및 메시지 빌드
 * - 발송 로그 기록 (AlimtalkLog)
 * - 1회 재시도 + SMS fallback (Aligo failover=Y)
 *
 * 원칙:
 * - 알림톡 실패가 메인 비즈니스 로직에 영향을 주면 안 됨 (fire-and-forget)
 * - tplCode가 null인 미등록 템플릿은 자동 skip
 * - 메시지 빌드: alimtalkTemplateCache에서 캐시된 templtContent 기반 #{변수} 치환
 * - 캐시 미스 시 fallbackContent 사용 (config/alimtalkTemplates.js)
 */

const { Op } = require('sequelize');
const { sendAlimtalk } = require('../utils/aligoClient');
const { getTemplate, isTemplateActive } = require('../config/alimtalkTemplates');
const { buildMessage, getCachedButtons } = require('../utils/alimtalkTemplateCache');

class AlimtalkService {
  /**
   * 모델 lazy loading (순환 참조 방지)
   */
  static getModels() {
    const { AlimtalkLog, User, GuestRefundAccount } = require('../models');
    return { AlimtalkLog, User, GuestRefundAccount };
  }

  // =====================================================
  // 핵심 발송 메서드
  // =====================================================

  /**
   * 알림톡 발송
   * @param {string} eventName - 이벤트명 (alimtalkTemplates.js의 key)
   * @param {Object} receiver - 수신자 { id, phoneNumber }
   * @param {Object} templateData - 템플릿 변수 데이터
   * @param {Object} [options] - 추가 옵션
   * @param {number} [options.contractId] - 관련 계약 ID
   * @param {number} [options.chatRoomId] - 관련 채팅방 ID
   * @param {number} [options.moveInCaseId] - 관련 입주 준비 케이스 ID (일별 발송 제한 카운트용)
   * @param {boolean} [options.skipDedup=false] - 중복 체크 skip 여부
   * @param {Array} [options.buttonOverride] - 캐시된 버튼 대신 사용할 버튼 배열
   *   - 알리고 콘솔에 버튼 URL 을 `http://#{url}` 처럼 등록한 템플릿 발송 시
   *     {linkMo, linkPc} 등을 발송 시점에 실제 값으로 치환해서 넘겨야 함
   * @returns {Promise<{sent: boolean, skipped: boolean, logId: number|null, error: string|null}>}
   */
  static async send(eventName, receiver, templateData = {}, options = {}) {
    const {
      contractId = null,
      chatRoomId = null,
      moveInCaseId = null,
      skipDedup = false,
      receiverRole = null,
      buttonOverride = null
    } = options;

    try {
      // 1. 템플릿 활성 여부 확인
      if (!isTemplateActive(eventName)) {
        console.log(`[Alimtalk] ${eventName}: 템플릿 미등록(tplCode=null), skip`);
        return { sent: false, skipped: true, logId: null, error: null };
      }

      // 2. 전화번호 확인
      if (!receiver || !receiver.phoneNumber) {
        console.log(`[Alimtalk] ${eventName}: 수신자(${receiver?.id}) 전화번호 없음, skip`);
        return { sent: false, skipped: true, logId: null, error: '전화번호 없음' };
      }

      // 3. 중복 발송 체크
      if (!skipDedup) {
        const isDup = await this.isDuplicate(eventName, contractId, receiver.id);
        if (isDup) {
          console.log(`[Alimtalk] ${eventName}: 중복 발송 감지 (contract=${contractId}, receiver=${receiver.id}), skip`);
          return { sent: false, skipped: true, logId: null, error: '중복 발송' };
        }
      }

      // 4. 템플릿 메시지 빌드 (캐시 → fallback 순)
      const template = getTemplate(eventName);
      const message = buildMessage(eventName, templateData);
      if (!message) {
        console.warn(`[Alimtalk] ${eventName}: 메시지 빌드 실패 (캐시/fallback 없음), skip`);
        return { sent: false, skipped: true, logId: null, error: '메시지 빌드 실패' };
      }
      const fallbackSMS = template.buildFallbackSMS ? template.buildFallbackSMS(templateData) : null;

      // 5. 로그 PENDING 기록 (재시도용 메시지 저장)
      const { AlimtalkLog } = this.getModels();
      const log = await AlimtalkLog.create({
        eventName,
        contractId,
        chatRoomId,
        moveInCaseId,
        receiverId: receiver.id ?? null,
        receiverPhone: receiver.phoneNumber,
        receiverRole,
        tplCode: template.tplCode,
        status: 'PENDING',
        requestPayload: { message, fallbackSMS }
      });

      // 6. 발송 (버튼 우선순위: buttonOverride > 캐시된 버튼)
      const buttons = buttonOverride || getCachedButtons(template.tplCode);
      const result = await sendAlimtalk({
        receiver: receiver.phoneNumber,
        tplCode: template.tplCode,
        subject: template.eventLabel || eventName,
        message,
        button: buttons || undefined,
        failover: 'Y',
        fsubject: `[EZstay] ${template.eventLabel || eventName}`,
        fmessage: fallbackSMS
      });

      // 7. 결과 기록
      if (result.success) {
        await log.update({
          status: 'SENT',
          responsePayload: result.data,
          sentAt: new Date()
        });
        return { sent: true, skipped: false, logId: log.id, error: null };
      }

      // 실패 → 1회 재시도
      await log.update({
        status: 'FAILED',
        responsePayload: result.data,
        errorMessage: result.error,
        failedAt: new Date()
      });

      console.error(`[Alimtalk] ${eventName} 발송 실패 (1차): ${result.error}`);
      return { sent: false, skipped: false, logId: log.id, error: result.error };
    } catch (err) {
      console.error(`[Alimtalk] ${eventName} 발송 에러:`, err.message);
      return { sent: false, skipped: false, logId: null, error: err.message };
    }
  }

  // =====================================================
  // 중복 발송 체크
  // =====================================================

  /**
   * 동일 이벤트 중복 발송 여부 확인
   * 기준: event_name + contract_id + receiver_id, 24시간 내 SENT 기록
   */
  static async isDuplicate(eventName, contractId, receiverId) {
    if (!contractId) return false;

    const { AlimtalkLog } = this.getModels();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const existing = await AlimtalkLog.findOne({
      where: {
        eventName,
        contractId,
        receiverId,
        status: { [Op.in]: ['SENT', 'RETRIED', 'FALLBACK_SENT'] },
        createdAt: { [Op.gte]: oneDayAgo }
      }
    });

    return !!existing;
  }

  // =====================================================
  // 입주 준비 케이스 일별 발송 횟수
  // =====================================================

  /**
   * 특정 입주 준비 케이스에 대해 오늘(KST) 발송 시도된 알림톡 건수.
   *
   * - 카운트 대상: PENDING/SENT/FAILED/RETRIED/FALLBACK_SENT 등 status 무관 — 발송 "시도" 기준
   *   (실패해도 임차인 단말로 SMS fallback 이 갈 수 있고, 재시도 어뷰징 방지)
   * - 기준 시각: created_at, KST 당일 00:00:00 ~ 23:59:59
   *
   * @param {number} moveInCaseId
   * @returns {Promise<number>}
   */
  static async countMoveInSentToday(moveInCaseId) {
    if (!moveInCaseId) return 0;

    const { AlimtalkLog } = this.getModels();
    const { kstDayRangeUtc } = require('../utils/dateHelper');
    const { start, end } = kstDayRangeUtc();

    return AlimtalkLog.count({
      where: {
        moveInCaseId,
        createdAt: { [Op.between]: [start, end] }
      }
    });
  }

  // =====================================================
  // 재시도
  // =====================================================

  /**
   * 실패한 발송 건 재시도 (retry_count < 1인 FAILED 건)
   * @param {number} logId - AlimtalkLog ID
   */
  static async retryFailed(logId) {
    const { AlimtalkLog } = this.getModels();
    const log = await AlimtalkLog.findByPk(logId);

    if (!log || log.status !== 'FAILED' || log.retryCount >= 1) {
      return { retried: false, error: '재시도 불가' };
    }

    const template = getTemplate(log.eventName);
    if (!template) return { retried: false, error: '템플릿 미발견' };

    // 재시도 (저장된 메시지 우선 사용 → 없으면 캐시에서 빌드)
    const retryMessage = log.requestPayload?.message || buildMessage(log.eventName, {});
    if (!retryMessage) return { retried: false, error: '메시지 빌드 실패' };

    const cachedButtons = getCachedButtons(log.tplCode);
    const result = await sendAlimtalk({
      receiver: log.receiverPhone,
      tplCode: log.tplCode,
      subject: template.eventLabel || log.eventName,
      message: retryMessage,
      button: cachedButtons || undefined,
      failover: 'Y',
      fsubject: `[EZstay] ${template.eventLabel || log.eventName}`,
      fmessage: log.requestPayload?.fallbackSMS || null
    });

    if (result.success) {
      await log.update({
        status: 'RETRIED',
        retryCount: log.retryCount + 1,
        responsePayload: result.data,
        sentAt: new Date(),
        errorMessage: null
      });
      return { retried: true, error: null };
    }

    // 최종 실패 (SMS fallback은 Aligo의 failover=Y가 처리)
    await log.update({
      status: 'FALLBACK_SENT', // Aligo가 SMS fallback 수행
      retryCount: log.retryCount + 1,
      responsePayload: result.data,
      errorMessage: result.error,
      failedAt: new Date()
    });

    console.error(`[Alimtalk] 재시도 실패 (logId=${logId}): ${result.error} → SMS fallback`);
    return { retried: false, error: result.error };
  }

  // =====================================================
  // 실패 건 일괄 재시도 (스케줄러에서 호출)
  // =====================================================

  /**
   * FAILED 상태 + retry_count=0인 건들 일괄 재시도
   * @param {number} [limit=50] - 최대 처리 건수
   */
  static async retryAllFailed(limit = 50) {
    const { AlimtalkLog } = this.getModels();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const failedLogs = await AlimtalkLog.findAll({
      where: {
        status: 'FAILED',
        retryCount: 0,
        failedAt: { [Op.lte]: tenMinutesAgo }
      },
      limit,
      order: [['failedAt', 'ASC']]
    });

    let retried = 0;
    for (const log of failedLogs) {
      const result = await this.retryFailed(log.id);
      if (result.retried) retried++;
    }

    if (failedLogs.length > 0) {
      console.log(`[Alimtalk] 재시도 완료: ${retried}/${failedLogs.length}건 성공`);
    }
    return { total: failedLogs.length, retried };
  }

  // =====================================================
  // 편의 메서드 (이벤트별)
  // =====================================================

  /**
   * 4-3. 결제 완료 알림톡 (게스트 + 호스트 + 환급계좌 미등록 안내)
   */
  static async sendPaymentCompleted(contract, guest, host, room, paymentData = {}) {
    const commonData = {
      roomName: room?.roomName || '',
      startDate: this._formatDate(contract.checkInDate),
      endDate: this._formatDate(contract.checkOutDate)
    };

    // 게스트에게 (옵션 상품이 있으면 포함)
    await this.send('payment_completed_guest', guest, {
      ...commonData,
      amount: this._formatNumber(paymentData.guestAmount || contract.finalTotalAmount),
      optionItems: paymentData.optionItems || '없음'
    }, { contractId: contract.id, receiverRole: 'guest' });

    // 호스트에게
    await this.send('payment_completed_host', host, {
      ...commonData,
      amount: this._formatNumber(paymentData.hostAmount || contract.totalUsageFee)
    }, { contractId: contract.id, receiverRole: 'host' });

    // 게스트 환급계좌 미등록 시 안내
    const { GuestRefundAccount } = this.getModels();
    const refundAccount = await GuestRefundAccount.findOne({ where: { userId: guest.id } });
    if (!refundAccount) {
      await this.send('bank_account_required', guest, {}, { contractId: contract.id, receiverRole: 'guest' });
    }
  }

  /**
   * 4-5. 계약 취소 알림톡
   * @param {'guest'|'host'} canceledBy - 취소 주체
   */
  static async sendContractCanceled(contract, canceledBy, guest, host, room, refundData = {}) {
    const commonData = {
      roomName: room?.roomName || '',
      startDate: this._formatDate(contract.checkInDate),
      endDate: this._formatDate(contract.checkOutDate)
    };

    if (canceledBy === 'guest') {
      // 게스트 취소 → 게스트에게
      await this.send('contract_canceled_guest_to_guest', guest, {
        ...commonData,
        penaltyAmount: this._formatNumber(refundData.guestPenalty || 0),
        refundAmount: this._formatNumber(refundData.refundAmount || 0)
      }, { contractId: contract.id, receiverRole: 'guest' });

      // 게스트 취소 → 호스트에게
      await this.send('contract_canceled_guest_to_host', host, {
        ...commonData,
        penaltyAmount: this._formatNumber(refundData.hostPenalty || 0),
        settlementAmount: this._formatNumber(refundData.settlementAmount || 0)
      }, { contractId: contract.id, receiverRole: 'host' });
    } else {
      // 호스트 취소 → 게스트에게
      await this.send('contract_canceled_host_to_guest', guest, {
        ...commonData,
        penaltyAmount: this._formatNumber(refundData.guestCompensationAmount || 0)
      }, { contractId: contract.id, receiverRole: 'guest' });

      // 호스트 취소 → 호스트에게
      await this.send('contract_canceled_host_to_host', host, {
        ...commonData,
        penaltyAmount: this._formatNumber(refundData.hostBurdenAmount || 0)
      }, { contractId: contract.id, receiverRole: 'host' });
    }
  }

  /**
   * 4-6. 퇴실 전일 안내 알림톡
   */
  static async sendCheckoutEve(contract, guest, room) {
    await this.send('checkout_eve_guest', guest, {
      checkOutTime: room?.checkOutTime || '11:00'
    }, { contractId: contract.id, receiverRole: 'guest' });
  }

  /**
   * 4-11. 보증금 정산 합의 완료 알림톡 (게스트 + 호스트)
   */
  static async sendDepositSettlementAgreed(contract, guest, host, agreementData = {}) {
    const data = {
      guestAmount: this._formatNumber(agreementData.guestAmount || 0),
      hostAmount: this._formatNumber(agreementData.hostAmount || 0)
    };

    await this.send('deposit_settlement_agreed', guest, data, { contractId: contract.id, receiverRole: 'guest' });
    await this.send('deposit_settlement_agreed', host, data, { contractId: contract.id, receiverRole: 'host' });
  }

  /**
   * 4-12. 보증금 합의 기한 만료 알림톡 (게스트 + 호스트)
   */
  static async sendDepositAgreementExpired(contract, guest, host) {
    await this.send('deposit_agreement_expired', guest, {}, { contractId: contract.id, receiverRole: 'guest' });
    await this.send('deposit_agreement_expired', host, {}, { contractId: contract.id, receiverRole: 'host' });
  }

  /**
   * 4-13. 호스트 퇴실 확인 완료 + 보증금 반환 (게스트에게)
   */
  static async sendDepositReturnedNormal(contract, guest) {
    await this.send('deposit_returned_normal', guest, {}, { contractId: contract.id, receiverRole: 'guest' });
  }

  /**
   * 4-15. 퇴실 확인 기한 만료 (게스트 + 호스트)
   */
  static async sendCheckoutConfirmExpired(contract, guest, host, room) {
    // 게스트에게 (4-13과 동일 메시지)
    await this.send('checkout_confirm_expired_guest', guest, {}, { contractId: contract.id, receiverRole: 'guest' });

    // 호스트에게
    await this.send('checkout_confirm_expired_host', host, {
      roomName: room?.roomName || '',
      startDate: this._formatDate(contract.checkInDate),
      endDate: this._formatDate(contract.checkOutDate)
    }, { contractId: contract.id, receiverRole: 'host' });
  }

  // =====================================================
  // 미등록 템플릿용 편의 메서드 (TODO: 검수 후 활성화)
  // =====================================================

  /** 방 심사 승인 안내 알림톡 (호스트에게) */
  static async sendPropertyApproved(host, room) {
    await this.send('property_approved_host', host, {
      roomName: room?.roomName || ''
    }, { receiverRole: 'host', skipDedup: true });
  }

  /**
   * 입주 준비 결제 요청 알림톡 — 임차인 수신 (UI_0932)
   *
   * 템플릿 변수: #{임대인} / #{입주일} / #{마감기한} / #{url}
   * 알리고 콘솔 검수 등록 버튼 URL 은 `https://#{url}` 형식 — 발송 버튼도 동일하게
   * `https://` + (scheme 제거한 host+path) 로 맞춰야 검수본과 일치해 알림톡으로 발송됨.
   * (스킴이 다르면 버튼 불일치로 알림톡 거부 → 대체문자 전환)
   *
   * 마감기한: 입주일 -5일 (D-5 게이트, calculatePaymentDeadline 결과를 YYYY-MM-DD 로 포맷)
   *
   * @param {Object} guest    - { phoneNumber } (가입돼있으면 id 도 포함 가능)
   * @param {Object} payload  - { hostName, checkInDate, paymentDeadline, paymentLink }
   * @param {Object} [opts]   - { moveInCaseId } 일별 발송 제한 카운트용 케이스 ID
   */
  static async sendMoveInPaymentRequest(guest, { hostName, checkInDate, paymentDeadline, paymentLink }, opts = {}) {
    // paymentLink 에서 scheme 분리 — 템플릿 #{url} 변수는 host+path 만 받음
    const urlWithoutScheme = String(paymentLink || '').replace(/^https?:\/\//, '');
    // 검수본 버튼이 `https://#{url}` 이므로 발송 버튼도 https 로 고정
    const buttonLink = `https://${urlWithoutScheme}`;

    const buttonOverride = [{
      name: '확인하기',
      linkType: 'WL',          // 웹링크
      linkMo: buttonLink,
      linkPc: buttonLink
    }];

    return this.send(
      'move_in_payment_request_guest',
      guest,
      {
        hostName: hostName || '임대인',
        checkInDate: this._formatDate(checkInDate),
        paymentDeadline: this._formatDate(paymentDeadline),
        url: urlWithoutScheme
      },
      {
        receiverRole: 'guest',
        skipDedup: true,        // 케이스 단위 재발송 허용 (resendCount 별도 추적)
        moveInCaseId: opts.moveInCaseId ?? null, // 일별 10회 제한 카운트 기준
        buttonOverride
      }
    );
  }

  /** 4-2. 계약 승인 알림톡 */
  static async sendContractApproved(contract, guest, room) {
    await this.send('contract_approved_guest', guest, {
      roomName: room?.roomName || '',
      startDate: this._formatDate(contract.checkInDate),
      endDate: this._formatDate(contract.checkOutDate)
    }, { contractId: contract.id, receiverRole: 'guest' });
  }

  /** 계약 거절 알림톡 (게스트에게) */
  static async sendContractRejected(contract, guest, room) {
    await this.send('contract_rejected_guest', guest, {
      roomName: room?.roomName || '',
      startDate: this._formatDate(contract.checkInDate),
      endDate: this._formatDate(contract.checkOutDate)
    }, { contractId: contract.id, receiverRole: 'guest' });
  }

  /** 4-4. 입주 당일 안내 알림톡 */
  static async sendCheckinToday(contract, guest, host, room) {
    const address = room?.address || '';
    await this.send('checkin_today_guest', guest, {
      roomName: room?.roomName || '', address
    }, { contractId: contract.id, receiverRole: 'guest' });
    await this.send('checkin_today_host', host, {
      roomName: room?.roomName || '', address
    }, { contractId: contract.id, receiverRole: 'host' });
  }

  /** 4-7. 퇴실 당일 알림톡 */
  static async sendCheckoutToday(contract, guest) {
    await this.send('checkout_today_guest', guest, {}, { contractId: contract.id, receiverRole: 'guest' });
  }

  /** 4-17. 퇴실 당일 침구류 반납 안내 (침구류 대여 게스트에게만) */
  static async sendCheckoutBeddingReturn(contract, guest) {
    await this.send('checkout_bedding_return_guest', guest, {}, { contractId: contract.id, receiverRole: 'guest' });
  }

  /** 4-8. 호스트 퇴실 확인 요청 */
  static async sendCheckoutHostRequest(contract, host, confirmDeadline) {
    await this.send('checkout_host_request', host, {
      confirmDeadline: confirmDeadline || '48시간'
    }, { contractId: contract.id, receiverRole: 'host' });
  }

  /** 4-9. 보증금 보류 안내 */
  static async sendDepositHold(contract, guest, host, agreementDeadline) {
    await this.send('deposit_hold_host', host, {
      agreementDeadline: agreementDeadline || ''
    }, { contractId: contract.id, receiverRole: 'host' });
    await this.send('deposit_hold_guest', guest, {}, { contractId: contract.id, receiverRole: 'guest' });
  }

  /** 4-10. 보증금 합의 요청 */
  static async sendDepositSettlementSubmitted(contract, guest, deductAmount, reason) {
    await this.send('deposit_settlement_submitted', guest, {
      deductAmount: this._formatNumber(deductAmount || 0),
      reason: reason || ''
    }, { contractId: contract.id, receiverRole: 'guest' });
  }

  /**
   * 4-1. 채팅 메시지 알림톡
   * Redis 5분 윈도우 + 읽음 상태 기반 발송
   * @param {Object} chatRoom - ChatRoom 인스턴스 { id, hostId, guestId, roomId }
   * @param {number} senderId - 메시지 발신자 ID
   * @param {Object} receiver - 수신자 { id, phoneNumber }
   * @param {string} roomName - 방 이름
   */
  static async sendChatMessageNotify(chatRoom, senderId, receiver, roomName) {
    const { safeRedisOperation } = require('../config/redis');

    const receiverId = receiver.id;
    const readKey = `chat_read:${chatRoom.id}:${receiverId}`;
    const notifiedKey = `chat_notified:${chatRoom.id}:${receiverId}`;

    // 1. 읽음 상태 확인 - 최근 10초 이내 읽음이면 현재 채팅방 보고 있는 것
    const lastReadTs = await safeRedisOperation(async (client) => client.get(readKey));
    if (lastReadTs && (Date.now() - parseInt(lastReadTs)) < 10 * 1000) {
      console.log(`[Alimtalk] chat_message: receiver(${receiverId}) 현재 채팅방 열람 중, skip`);
      return { sent: false, skipped: true, reason: 'currently_reading' };
    }

    // 2. 5분 윈도우 체크 - 이미 알림 발송했으면 skip
    const lastNotifiedTs = await safeRedisOperation(async (client) => client.get(notifiedKey));
    if (lastNotifiedTs && (Date.now() - parseInt(lastNotifiedTs)) < 5 * 60 * 1000) {
      console.log(`[Alimtalk] chat_message: receiver(${receiverId}) 5분 윈도우 내, skip`);
      return { sent: false, skipped: true, reason: 'within_window' };
    }

    // 3. 수신자가 호스트인지 게스트인지에 따라 템플릿 선택
    const isGuestSender = senderId === chatRoom.guestId;
    const eventName = isGuestSender
      ? 'chat_message_host'   // 게스트가 보냄 → 호스트에게 알림
      : 'chat_message_guest'; // 호스트가 보냄 → 게스트에게 알림
    const receiverRole = isGuestSender ? 'host' : 'guest';

    // 4. 알림톡 발송
    const result = await this.send(eventName, receiver, {
      roomName: roomName || ''
    }, { chatRoomId: chatRoom.id, skipDedup: true, receiverRole });

    // 5. 발송 성공 시 Redis에 알림 시간 기록 (TTL 10분)
    if (result.sent || !result.skipped) {
      await safeRedisOperation(async (client) => {
        await client.set(notifiedKey, String(Date.now()), { EX: 600 });
      });
    }

    return result;
  }

  /**
   * 채팅방 읽음 처리 (Redis 갱신)
   * @param {number} chatRoomId - ChatRoom ID (MySQL PK)
   * @param {number} userId - 읽은 사용자 ID
   */
  static async markChatRead(chatRoomId, userId) {
    const { safeRedisOperation } = require('../config/redis');
    await safeRedisOperation(async (client) => {
      await client.set(`chat_read:${chatRoomId}:${userId}`, String(Date.now()), { EX: 600 });
    });
  }

  /** 4-14. 계좌 등록 요청 */
  static async sendBankAccountRequired(receiver) {
    await this.send('bank_account_required', receiver, {}, { receiverRole: 'guest' });
  }

  /** 계약 승인 요청 알림톡 (호스트에게) */
  static async sendContractRequest(contract, host, room) {
    await this.send('contract_request_host', host, {
      roomName: room?.roomName || '',
      startDate: this._formatDate(contract.checkInDate),
      endDate: this._formatDate(contract.checkOutDate)
    }, { contractId: contract.id, receiverRole: 'host' });
  }

  /** 옵션 추가 결제 완료 알림톡 (게스트에게) */
  static async sendOptionPayment(contract, guest, room, optionData = {}, options = {}) {
    await this.send('option_payment_guest', guest, {
      roomName: room?.roomName || '',
      startDate: this._formatDate(contract.checkInDate),
      endDate: this._formatDate(contract.checkOutDate),
      optionItems: optionData.optionItems || '',
      amount: this._formatNumber(optionData.amount || 0)
    }, { contractId: contract.id, receiverRole: 'guest', ...options });
  }

  /** 옵션 결제 취소 완료 알림톡 (게스트에게) */
  static async sendOptionPaymentCanceled(contract, guest, room, optionData = {}) {
    await this.send('option_payment_canceled_guest', guest, {
      roomName: room?.roomName || '',
      startDate: this._formatDate(contract.checkInDate),
      endDate: this._formatDate(contract.checkOutDate),
      optionItems: optionData.optionItems || '',
      amount: this._formatNumber(optionData.amount || 0)
    }, { contractId: contract.id, receiverRole: 'guest' });
  }

  // =====================================================
  // 유틸리티
  // =====================================================

  static _formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  static _formatNumber(num) {
    if (num == null) return '0';
    return Number(num).toLocaleString('ko-KR');
  }
}

module.exports = AlimtalkService;
