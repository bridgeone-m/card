'use strict';
// 화면에 그대로 보여 줄 수 있는 오류. 비밀값·외부 API 응답 원문은 message 에 넣지 않는다.
class AppError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}
module.exports = { AppError };
