/**
 * 방 등록 진행 단계 계산 유틸리티
 */

/**
 * 방 등록 진행 단계 및 완료율 계산
 * @param {Object} room - Room 인스턴스 (photos, amenity, freeService 포함)
 * @returns {Object} { currentStep, completionRate, steps }
 */
const calculateProgress = (room) => {
  const steps = {
    basicInfo: false,           // 1단계: 기본 정보
    pricing: false,             // 2단계: 요금 설정
    photosAndAmenities: false,  // 3단계: 사진 및 편의시설
    freeServices: false,        // 4단계: 무료 부가서비스
    description: false          // 5단계: 방 소개
  };

  // 1단계: 기본 정보 체크
  if (room.roomName && room.address && room.detailAddress &&
      room.area && room.buildingType) {
    steps.basicInfo = true;
  }

  // 2단계: 요금 설정 체크
  if (room.dailyRent && room.minContractWeeks && room.refundPolicy) {
    steps.pricing = true;
  }

  // 3단계: 사진 및 편의시설 체크
  if (room.photos && room.photos.length >= 6 && room.amenity) {
    steps.photosAndAmenities = true;
  }

  // 4단계: 무료 부가서비스 체크
  if (room.freeService && room.freeService.agreeTerms) {
    steps.freeServices = true;
  }

  // 5단계: 방 소개 체크
  if (room.description && room.transportation && room.houseRules) {
    steps.description = true;
  }

  // 현재 단계 결정 (가장 최근에 완료한 단계의 다음 단계)
  let currentStep = 'basicInfo';
  if (!steps.basicInfo) currentStep = 'basicInfo';
  else if (!steps.pricing) currentStep = 'pricing';
  else if (!steps.photosAndAmenities) currentStep = 'photosAndAmenities';
  else if (!steps.freeServices) currentStep = 'freeServices';
  else if (!steps.description) currentStep = 'description';
  else currentStep = 'completed';

  // 완료율 계산
  const completedSteps = Object.values(steps).filter(Boolean).length;
  const totalSteps = Object.keys(steps).length;
  const completionRate = Math.round((completedSteps / totalSteps) * 100);

  return {
    currentStep,        // 현재 진행해야 할 단계
    completionRate,     // 완료율 (%)
    steps               // 각 단계별 완료 여부
  };
};

module.exports = {
  calculateProgress
};
