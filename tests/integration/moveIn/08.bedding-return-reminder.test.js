/**
 * 08.bedding-return-reminder.test.js
 * 침구류 반납 안내 알림톡(UI_1355) 스케줄러 통합 테스트
 *
 * 대상: schedulers/moveInScheduler.sendBeddingReturnReminders
 *  - check_out_date=오늘 & BEDDING_RETRIEVAL task(quantity>0) 케이스에만 발송
 *  - 케이스 단위 1회 발송 (AlimtalkLog move_in_case_id 가드)
 */

'use strict';

require('../../setup/setup');

const { MoveInCase, MoveInServiceTask, AlimtalkLog } = require('../../../models');
const { todayKST } = require('../../../utils/dateHelper');
const { sendBeddingReturnReminders } = require('../../../schedulers/moveInScheduler');
const { createHost, createGuest, cleanupUsers } = require('../../setup/factories/userFactory');
const { createMoveInRoom, cleanupMoveInByHost } = require('../../setup/factories/moveInFactory');
const { createMoveInCase, cleanupMoveInGuestByCases } = require('../../setup/factories/moveInGuestFactory');

describe('침구류 반납 안내 스케줄러 (UI_1355)', () => {
  let host, guest, room;
  const caseIds = [];
  const userIds = [];

  beforeAll(async () => {
    ({ user: host } = await createHost());
    ({ user: guest } = await createGuest({ phoneNumber: '01055559999', name: '침구반납테스트' }));
    userIds.push(host.id, guest.id);
    room = await createMoveInRoom(host.id);
  });

  afterAll(async () => {
    await AlimtalkLog.destroy({ where: { moveInCaseId: caseIds } }).catch(() => {});
    await MoveInServiceTask.destroy({ where: { caseId: caseIds } }).catch(() => {});
    await cleanupMoveInGuestByCases(caseIds);
    await cleanupMoveInByHost(host.id);
    await cleanupUsers(userIds);
  });

  /** 오늘 퇴실 + BEDDING_RETRIEVAL task 보유 케이스 생성 */
  async function makeCaseWithBeddingTask({ checkOutDate, quantity, taskStatus = 'PENDING', guestUserId = null }) {
    const c = await createMoveInCase({
      hostId: host.id,
      moveInRoomId: room.id,
      guestUserId,
      guestPhone: '01055559999',
      checkInDate: '2026-01-01',
      checkOutDate
    });
    caseIds.push(c.id);
    await MoveInServiceTask.create({
      caseId: c.id,
      taskType: 'BEDDING_RETRIEVAL',
      referenceDate: checkOutDate,
      status: taskStatus,
      quantity
    });
    return c;
  }

  test('오늘 퇴실 + 침구류 task 있으면 → 발송, AlimtalkLog 기록', async () => {
    const today = todayKST();
    const c = await makeCaseWithBeddingTask({ checkOutDate: today, quantity: 2, guestUserId: guest.id });

    const sent = await sendBeddingReturnReminders();
    expect(sent).toBeGreaterThanOrEqual(1);

    const log = await AlimtalkLog.findOne({
      where: { moveInCaseId: c.id, eventName: 'move_in_bedding_return_guest' }
    });
    expect(log).not.toBeNull();
  });

  test('두 번째 실행 시 같은 케이스 재발송 안 함 (중복 가드)', async () => {
    // 직전 테스트에서 발송된 케이스만 있는 상태 — 다시 실행해도 신규 발송 0
    const sentAgain = await sendBeddingReturnReminders();
    expect(sentAgain).toBe(0);
  });

  test('퇴실일이 오늘이 아니면 → 발송 대상 아님', async () => {
    await makeCaseWithBeddingTask({ checkOutDate: '2099-12-31', quantity: 1 });
    const sent = await sendBeddingReturnReminders();
    expect(sent).toBe(0);
  });

  test('침구류 task quantity=0 이면 → 발송 대상 아님', async () => {
    const today = todayKST();
    await makeCaseWithBeddingTask({ checkOutDate: today, quantity: 0 });
    const sent = await sendBeddingReturnReminders();
    expect(sent).toBe(0);
  });

  test('침구류 task status=CANCELLED 이면 → 발송 대상 아님', async () => {
    const today = todayKST();
    await makeCaseWithBeddingTask({ checkOutDate: today, quantity: 3, taskStatus: 'CANCELLED' });
    const sent = await sendBeddingReturnReminders();
    expect(sent).toBe(0);
  });
});
