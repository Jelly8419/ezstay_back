/**
 * 카카오 로컬 API를 사용한 주소-좌표 변환 유틸리티
 */

const axios = require('axios');

/**
 * 주소를 WGS84 좌표계 좌표로 변환
 * @param {string} address - 변환할 주소 (예: "서울특별시 강남구 강남대로 396")
 * @returns {Promise<{lat: number, lng: number}>} 위도/경도 좌표
 * @throws {Error} API 호출 실패 시 에러 발생
 */
async function convertAddressToCoordinates(address) {
  const KAKAO_REST_API_KEY = process.env.KAKAO_CLIENT_ID;

  if (!KAKAO_REST_API_KEY) {
    throw new Error('KAKAO_CLIENT_ID가 환경변수에 설정되지 않았습니다.');
  }

  try {
    const url = 'https://dapi.kakao.com/v2/local/search/address.json';
    const response = await axios.get(url, {
      params: { query: address },
      headers: {
        Authorization: `KakaoAK ${KAKAO_REST_API_KEY}`
      }
    });

    // 결과가 없는 경우
    if (!response.data.documents || response.data.documents.length === 0) {
      throw new Error('주소를 찾을 수 없습니다. 올바른 주소인지 확인해주세요.');
    }

    const addressData = response.data.documents[0].address;
    const lng = parseFloat(addressData.x);
    const lat = parseFloat(addressData.y);

    return { lat, lng };

  } catch (error) {
    if (error.response) {
      // 카카오 API 에러 응답
      throw new Error(`카카오 API 오류: ${error.response.data.message || '주소 변환에 실패했습니다.'}`);
    } else if (error.request) {
      // 요청은 보냈으나 응답이 없는 경우
      throw new Error('카카오 API 서버에 연결할 수 없습니다.');
    } else {
      // 기타 에러
      throw error;
    }
  }
}

/**
 * 도로명 주소와 상세 주소를 결합하여 좌표 변환
 * @param {string} roadAddress - 도로명 주소
 * @param {string} detailAddress - 상세 주소 (선택)
 * @returns {Promise<{lat: number, lng: number}>} 위도/경도 좌표
 */
async function convertRoadAddressToCoordinates(roadAddress, detailAddress = '') {
  // 상세 주소는 좌표 변환에 사용하지 않음 (도로명 주소만 사용)
  return convertAddressToCoordinates(roadAddress);
}

/**
 * 여러 주소를 한 번에 좌표로 변환 (배치 처리)
 * @param {string[]} addresses - 변환할 주소 배열
 * @returns {Promise<Array<{address: string, lat: number, lng: number, error: string}>>}
 */
async function convertMultipleAddresses(addresses) {
  const results = [];

  for (const address of addresses) {
    try {
      const coordinates = await convertAddressToCoordinates(address);
      results.push({
        address,
        ...coordinates,
        error: null
      });
    } catch (error) {
      results.push({
        address,
        lat: null,
        lng: null,
        error: error.message
      });
    }

    // API Rate Limit 방지를 위한 딜레이 (초당 10회 제한)
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}

module.exports = {
  convertAddressToCoordinates,
  convertRoadAddressToCoordinates,
  convertMultipleAddresses
};
