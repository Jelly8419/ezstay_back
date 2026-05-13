'use strict';

/**
 * moveInGuestCategoryHelper.js
 * 관리자 화면 — 게스트 주문 라인의 옵션 카테고리 그룹별 결제 상태 산출.
 *
 * 그룹 정의 (MoveInOption.BEDDING_CATEGORIES / AMENITY_CATEGORIES):
 *  - 침구류: BEDDING_SET
 *  - 입주용품: AMENITY_KIT, HAIR_DRYER, TOWEL_SET, OTHER
 *
 * 상태 결정 규칙 (한 케이스 내 주문 전체 기준):
 *  - 해당 카테고리 ACTIVE 라인이 포함된 주문 중 PAID 가 있으면          → 'PAID'
 *  - 그렇지 않고 해당 카테고리 ACTIVE 라인이 포함된 PENDING 이 있으면 → 'PENDING'
 *  - 위 어느 것도 없으면                                              → null (화면 공란)
 *
 * 환불 상태(PARTIAL_REFUND / FULLY_REFUNDED / CANCELLED) 는 PAID/PENDING 어디에도 포함하지 않는다.
 * 한 번 결제 완료 후 전액 환불된 경우도 '결제 완료' 로 잡지 않기 위함 — 화면에서는 게스트가 현재
 * 받고 있는/받을 항목만 노출돼야 함.
 */

const { MoveInOption } = require('../models');

const PAID_STATUSES    = new Set(['PAID']);
const PENDING_STATUSES = new Set(['PENDING']);

/**
 * 주문 라인의 카테고리가 그룹에 속하는지 판정.
 * order.items 의 각 item 은 include 시 `option` alias 로 카테고리를 접근한다.
 * 또는 itemsSnapshot JSON 에 category 가 락인돼 있을 수도 있어 그쪽도 확인.
 */
function getItemCategory(item, snapshotMap) {
  // 1) include 된 option 객체
  const opt = item.option || (item.get && item.get('option'));
  if (opt && opt.category) return opt.category;

  // 2) snapshot 백업 (option 비활성/삭제 대비)
  if (snapshotMap && item.optionId != null) {
    const snap = snapshotMap.get(item.optionId);
    if (snap && snap.category) return snap.category;
  }

  return null;
}

/**
 * 주문의 itemsSnapshot 을 optionId 키 맵으로 변환.
 * snapshot 구조 예: [{ optionId, name, category, price, quantity }, ...]
 */
function snapshotToMap(itemsSnapshot) {
  if (!Array.isArray(itemsSnapshot)) return null;
  const map = new Map();
  for (const s of itemsSnapshot) {
    if (s && s.optionId != null) map.set(s.optionId, s);
  }
  return map;
}

/**
 * 단일 그룹(카테고리 배열)에 대해 케이스의 주문 배열을 훑어 상태를 산출.
 *
 * @param {Array} orders - MoveInGuestOrder + items(+option) 가 include 된 배열
 * @param {string[]} categories - 그룹에 속하는 카테고리 목록
 * @returns {'PAID' | 'PENDING' | null}
 */
function computeCategoryStatus(orders, categories) {
  if (!Array.isArray(orders) || orders.length === 0) return null;
  const targetSet = new Set(categories);

  let hasPending = false;

  for (const order of orders) {
    const status = order.status;
    if (!PAID_STATUSES.has(status) && !PENDING_STATUSES.has(status)) continue;

    const items = order.items || [];
    if (items.length === 0) continue;

    const snapshotMap = snapshotToMap(order.itemsSnapshot);

    const hit = items.some(it => {
      if (it.status !== 'ACTIVE') return false;
      const cat = getItemCategory(it, snapshotMap);
      return cat && targetSet.has(cat);
    });

    if (!hit) continue;

    if (PAID_STATUSES.has(status)) return 'PAID';        // 최우선
    if (PENDING_STATUSES.has(status)) hasPending = true;
  }

  return hasPending ? 'PENDING' : null;
}

/**
 * 케이스 1건의 그룹별 상태 한 번에 산출.
 *
 * @param {Array} orders - 케이스의 MoveInGuestOrder 배열 (items + option include 권장)
 * @returns {{ amenity: 'PAID'|'PENDING'|null, bedding: 'PAID'|'PENDING'|null }}
 */
function computeGroupStatuses(orders) {
  return {
    amenity: computeCategoryStatus(orders, MoveInOption.AMENITY_CATEGORIES),
    bedding: computeCategoryStatus(orders, MoveInOption.BEDDING_CATEGORIES)
  };
}

module.exports = {
  computeCategoryStatus,
  computeGroupStatuses
};
