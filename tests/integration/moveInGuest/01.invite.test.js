/**
 * 01.invite.test.js
 * 비로그인 미리보기 + bind 통합 테스트
 *
 * 검증:
 *  - GET /invite/:token: 비로그인 미리보기 (옵션 카탈로그 + 마스킹된 주소)
 *  - 로그인 + phone 매칭 시 풀 노출
 *  - phone 불일치 시 결제 불가 표시
 *  - 토큰 만료 → 410
 *  - POST /invite/:token/bind: phone 매칭 시 guestUserId 갱신, 불일치 시 403
 *  - 청소 정보 응답 절대 미포함 (PRD 14.7-8)
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { MoveInPaymentRequest, MoveInCase, Notification } = require('../../../models');
const { createHost, createGuest, cleanupUsers } = require('../../setup/factories/userFactory');
const {
  createMoveInRoom,
  cleanupMoveInByHost
} = require('../../setup/factories/moveInFactory');
const {
  createMoveInCase,
  createPaymentRequest,
  createMoveInOption,
  cleanupMoveInOptions,
  cleanupMoveInNotifications
} = require('../../setup/factories/moveInGuestFactory');

describe('MoveIn Guest — Invite Preview & Bind', () => {
  let host, guest, otherGuest, room;
  const optionIds = [];
  const userIds = [];

  beforeAll(async () => {
    ({ user: host } = await createHost({ phoneNumber: '01099999999' }));
    ({ user: guest } = await createGuest({ phoneNumber: '01023456789' }));
    ({ user: otherGuest } = await createGuest({ phoneNumber: '01077777777' }));
    userIds.push(host.id, guest.id, otherGuest.id);

    room = await createMoveInRoom(host.id, { areaPyeong: 18 });

    const opt = await createMoveInOption({ name: '어메니티 키트', price: 10000 });
    optionIds.push(opt.id);
  });

  afterAll(async () => {
    await cleanupMoveInNotifications(userIds);
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
  });

  test('GET /invite/:token (비로그인) → 200 + 옵션 카탈로그 + 마스킹된 주소', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestPhone: '01023456789',
      checkInDate: '2027-07-01',
      checkOutDate: '2027-07-15'
    });
    const pr = await createPaymentRequest(c.id);

    const res = await request(app).get(`/api/guest/move-in/invite/${pr.token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const d = res.body.data;
    expect(d.requestId).toBe(c.id);
    expect(d.authRequired).toBe(true);
    expect(d.room.detailAddress).toBeNull(); // 비로그인 마스킹
    expect(Array.isArray(d.options)).toBe(true);
    expect(d.options.length).toBeGreaterThan(0);
    expect(d.paymentEligibility).toEqual({
      loggedIn: false,
      phoneMatched: false,
      canPay: false
    });

    // 청소 필드 미노출
    expect(JSON.stringify(d)).not.toMatch(/cleaningStatus/);
    expect(JSON.stringify(d)).not.toMatch(/cleaningFee/);
    expect(JSON.stringify(d)).not.toMatch(/Password/i);
  });

  test('GET /invite/:token (로그인 + phone 매칭) → detailAddress 노출 + canPay=true', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestPhone: '01023456789',
      checkInDate: '2027-07-20',
      checkOutDate: '2027-07-30'
    });
    const pr = await createPaymentRequest(c.id);

    const { token: guestToken } = await loginGuest(guest);

    const res = await request(app)
      .get(`/api/guest/move-in/invite/${pr.token}`)
      .set('Authorization', `Bearer ${guestToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.room.detailAddress).toBeTruthy();
    expect(res.body.data.authRequired).toBe(false);
    expect(res.body.data.paymentEligibility.canPay).toBe(true);
  });

  test('GET /invite/:token (로그인 + phone 불일치) → canPay=false', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestPhone: '01023456789',
      checkInDate: '2027-08-01',
      checkOutDate: '2027-08-10'
    });
    const pr = await createPaymentRequest(c.id);

    const { token: otherToken } = await loginGuest(otherGuest);
    const res = await request(app)
      .get(`/api/guest/move-in/invite/${pr.token}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.paymentEligibility.canPay).toBe(false);
    expect(res.body.data.paymentEligibility.phoneMatched).toBe(false);
    expect(res.body.data.room.detailAddress).toBeNull();
  });

  test('GET /invite/:token (토큰 만료) → 410', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestPhone: '01023456789',
      checkInDate: '2027-09-01',
      checkOutDate: '2027-09-10'
    });
    const pr = await createPaymentRequest(c.id, {
      expiresAt: new Date(Date.now() - 1000) // 이미 만료
    });

    const res = await request(app).get(`/api/guest/move-in/invite/${pr.token}`);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe(4781); // MOVE_IN_GUEST_TOKEN_EXPIRED
  });

  test('GET /invite/:token (잘못된 토큰) → 404', async () => {
    const res = await request(app).get('/api/guest/move-in/invite/nonexistent-token');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(4780); // MOVE_IN_GUEST_TOKEN_INVALID
  });

  test('POST /invite/:token/bind (phone 일치) → guestUserId 갱신', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestPhone: '01023456789',
      checkInDate: '2027-10-01',
      checkOutDate: '2027-10-10'
    });
    const pr = await createPaymentRequest(c.id);

    const { token: guestToken } = await loginGuest(guest);
    const res = await request(app)
      .post(`/api/guest/move-in/invite/${pr.token}/bind`)
      .set('Authorization', `Bearer ${guestToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.bound).toBe(true);

    const fresh = await MoveInCase.findByPk(c.id);
    expect(fresh.guestUserId).toBe(guest.id);
  });

  test('POST /invite/:token/bind (phone 불일치) → 403', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestPhone: '01023456789',
      checkInDate: '2027-11-01',
      checkOutDate: '2027-11-10'
    });
    const pr = await createPaymentRequest(c.id);

    const { token: otherToken } = await loginGuest(otherGuest);
    const res = await request(app)
      .post(`/api/guest/move-in/invite/${pr.token}/bind`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(4782); // MOVE_IN_GUEST_PHONE_MISMATCH
  });

  test('POST /invite/:token/bind (이미 다른 유저 bound) → 403', async () => {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id, // 이미 bound
      guestPhone: '01023456789',
      checkInDate: '2027-12-01',
      checkOutDate: '2027-12-10'
    });
    const pr = await createPaymentRequest(c.id);

    // 다른 게스트가 시도하지만 phone 도 불일치
    const { token: otherToken } = await loginGuest(otherGuest);
    const res = await request(app)
      .post(`/api/guest/move-in/invite/${pr.token}/bind`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });
});

// helper: 토큰 재발급 (factory 토큰 만료 우려 회피용 — 그냥 동일 토큰 재사용)
async function loginGuest(user) {
  const { generateToken } = require('../../setup/factories/userFactory');
  return { token: generateToken(user) };
}
