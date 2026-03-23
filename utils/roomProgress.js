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
    pricing: false,             // 3단계: 요금 설정 (청소서비스 포함)
    description: false          // 4단계: 방 소개
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

  // 4단계: 방 소개 체크
  if (room.description && room.maxGuests) {
    steps.description = true;
  }

  // 현재 단계 결정
  let currentStep = determineCurrentStep(steps);

  // 완료율 계산
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
 * 순차적으로 미완료된 첫 번째 단계 결정
 * @param {Object} steps - 각 단계별 완료 여부
 * @returns {string} currentStep
 */
const determineCurrentStep = (steps) => {
  if (!steps.basicInfo) return 'basicInfo';
  if (!steps.photosAndAmenities) return 'photosAndAmenities';
  if (!steps.pricing) return 'pricing';
  if (!steps.description) return 'description';
  return 'completed';
};

module.exports = {
  calculateProgress
};
