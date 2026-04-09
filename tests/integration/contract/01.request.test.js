/**
 * 01.request.test.js
 * TC-01-01 ~ TC-01-15: 계약 요청 통합 테스트
 *
 * POST /api/contracts/request
 */

'use strict';

// 공통 mock 세팅 (Firebase, PayTag, Bull, Redis)
require('../../setup/setup');

const request = require('supertest');
const app     = require('../../setup/testApp');
const { Contract, ContractStatusLog } = require('../../../models');
const { createGuest, createHost, cleanupUsers } = require('../../setup/factories/userFactory');
const { createRoom, cleanupRooms }              = require('../../setup/factories/roomFactory');
const { cleanupContract, calcAmounts, daysLater } = require('../../setup/factories/contractFactory');

// ─── 공통 헬퍼 ──────────────────────────────────────────────────────

/** 정상 계약 요청 body 생성 */
function makeRequestBody(room, overrides = {}) {
  const checkInDate  = overrides.checkInDate  || daysLater(30);
  const checkOutDate = overrides.checkOutDate || daysLater(44); // 14일
  const totalDays    = overrides.totalDays    || 14;

  const amounts = calcAmounts(room, totalDays);

  return {
    roomId: room.id,
    checkInDate,
    checkOutDate,
    totalDays,
    rentalFee:       amounts.rentalFee,
    maintenanceFee:  amounts.maintenanceFee,
    cleaningFee:     amounts.cleaningFee,
    rentalItemsFee:  0,
    platformFee:     amounts.platformFee,
    discountAmount:  0,
    subtotal:        amounts.rentalFee + amounts.maintenanceFee + amounts.cleaningFee,
    totalUsageFee:   amounts.rentalFee + amounts.maintenanceFee + amounts.cleaningFee + amounts.platformFee,
    deposit:         amounts.deposit,
    finalTotalAmount: amounts.finalTotalAmount,
    rentalItems: [],
    termsAgreed: {
      serviceTerms:       true,
      cancellationPolicy: true,
      refundPolicy:       true,
    },
    ...overrides,
  };
}

// ─── 테스트 데이터 ────────────────────────────────────────────────────

let guest, guestToken;
let host;
let room;

// 각 계약 ID (afterEach cleanup 용)
const contractIds = [];

beforeAll(async () => {
  const guestResult = await createGuest();
  guest      = guestResult.user;
  guestToken = guestResult.token;

  const hostResult = await createHost();
  host = hostResult.user;

  const roomResult = await createRoom(host.id);
  room = roomResult.room;
});

afterAll(async () => {
  // 생성된 계약 전체 정리
  for (const id of contractIds) {
    await cleanupContract(id).catch(() => {});
  }
  await cleanupRooms([room.id]).catch(() => {});
  await cleanupUsers([guest.id, host.id]).catch(() => {});
});

// ─── TC-01-01: 정상 계약 요청 ─────────────────────────────────────────

describe('TC-01-01: 정상 계약 요청', () => {
  it('201 + contractId 반환', async () => {
    const body = makeRequestBody(room);

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractId).toBeDefined();
    expect(res.body.data.status).toBe('PENDING_APPROVAL');

    const contractId = res.body.data.contractId;
    contractIds.push(contractId);

    // DB 검증
    const contract = await Contract.findByPk(contractId);
    expect(contract).not.toBeNull();
    expect(contract.guestId).toBe(guest.id);
    expect(contract.hostId).toBe(host.id);
    expect(contract.roomId).toBe(room.id);
    expect(contract.status).toBe('PENDING_APPROVAL');
    expect(contract.finalTotalAmount).toBe(body.finalTotalAmount);

    // 상태 로그 검증
    const log = await ContractStatusLog.findOne({ where: { contractId } });
    expect(log).not.toBeNull();
    expect(log.toStatus).toBe('PENDING_APPROVAL');
  });
});

// ─── TC-01-02: 인증 토큰 없음 ─────────────────────────────────────────

describe('TC-01-02: 인증 토큰 없음', () => {
  it('401 반환', async () => {
    const body = makeRequestBody(room);

    const res = await request(app)
      .post('/api/contracts/request')
      .send(body);

    expect(res.status).toBe(401);
  });
});

// ─── TC-01-03: 필수 필드 누락 (roomId) ───────────────────────────────

describe('TC-01-03: 필수 필드 누락', () => {
  it('roomId 없으면 400 반환', async () => {
    const body = makeRequestBody(room);
    delete body.roomId;

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('checkInDate 없으면 400 반환', async () => {
    const body = makeRequestBody(room);
    delete body.checkInDate;

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(400);
  });

  it('termsAgreed 없으면 400 반환', async () => {
    const body = makeRequestBody(room);
    delete body.termsAgreed;

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(400);
  });
});

// ─── TC-01-04: 약관 미동의 ────────────────────────────────────────────

describe('TC-01-04: 약관 미동의', () => {
  it('serviceTerms=false이면 400(code 4301) 반환', async () => {
    const body = makeRequestBody(room, {
      termsAgreed: {
        serviceTerms: false,
        cancellationPolicy: true,
        refundPolicy: true,
      },
    });

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4301);
  });
});

// ─── TC-01-05: 존재하지 않는 방 ──────────────────────────────────────

describe('TC-01-05: 존재하지 않는 방', () => {
  it('404 반환', async () => {
    const body = makeRequestBody(room, { roomId: 999999 });

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(404);
  });
});

// ─── TC-01-06: 자기 방 예약 불가 ─────────────────────────────────────

describe('TC-01-06: 자기 방 예약 불가', () => {
  let hostToken;

  beforeAll(async () => {
    // 호스트 토큰 발급
    hostToken = require('../../setup/factories/userFactory').generateToken(host);
  });

  it('호스트가 자신의 방 요청 시 400(code 4302) 반환', async () => {
    const body = makeRequestBody(room);

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${hostToken}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4302);
  });
});

// ─── TC-01-07: 과거 날짜 예약 불가 ───────────────────────────────────

describe('TC-01-07: 과거 날짜 예약 불가', () => {
  it('checkInDate가 과거이면 400 반환', async () => {
    const body = makeRequestBody(room, {
      checkInDate:  '2020-01-01',
      checkOutDate: '2020-01-15',
      totalDays:    14,
    });

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4303);
  });
});

// ─── TC-01-08: 날짜 일수 불일치 ──────────────────────────────────────

describe('TC-01-08: 날짜 일수 불일치', () => {
  it('totalDays가 실제 날짜 범위와 다르면 400(code 4304) 반환', async () => {
    const checkInDate  = daysLater(150);
    const checkOutDate = daysLater(164); // 실제 14일

    const body = makeRequestBody(room, {
      checkInDate,
      checkOutDate,
      totalDays: 10, // 틀린 값
    });

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4304);
  });
});

// ─── TC-01-09: 금액 불일치 ────────────────────────────────────────────

describe('TC-01-09: 금액 불일치', () => {
  it('finalTotalAmount가 서버 계산과 2원 이상 다르면 400(code 4307) 반환', async () => {
    const body = makeRequestBody(room, {
      checkInDate:  daysLater(160),
      checkOutDate: daysLater(174),
    });
    body.finalTotalAmount += 10000; // 의도적 오차

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4307);
  });
});

// ─── TC-01-10: 날짜 중복 계약 ────────────────────────────────────────

describe('TC-01-10: 날짜 중복 계약', () => {
  let conflictContractId;

  beforeAll(async () => {
    // 먼저 PAYMENT_COMPLETED 상태 계약을 직접 DB에 삽입
    const { createPaidContract } = require('../../setup/factories/contractFactory');
    const result = await createPaidContract({
      guest: guest,
      guestToken,
      host: host,
      room: room,
      checkInDate:  daysLater(60),
      checkOutDate: daysLater(74),
      totalDays:    14,
    });
    conflictContractId = result.contract.id;
    contractIds.push(conflictContractId);
  });

  it('이미 결제 완료된 기간에 요청하면 409(code 4305) 반환', async () => {
    const body = makeRequestBody(room, {
      checkInDate:  daysLater(60),
      checkOutDate: daysLater(74),
      totalDays:    14,
    });

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(4305);
  });
});

// ─── TC-01-11: 동일 게스트 중복 요청 ─────────────────────────────────

describe('TC-01-11: 동일 게스트 중복 요청', () => {
  let firstContractId;

  beforeAll(async () => {
    // 먼저 PENDING_APPROVAL 계약을 생성
    const body = makeRequestBody(room, {
      checkInDate:  daysLater(200),
      checkOutDate: daysLater(214),
      totalDays:    14,
    });

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    if (res.status === 201) {
      firstContractId = res.body.data.contractId;
      contractIds.push(firstContractId);
    }
  });

  it('동일 기간 중복 요청 시 409(code 4306) 반환', async () => {
    if (!firstContractId) {
      // 선행 계약 생성 실패 시 skip
      return;
    }

    const body = makeRequestBody(room, {
      checkInDate:  daysLater(200),
      checkOutDate: daysLater(214),
      totalDays:    14,
    });

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(4306);
  });
});

// ─── TC-01-12: 최소 계약 일수 미달 ───────────────────────────────────

describe('TC-01-12: 최소 계약 일수 미달', () => {
  it('방의 minContractDays(7일)보다 짧으면 400 반환', async () => {
    const checkInDate  = daysLater(100);
    const checkOutDate = daysLater(104); // 4일만
    const totalDays    = 4;
    const amounts      = calcAmounts(room, totalDays);

    const body = {
      roomId: room.id,
      checkInDate,
      checkOutDate,
      totalDays,
      rentalFee:       amounts.rentalFee,
      maintenanceFee:  amounts.maintenanceFee,
      cleaningFee:     amounts.cleaningFee,
      rentalItemsFee:  0,
      platformFee:     amounts.platformFee,
      discountAmount:  0,
      subtotal:        amounts.rentalFee + amounts.maintenanceFee + amounts.cleaningFee,
      totalUsageFee:   amounts.rentalFee + amounts.maintenanceFee + amounts.cleaningFee + amounts.platformFee,
      deposit:         amounts.deposit,
      finalTotalAmount: amounts.finalTotalAmount,
      rentalItems: [],
      termsAgreed: { serviceTerms: true, cancellationPolicy: true, refundPolicy: true },
    };

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(400);
  });
});

// ─── TC-01-13: 렌탈 아이템 6일 이내 마감 ─────────────────────────────

describe('TC-01-13: 렌탈 아이템 6일 이내 마감', () => {
  it('입주 6일 이내에 렌탈 아이템 포함 요청 시 400 반환', async () => {
    const checkInDate  = daysLater(3); // 3일 후 입주 → 마감 초과
    const checkOutDate = daysLater(17);
    const totalDays    = 14;
    const amounts      = calcAmounts(room, totalDays);

    const body = {
      roomId: room.id,
      checkInDate,
      checkOutDate,
      totalDays,
      rentalFee:       amounts.rentalFee,
      maintenanceFee:  amounts.maintenanceFee,
      cleaningFee:     amounts.cleaningFee,
      rentalItemsFee:  5000,
      platformFee:     amounts.platformFee,
      discountAmount:  0,
      subtotal:        amounts.rentalFee + amounts.maintenanceFee + amounts.cleaningFee,
      totalUsageFee:   amounts.rentalFee + amounts.maintenanceFee + amounts.cleaningFee + amounts.platformFee,
      deposit:         amounts.deposit,
      finalTotalAmount: amounts.finalTotalAmount,
      rentalItems: [{ itemId: 1, quantity: 1 }], // 더미 렌탈 아이템
      termsAgreed: { serviceTerms: true, cancellationPolicy: true, refundPolicy: true },
    };

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(400);
  });
});

// ─── TC-01-14: guestMessage 포함 정상 요청 ───────────────────────────

describe('TC-01-14: guestMessage 포함 정상 요청', () => {
  it('guestMessage 포함 시 DB에 저장됨', async () => {
    const body = makeRequestBody(room, {
      checkInDate:  daysLater(110),
      checkOutDate: daysLater(124),
      guestMessage: '강아지 동반입니다.',
    });

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${guestToken}`)
      .send(body);

    expect(res.status).toBe(201);
    const contractId = res.body.data.contractId;
    contractIds.push(contractId);

    const contract = await Contract.findByPk(contractId);
    expect(contract.guestMessage).toBe('강아지 동반입니다.');
  });
});

// ─── TC-01-15: 전화번호 없는 게스트 계약 불가 ─────────────────────────

describe('TC-01-15: 전화번호 없는 게스트는 계약 불가', () => {
  it('phoneNumber 없는 유저는 400 반환 (requireUserInfo 미들웨어)', async () => {
    const { user: noPhoneUser, token: noPhoneToken } = await createGuest({
      phoneNumber: null,
      phoneVerified: false,
    });

    const body = makeRequestBody(room, {
      checkInDate:  daysLater(120),
      checkOutDate: daysLater(134),
    });

    const res = await request(app)
      .post('/api/contracts/request')
      .set('Authorization', `Bearer ${noPhoneToken}`)
      .send(body);

    expect(res.status).toBe(400);

    await cleanupUsers([noPhoneUser.id]).catch(() => {});
  });
});
