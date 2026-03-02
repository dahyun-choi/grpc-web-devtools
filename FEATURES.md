# 기능 목록

## 🎯 핵심 기능

### 1. gRPC 요청/응답 모니터링
- 실시간 gRPC-Web 요청 추적
- Request/Response body 상세 보기
- 에러 상태 및 메시지 확인
- Method type (Unary/Server Streaming) 표시

### 2. **Repeat 기능** ⭐ NEW (2026.03.02)
Proto 파일 없이도 gRPC 요청을 반복 실행할 수 있습니다.

**작동 방식:**
- chrome.debugger API를 통한 raw request body 캡처
- 캐시된 request body로 새로운 요청 생성
- URL 기반 매칭으로 안정적인 요청 식별

**사용 방법:**
1. DevTools 패널에서 gRPC 요청 선택
2. 우측 상단 "Repeat" 버튼 클릭
3. 동일한 요청이 자동으로 재전송됨

**제약사항:**
- Chrome 브라우저 상단에 노란색 배너 표시
  ("Chrome is being controlled by automated test software")
- 이는 chrome.debugger API 사용 시 보안을 위한 정상적인 표시입니다

### 3. Edit & Repeat 기능
요청을 수정하여 재전송할 수 있습니다.

**편집 가능 항목:**
- Request Headers
- Request Body (JSON)

### 4. 검색 및 필터링
- Method 이름으로 필터링
- Request/Response/Error 내용 전역 검색
- 실시간 필터링

### 5. Copy 기능
- Request 복사 (JSON)
- Response 복사 (JSON)
- Error 복사 (JSON)
- Headers 복사

### 6. 다크 모드 지원
- 시스템 테마 자동 감지
- 수동 라이트/다크 모드 전환

## 🔧 기술 상세

### chrome.debugger API 통합 (v1.4.1+)

**목적:**
- 100% 안정적인 raw HTTP request body 캡처
- 타이밍 이슈 없는 요청 인터셉션

**구현:**
```javascript
// 자동 초기화
chrome.debugger.attach({ tabId }, '1.3');
chrome.debugger.sendCommand({ tabId }, 'Network.enable');

// Network 이벤트 리스닝
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Network.requestWillBeSent') {
    const postData = params.request.postData;
    // gRPC 요청 필터링 및 캐싱
  }
});
```

**장점:**
- ✅ 모든 네트워크 요청의 raw body 접근
- ✅ CSP(Content Security Policy) 제한 우회
- ✅ 인터셉터 로딩 타이밍과 무관
- ✅ Manifest V3 완전 호환

### URL 기반 매칭 Fallback

**문제:**
- DebuggerCapture: Chrome requestId 사용
- 기존 시스템: 내부 entryId 사용
- ID 불일치로 매칭 실패

**해결:**
3단계 Fallback 전략
```
1. requestId로 조회 (기존 interceptor)
   ↓ 실패 시
2. entryId로 조회 (기존 방식)
   ↓ 실패 시
3. URL 매칭 (DebuggerCapture용)
   → entry.method와 cache.url 비교
```

## 📋 사용 요구사항

### 필수
- Chrome 또는 Firefox 브라우저
- gRPC-Web 클라이언트 (`protoc-gen-grpc-web` >= 1.0.4)

### 클라이언트 설정
```javascript
const enableDevTools = window.__GRPCWEB_DEVTOOLS__ || (() => {});
const client = new YourServiceClient('https://api.example.com');
enableDevTools([client]);
```

## 🎨 UI 기능

### 네트워크 목록
- 요청 시간순 정렬
- Status code 표시 (성공/에러)
- Method 이름 표시
- Duration 표시

### 상세 패널
#### Request 탭
- Headers 보기
- Body 보기 (JSON 포맷팅)
- Copy 버튼

#### Response 탭
- Headers 보기
- Body 보기 (JSON 포맷팅)
- Copy 버튼

#### Error 탭
- Error code
- Error message
- Stack trace (있는 경우)

### 툴바
- Clear 버튼: 목록 초기화
- Preserve log: 페이지 새로고침 시 로그 유지
- Filter 입력: Method 이름 필터링
- Search 입력: 전역 검색

## 🔮 향후 계획

### 단기
- [ ] Settings UI에서 DebuggerCapture on/off
- [ ] URL 매칭 시 timestamp 기반 최신 요청 선택
- [ ] 캐시 크기 제한 설정 UI

### 장기
- [ ] Request/Response diff 비교
- [ ] Export/Import 기능
- [ ] HAR(HTTP Archive) 포맷 지원
- [ ] Performance 분석 도구

## 📚 문서

- `README.md` - 설치 및 기본 사용법
- `CHANGELOG_2026_03_02.md` - 상세 변경 이력
- `WORK_SUMMARY.md` - 작업 요약
- `IMPLEMENTATION_SUMMARY.md` - 구현 요약
- `DEBUGGER_API_IMPLEMENTATION.md` - API 구현 상세
- `MANUAL_TEST_GUIDE.md` - 테스트 가이드

## 🐛 알려진 이슈

### chrome.debugger API 관련
1. **노란색 배너**
   - 증상: "Chrome is being controlled by automated test software" 표시
   - 원인: chrome.debugger API 사용 시 보안 알림
   - 해결: 정상적인 동작, 문제 없음

2. **디버거 충돌**
   - 증상: 다른 디버거 도구와 충돌
   - 원인: 탭당 하나의 디버거만 연결 가능
   - 해결: DevTools를 닫고 다시 열기

3. **성능 오버헤드**
   - 증상: 모든 네트워크 이벤트 처리
   - 원인: Network.enable 활성화
   - 영향: 일반적인 사용에는 문제 없음

## 💡 팁

### Repeat 기능 활용
```
1. 개발 중 API 테스트 - 동일 요청 반복 실행
2. 에러 재현 - 실패한 요청 즉시 재시도
3. 부하 테스트 - 같은 요청 연속 실행
4. 인증 테스트 - 토큰 만료 후 재시도
```

### 검색 기능 활용
```
1. 특정 필드 값 찾기 - "userId": "123"
2. 에러 메시지 검색 - "NOT_FOUND"
3. 특정 타입 필터 - "unary" 또는 "stream"
```

## 🤝 기여

버그 리포트와 기능 제안은 GitHub Issues를 통해 환영합니다!

- 버그 리포트: 재현 단계와 스크린샷 첨부
- 기능 제안: 사용 사례와 예상 동작 설명
- Pull Request: COMMIT_MESSAGE.txt 참고

---

**Last Updated:** 2026년 3월 2일
**Version:** 1.4.1
