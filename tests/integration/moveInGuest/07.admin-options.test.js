/**
 * 07.admin-options.test.js
 * 관리자 옵션 카탈로그 CRUD 통합 테스트
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app = require('../../setup/testApp');
const { MoveInOption } = require('../../../models');
const { createAdmin, cleanupAdmins } = require('../../setup/factories/adminFactory');
const { cleanupMoveInOptions } = require('../../setup/factories/moveInGuestFactory');

describe('Admin — MoveIn Option Catalog CRUD', () => {
  let admin, adminToken;
  const createdIds = [];

  beforeAll(async () => {
    ({ admin, token: adminToken } = await createAdmin());
  });

  afterAll(async () => {
    await cleanupMoveInOptions(createdIds);
    await cleanupAdmins([admin.id]);
  });

  test('POST /options — 정상 생성', async () => {
    const res = await request(app)
      .post('/api/admin/move-in/options')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '관리자생성옵션',
        optionType: 'PURCHASE',
        category: 'AMENITY_KIT',
        price: 15000,
        totalStock: 50
      });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('관리자생성옵션');
    createdIds.push(res.body.data.id);
  });

  test('POST /options — RENTAL totalStock=0 → 400', async () => {
    const res = await request(app)
      .post('/api/admin/move-in/options')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '재고없는대여',
        optionType: 'RENTAL',
        price: 30000,
        totalStock: 0
      });
    expect(res.status).toBe(400);
    expect(res.body.details).toMatch(/RENTAL/);
  });

  test('POST /options — 필수 필드 누락 → 400', async () => {
    const res = await request(app)
      .post('/api/admin/move-in/options')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '불완전' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4002); // MISSING_REQUIRED_FIELDS
  });

  test('GET /options — 목록 페이지네이션 + 필터', async () => {
    // 추가 옵션 1개 더
    const r2 = await request(app)
      .post('/api/admin/move-in/options')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '필터용RENTAL',
        optionType: 'RENTAL',
        category: 'BEDDING_SET',
        price: 30000,
        totalStock: 10
      });
    createdIds.push(r2.body.data.id);

    const all = await request(app)
      .get('/api/admin/move-in/options')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(all.status).toBe(200);
    expect(all.body.data.items.length).toBeGreaterThanOrEqual(2);

    const filtered = await request(app)
      .get('/api/admin/move-in/options?optionType=RENTAL')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    filtered.body.data.items.forEach(it => expect(it.optionType).toBe('RENTAL'));
  });

  test('PATCH /options/:id — 부분 수정', async () => {
    const optionId = createdIds[0];
    const res = await request(app)
      .patch(`/api/admin/move-in/options/${optionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: 18000, displayOrder: 99 });
    expect(res.status).toBe(200);
    expect(res.body.data.price).toBe(18000);
    expect(res.body.data.displayOrder).toBe(99);
  });

  test('DELETE /options/:id — Soft 비활성화', async () => {
    const optionId = createdIds[0];
    const res = await request(app)
      .delete(`/api/admin/move-in/options/${optionId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    const fresh = await MoveInOption.findByPk(optionId);
    expect(fresh.isActive).toBe(false);
  });

  test('GET /options/:id — activeUsageCount 포함', async () => {
    const optionId = createdIds[1];
    const res = await request(app)
      .get(`/api/admin/move-in/options/${optionId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.activeUsageCount).toBeDefined();
  });

  test('미인증 → 401', async () => {
    const res = await request(app)
      .get('/api/admin/move-in/options');
    expect(res.status).toBe(401);
  });
});
