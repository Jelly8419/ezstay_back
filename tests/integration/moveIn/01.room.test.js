/**
 * 01.room.test.js
 * 간편 방 정보 CRUD + 비밀번호 암/복호화 통합 테스트
 */
'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { MoveInRoom } = require('../../../models');
const cryptoHelper = require('../../../utils/cryptoHelper');
const { createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const { createMoveInRoom, cleanupMoveInByHost } = require('../../setup/factories/moveInFactory');

describe('MoveIn /api/host/move-in/rooms', () => {
  let host, hostToken, otherHost, otherHostToken;

  beforeAll(async () => {
    ({ user: host, token: hostToken } = await createHost());
    ({ user: otherHost, token: otherHostToken } = await createHost());
  });

  afterAll(async () => {
    await cleanupMoveInByHost(host.id);
    await cleanupMoveInByHost(otherHost.id);
    await cleanupUsers([host.id, otherHost.id]);
  });

  describe('POST /rooms', () => {
    test('정상 등록 → 비밀번호 암호화 저장 + 복호화 응답', async () => {
      const res = await request(app)
        .post('/api/host/move-in/rooms')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          roomName: '오즈오 가로수길점',
          address: '서울 강남구 가로수길 9',
          detailAddress: '101동 1203호',
          areaPyeong: 18,
          livingRoomCount: 1,
          roomCount: 1,
          bathroomCount: 1,
          bedCount: 2,
          beds: [{ index: 1, size: 'QUEEN' }, { index: 2, size: 'SUPER_SINGLE' }],
          commonEntrancePassword: '2479#',
          doorLockPassword: '0512*',
          cleaningSuppliesAvailable: true,
          cleaningSuppliesLocation: '현관 수납장 하단'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.commonEntrancePassword).toBe('2479#'); // 응답은 평문
      expect(res.body.data.doorLockPassword).toBe('0512*');

      // DB는 암호문으로 저장
      const stored = await MoveInRoom.findByPk(res.body.data.id);
      expect(stored.commonEntrancePassword).not.toBe('2479#');
      expect(cryptoHelper.decrypt(stored.commonEntrancePassword)).toBe('2479#');
    });

    test('도어락 비밀번호 없으면 → 400 (열쇠 사용 집은 청소 불가)', async () => {
      const res = await request(app)
        .post('/api/host/move-in/rooms')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          address: '서울 강남구',
          detailAddress: '103호',
          areaPyeong: 10,
          livingRoomCount: 1,
          roomCount: 1,
          bathroomCount: 1,
          bedCount: 1,
          beds: [{ index: 1, size: 'QUEEN' }],
          commonEntrancePassword: '2479#',
          cleaningSuppliesAvailable: false
          // doorLockPassword 누락
        });
      expect(res.status).toBe(400);
    });

    test('공동현관 비밀번호 없어도 도어락만 있으면 → 201 (공동현관은 선택)', async () => {
      const res = await request(app)
        .post('/api/host/move-in/rooms')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          address: '서울 강남구',
          detailAddress: '104호',
          areaPyeong: 10,
          livingRoomCount: 1,
          roomCount: 1,
          bathroomCount: 1,
          bedCount: 1,
          beds: [{ index: 1, size: 'QUEEN' }],
          doorLockPassword: '0512*',
          cleaningSuppliesAvailable: false
          // commonEntrancePassword 누락 — 단독주택 등 공동현관 없는 집
        });
      expect(res.status).toBe(201);
      expect(res.body.data.commonEntrancePassword).toBeNull();
      expect(res.body.data.doorLockPassword).toBe('0512*');
    });

    test('bedCount와 beds.length 불일치 → 400', async () => {
      const res = await request(app)
        .post('/api/host/move-in/rooms')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          address: '서울 강남구',
          detailAddress: '101호',
          areaPyeong: 10,
          livingRoomCount: 1,
          roomCount: 1,
          bathroomCount: 1,
          bedCount: 2,
          beds: [{ index: 1, size: 'QUEEN' }],
          doorLockPassword: '0512*',
          cleaningSuppliesAvailable: false
        });
      expect(res.status).toBe(400);
    });

    test('청소용품 구비함인데 location 없음 → 400', async () => {
      const res = await request(app)
        .post('/api/host/move-in/rooms')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          address: '서울 강남구',
          detailAddress: '102호',
          areaPyeong: 10,
          livingRoomCount: 1,
          roomCount: 1,
          bathroomCount: 1,
          bedCount: 1,
          beds: [{ index: 1, size: 'QUEEN' }],
          doorLockPassword: '0512*',
          cleaningSuppliesAvailable: true
          // cleaningSuppliesLocation 누락
        });
      expect(res.status).toBe(400);
    });

    test('인증 없으면 401', async () => {
      const res = await request(app).post('/api/host/move-in/rooms').send({});
      expect(res.status).toBe(401);
    });
  });

  describe('GET /rooms', () => {
    test('본인 방만 조회됨 (다른 호스트 방 노출 X)', async () => {
      await createMoveInRoom(host.id, { roomName: '내방' });
      await createMoveInRoom(otherHost.id, { roomName: '남의방' });

      const res = await request(app)
        .get('/api/host/move-in/rooms')
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(200);
      const names = res.body.data.map(r => r.roomName);
      expect(names).toContain('내방');
      expect(names).not.toContain('남의방');
    });
  });

  describe('GET /rooms/:roomId', () => {
    test('타인 방 조회 시 404', async () => {
      const room = await createMoveInRoom(otherHost.id);
      const res = await request(app)
        .get(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /rooms/:roomId', () => {
    test('비밀번호 수정 시 재암호화', async () => {
      const room = await createMoveInRoom(host.id);
      const res = await request(app)
        .patch(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ doorLockPassword: '9999*' });

      expect(res.status).toBe(200);
      const reloaded = await MoveInRoom.findByPk(room.id);
      expect(cryptoHelper.decrypt(reloaded.doorLockPassword)).toBe('9999*');
    });

    test('cleaningSuppliesAvailable=false 변경 시 location 자동 null', async () => {
      const room = await createMoveInRoom(host.id, {
        cleaningSuppliesAvailable: true,
        cleaningSuppliesLocation: '있음'
      });
      const res = await request(app)
        .patch(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ cleaningSuppliesAvailable: false });

      expect(res.status).toBe(200);
      const reloaded = await MoveInRoom.findByPk(room.id);
      expect(reloaded.cleaningSuppliesAvailable).toBe(false);
      expect(reloaded.cleaningSuppliesLocation).toBeNull();
    });
  });

  describe('DELETE /rooms/:roomId', () => {
    test('연결된 케이스 없으면 soft delete', async () => {
      const room = await createMoveInRoom(host.id);
      const res = await request(app)
        .delete(`/api/host/move-in/rooms/${room.id}`)
        .set('Authorization', `Bearer ${hostToken}`);
      expect(res.status).toBe(200);

      const reloaded = await MoveInRoom.findByPk(room.id, { paranoid: false });
      expect(reloaded.deletedAt).not.toBeNull();
    });
  });
});
