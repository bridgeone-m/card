// 계약서 2종 준비 기능 설정. 비밀값을 넣지 않는다(API 키는 서버 비밀 설정에만 있다).
// apiBase 가 비어 있으면 서버 연결 전 상태로, 화면에 안내만 표시한다.
// 실제 발송 차단·서명 위치 승인·도장 사용 여부는 서버 설정이 정한다(이 파일로 켤 수 없다).
window.SHIN2_CONTRACT_CONFIG = { apiBase: 'https://asia-northeast3-pour-dashboard.cloudfunctions.net/contractApi' };
