/**
 * 04.rentalItems.test.js
 * TC-04-01 ~ TC-04-06: 렌탈 아이템 수정 통합 테스트
 *
 * PATCH /api/contracts/:contractId/rental-items
 *
 * 허용 상태: PENDING_APPROVAL, APPROVED (결제 전만)
 * 결제 후(PAYMENT_COMPLETED~) 추가 렌탈은 별도 API (POST /rental-orders)
 */

'use strict';

require('../../setup/setup');

const request = require('supertest');
const app     = require('../../setup/testApp');
const { Contract, RentalItem, RentalItemReservation } = require('../../../models');
const { createHost, cleanupUsers }  = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms }  = require('../../setup/factories/roomFactory');
const {
  createApprovedContract,
  createPaidContract,
  cleanupContract,
  daysLater,
} = require('../../setup/factories/contractFactory');

// ─── 공통 데이터 ────────────────────────────────────────────────────

let host, hostToken;
let room;
let rentalItemActive;   // 재고 충분한 아이템
let rentalItemNoStock;  // 재고 0인 아이템

let createdContractIds  = [];
let createdUserIds      = [];
let createdRoomIds      = [];
let createdRentalItems  = [];

beforeAll(async () => {
  const h = await createHost();
  host      = h.user;
  hostToken = h.token;

  const r = await createRoom(host.id);
  room = r.room;

  createdUserIds.push(host.id);
  createdRoomIds.push(room.id);

  // 재고 충분한 아이템 생성
  rentalItemActive = await RentalItem.create({
    itemType: 'amenity_kit',
    salesType: 'SALE',
    name: '테스트 어메니티 키트',
    price: 5000,
    totalStock: 10,
    isActive: true,
  });
  createdRentalItems.push(rentalItemActive.id);

  // 재고 0인 아이템 생성
  rentalItemNoStock = await RentalItem.create({
    itemType: 'towel_set',
    salesType: 'SALE',
    name: '테스트 타월 세트 (품절)',
    price: 3000,
    totalStock: 0,
    isActive: true,
  });
  createdRentalItems.push(rentalItemNoStock.id);
});

afterAll(async () => {
  for (const id of createdContractIds) {
    await cleanupContract(id).catch(() => {});
  }
  await cleanupRooms(createdRoomIds).catch(() => {});
  await cleanupUsers(createdUserIds).catch(() => {});
  // 렌탈 아이템 정리
  for (const id of createdRentalItems) {
    await RentalItemReservation.destroy({ where: { rentalItemId: id } }).catch(() => {});
    await RentalItem.destroy({ where: { id } }).catch(() => {});
  }
});

// APPROVED 계약 생성 헬퍼
async function makeApproved(options = {}) {
  const result = await createApprovedContract({ host, room, ...options });
  createdContractIds.push(result.contract.id);
  return result;
}

// ─── TC-04-01: APPROVED 상태에서 렌탈 아이템 추가 ──────────────────

test('TC-04-01: APPROVED 상태에서 렌탈 아이템 추가 → 200, rentalItems 저장', async () => {
  const { contract, guestToken } = await makeApproved();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/rental-items`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ rentalItems: [{ itemId: rentalItemActive.id, quantity: 2 }] });

  expect(res.status).toBe(200);
  expect(res.body.data.rentalItems).toHaveLength(1);
  expect(res.body.data.rentalItems[0].itemId).toBe(rentalItemActive.id);
  expect(res.body.data.rentalItems[0].quantity).toBe(2);
  expect(res.body.data.rentalItemsFee).toBe(10000); // 5000 * 2

  // DB 반영 확인
  const updated = await Contract.findByPk(contract.id);
  expect(updated.rentalItemsFee).toBe(10000);
});

// ─── TC-04-02: 입주 5일 전 이후 변경 시도 → 400, code 4701 ─────────

test('TC-04-02: 입주 5일 전 이후 변경 시도 → 400, code 4701', async () => {
  // 체크인이 3일 후 → 이미 5일 기한 초과
  const { contract, guestToken } = await makeApproved({
    contractOverrides: {
      checkInDate: daysLater(3),
      checkOutDate: daysLater(17),
    },
  });

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/rental-items`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ rentalItems: [{ itemId: rentalItemActive.id, quantity: 1 }] });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4701);
});

// ─── TC-04-03: 재고 부족 아이템 선택 → 400, code 4702 ───────────────

test('TC-04-03: 재고 부족 아이템 선택 → 400, code 4702', async () => {
  const { contract, guestToken } = await makeApproved();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/rental-items`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ rentalItems: [{ itemId: rentalItemNoStock.id, quantity: 1 }] });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4702);
});

// ─── TC-04-04: 호스트가 변경 시도 → 403 ────────────────────────────

test('TC-04-04: 호스트가 렌탈 아이템 변경 시도 → 403', async () => {
  const { contract } = await makeApproved();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/rental-items`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ rentalItems: [{ itemId: rentalItemActive.id, quantity: 1 }] });

  expect(res.status).toBe(403);
});

// ─── TC-04-05: PAYMENT_COMPLETED 이후 PATCH rental-items 시도 → 400, code 4710

test('TC-04-05: PAYMENT_COMPLETED 이후 PATCH rental-items 시도 → 400, code 4710', async () => {
  const { contract, guestToken } = await (async () => {
    const result = await createPaidContract({ host, room });
    createdContractIds.push(result.contract.id);
    return result;
  })();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/rental-items`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ rentalItems: [{ itemId: rentalItemActive.id, quantity: 1 }] });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe(4710);
});

// ─── TC-04-06: 렌탈 아이템 없이 업데이트 → 200, rentalItemsFee=0 ───

test('TC-04-06: 렌탈 아이템 없이 업데이트 → 200, rentalItemsFee=0', async () => {
  const { contract, guestToken } = await makeApproved();

  const res = await request(app)
    .patch(`/api/contracts/${contract.id}/rental-items`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ rentalItems: [] });

  expect(res.status).toBe(200);
  expect(res.body.data.rentalItems).toBeNull();
  expect(res.body.data.rentalItemsFee).toBe(0);
});
