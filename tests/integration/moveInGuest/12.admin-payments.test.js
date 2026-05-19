/**
 * 12.admin-payments.test.js
 * 관리자 입주 준비 결제 통합 내역 — GET /api/admin/move-in/payments
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { MoveInPayment } = require('../../../models');
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

describe('Admin — 입주 준비 결제 통합 내역', () => {
  let host, guest, admin, adminToken, room, opt, c;
  const optionIds = [];
  const caseIds = [];
  const userIds = [];

  beforeAll(async () => {
    process.env.PAYMENT_USE_MOCK = 'true';
    ({ user: host } = await createHost({ name: '결제임대인', phoneNumber: '01055551111' }));
    ({ user: guest } = await createGuest({ name: '결제임차인', phoneNumber: '01066662222' }));
    ({ admin, token: adminToken } = await createAdmin());
    userIds.push(host.id, guest.id);

    room = await createMoveInRoom(host.id, { areaPyeong: 18, address: '서울 결제구 결제로 1' });
    opt = await createMoveInOption({ name: '결제내역옵션', category: 'AMENITY_KIT', price: 25000 });
    optionIds.push(opt.id);

    c = await createMoveInCase({
      hostId: host.id, moveInRoomId: room.id, guestUserId: guest.id,
      guestName: '결제임차인', guestPhone: '01066662222',
      checkInDate: '2030-09-01', checkOutDate: '2030-09-07'
    });
    caseIds.push(c.id);

    // 임대인 청소 결제 (PAID) — 모델 직접 생성
    await MoveInPayment.create({
      caseId: c.id, hostId: host.id, orderId: 'M3009010001',
      amount: 70000, status: 'PAID',
      pgProvider: 'paytag', pgMethod: 'CARD', pgTid: 'TID-CLEAN-1',
      paidAt: new Date('2030-08-25T10:00:00+09:00')
    });
    // 임대인 청소 결제 실패 1건 (재시도 흔적)
    await MoveInPayment.create({
      caseId: c.id, hostId: host.id, orderId: 'M3009010002',
      amount: 70000, status: 'FAILED',
      pgProvider: 'paytag',
      failedAt: new Date('2030-08-24T09:00:00+09:00'), failureReason: '[8314] 유효기간경과 ()'
    });
    // 임차인 옵션 결제 (PAID)
    await createPaidGuestOrder({
      caseId: c.id, guestUserId: guest.id,
      options: [{ option: opt, quantity: 2 }], checkInDate: c.checkInDate
    });
  });

  afterAll(async () => {
    await MoveInPayment.destroy({ where: { caseId: caseIds } });
    await cleanupMoveInGuestByCases(caseIds);
    await cleanupMoveInNotifications(userIds);
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
    await cleanupAdmins([admin.id]);
  });

  test('미인증 → 401', async () => {
    const res = await request(app).get('/api/admin/move-in/payments');
    expect(res.status).toBe(401);
  });

  test('통합 조회 (type=all) — 청소+옵션 + breakdown', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/payments?limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const items = res.body.data.items;
    const mine = items.filter(it => it.caseId === c.id);
    const cleaning = mine.filter(it => it.type === 'cleaning');
    const guestP = mine.filter(it => it.type === 'guest_option');
    expect(cleaning.length).toBe(2);          // PAID + FAILED
    expect(guestP.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.breakdown).toHaveProperty('cleaning');
    expect(res.body.data.breakdown).toHaveProperty('guest_option');

    // payer role 구분
    const cl = cleaning.find(x => x.status === 'PAID');
    expect(cl.payer.role).toBe('host');
    expect(cl.payer.name).toBe('결제임대인');
    const gp = guestP[0];
    expect(gp.payer.role).toBe('guest');
    // case 요약 동봉
    expect(cl.case.caseId).toBe(c.id);
    expect(cl.case.address).toBe('서울 결제구 결제로 1');
  });

  test('type=cleaning — 청소 결제만', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/payments?type=cleaning&limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    res.body.data.items.forEach(it => expect(it.type).toBe('cleaning'));
    expect(res.body.data.breakdown.guest_option).toBe(0);
  });

  test('type=guest_option — 옵션 결제만', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/payments?type=guest_option&limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    res.body.data.items.forEach(it => expect(it.type).toBe('guest_option'));
  });

  test('status=FAILED 필터', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/payments?status=FAILED&limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    res.body.data.items.forEach(it => expect(it.status).toBe('FAILED'));
    const fail = res.body.data.items.find(it => it.caseId === c.id);
    expect(fail.failureReason).toMatch(/8314/);
  });

  test('search — 주문번호', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/payments?search=M3009010001&limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.items.some(it => it.orderId === 'M3009010001')).toBe(true);
  });

  test('search — 임대인 이름', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/payments?search=결제임대인&limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const found = res.body.data.items.filter(it => it.caseId === c.id && it.type === 'cleaning');
    expect(found.length).toBe(2);
  });

  test('search — 케이스ID (숫자)', async () => {
    const res = await request(app)
      .get(`/api/admin/move-in/payments?search=${c.id}&limit=100`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.every(it => it.caseId === c.id)).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(3); // 청소2 + 옵션1+
  });

  test('기간 필터 (paidFrom/paidTo)', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/payments?paidFrom=2030-08-25&paidTo=2030-08-25&limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // 8/25 결제된 청소 PAID 1건만 (8/24 FAILED 는 제외)
    const cl = res.body.data.items.filter(it => it.caseId === c.id && it.type === 'cleaning');
    expect(cl.length).toBe(1);
    expect(cl[0].status).toBe('PAID');
  });

  test('잘못된 type → 400', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/payments?type=invalid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  test('정렬 — paidAt DESC', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/payments?type=cleaning&limit=100')
      .set('Authorization', `Bearer ${adminToken}`);
    const mine = res.body.data.items.filter(it => it.caseId === c.id);
    // PAID(8/25) 가 FAILED(8/24, paidAt null→createdAt) 보다 먼저 (최신순)
    const paidIdx = mine.findIndex(x => x.status === 'PAID');
    const failIdx = mine.findIndex(x => x.status === 'FAILED');
    expect(paidIdx).toBeLessThan(failIdx);
  });
});
