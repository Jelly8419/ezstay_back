/**
 * 02.requests.test.js
 * 본인 요청 조회: 목록 / 상세 / 옵션 카탈로그 통합 테스트
 *
 * 검증:
 *  - GET /requests: 본인(guestUserId == req.user.id) 케이스만
 *  - GET /requests/:caseId: 상세 + phone 재검증
 *  - GET /requests/:caseId/options: 카탈로그 + canPay/paymentDeadline
 *  - 청소 정보 응답 미포함
 *  - 다른 사람 케이스 접근 → 404
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { createHost, createGuest, cleanupUsers, generateToken } = require('../../setup/factories/userFactory');
const {
  createMoveInRoom,
  cleanupMoveInByHost
} = require('../../setup/factories/moveInFactory');
const {
  createMoveInCase,
  createMoveInOption,
  cleanupMoveInOptions
} = require('../../setup/factories/moveInGuestFactory');

describe('MoveIn Guest — Requests List/Detail/Options', () => {
  let host, guest, otherGuest, room;
  let case1, case2;
  const optionIds = [];
  const userIds = [];

  beforeAll(async () => {
    ({ user: host } = await createHost({ phoneNumber: '01099999999' }));
    ({ user: guest } = await createGuest({ phoneNumber: '01023456789' }));
    ({ user: otherGuest } = await createGuest({ phoneNumber: '01077777777' }));
    userIds.push(host.id, guest.id, otherGuest.id);

    room = await createMoveInRoom(host.id, { areaPyeong: 18 });

    const opt1 = await createMoveInOption({ name: '어메니티', price: 10000, displayOrder: 1 });
    const opt2 = await createMoveInOption({
      name: '침구',
      price: 35000,
      optionType: 'RENTAL',
      category: 'BEDDING_SET',
      displayOrder: 2
    });
    optionIds.push(opt1.id, opt2.id);

    // 본인 케이스 2건 + 타인 케이스 1건
    case1 = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestPhone: '01023456789',
      checkInDate: '2027-08-10',
      checkOutDate: '2027-08-15'
    });
    case2 = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: guest.id,
      guestPhone: '01023456789',
      checkInDate: '2027-09-10',
      checkOutDate: '2027-09-15'
    });
    // 타인 케이스
    await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId: otherGuest.id,
      guestPhone: '01077777777',
      checkInDate: '2027-10-10',
      checkOutDate: '2027-10-15'
    });
  });

  afterAll(async () => {
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInOptions(optionIds);
    await cleanupUsers(userIds);
  });

  test('GET /requests → 본인 케이스 2건만', async () => {
    const token = generateToken(guest);
    const res = await request(app)
      .get('/api/guest/move-in/requests')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(2);
    const ids = res.body.data.items.map(i => i.requestId).sort();
    expect(ids).toEqual([case1.id, case2.id].sort());
    // 청소 미노출
    expect(JSON.stringify(res.body.data)).not.toMatch(/cleaningStatus/);
  });

  test('GET /requests (다른 게스트) → 본인 1건만', async () => {
    const token = generateToken(otherGuest);
    const res = await request(app)
      .get('/api/guest/move-in/requests')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(1);
  });

  test('GET /requests/:caseId → 상세 + 옵션 + 주문 빈배열', async () => {
    const token = generateToken(guest);
    const res = await request(app)
      .get(`/api/guest/move-in/requests/${case1.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.requestId).toBe(case1.id);
    expect(d.canPay).toBe(true);
    expect(d.paymentDeadline).toMatch(/^2027-08-05T23:59:59/);
    expect(Array.isArray(d.options)).toBe(true);
    expect(d.options.length).toBe(2);
    expect(d.orders).toEqual([]);
    expect(JSON.stringify(d)).not.toMatch(/cleaningStatus/);
  });

  test('GET /requests/:caseId (다른 사람 케이스) → 404', async () => {
    const token = generateToken(otherGuest);
    const res = await request(app)
      .get(`/api/guest/move-in/requests/${case1.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(4783); // MOVE_IN_GUEST_CASE_NOT_FOUND
  });

  test('GET /requests/:caseId/options → 카탈로그 + 컨텍스트', async () => {
    const token = generateToken(guest);
    const res = await request(app)
      .get(`/api/guest/move-in/requests/${case1.id}/options`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.caseId).toBe(case1.id);
    expect(res.body.data.canPay).toBe(true);
    expect(res.body.data.options.length).toBe(2);
    // displayOrder 정렬 확인
    expect(res.body.data.options[0].name).toBe('어메니티');
    expect(res.body.data.options[1].name).toBe('침구');
  });

  test('미인증 → 401', async () => {
    const res = await request(app).get('/api/guest/move-in/requests');
    expect(res.status).toBe(401);
  });
});
