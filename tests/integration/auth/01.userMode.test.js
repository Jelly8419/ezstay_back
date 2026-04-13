/**
 * 01.userMode.test.js
 * TC-AUTH-01 ~ TC-AUTH-05: 유저 모드 전환 통합 테스트
 *
 * PATCH /api/auth/mode
 * GET   /api/auth/profile
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app     = require('../../setup/testApp');
const { User } = require('../../../models');
const { createGuest, createHost, cleanupUsers } = require('../../setup/factories/userFactory');

// ─── 공통 ──────────────────────────────────────────────────────────────

const cleanupIds = [];

afterAll(async () => {
  await cleanupUsers(cleanupIds);
});

// ─── TC-AUTH-01: guest → host 전환 성공 (계좌 있음) ────────────────────

describe('TC-AUTH-01 | PATCH /api/auth/mode — guest→host 성공', () => {
  let host, token;

  beforeAll(async () => {
    ({ user: host, token } = await createHost());
    cleanupIds.push(host.id);
    // 초기 userMode를 guest로 리셋
    await host.update({ userMode: 'guest' });
  });

  it('200 + mode: host 반환', async () => {
    const res = await request(app)
      .patch('/api/auth/mode')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'host' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mode).toBe('host');
  });

  it('DB에 userMode가 host로 저장됨', async () => {
    const updated = await User.findByPk(host.id);
    expect(updated.userMode).toBe('host');
  });
});

// ─── TC-AUTH-02: host 전환 실패 (계좌 없음) ───────────────────────────

describe('TC-AUTH-02 | PATCH /api/auth/mode — host 전환 실패 (계좌 없음)', () => {
  let guest, token;

  beforeAll(async () => {
    ({ user: guest, token } = await createGuest());
    cleanupIds.push(guest.id);
  });

  it('403 + 계좌 등록 안내 메시지', async () => {
    const res = await request(app)
      .patch('/api/auth/mode')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'host' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('DB userMode는 여전히 guest', async () => {
    const unchanged = await User.findByPk(guest.id);
    expect(unchanged.userMode).toBe('guest');
  });
});

// ─── TC-AUTH-03: 잘못된 mode 값 ───────────────────────────────────────

describe('TC-AUTH-03 | PATCH /api/auth/mode — 잘못된 mode 값', () => {
  let guest, token;

  beforeAll(async () => {
    ({ user: guest, token } = await createGuest());
    cleanupIds.push(guest.id);
  });

  it('400 반환 (mode=admin)', async () => {
    const res = await request(app)
      .patch('/api/auth/mode')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('400 반환 (mode 누락)', async () => {
    const res = await request(app)
      .patch('/api/auth/mode')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─── TC-AUTH-04: GET /profile 응답에 mode 필드 포함 ───────────────────

describe('TC-AUTH-04 | GET /api/auth/profile — mode 필드 포함', () => {
  let host, token;

  beforeAll(async () => {
    ({ user: host, token } = await createHost());
    cleanupIds.push(host.id);
    await host.update({ userMode: 'host' });
  });

  it('200 + user.mode 필드 존재', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toHaveProperty('mode');
  });

  it('DB 저장값과 응답 mode 일치', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.user.mode).toBe('host');
  });
});

// ─── TC-AUTH-05: PATCH → GET 일관성 확인 ─────────────────────────────

describe('TC-AUTH-05 | PATCH /mode → GET /profile 일관성', () => {
  let host, token;

  beforeAll(async () => {
    ({ user: host, token } = await createHost());
    cleanupIds.push(host.id);
    await host.update({ userMode: 'guest' });
  });

  it('host로 전환 후 profile 조회 시 mode=host', async () => {
    await request(app)
      .patch('/api/auth/mode')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'host' });

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.mode).toBe('host');
  });

  it('guest로 재전환 후 profile 조회 시 mode=guest', async () => {
    await request(app)
      .patch('/api/auth/mode')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'guest' });

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.mode).toBe('guest');
  });
});
