/**
 * 08.admin-orders.test.js
 * 관리자 게스트 주문 모니터링 + 배송 상태 갱신 통합 테스트
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { MoveInGuestOrder, MoveInGuestOrderLog } = require('../../../models');
const { createHost, createGuest, cleanupUsers } = require('../../setup/factories/userFactory');
const { createAdmin, cleanupAdmins } = require('../../setup/factories/adminFactory');
const { createMoveInRoom, cleanupMoveInByHost } = require('../../setup/factories/moveInFactory');
const {
  createMoveInCase,
  createMoveInOption,
  createPaidGuestOrder,
  cleanupMoveInOptions,
  cleanupMoveInNotifications
} = require('../../setup/factories/moveInGuestFactory');

describe('Admin — Guest Orders Monitoring', () => {
  let admin, adminToken, host, guest, room, opt, c, order;
  const optionIds = [];
  const userIds = [];

  beforeAll(async () => {
    ({ admin, token: adminToken } = await createAdmin());
    ({ user: host } = await createHost());
    ({ user: guest } = await createGuest({ phoneNumber: '01023456789', name: '관리자조회테스트' }));
    userIds.push(host.id, guest.id);

    room = await createMoveInRoom(host.id);
    opt = await createMoveInOption({ name: '관리자조회용', price: 9000 });
    optionIds.push(opt.id);

    c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestName: '관리자조회테스트', // 검색 매칭용
      guestPhone: '01023456789',
      checkInDate: '2029-01-15',
      checkOutDate: '2029-01-20'
    });
    ({ order } = await createPaidGuestOrder({
      caseId: c.id,
      guestUserId: guest.id,
      options: [{ option: opt, quantity: 1 }],
      checkInDate: c.checkInDate
    }));
  });

  afterAll(async () => {
    await cleanupMoveInNotifications(userIds);
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
    await cleanupAdmins([admin.id]);
  });

  test('GET /guest-orders — 목록 조회', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/guest-orders')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    // 청소 정보 미노출
    expect(JSON.stringify(res.body.data)).not.toMatch(/cleaningStatus/);
  });

  test('GET /guest-orders?status=PAID — 필터', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/guest-orders?status=PAID')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    res.body.data.items.forEach(it => expect(it.status).toBe('PAID'));
  });

  test('GET /guest-orders?search= — guestName 검색', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/guest-orders?search=관리자조회')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /guest-orders/:id — 상세 + 로그', async () => {
    const res = await request(app)
      .get(`/api/admin/move-in/guest-orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(order.id);
    expect(Array.isArray(res.body.data.logs)).toBe(true);
  });

  test('PATCH /guest-orders/:id/delivery — PENDING → IN_TRANSIT', async () => {
    const res = await request(app)
      .patch(`/api/admin/move-in/guest-orders/${order.id}/delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deliveryStatus: 'IN_TRANSIT', note: '발송 완료' });
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryStatus).toBe('IN_TRANSIT');

    const fresh = await MoveInGuestOrder.findByPk(order.id);
    expect(fresh.deliveryStatus).toBe('IN_TRANSIT');

    const log = await MoveInGuestOrderLog.findOne({
      where: { guestOrderId: order.id, action: 'DELIVERY_UPDATED' },
      order: [['createdAt', 'DESC']]
    });
    expect(log).toBeTruthy();
    expect(log.actor).toBe('ADMIN');
  });

  test('PATCH delivery → DELIVERED → deliveredAt 자동 기록', async () => {
    const res = await request(app)
      .patch(`/api/admin/move-in/guest-orders/${order.id}/delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deliveryStatus: 'DELIVERED' });
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryStatus).toBe('DELIVERED');
    expect(res.body.data.deliveredAt).toBeTruthy();
  });

  test('PATCH delivery — 잘못된 전이 (DELIVERED → PENDING) → 400', async () => {
    const res = await request(app)
      .patch(`/api/admin/move-in/guest-orders/${order.id}/delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deliveryStatus: 'PENDING' });
    expect(res.status).toBe(400);
  });

  test('미인증 → 401', async () => {
    const res = await request(app).get('/api/admin/move-in/guest-orders');
    expect(res.status).toBe(401);
  });
});
