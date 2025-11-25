/**
 * 방 등록 진행 단계 계산 유틸리티
 */

/**
 * 방 등록 진행 단계 및 완료율 계산
 * @param {Object} room - Room 인스턴스 (photos, amenity, ezService 포함)
 * @returns {Object} { currentStep, completionRate, steps }
 */
const calculateProgress = (room) => {
  const steps = {
    basicInfo: false,           // 1단계: 기본 정보
    photosAndAmenities: false,  // 2단계: 사진 및 편의시설
    pricing: false,             // 3단계: 요금 설정
    ezService: false,           // 4단계: 이지서비스 (선택 사항)
    description: false          // 5단계: 방 소개
  };

  // 1단계: 기본 정보 체크
  if (room.roomName && room.address && room.detailAddress &&
      room.area && room.buildingType) {
    steps.basicInfo = true;
  }

   // 2단계: 사진 및 편의시설 체크
  if (room.photos && room.photos.length >= 5 && room.amenity) {
    steps.photosAndAmenities = true;
  }

  // 3단계: 요금 설정 체크
  if (room.dailyRent && room.refundPolicy) {
    steps.pricing = true;
  }

  // 4단계: 이지서비스 체크 (선택 사항)
  // ezService 객체가 존재하면 완료로 간주 (사용자가 명시적으로 단계를 거쳤음을 의미)
  if (room.ezService) {
    steps.ezService = true;
  }

  // 5단계: 방 소개 체크
  if (room.description && room.maxGuests) {
    steps.description = true;
  }

  // 현재 단계 결정: 사용자가 실제로 작업 중인 단계 추적
  let currentStep = determineCurrentStep(room, steps);

  // 완료율 계산 (4단계는 선택 사항이므로 제외)
  const requiredSteps = ['basicInfo', 'photosAndAmenities', 'pricing', 'description'];
  const completedRequiredSteps = requiredSteps.filter(step => steps[step]).length;
  const completionRate = Math.round((completedRequiredSteps / requiredSteps.length) * 100);

  return {
    currentStep,        // 현재 진행해야 할 단계
    completionRate,     // 완료율 (%)
    steps               // 각 단계별 완료 여부
  };
};

/**
 * 사용자가 실제로 작업 중인 단계 결정
 * - 순차적 진행을 기본으로 하되, 선택 단계(ezService)는 건너뛸 수 있음
 * - 각 테이블의 updatedAt 시간을 비교하여 가장 최근에 작업한 단계를 파악
 *
 * @param {Object} room - Room 인스턴스
 * @param {Object} steps - 각 단계별 완료 여부
 * @returns {string} currentStep
 */
const determineCurrentStep = (room, steps) => {
  // 1. 순차적으로 미완료된 첫 번째 필수 단계 찾기
  if (!steps.basicInfo) return 'basicInfo';
  if (!steps.photosAndAmenities) return 'photosAndAmenities';
  if (!steps.pricing) return 'pricing';

  // 2. 3단계까지 완료된 경우, 실제 작업 중인 단계 판단
  // 2-1. 5단계(description)가 이미 완료되었다면
  if (steps.description) {
    // 4단계가 미완료여도 현재 단계는 'completed' (4단계는 선택사항)
    return 'completed';
  }

  // 2-2. 5단계가 미완료인 경우, 최근 작업 시간으로 판단
  const timestamps = [];

  // Room 테이블의 description 관련 필드 업데이트 시간
  if (room.updatedAt) {
    timestamps.push({
      step: 'description',
      time: new Date(room.updatedAt),
      // description 필드가 있으면 5단계 작업 중으로 간주
      isRelevant: !!(room.description || room.maxGuests)
    });
  }

  // EzService 업데이트 시간
  if (room.ezService && room.ezService.updatedAt) {
    timestamps.push({
      step: 'ezService',
      time: new Date(room.ezService.updatedAt),
      isRelevant: true
    });
  }

  // 관련 있는 최근 작업 찾기
  const relevantTimestamps = timestamps.filter(t => t.isRelevant);

  if (relevantTimestamps.length > 0) {
    // 가장 최근 작업을 기준으로 현재 단계 결정
    relevantTimestamps.sort((a, b) => b.time - a.time);
    const latestWork = relevantTimestamps[0];

    // 5단계 작업 중이면 currentStep = 'description'
    if (latestWork.step === 'description') {
      return 'description';
    }
  }

  // 2-3. 어떤 작업도 감지되지 않은 경우
  // 4단계가 완료되지 않았으면 4단계, 아니면 5단계
  if (!steps.ezService) {
    return 'ezService';
  }

  return 'description';
};

module.exports = {
  calculateProgress
};
