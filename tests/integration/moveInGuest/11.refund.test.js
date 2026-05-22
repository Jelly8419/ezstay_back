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
  let host, guest, guestToken, admin, adminToken, room, opt, opt2;
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
    opt2 = await createMoveInOption({ name: '환불테스트옵션2', category: 'BEDDING_SET', price: 20000 });
    optionIds.push(opt.id, opt2.id);
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

  async function makeCaseWithPaidOrder({ checkInDate, checkOutDate, deliveryStatus = 'PENDING', options }) {
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
      options: options || [{ option: opt, quantity: 1 }],
      checkInDate
    });
    if (deliveryStatus !== 'PENDING') {
      await order.update({ deliveryStatus });
    }
    const items = await MoveInGuestOrderItem.findAll({
      where: { guestOrderId: order.id }, order: [['id', 'ASC']]
    });
    return { c, order, items };
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
      expect(pay.status).toBe('REFUNDED');
      expect(pay.refundedAt).toBeTruthy();
      expect(fresh.lastRefundedAt).toBeTruthy();
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

  // ── 부분 환불 (수량 단위) ──────────────────────────────────────
  describe('부분 취소/반품 (수량 단위)', () => {
    test('취소: 어메니티 2개 중 1개만 → PARTIAL_REFUND', async () => {
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: '2030-02-10', checkOutDate: '2030-02-15',
        options: [{ option: opt, quantity: 2 }]   // 30000 x 2 = 60000
      });
      const itemId = items[0].id;

      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId, cancelQuantity: 1 }], reason: '1개 변심' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PARTIAL_REFUND');
      expect(res.body.data.refundAmount).toBe(30000);  // 1개분

      const it = await MoveInGuestOrderItem.findByPk(itemId);
      expect(it.status).toBe('ACTIVE');       // 라인 살아있음
      expect(it.quantity).toBe(1);            // 2 → 1
      expect(Number(it.totalPrice)).toBe(30000);
      expect(Number(it.refundAmount)).toBe(30000);

      const fresh = await MoveInGuestOrder.findByPk(order.id);
      expect(fresh.status).toBe('PARTIAL_REFUND');
      expect(Number(fresh.refundedAmount)).toBe(30000);
    });

    test('취소: 2라인 중 1라인 전량 → 남은 라인 ACTIVE, PARTIAL_REFUND', async () => {
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: '2030-03-10', checkOutDate: '2030-03-15',
        options: [{ option: opt, quantity: 1 }, { option: opt2, quantity: 1 }]
      });
      const target = items.find(i => i.optionId === opt.id);
      const keep = items.find(i => i.optionId === opt2.id);

      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId: target.id, cancelQuantity: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PARTIAL_REFUND');
      expect(res.body.data.refundAmount).toBe(30000);

      const cancelled = await MoveInGuestOrderItem.findByPk(target.id);
      expect(cancelled.status).toBe('CANCELLED');
      const alive = await MoveInGuestOrderItem.findByPk(keep.id);
      expect(alive.status).toBe('ACTIVE');
    });

    test('취소: 전 수량 부분지정 → FULLY_REFUNDED + 결제 REFUNDED', async () => {
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: '2030-04-10', checkOutDate: '2030-04-15',
        options: [{ option: opt, quantity: 2 }]
      });
      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId: items[0].id, cancelQuantity: 2 }] });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('FULLY_REFUNDED');
      const pay = await MoveInGuestPayment.findOne({ where: { guestOrderId: order.id } });
      expect(pay.status).toBe('REFUNDED');
      expect(pay.refundedAt).toBeTruthy();
    });

    test('취소: cancelQuantity 초과 → 4814', async () => {
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: '2030-05-10', checkOutDate: '2030-05-15',
        options: [{ option: opt, quantity: 1 }]
      });
      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId: items[0].id, cancelQuantity: 5 }] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4814);
    });

    test('잔액 가드: 부분 취소 후 1~9,999원 남으면 → 4815 거부', async () => {
      // 13,000 옵션 1개 + 5,000 옵션 1개 = 18,000. 13,000 라인 취소 → 5,000 남음 (거부)
      const o13 = await createMoveInOption({ name: '잔액가드13k', category: 'AMENITY_KIT', price: 13000 });
      const o5 = await createMoveInOption({ name: '잔액가드5k', category: 'AMENITY_KIT', price: 5000 });
      optionIds.push(o13.id, o5.id);
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: '2030-08-10', checkOutDate: '2030-08-15',
        options: [{ option: o13, quantity: 1 }, { option: o5, quantity: 1 }]
      });
      const line13 = items.find(i => i.optionId === o13.id);

      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId: line13.id, cancelQuantity: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4815);

      // 주문/라인 변동 없어야 함 (거부 = 롤백)
      const fresh = await MoveInGuestOrder.findByPk(order.id);
      expect(fresh.status).toBe('PAID');
      const l = await MoveInGuestOrderItem.findByPk(line13.id);
      expect(l.status).toBe('ACTIVE');
      expect(l.quantity).toBe(1);
    });

    test('잔액 가드: 전량 취소(잔액 0) 는 통과', async () => {
      const o3 = await createMoveInOption({ name: '잔액가드3k', category: 'AMENITY_KIT', price: 3000 });
      optionIds.push(o3.id);
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: '2030-08-20', checkOutDate: '2030-08-25',
        options: [{ option: o3, quantity: 1 }]   // 3,000원 — 1~9999 구간이지만 전량이라 잔액 0
      });
      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId: items[0].id, cancelQuantity: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('FULLY_REFUNDED');
    });

    test('잔액 가드: 취소 후 10,000원 이상 남으면 통과', async () => {
      const o15 = await createMoveInOption({ name: '잔액가드15k', category: 'AMENITY_KIT', price: 15000 });
      const o8 = await createMoveInOption({ name: '잔액가드8k', category: 'AMENITY_KIT', price: 8000 });
      optionIds.push(o15.id, o8.id);
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: '2030-08-28', checkOutDate: '2030-08-30',
        options: [{ option: o15, quantity: 1 }, { option: o8, quantity: 1 }] // 23,000
      });
      const line8 = items.find(i => i.optionId === o8.id);
      // 8,000 취소 → 15,000 남음 (>= 10,000, 통과)
      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId: line8.id, cancelQuantity: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PARTIAL_REFUND');
      expect(res.body.data.refundAmount).toBe(8000);
    });

    test('PARTIAL_REFUND 주문 재취소 가능 → 남은 수량 추가 취소', async () => {
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: '2030-06-10', checkOutDate: '2030-06-15',
        options: [{ option: opt, quantity: 3 }]
      });
      const itemId = items[0].id;
      // 1차: 1개 부분취소
      await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId, cancelQuantity: 1 }] });
      // 2차: 남은 2개 중 1개 또 취소
      const res2 = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId, cancelQuantity: 1 }] });
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe('PARTIAL_REFUND');

      const it = await MoveInGuestOrderItem.findByPk(itemId);
      expect(it.quantity).toBe(1);                 // 3 → 2 → 1
      expect(Number(it.refundAmount)).toBe(60000); // 누적 30000 x 2
    });

    test('반품: 부분 수량 요청 → 스냅샷 저장, 승인 시 부분 환불 + 배송비', async () => {
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: new Date(Date.now() - 24*60*60*1000).toISOString().slice(0,10),
        checkOutDate: new Date(Date.now() + 5*24*60*60*1000).toISOString().slice(0,10),
        deliveryStatus: 'DELIVERED',
        options: [{ option: opt, quantity: 2 }]   // 30000 x 2
      });
      const itemId = items[0].id;

      const reqRes = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/return`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId, returnQuantity: 1 }], reason: '1개 파손' });
      expect(reqRes.status).toBe(200);
      const reqId = reqRes.body.data.refundRequestId;

      const rr = await MoveInGuestRefundRequest.findByPk(reqId);
      expect(rr.targetItems.length).toBe(1);
      expect(rr.targetItems[0].quantity).toBe(1);
      expect(Number(rr.itemTotalAmount)).toBe(30000);

      const approve = await request(app)
        .patch(`/api/admin/move-in/refund-requests/${reqId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(approve.status).toBe(200);
      expect(approve.body.data.shippingDeduction).toBe(7000);
      expect(approve.body.data.finalRefundAmount).toBe(23000); // 30000 - 7000
      expect(approve.body.data.orderStatus).toBe('PARTIAL_REFUND');

      const it = await MoveInGuestOrderItem.findByPk(itemId);
      expect(it.status).toBe('ACTIVE');
      expect(it.quantity).toBe(1);   // 2 → 1
    });

    test('반품 배송비 면제: 같은 케이스 이미 APPROVED 반품 존재 시 0원', async () => {
      const checkIn = new Date(Date.now() - 24*60*60*1000).toISOString().slice(0,10);
      const checkOut = new Date(Date.now() + 5*24*60*60*1000).toISOString().slice(0,10);
      const c = await createMoveInCase({
        hostId: host.id, moveInRoomId: room.id, guestUserId: guest.id,
        guestName: '환불테스트', guestPhone: '01066667777',
        checkInDate: checkIn, checkOutDate: checkOut
      });
      caseIds.push(c.id);
      // 같은 케이스에 INITIAL PAID 주문 + 이미 APPROVED 된 반품요청 1건 사전 생성
      const { order: o1 } = await createPaidGuestOrder({
        caseId: c.id, guestUserId: guest.id, options: [{ option: opt, quantity: 1 }], checkInDate: checkIn
      });
      await o1.update({ deliveryStatus: 'DELIVERED' });
      await MoveInGuestRefundRequest.create({
        guestOrderId: o1.id, caseId: c.id, requestedBy: guest.id,
        status: 'APPROVED', deliveryStatusSnapshot: 'DELIVERED',
        itemTotalAmount: 30000, shippingDeduction: 7000, finalRefundAmount: 23000
      });
      // 두 번째 주문 반품 요청 → 승인 시 배송비 면제(0)
      const { order: o2 } = await createPaidGuestOrder({
        caseId: c.id, guestUserId: guest.id, orderType: 'ADDITIONAL',
        options: [{ option: opt2, quantity: 1 }], checkInDate: checkIn
      });
      await o2.update({ deliveryStatus: 'DELIVERED' });
      const reqRes = await request(app)
        .post(`/api/guest/move-in/orders/${o2.id}/return`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ reason: '면제테스트' });
      const reqId = reqRes.body.data.refundRequestId;
      const approve = await request(app)
        .patch(`/api/admin/move-in/refund-requests/${reqId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(approve.status).toBe(200);
      expect(approve.body.data.shippingDeduction).toBe(0);   // 면제
      expect(approve.body.data.finalRefundAmount).toBe(20000); // 전액
    });

    test('주문 상세에 진행 중 반품요청 동봉 + items.pendingReturnQuantity', async () => {
      const { c, order, items } = await makeCaseWithPaidOrder({
        checkInDate: new Date(Date.now() - 24*60*60*1000).toISOString().slice(0,10),
        checkOutDate: new Date(Date.now() + 5*24*60*60*1000).toISOString().slice(0,10),
        deliveryStatus: 'DELIVERED',
        options: [{ option: opt, quantity: 2 }]
      });
      const itemId = items[0].id;

      const reqRes = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/return`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId, returnQuantity: 1 }], reason: '동봉테스트' });
      const reqId = reqRes.body.data.refundRequestId;

      // 주문 상세 (GET /requests/:caseId)
      const detail = await request(app)
        .get(`/api/guest/move-in/requests/${c.id}`)
        .set('Authorization', `Bearer ${guestToken}`);
      expect(detail.status).toBe(200);
      const ord = detail.body.data.orders.find(o => o.orderDbId === order.id);
      expect(ord).toBeTruthy();
      // 진행 중 반품요청 동봉
      expect(Array.isArray(ord.refundRequests)).toBe(true);
      const rr = ord.refundRequests.find(r => r.id === reqId);
      expect(rr).toBeTruthy();
      expect(rr.status).toBe('PENDING');
      expect(rr.targetItems).toEqual([{ itemId, quantity: 1 }]);
      // 라인별 반품 요청 중 수량
      const line = ord.items.find(i => i.itemId === itemId);
      expect(line.status).toBe('ACTIVE');           // 라인 status 불변
      expect(line.pendingReturnQuantity).toBe(1);   // 2개 중 1개 요청 중
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

      // 정책(나안): 반품 요청 시 라인 status 는 ACTIVE 유지, refundRequest 스냅샷으로 추적
      const item = await MoveInGuestOrderItem.findOne({ where: { guestOrderId: order.id } });
      expect(item.status).toBe('ACTIVE');
      const rr = await MoveInGuestRefundRequest.findByPk(reqId);
      expect(rr.targetItems.length).toBeGreaterThanOrEqual(1);

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

    test('배송중(IN_TRANSIT) + 입주 전 → 반품 요청 접수 (2026-05-20 완화)', async () => {
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: '2030-06-10', checkOutDate: '2030-06-15',
        deliveryStatus: 'IN_TRANSIT'
      });
      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/return`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId: items[0].id, returnQuantity: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.data.refundRequestId).toBeTruthy();
    });

    test('배송완료(DELIVERED) + 입주 전 → 반품 요청 접수 (2026-05-20 완화)', async () => {
      const { order, items } = await makeCaseWithPaidOrder({
        checkInDate: '2030-07-10', checkOutDate: '2030-07-15',
        deliveryStatus: 'DELIVERED'
      });
      const res = await request(app)
        .post(`/api/guest/move-in/orders/${order.id}/return`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ items: [{ itemId: items[0].id, returnQuantity: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.data.refundRequestId).toBeTruthy();
    });

    test('배송완료(DELIVERED) + 퇴실일 이후 → 반품 거절 (4799, 시점 가드)', async () => {
      const past2 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const past1 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { order } = await makeCaseWithPaidOrder({
        checkInDate: past2, checkOutDate: past1, deliveryStatus: 'DELIVERED'
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
