/**
 * 11.refund.test.js
 * 입주 준비 서비스 환불 — 임차인 취소/반품 + 관리자 승인/거절 + 임대인 청소 환불
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const {
  MoveInCase,
  MoveInGuestOrder,
  MoveInGuestOrderItem,
  MoveInGuestPayment,
  MoveInGuestRefundRequest,
  MoveInPayment,
  MoveInServiceTask
} = require('../../../models');
const { createHost, createGuest, cleanupUsers } = require('../../setup/factories/userFactory');
const { createAdmin, cleanupAdmins } = require('../../setup/factories/adminFactory');
const { createMoveInRoom, cleanupMoveInByHost } = require('../../setup/factories/moveInFactory');
const {
  createMoveInCase,
  createMoveInOption,
  createPaidGuestOrder,
  cleanupMoveInGuestByCases,
  cleanupMoveInOptions,
  cleanupMoveInNotifications
} = require('../../setup/factories/moveInGuestFactory');

describe('입주 준비 환불', () => {
  let host, guest, guestToken, admin, adminToken, room, opt;
  const optionIds = [];
  const caseIds = [];
  const userIds = [];

  beforeAll(async () => {
    process.env.PAYMENT_USE_MOCK = 'true';
    ({ user: host } = await createHost());
    ({ user: guest, token: guestToken } = await createGuest({ phoneNumber: '01066667777', name: '환불테스트' }));
    ({ admin, token: adminToken } = await createAdmin());
    userIds.push(host.id, guest.id);

    room = await createMoveInRoom(host.id, { areaPyeong: 18 });
    opt = await createMoveInOption({ name: '환불테스트옵션', category: 'AMENITY_KIT', price: 30000 });
    optionIds.push(opt.id);
  });

  afterAll(async () => {
    await cleanupMoveInGuestByCases(caseIds);
    await MoveInGuestRefundRequest.destroy({ where: { caseId: caseIds } });
    // 청소 환불 테스트가 만든 케이스의 결제/태스크/케이스/방 직접 정리 (여러 host 분산)
    await MoveInServiceTask.destroy({ where: { caseId: caseIds } });
    await MoveInPayment.destroy({ where: { caseId: caseIds } });
    const cases = await MoveInCase.findAll({ where: { id: caseIds }, attributes: ['moveInRoomId'] });
    const roomIds = [...new Set(cases.map(c => c.moveInRoomId))];
    await MoveInCase.destroy({ where: { id: caseIds } });
    if (roomIds.length) {
      const { MoveInRoom } = require('../../../models');
      await MoveInRoom.destroy({ where: { id: roomIds } });
    }
    await cleanupMoveInNotifications(userIds);
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
    await cleanupAdmins([admin.id]);
  });

  async function makeCaseWithPaidOrder({ checkInDate, checkOutDate, deliveryStatus = 'PENDING' }) {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestName: '환불테스트',
      guestPhone: '01066667777',
      checkInDate,
      checkOutDate
    });
    caseIds.push(c.id);
    const { order } = await createPaidGuestOrder({
      caseId: c.id,
      guestUserId: guest.id,
      options: [{ option: opt, quantity: 1 }],
      checkInDate
    });
    if (deliveryStatus !== 'PENDING') {
      await order.update({ deliveryStatus });
    }
    return { c, order };
  }

  // ── 임차인 취소 (즉시) ─────────────────────────────────────────
  describe('POST /orders/:orderId/cancel — 즉시 취소', () => {
    test('결제완료 ~ D-5 전: 전액 환불', async () => {
      // 입주일을 충분히 미래로 → D-5 전
      const { c, order } = await makeCaseWithPaidOrder({
        checkInDate: '2030-01-20', checkOutDate: '2030-01-25'
      });
      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ reason: '단순 변심' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('FULLY_REFUNDED');
      expect(res.body.data.refundAmount).toBe(30000);
      expect(res.body.data.shippingDeduction).toBe(0);

      const fresh = await MoveInGuestOrder.findByPk(order.id);
      expect(fresh.status).toBe('FULLY_REFUNDED');
      const item = await MoveInGuestOrderItem.findOne({ where: { guestOrderId: order.id } });
      expect(item.status).toBe('CANCELLED');
      const pay = await MoveInGuestPayment.findOne({ where: { guestOrderId: order.id } });
      expect(pay.status).toBe('CANCELLED');
    });

    test('입주일 이후: 취소 불가 (4799)', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const plus5 = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { order } = await makeCaseWithPaidOrder({
        checkInDate: yesterday, checkOutDate: plus5
      });
      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4799);
    });

    test('D-5 이후 + 배송중: 취소 불가 (4799)', async () => {
      // 입주일 = 오늘+3일 → D-5 이미 지남, 배송중
      const checkIn = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const checkOut = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { order } = await makeCaseWithPaidOrder({
        checkInDate: checkIn, checkOutDate: checkOut, deliveryStatus: 'IN_TRANSIT'
      });
      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4799);
    });
  });

  // ── 임차인 반품 요청 + 관리자 승인/거절 ───────────────────────
  describe('반품 요청 → 관리자 승인/거절', () => {
    test('입주일~퇴실일 + 배송완료: 반품 요청 접수', async () => {
      const checkIn = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 어제 입주
      const checkOut = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { order } = await makeCaseWithPaidOrder({
        checkInDate: checkIn, checkOutDate: checkOut, deliveryStatus: 'DELIVERED'
      });

      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/return`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ reason: '파손' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PENDING');
      const reqId = res.body.data.refundRequestId;

      const item = await MoveInGuestOrderItem.findOne({ where: { guestOrderId: order.id } });
      expect(item.status).toBe('RETURN_REQUESTED');

      // 중복 요청 차단
      const dup = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/return`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});
      expect(dup.status).toBe(409);

      // 관리자 승인 → 왕복배송비 7000 차감
      const approve = await request(app)
        .patch(`/api/admin/move-in/refund-requests/${reqId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(approve.status).toBe(200);
      expect(approve.body.data.shippingDeduction).toBe(7000);
      expect(approve.body.data.finalRefundAmount).toBe(23000); // 30000 - 7000

      const fresh = await MoveInGuestOrder.findByPk(order.id);
      expect(fresh.status).toBe('FULLY_REFUNDED');
      const reqRow = await MoveInGuestRefundRequest.findByPk(reqId);
      expect(reqRow.status).toBe('APPROVED');
    });

    test('반품 거절 → 라인 ACTIVE 원복', async () => {
      const checkIn = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const checkOut = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { order } = await makeCaseWithPaidOrder({
        checkInDate: checkIn, checkOutDate: checkOut, deliveryStatus: 'DELIVERED'
      });
      const reqRes = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/return`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ reason: '변심' });
      const reqId = reqRes.body.data.refundRequestId;

      const reject = await request(app)
        .patch(`/api/admin/move-in/refund-requests/${reqId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rejectReason: '사용 흔적 있음' });
      expect(reject.status).toBe(200);

      const item = await MoveInGuestOrderItem.findOne({ where: { guestOrderId: order.id } });
      expect(item.status).toBe('ACTIVE');
      const fresh = await MoveInGuestOrder.findByPk(order.id);
      expect(fresh.status).toBe('PAID'); // 환불 안 됨
    });

    test('배송 전 주문 반품 요청 → 거절 (4799)', async () => {
      const checkIn = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const checkOut = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { order } = await makeCaseWithPaidOrder({
        checkInDate: checkIn, checkOutDate: checkOut, deliveryStatus: 'PENDING'
      });
      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/return`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4799);
    });
  });

  // ── 관리자 반품 요청 조회 (목록/단건/케이스 상세 동봉) ──────────
  describe('관리자 반품 요청 조회', () => {
    let caseId, orderId, reqId;

    beforeAll(async () => {
      const checkIn = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const checkOut = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { c, order } = await makeCaseWithPaidOrder({
        checkInDate: checkIn, checkOutDate: checkOut, deliveryStatus: 'DELIVERED'
      });
      caseId = c.id;
      orderId = order.id;
      const r = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/return`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ reason: '조회테스트' });
      reqId = r.body.data.refundRequestId;
    });

    test('GET /refund-requests — 목록 (PENDING 필터)', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/refund-requests?status=PENDING')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      const row = res.body.data.items.find(it => it.id === reqId);
      expect(row).toBeTruthy();
      expect(row.status).toBe('PENDING');
      expect(row.order.orderDbId).toBe(orderId);
      expect(row.case.guestName).toBe('환불테스트');
      // 청소 필드 비노출
      expect(JSON.stringify(row)).not.toMatch(/cleaningStatus/);
    });

    test('GET /refund-requests/:id — 단건 + 주문 라인', async () => {
      const res = await request(app)
        .get(`/api/admin/move-in/refund-requests/${reqId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(reqId);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    });

    test('GET /refund-requests/:id — 없는 ID → 4811', async () => {
      const res = await request(app)
        .get('/api/admin/move-in/refund-requests/9999999')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(4811);
    });

    test('케이스 상세에 refundRequests[] 동봉', async () => {
      const res = await request(app)
        .get(`/api/admin/move-in/cases/${caseId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.refundRequests)).toBe(true);
      const rr = res.body.data.refundRequests.find(x => x.id === reqId);
      expect(rr).toBeTruthy();
      expect(rr.status).toBe('PENDING');
      expect(rr.returnReason).toBe('조회테스트');
    });
  });

  // ── 임대인 청소 환불 ──────────────────────────────────────────
  describe('POST /cases/:caseId/cleaning/refund — 임대인 청소 환불', () => {
    async function paidCleaningCase({ checkInDate, checkOutDate, cleaningDate, cleaningTime }) {
      const { token: hToken, user: h } = await createHost();
      userIds.push(h.id);
      const rm = await createMoveInRoom(h.id, { areaPyeong: 18 });
      // 케이스 생성 (cleaningDate/Time 포함)
      const createRes = await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hToken}`)
        .send({
          moveInRoomId: rm.id,
          checkInDate, checkOutDate,
          guestName: '청소환불', guestPhone: '01066667777',
          cleaningDate, cleaningTime,
          sendGuestPaymentRequest: false
        });
      const caseId = createRes.body.data.id;
      caseIds.push(caseId);

      await request(app)
        .post(`/api/host/move-in/cases/${caseId}/cleaning/request`)
        .set('Authorization', `Bearer ${hToken}`);
      const initRes = await request(app)
        .post(`/api/host/move-in/cases/${caseId}/cleaning/payment/init`)
        .set('Authorization', `Bearer ${hToken}`);
      const paymentId = initRes.body.data.paymentId;
      await request(app)
        .post(`/api/host/move-in/cases/${caseId}/cleaning/payment/confirm`)
        .set('Authorization', `Bearer ${hToken}`)
        .send({ paymentId });
      return { hToken, caseId };
    }

    test('청소 희망일 2일 전: 전액 환불 + ServiceTask CANCELLED', async () => {
      // 희망일을 충분히 미래로
      const { hToken, caseId } = await paidCleaningCase({
        checkInDate: '2030-03-10', checkOutDate: '2030-03-15',
        cleaningDate: '2030-03-12', cleaningTime: '14:00'
      });
      // ServiceTask 가 있다고 가정하고 강제 생성 (스케줄러 미실행)
      await MoveInServiceTask.findOrCreate({
        where: { caseId, taskType: 'CLEANING' },
        defaults: { referenceDate: '2030-03-12', status: 'PENDING' }
      });

      const res = await request(app)
        .post(`/api/host/move-in/cases/${caseId}/cleaning/refund`)
        .set('Authorization', `Bearer ${hToken}`)
        .send({ reason: '일정 취소' });
      expect(res.status).toBe(200);
      expect(res.body.data.cleaningStatus).toBe('CANCELLED');
      expect(res.body.data.deduction).toBe(0);
      expect(res.body.data.refundAmount).toBe(70000);

      const c = await MoveInCase.findByPk(caseId);
      expect(c.cleaningStatus).toBe('CANCELLED');
      const pay = await MoveInPayment.findOne({ where: { caseId, status: 'REFUNDED' } });
      expect(pay).toBeTruthy();
      const task = await MoveInServiceTask.findOne({ where: { caseId, taskType: 'CLEANING' } });
      expect(task.status).toBe('CANCELLED');
    });

    test('청소 희망일 D-1: 10,000원 차감 후 환불', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const plus10 = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { hToken, caseId } = await paidCleaningCase({
        checkInDate: plus10, checkOutDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        cleaningDate: tomorrow, cleaningTime: '14:00'
      });
      const res = await request(app)
        .post(`/api/host/move-in/cases/${caseId}/cleaning/refund`)
        .set('Authorization', `Bearer ${hToken}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.deduction).toBe(10000);
      expect(res.body.data.refundAmount).toBe(60000); // 70000 - 10000
    });

    test('PAID 아닌 청소 환불 시도 → 4813', async () => {
      const { token: hToken, user: h } = await createHost();
      userIds.push(h.id);
      const rm = await createMoveInRoom(h.id, { areaPyeong: 18 });
      const createRes = await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hToken}`)
        .send({
          moveInRoomId: rm.id,
          checkInDate: '2030-04-10', checkOutDate: '2030-04-15',
          guestName: '미결제', guestPhone: '01066667777',
          sendGuestPaymentRequest: false
        });
      const caseId = createRes.body.data.id;
      caseIds.push(caseId);

      const res = await request(app)
        .post(`/api/host/move-in/cases/${caseId}/cleaning/refund`)
        .set('Authorization', `Bearer ${hToken}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4813);
    });
  });
});
