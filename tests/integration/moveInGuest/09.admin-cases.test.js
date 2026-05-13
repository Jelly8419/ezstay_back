/**
 * 09.admin-cases.test.js
 * 관리자 — 입주 준비 케이스 단위 조회/수정/재발송 통합 테스트
 *
 * 대상 라우트 (routes/adminMoveInCaseRoutes.js):
 *   GET    /api/admin/move-in/cases
 *   GET    /api/admin/move-in/cases/:caseId
 *   PATCH  /api/admin/move-in/cases/:caseId
 *   POST   /api/admin/move-in/cases/:caseId/payment-request/resend
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const {
  MoveInCase,
  MoveInPaymentRequest,
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInGuestPayment
} = require('../../../models');
const { createHost, createGuest, cleanupUsers } = require('../../setup/factories/userFactory');
const { createAdmin, cleanupAdmins } = require('../../setup/factories/adminFactory');
const { createMoveInRoom, cleanupMoveInByHost } = require('../../setup/factories/moveInFactory');
const {
  createMoveInCase,
  createMoveInOption,
  createPaymentRequest,
  createPaidGuestOrder,
  cleanupMoveInGuestByCases,
  cleanupMoveInOptions,
  cleanupMoveInNotifications
} = require('../../setup/factories/moveInGuestFactory');

/**
 * PENDING 주문 직접 생성 헬퍼.
 * createPaidGuestOrder 는 PAID 만 만들어주므로, 그룹 상태 'PENDING' 산출 검증용으로 별도 작성.
 */
async function createPendingGuestOrder({ caseId, guestUserId, options, checkInDate }) {
  const { generateMoveInGuestOrderId } = require('../../../utils/orderIdGenerator');
  const { calculatePaymentDeadline } = require('../../../utils/moveInGuestPaymentGuard');

  const lines = options.map(({ option, quantity }) => ({
    optionId: option.id,
    name: option.name,
    quantity,
    pricePerItem: option.price,
    totalPrice: option.price * quantity,
    optionType: option.optionType,
    category: option.category
  }));
  const totalAmount = lines.reduce((s, l) => s + l.totalPrice, 0);

  const orderId = await generateMoveInGuestOrderId();

  const order = await MoveInGuestOrder.create({
    caseId,
    guestUserId,
    orderId,
    orderType: 'INITIAL',
    totalAmount,
    paidAmount: 0,
    refundedAmount: 0,
    status: 'PENDING',
    modifiableUntil: calculatePaymentDeadline(checkInDate),
    itemsSnapshot: lines,
    deliveryStatus: 'PENDING'
  });

  for (const l of lines) {
    await MoveInGuestOrderItem.create({
      guestOrderId: order.id,
      optionId: l.optionId,
      quantity: l.quantity,
      pricePerItem: l.pricePerItem,
      totalPrice: l.totalPrice,
      status: 'ACTIVE'
    });
  }

  return order;
}

describe('Admin — Move-in Case CRUD (Notion 입주 준비 서비스 Admin)', () => {
  let admin, adminToken, host, guest, room;
  let amenityOpt, beddingOpt;
  let caseFullPaid;     // 청소 PAID + amenity PAID + bedding PAID
  let casePending;      // 청소 NOT_REQUESTED + amenity PAID + bedding PENDING
  let caseEmpty;        // 주문 없음
  const optionIds = [];
  const caseIds = [];
  const userIds = [];

  beforeAll(async () => {
    ({ admin, token: adminToken } = await createAdmin());
    ({ user: host } = await createHost());
    ({ user: guest } = await createGuest({ phoneNumber: '01087654321', name: '관리자케이스테스트' }));
    userIds.push(host.id, guest.id);

    room = await createMoveInRoom(host.id, {
      address: '서울 강남구 케이스로 1',
      detailAddress: '101동 1234호'
    });

    amenityOpt = await createMoveInOption({
      name: '어메니티 키트 (관리자케이스용)',
      category: 'AMENITY_KIT',
      optionType: 'PURCHASE',
      price: 30000
    });
    beddingOpt = await createMoveInOption({
      name: '침구 세트 (관리자케이스용)',
      category: 'BEDDING_SET',
      optionType: 'RENTAL',
      price: 39000
    });
    optionIds.push(amenityOpt.id, beddingOpt.id);

    // 1) 풀 PAID 케이스: 청소 PAID + amenity PAID + bedding PAID
    caseFullPaid = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestName: '관리자케이스테스트',
      guestPhone: '01087654321',
      checkInDate: '2029-02-01',
      checkOutDate: '2029-02-07',
      cleaningStatus: 'PAID'
    });
    await createPaymentRequest(caseFullPaid.id, { status: 'SENT', sentAt: new Date(), resendCount: 0 });
    await createPaidGuestOrder({
      caseId: caseFullPaid.id,
      guestUserId: guest.id,
      options: [
        { option: amenityOpt, quantity: 1 },
        { option: beddingOpt, quantity: 1 }
      ],
      checkInDate: caseFullPaid.checkInDate
    });
    caseIds.push(caseFullPaid.id);

    // 2) Mixed 케이스: 청소 미신청 + amenity PAID + bedding PENDING
    casePending = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestName: '관리자케이스테스트',
      guestPhone: '01087654321',
      checkInDate: '2029-03-01',
      checkOutDate: '2029-03-07',
      cleaningStatus: 'NOT_REQUESTED'
    });
    await createPaymentRequest(casePending.id, { status: 'NOT_SENT', resendCount: 0 });
    await createPaidGuestOrder({
      caseId: casePending.id,
      guestUserId: guest.id,
      options: [{ option: amenityOpt, quantity: 1 }],
      checkInDate: casePending.checkInDate
    });
    await createPendingGuestOrder({
      caseId: casePending.id,
      guestUserId: guest.id,
      options: [{ option: beddingOpt, quantity: 1 }],
      checkInDate: casePending.checkInDate
    });
    caseIds.push(casePending.id);

    // 3) 빈 케이스: 주문 없음 + paymentRequest 없음
    caseEmpty = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestPhone: '01099998888',
      guestName: '빈케이스',
      checkInDate: '2029-04-01',
      checkOutDate: '2029-04-07',
      cleaningStatus: 'NOT_REQUESTED'
    });
    caseIds.push(caseEmpty.id);
  });

  afterAll(async () => {
    await cleanupMoveInGuestByCases(caseIds);
    await MoveInPaymentRequest.destroy({ where: { caseId: caseIds } });
    await cleanupMoveInNotifications(userIds);
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
    await cleanupAdmins([admin.id]);
  });

  // ──────────────────────────────────────────────────────────────
  // 인증
  // ──────────────────────────────────────────────────────────────
  test('미인증 → 401', async () => {
    const res = await request(app).get('/api/admin/move-in/cases');
    expect(res.status).toBe(401);
  });

  // ──────────────────────────────────────────────────────────────
  // 목록
  // ──────────────────────────────────────────────────────────────
  describe('GET /api/admin/move-in/cases — 목록', () => {
    test('기본 응답 — pagination 구조', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/cases')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('items');
      expect(res.body.data).toHaveProperty('pagination');
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(3);
    });

    test('카테고리 그룹 상태 산출 — full PAID 케이스', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/cases')
        .set('Authorization', `Bearer ${adminToken}`);
      const row = res.body.data.items.find(it => it.id === caseFullPaid.id);
      expect(row).toBeTruthy();
      expect(row.cleaning.status).toBe('PAID');
      expect(row.amenity.status).toBe('PAID');
      expect(row.bedding.status).toBe('PAID');
    });

    test('카테고리 그룹 상태 산출 — bedding 만 PENDING', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/cases')
        .set('Authorization', `Bearer ${adminToken}`);
      const row = res.body.data.items.find(it => it.id === casePending.id);
      expect(row).toBeTruthy();
      expect(row.cleaning.status).toBe('NOT_REQUESTED');
      expect(row.amenity.status).toBe('PAID');
      expect(row.bedding.status).toBe('PENDING');
    });

    test('카테고리 그룹 상태 산출 — 빈 케이스 (모두 null)', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/cases')
        .set('Authorization', `Bearer ${adminToken}`);
      const row = res.body.data.items.find(it => it.id === caseEmpty.id);
      expect(row).toBeTruthy();
      expect(row.cleaning.status).toBe('NOT_REQUESTED');
      expect(row.amenity.status).toBeNull();
      expect(row.bedding.status).toBeNull();
      expect(row.paymentRequest).toBeNull();
    });

    test('cleaningStatus 필터', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/cases?cleaningStatus=PAID')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      res.body.data.items.forEach(it => {
        expect(it.cleaning.status).toBe('PAID');
      });
    });

    test('search — 임차인 이름 LIKE', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/cases?search=관리자케이스')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(2);
      res.body.data.items.forEach(it => {
        // 주소 일치 또는 임차인 이름 일치
        expect(
          (it.address || '').includes('관리자케이스')
            || (it.detailAddress || '').includes('관리자케이스')
            || (it.guest?.name || '').includes('관리자케이스')
            || (it.guest?.phoneNumber || '').includes('관리자케이스')
        ).toBe(true);
      });
    });

    test('잘못된 cleaningStatus → 400', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/cases?cleaningStatus=INVALID')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 단건 상세
  // ──────────────────────────────────────────────────────────────
  describe('GET /api/admin/move-in/cases/:caseId — 단건 상세', () => {
    test('full PAID 케이스 응답 구조', async () => {
      const res = await request(app)
        .get(`/api/admin/move-in/cases/${caseFullPaid.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.id).toBe(caseFullPaid.id);
      // 방 정보 snapshot 노출
      expect(d.room.address).toBe('서울 강남구 케이스로 1');
      expect(d.room.detailAddress).toBe('101동 1234호');
      // 비밀번호 평문 복호화
      expect(d.room.commonEntrancePassword).toBe('2479#');
      expect(d.room.doorLockPassword).toBe('0512*');
      // 임대인/임차인
      expect(d.host).toBeTruthy();
      expect(d.guest.phoneNumber).toBe('01087654321');
      // 청소 PAID
      expect(d.cleaning.status).toBe('PAID');
      // 그룹별 상태
      expect(d.amenity.status).toBe('PAID');
      expect(d.bedding.status).toBe('PAID');
      // 그룹별 orders 응답
      expect(Array.isArray(d.amenity.orders)).toBe(true);
      expect(Array.isArray(d.bedding.orders)).toBe(true);
      expect(d.amenity.orders.length).toBeGreaterThanOrEqual(1);
      expect(d.bedding.orders.length).toBeGreaterThanOrEqual(1);
      // 같은 주문이 양쪽 그룹에 모두 노출되는지 (amenity+bedding 동시 라인 보유)
      const sharedOrderIds = d.amenity.orders.map(o => o.id)
        .filter(id => d.bedding.orders.some(b => b.id === id));
      expect(sharedOrderIds.length).toBeGreaterThanOrEqual(1);
      // paymentRequest 링크
      expect(d.paymentRequest).toBeTruthy();
      expect(d.paymentRequest.link).toMatch(/move-in\/payment\//);
    });

    test('빈 케이스 — paymentRequest null, 그룹 상태 null', async () => {
      const res = await request(app)
        .get(`/api/admin/move-in/cases/${caseEmpty.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.paymentRequest).toBeNull();
      expect(d.amenity.status).toBeNull();
      expect(d.bedding.status).toBeNull();
      expect(d.amenity.orders.length).toBe(0);
      expect(d.bedding.orders.length).toBe(0);
    });

    test('caseId 정수 아님 → 400', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/cases/abc')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });

    test('존재하지 않는 caseId → 404 MOVE_IN_CASE_NOT_FOUND (4796)', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/cases/9999999')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(4796);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // PATCH — adminMemo + lastModifiedBy 자동 갱신
  // ──────────────────────────────────────────────────────────────
  describe('PATCH /api/admin/move-in/cases/:caseId — 부분 수정', () => {
    test('adminMemo 수정 → lastModifiedBy/At 자동 갱신', async () => {
      const before = await MoveInCase.findByPk(caseEmpty.id);
      expect(before.adminMemo).toBeNull();
      expect(before.lastModifiedByAdminId).toBeNull();
      expect(before.lastModifiedAt).toBeNull();

      const res = await request(app)
        .patch(`/api/admin/move-in/cases/${caseEmpty.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adminMemo: '관리자 메모 추가' });
      expect(res.status).toBe(200);
      expect(res.body.data.adminMemo).toBe('관리자 메모 추가');
      expect(res.body.data.lastModified.admin.id).toBe(admin.id);
      expect(res.body.data.lastModified.at).toBeTruthy();

      const after = await MoveInCase.findByPk(caseEmpty.id);
      expect(after.adminMemo).toBe('관리자 메모 추가');
      expect(after.lastModifiedByAdminId).toBe(admin.id);
      expect(after.lastModifiedAt).toBeTruthy();
    });

    test('adminMemo: null 도 허용 (삭제)', async () => {
      const res = await request(app)
        .patch(`/api/admin/move-in/cases/${caseEmpty.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adminMemo: null });
      expect(res.status).toBe(200);
      expect(res.body.data.adminMemo).toBeNull();
    });

    test('수정 가능 필드 없음 → 400', async () => {
      const res = await request(app)
        .patch(`/api/admin/move-in/cases/${caseEmpty.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    test('adminMemo 타입 오류 → 400', async () => {
      const res = await request(app)
        .patch(`/api/admin/move-in/cases/${caseEmpty.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adminMemo: 123 });
      expect(res.status).toBe(400);
    });

    test('수정 화이트리스트 외 필드는 무시 (lastModifiedBy 도 갱신 안 됨)', async () => {
      const beforeMemo = (await MoveInCase.findByPk(caseEmpty.id)).adminMemo;
      const res = await request(app)
        .patch(`/api/admin/move-in/cases/${caseEmpty.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cleaningStatus: 'PAID', guestName: 'HACK' });
      // 수정 가능 필드 없음 → 400 (화이트리스트 외)
      expect(res.status).toBe(400);
      const after = await MoveInCase.findByPk(caseEmpty.id);
      expect(after.cleaningStatus).toBe('NOT_REQUESTED');  // 불변
      expect(after.guestName).toBe('빈케이스');           // 불변
      expect(after.adminMemo).toBe(beforeMemo);
    });

    test('존재하지 않는 caseId → 404', async () => {
      const res = await request(app)
        .patch('/api/admin/move-in/cases/9999999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ adminMemo: 'x' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(4796);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 알림톡 재발송
  // ──────────────────────────────────────────────────────────────
  describe('POST /api/admin/move-in/cases/:caseId/payment-request/resend', () => {
    test('기존 paymentRequest 존재 → resendCount++ + status=SENT + lastResentAt', async () => {
      const before = await MoveInPaymentRequest.findOne({ where: { caseId: casePending.id } });
      const beforeCount = before.resendCount;

      const res = await request(app)
        .post(`/api/admin/move-in/cases/${casePending.id}/payment-request/resend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SENT');
      expect(res.body.data.resendCount).toBe(beforeCount + 1);
      expect(res.body.data.lastResentAt).toBeTruthy();
      expect(res.body.data.paymentLink).toMatch(/move-in\/payment\//);

      const after = await MoveInPaymentRequest.findOne({ where: { caseId: casePending.id } });
      expect(after.status).toBe('SENT');
      expect(after.resendCount).toBe(beforeCount + 1);
      expect(after.lastResentAt).toBeTruthy();
    });

    test('paymentRequest 누락 시 자동 발급 + 발송', async () => {
      // caseEmpty 는 paymentRequest 없음 상태
      const exists = await MoveInPaymentRequest.findOne({ where: { caseId: caseEmpty.id } });
      expect(exists).toBeNull();

      const res = await request(app)
        .post(`/api/admin/move-in/cases/${caseEmpty.id}/payment-request/resend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SENT');
      expect(res.body.data.resendCount).toBe(1);

      const after = await MoveInPaymentRequest.findOne({ where: { caseId: caseEmpty.id } });
      expect(after).toBeTruthy();
      expect(after.status).toBe('SENT');
    });

    test('존재하지 않는 caseId → 404', async () => {
      const res = await request(app)
        .post('/api/admin/move-in/cases/9999999/payment-request/resend')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(4796);
    });
  });
});
