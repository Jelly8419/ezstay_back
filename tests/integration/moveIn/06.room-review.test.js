/**
 * 06.room-review.test.js
 * 입주 준비 방 심사 도입 통합 테스트
 *
 * 검증 시나리오 (Notion "입주 준비 서비스 Admin" PRD):
 *  1. 신규 등록 시 reviewStatus=PENDING 으로 시작
 *  2. PENDING/REJECTED 방으로 케이스 생성 시 4795 에러
 *  3. APPROVED 방만 케이스 생성 가능
 *  4. 트리거 필드(주소·평수·거실·방·화장실·침대 수) 변경 → 재심사 진입
 *  5. 비트리거 필드(memo, 비밀번호, 청소용품) 변경 → status 유지
 *  6. 관리자 ?source=move_in 분기 — 목록/단건/승인/반려
 *  7. isEditable / isSelectable 플래그 응답
 *  8. 이력 기록 (SYSTEM/HOST/ADMIN)
 */
'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { MoveInRoom, MoveInRoomStatusHistory } = require('../../../models');
const { createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const { createAdmin, cleanupAdmins } = require('../../setup/factories/adminFactory');
const { createMoveInRoom, cleanupMoveInByHost } = require('../../setup/factories/moveInFactory');

describe('입주 준비 방 심사 도입', () => {
  let host, hostToken, otherHost, otherHostToken;
  let admin, adminToken;

  beforeAll(async () => {
    ({ user: host, token: hostToken } = await createHost());
    ({ user: otherHost, token: otherHostToken } = await createHost());
    ({ admin, token: adminToken } = await createAdmin({ role: 'admin' }));
  });

  afterAll(async () => {
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInByHost(otherHost.id);
    await cleanupUsers([host.id, otherHost.id]);
    await cleanupAdmins([admin.id]);
  });

  // ============================================================
  // 1. 신규 등록 시 PENDING 시작
  // ============================================================
  describe('POST /api/host/move-in/rooms — 신규 등록 시 PENDING', () => {
    test('등록 직후 reviewStatus=PENDING, isSelectable/isEditable=false', async () => {
      const res = await request(app)
        .post('/api/host/move-in/rooms')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          roomName: '심사대기방',
          address: '서울 강남구 가로수길 1',
          detailAddress: '101동',
          areaPyeong: 12,
          livingRoomCount: 1,
          roomCount: 1,
          bathroomCount: 1,
          bedCount: 1,
          beds: [{ index: 1, size: 'QUEEN' }],
          cleaningSuppliesAvailable: false
        });

      expect(res.status).toBe(201);
      expect(res.body.data.reviewStatus).toBe('PENDING');
      expect(res.body.data.submittedAt).not.toBeNull();
      expect(res.body.data.approvedAt).toBeNull();
      expect(res.body.data.isSelectable).toBe(false);
      expect(res.body.data.isEditable).toBe(false);

      // 이력 SYSTEM 1건 기록
      const history = await MoveInRoomStatusHistory.findAll({
        where: { moveInRoomId: res.body.data.id }
      });
      expect(history).toHaveLength(1);
      expect(history[0].changedBy).toBe('SYSTEM');
      expect(history[0].previousStatus).toBeNull();
      expect(history[0].newStatus).toBe('PENDING');
    });
  });

  // ============================================================
  // 2. 케이스 생성 가드 4795
  // ============================================================
  describe('POST /api/host/move-in/cases — APPROVED 방 가드', () => {
    test('PENDING 방으로 케이스 생성 → 4795', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'PENDING' });
      const res = await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          moveInRoomId: room.id,
          checkInDate: '2027-08-10',
          checkOutDate: '2027-08-15',
          guestName: '이서연',
          guestPhone: '01023456789',
          sendGuestPaymentRequest: false
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4795);
      expect(res.body.details?.reviewStatus).toBe('PENDING');
    });

    test('REJECTED 방으로 케이스 생성 → 4795', async () => {
      const room = await createMoveInRoom(host.id, {
        reviewStatus: 'REJECTED',
        rejectionReason: '사진 부족'
      });
      const res = await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          moveInRoomId: room.id,
          checkInDate: '2027-08-10',
          checkOutDate: '2027-08-15',
          guestName: '이서연',
          guestPhone: '01023456789',
          sendGuestPaymentRequest: false
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(4795);
    });

    test('APPROVED 방은 케이스 생성 정상', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'APPROVED' });
      const res = await request(app)
        .post('/api/host/move-in/cases')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          moveInRoomId: room.id,
          checkInDate: '2027-09-10',
          checkOutDate: '2027-09-15',
          guestName: '이서연',
          guestPhone: '01023456790',
          sendGuestPaymentRequest: false
        });
      expect(res.status).toBe(201);
    });
  });

  // ============================================================
  // 3. 재심사 트리거
  // ============================================================
  describe('PATCH /api/host/move-in/rooms/:id — 재심사 트리거', () => {
    test('APPROVED 방의 areaPyeong 변경 → PENDING 재진입', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'APPROVED', areaPyeong: 15 });
      const res = await request(app)
        .patch(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ areaPyeong: 25 });

      expect(res.status).toBe(200);
      expect(res.body.data.reviewStatus).toBe('PENDING');
      expect(res.body.data.submittedAt).not.toBeNull();
      expect(res.body.message).toMatch(/재심사/);

      // HOST 이력 1건 추가
      const histories = await MoveInRoomStatusHistory.findAll({
        where: { moveInRoomId: room.id },
        order: [['changedAt', 'DESC']]
      });
      expect(histories[0].changedBy).toBe('HOST');
      expect(histories[0].previousStatus).toBe('APPROVED');
      expect(histories[0].newStatus).toBe('PENDING');
      expect(histories[0].triggeredFields).toEqual(['areaPyeong']);
    });

    test('REJECTED 방의 주소 변경 → PENDING 재진입 + rejectionReason 초기화', async () => {
      const room = await createMoveInRoom(host.id, {
        reviewStatus: 'REJECTED',
        rejectionReason: '사진 부족'
      });
      const res = await request(app)
        .patch(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ address: '서울 강남구 신주소' });

      expect(res.status).toBe(200);
      expect(res.body.data.reviewStatus).toBe('PENDING');
      expect(res.body.data.rejectionReason).toBeNull();
      expect(res.body.data.rejectedAt).toBeNull();
    });

    test('비트리거 필드(memo) 변경 → status 유지', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'APPROVED' });
      const res = await request(app)
        .patch(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ memo: '메모만 수정' });

      expect(res.status).toBe(200);
      expect(res.body.data.reviewStatus).toBe('APPROVED');
      expect(res.body.message).not.toMatch(/재심사/);
    });

    test('비밀번호만 변경 → status 유지 (비트리거)', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'APPROVED' });
      const res = await request(app)
        .patch(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ doorLockPassword: '9999*' });

      expect(res.status).toBe(200);
      expect(res.body.data.reviewStatus).toBe('APPROVED');
    });

    test('PENDING 상태에서 트리거 필드 수정 → 그대로 PENDING (이미 심사 대기)', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'PENDING', areaPyeong: 15 });
      const before = await MoveInRoomStatusHistory.count({ where: { moveInRoomId: room.id } });
      const res = await request(app)
        .patch(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ areaPyeong: 18 });

      expect(res.status).toBe(200);
      expect(res.body.data.reviewStatus).toBe('PENDING');
      // 새 이력 추가되지 않음 (재진입 아님)
      const after = await MoveInRoomStatusHistory.count({ where: { moveInRoomId: room.id } });
      expect(after).toBe(before);
    });
  });

  // ============================================================
  // 4. 관리자 ?source=move_in 분기
  // ============================================================
  describe('관리자 API — ?source=move_in', () => {
    let pendingRoom, approvedRoom;

    beforeAll(async () => {
      pendingRoom = await createMoveInRoom(host.id, {
        reviewStatus: 'PENDING', roomName: '심사대기'
      });
      approvedRoom = await createMoveInRoom(otherHost.id, {
        reviewStatus: 'APPROVED', roomName: '승인됨'
      });
    });

    test('GET /api/admin/properties/pending-review?source=move_in — PENDING 만 반환', async () => {
      const res = await request(app)
        .get('/api/admin/properties/pending-review?source=move_in')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const ids = res.body.data.properties.map(r => r.id);
      expect(ids).toContain(pendingRoom.id);
      expect(ids).not.toContain(approvedRoom.id);
      const item = res.body.data.properties.find(r => r.id === pendingRoom.id);
      expect(item.source).toBe('move_in');
      expect(item.dailyRentLabel).toBe('입주 준비 서비스');
    });

    test('GET /api/admin/properties/:id?source=move_in — 비밀번호 복호화 + 이력 포함', async () => {
      const res = await request(app)
        .get(`/api/admin/properties/${pendingRoom.id}?source=move_in`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe('move_in');
      expect(res.body.data.commonEntrancePassword).toBe('2479#');
      expect(res.body.data.doorLockPassword).toBe('0512*');
      expect(Array.isArray(res.body.data.statusHistories)).toBe(true);
    });

    test('POST /api/admin/properties/:id/approve?source=move_in — 승인 → APPROVED + 이력', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'PENDING' });
      const res = await request(app)
        .post(`/api/admin/properties/${room.id}/approve?source=move_in`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.reviewStatus).toBe('APPROVED');
      expect(res.body.data.approvedAt).not.toBeNull();

      const history = await MoveInRoomStatusHistory.findOne({
        where: { moveInRoomId: room.id, newStatus: 'APPROVED' }
      });
      expect(history).not.toBeNull();
      expect(history.changedBy).toBe('ADMIN');
      expect(history.adminId).toBe(admin.id);
    });

    test('POST /api/admin/properties/:id/approve?source=move_in — APPROVED 방 재승인 시도 → 400', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'APPROVED' });
      const res = await request(app)
        .post(`/api/admin/properties/${room.id}/approve?source=move_in`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    test('POST /api/admin/properties/:id/reject?source=move_in — 반려 → REJECTED + 사유 기록', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'PENDING' });
      const res = await request(app)
        .post(`/api/admin/properties/${room.id}/reject?source=move_in`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rejectionReason: '평수 정보가 사실과 다름' });

      expect(res.status).toBe(200);
      expect(res.body.data.reviewStatus).toBe('REJECTED');
      expect(res.body.data.rejectionReason).toBe('평수 정보가 사실과 다름');
    });

    test('POST /api/admin/properties/:id/reject?source=move_in — rejectionReason 누락 → 400', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'PENDING' });
      const res = await request(app)
        .post(`/api/admin/properties/${room.id}/reject?source=move_in`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ============================================================
  // 5. 응답 플래그 (isSelectable / isEditable)
  // ============================================================
  describe('응답 플래그 isSelectable / isEditable', () => {
    test('APPROVED → 둘 다 true', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'APPROVED' });
      const res = await request(app)
        .get(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(res.body.data.isSelectable).toBe(true);
      expect(res.body.data.isEditable).toBe(true);
    });

    test('PENDING → 둘 다 false', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'PENDING' });
      const res = await request(app)
        .get(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(res.body.data.isSelectable).toBe(false);
      expect(res.body.data.isEditable).toBe(false);
    });

    test('REJECTED → 둘 다 false', async () => {
      const room = await createMoveInRoom(host.id, { reviewStatus: 'REJECTED' });
      const res = await request(app)
        .get(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(res.body.data.isSelectable).toBe(false);
      expect(res.body.data.isEditable).toBe(false);
    });
  });
});
