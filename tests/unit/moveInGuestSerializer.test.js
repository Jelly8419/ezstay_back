/**
 * moveInGuestSerializer.test.js
 * 입주 준비 서비스 임차인 응답 직렬화 단위 테스트
 *
 * 검증 포인트:
 *  - PRD 14.7-8: 청소 정보(cleaningStatus/Fee/PaidAt) 절대 노출 X
 *  - 비밀번호(공동현관/도어락) 절대 노출 X
 *  - 비로그인: detail_address 마스킹
 *  - 로그인+매칭: 풀 노출
 *  - 게스트 상태 파생 로직
 */

'use strict';

const {
  maskAddress,
  deriveGuestStatus,
  serializeGuestCase,
  serializeOption,
  serializeGuestOrder
} = require('../../utils/moveInGuestSerializer');

describe('maskAddress', () => {
  test('null/undefined → null', () => {
    expect(maskAddress(null)).toBeNull();
    expect(maskAddress(undefined)).toBeNull();
  });

  test('짧은 주소 (4 토큰 이하) → 그대로 반환', () => {
    expect(maskAddress('서울 강남구 가로수길 9')).toBe('서울 강남구 가로수길 9');
  });

  test('긴 주소 → 4 토큰까지만 + "…"', () => {
    expect(maskAddress('서울 강남구 가로수길 9 101동 1503호'))
      .toBe('서울 강남구 가로수길 9 …');
  });

  test('앞뒤 공백 trim', () => {
    expect(maskAddress('  서울 강남구 가로수길 9  ')).toBe('서울 강남구 가로수길 9');
  });
});

describe('deriveGuestStatus', () => {
  test('주문 없음 → PENDING_PAYMENT', () => {
    expect(deriveGuestStatus([])).toBe('PENDING_PAYMENT');
  });

  test('PENDING 만 있음 → PENDING_PAYMENT', () => {
    expect(deriveGuestStatus([
      { status: 'PENDING', deliveryStatus: 'PENDING' }
    ])).toBe('PENDING_PAYMENT');
  });

  test('PAID + 배송 미완료 → PAID', () => {
    expect(deriveGuestStatus([
      { status: 'PAID', deliveryStatus: 'IN_TRANSIT' }
    ])).toBe('PAID');
  });

  test('모든 PAID 가 배송 완료 → COMPLETED', () => {
    expect(deriveGuestStatus([
      { status: 'PAID', deliveryStatus: 'DELIVERED' },
      { status: 'PARTIAL_REFUND', deliveryStatus: 'DELIVERED' }
    ])).toBe('COMPLETED');
  });

  test('일부만 배송 완료 → PAID', () => {
    expect(deriveGuestStatus([
      { status: 'PAID', deliveryStatus: 'DELIVERED' },
      { status: 'PAID', deliveryStatus: 'IN_TRANSIT' }
    ])).toBe('PAID');
  });

  test('CANCELLED 는 무시', () => {
    expect(deriveGuestStatus([
      { status: 'CANCELLED', deliveryStatus: 'PENDING' }
    ])).toBe('PENDING_PAYMENT');
  });
});

describe('serializeGuestCase — 핵심 안전장치', () => {
  const baseCase = {
    id: 100,
    checkInDate: '2026-04-10',
    checkOutDate: '2026-04-15',
    cleaningStatus: 'PAID',          // ⚠️ 노출 금지
    cleaningFee: 50000,              // ⚠️ 노출 금지
    cleaningPaidAt: new Date(),      // ⚠️ 노출 금지
    roomSnapshot: {
      roomName: '오즈오',
      address: '서울 강남구 가로수길 9',
      detailAddress: '101동 1503호',
      commonEntrancePassword: 'SECRET-123', // ⚠️ 노출 금지
      doorLockPassword: 'SECRET-456'        // ⚠️ 노출 금지
    }
  };

  test('비로그인: detailAddress 마스킹', () => {
    const r = serializeGuestCase(baseCase, { includeSensitive: false });
    expect(r.room.detailAddress).toBeNull();
    expect(r.authRequired).toBe(true);
  });

  test('로그인+매칭: detailAddress 노출', () => {
    const r = serializeGuestCase(baseCase, { includeSensitive: true });
    expect(r.room.detailAddress).toBe('101동 1503호');
    expect(r.authRequired).toBe(false);
  });

  test('청소 관련 필드는 절대 응답에 포함되지 않음', () => {
    const r = serializeGuestCase(baseCase, { includeSensitive: true });
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/cleaningStatus/);
    expect(json).not.toMatch(/cleaningFee/);
    expect(json).not.toMatch(/cleaningPaidAt/);
  });

  test('비밀번호 필드 절대 노출 X', () => {
    const r = serializeGuestCase(baseCase, { includeSensitive: true });
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/SECRET-/);
    expect(json).not.toMatch(/Password/);
  });

  test('paymentDeadline 자동 계산 포함', () => {
    const r = serializeGuestCase(baseCase, { includeSensitive: false });
    expect(r.paymentDeadline).toMatch(/^2026-04-05T23:59:59\+09:00$/);
  });

  test('roomSnapshot 이 문자열인 경우 (DB 직렬화 형태) 도 파싱', () => {
    const c = { ...baseCase, roomSnapshot: JSON.stringify(baseCase.roomSnapshot) };
    const r = serializeGuestCase(c, { includeSensitive: true });
    expect(r.room.displayName).toBe('오즈오');
  });

  test('null 입력 → null 반환', () => {
    expect(serializeGuestCase(null)).toBeNull();
  });
});

describe('serializeOption', () => {
  test('Sequelize plain 형태 직렬화', () => {
    const o = {
      id: 1,
      name: '프리미엄 어메니티 키트',
      description: '치약/칫솔/샴푸/린스',
      optionType: 'PURCHASE',
      category: 'AMENITY_KIT',
      price: 10000,
      imageUrl: 'https://x/y.jpg',
      isActive: true
    };
    expect(serializeOption(o)).toEqual({
      optionId: 1,
      name: '프리미엄 어메니티 키트',
      description: '치약/칫솔/샴푸/린스',
      type: 'PURCHASE',
      category: 'AMENITY_KIT',
      price: 10000,
      imageUrl: 'https://x/y.jpg',
      available: true
    });
  });

  test('snake_case 필드명도 지원', () => {
    const o = {
      id: 2,
      name: '침구 세트',
      option_type: 'RENTAL',
      category: 'BEDDING_SET',
      price: 35000,
      image_url: null,
      is_active: false
    };
    const r = serializeOption(o);
    expect(r.type).toBe('RENTAL');
    expect(r.available).toBe(false);
    expect(r.imageUrl).toBeNull();
  });
});

describe('serializeGuestOrder', () => {
  test('주문 + 라인 직렬화', () => {
    const order = {
      orderId: '260507-G0001',
      orderType: 'INITIAL',
      status: 'PAID',
      deliveryStatus: 'PENDING',
      totalAmount: 45000,
      paidAmount: 45000,
      refundedAmount: 0,
      paidAt: '2026-05-07T05:00:00.000Z',
      createdAt: '2026-05-07T04:00:00.000Z',
      items: [
        {
          id: 1,
          optionId: 10,
          option: { name: '어메니티 키트' },
          quantity: 1,
          pricePerItem: 10000,
          totalPrice: 10000,
          status: 'ACTIVE'
        }
      ]
    };
    const r = serializeGuestOrder(order);
    expect(r.orderId).toBe('260507-G0001');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].name).toBe('어메니티 키트');
    expect(r.paidAt).toBe('2026-05-07T14:00:00+09:00'); // UTC 05:00 → KST 14:00
  });

  test('items 누락 시 빈 배열', () => {
    const r = serializeGuestOrder({
      orderId: '260507-G0001',
      status: 'PENDING'
    });
    expect(r.items).toEqual([]);
  });

  // ── canCancel / canReturn 플래그 (배송 상태별) ───────────────────
  describe('canCancel / canReturn (배송 상태별 정책 노출)', () => {
    // 충분히 미래 케이스 — D-5 이전
    const futureCase = {
      checkInDate: '2030-01-20',
      checkOutDate: '2030-01-25'
    };
    const baseOrder = {
      orderId: '260520-G0003',
      status: 'PAID',
      totalAmount: 10000,
      paidAmount: 10000,
      refundedAmount: 0,
      items: [{ id: 1, optionId: 10, quantity: 1, totalPrice: 10000, status: 'ACTIVE' }]
    };

    test('caseRow 미지정 → canCancel/canReturn=false (보수적 차단)', () => {
      const r = serializeGuestOrder({ ...baseOrder, deliveryStatus: 'PENDING' });
      expect(r.canCancel).toBe(false);
      expect(r.canReturn).toBe(false);
    });

    test('배송 전(PENDING) + D-5 이전 → canCancel=true, canReturn=false', () => {
      const r = serializeGuestOrder(
        { ...baseOrder, deliveryStatus: 'PENDING' },
        { caseRow: futureCase }
      );
      expect(r.canCancel).toBe(true);
      expect(r.canReturn).toBe(false);
    });

    test('배송중(IN_TRANSIT) → canCancel=false, canReturn=false (입주 전이라 반품도 불가)', () => {
      const r = serializeGuestOrder(
        { ...baseOrder, deliveryStatus: 'IN_TRANSIT' },
        { caseRow: futureCase }
      );
      expect(r.canCancel).toBe(false);
      expect(r.canReturn).toBe(false);
    });

    test('배송완료(DELIVERED) + 입주 전 → canCancel=false, canReturn=false', () => {
      const r = serializeGuestOrder(
        { ...baseOrder, deliveryStatus: 'DELIVERED' },
        { caseRow: futureCase }
      );
      expect(r.canCancel).toBe(false);
      expect(r.canReturn).toBe(false);
    });

    test('배송완료(DELIVERED) + 입주 ~ 퇴실 기간 → canReturn=true', () => {
      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const plus5 = new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000);
      const fmt = d => d.toISOString().slice(0, 10);
      const r = serializeGuestOrder(
        { ...baseOrder, deliveryStatus: 'DELIVERED' },
        { caseRow: { checkInDate: fmt(yesterday), checkOutDate: fmt(plus5) } }
      );
      expect(r.canCancel).toBe(false);
      expect(r.canReturn).toBe(true);
    });

    test('전액 환불 종료(FULLY_REFUNDED) → canCancel/canReturn=false', () => {
      const r = serializeGuestOrder(
        { ...baseOrder, status: 'FULLY_REFUNDED', deliveryStatus: 'PENDING',
          items: [{ id: 1, quantity: 1, totalPrice: 0, status: 'CANCELLED' }] },
        { caseRow: futureCase }
      );
      expect(r.canCancel).toBe(false);
      expect(r.canReturn).toBe(false);
    });
  });
});
