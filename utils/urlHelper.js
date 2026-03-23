/**
 * URL 헬퍼 - 상대경로에 BASE_URL prefix 추가
 *
 * S3/카카오 등 절대 URL은 그대로, 로컬 상대경로(/uploads/...)만 prefix 추가
 */

const BASE_URL = () => process.env.BASE_URL || 'http://localhost:8080';

/**
 * 단일 URL에 baseUrl prefix 추가 (상대경로만)
 * @param {string|null} url
 * @returns {string|null}
 */
const toAbsoluteUrl = (url) => {
  if (!url) return url;
  return url.startsWith('http') ? url : `${BASE_URL()}${url}`;
};

module.exports = { toAbsoluteUrl };
