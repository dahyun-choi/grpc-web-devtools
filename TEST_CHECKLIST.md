# 🧪 gRPC-Web DevTools - chrome.debugger API 테스트 체크리스트

## 준비 상태

- [x] ✅ 빌드 완료 (build/ 디렉토리 존재)
- [x] ✅ manifest.json에 debugger 권한 추가됨
- [x] ✅ DebuggerCapture.js 구현 완료
- [x] ✅ index.js 통합 완료
- [x] ✅ Main bundle 생성 완료 (544K)

## 1단계: 확장 프로그램 로드

- [ ] Chrome 확장 프로그램 페이지 열기 (`chrome://extensions`)
- [ ] "개발자 모드" 활성화 (우측 상단 토글)
- [ ] "압축해제된 확장 프로그램 로드" 클릭
- [ ] `/Users/hmc/Documents/GitHub/grpc-web-devtools/build` 선택
- [ ] 확장 프로그램 카드에 "gRPC-Web DevTools" 표시 확인

## 2단계: 테스트 페이지 접속

- [ ] 새 탭 열기
- [ ] 주소창에 입력: `https://qa-privacy.shucle.com:15449/drt/management/stoppoint`
- [ ] 페이지 로드 완료 대기
- [ ] 로그인 필요 시 로그인

## 3단계: DevTools 패널 열기

- [ ] F12 키 누르기 (또는 우클릭 → "검사")
- [ ] DevTools 탭 목록에서 **"gRPC-Web DevTools"** 탭 찾기
- [ ] gRPC-Web DevTools 탭 클릭

## 4단계: chrome.debugger API 동작 확인

### 4-1. 노란색 배너 확인 ⚠️ **중요!**

- [ ] 브라우저 **상단**에 노란색 배너 표시됨:
  ```
  Chrome is being controlled by automated test software.
  ```
- [ ] ✅ 이 배너가 보이면 = debugger attach 성공!
- [ ] ❌ 배너가 안 보이면 = Console에서 에러 확인 필요

### 4-2. Console 로그 확인

DevTools → Console 탭에서 다음 로그들 확인:

**초기화 로그:**
- [ ] `[Index] Initializing DebuggerCapture for tab: XXX`
- [ ] `[DebuggerCapture] Created for tab: XXX`
- [ ] `[DebuggerCapture] Attaching debugger to tab: XXX`
- [ ] `[DebuggerCapture] ✓ Debugger attached`
- [ ] `[DebuggerCapture] ✓ Network domain enabled`
- [ ] `[DebuggerCapture] ✓ Ready to capture requests`
- [ ] `[Index] ✓ DebuggerCapture enabled`

### 4-3. gRPC 요청 캡처 확인

페이지를 **새로고침**한 후 Console에서:

- [ ] `[DebuggerCapture] Captured gRPC request: ...` 로그 여러 개 표시됨
- [ ] `[DebuggerCapture] ✓ Captured raw request body: ...` 로그 표시됨
- [ ] `[Index] ✓ Cached raw request for ID: ...` 로그 표시됨
- [ ] `Cache size: X` (X는 1 이상)

### 4-4. Raw Cache 확인

Console에서 다음 명령어 실행:

```javascript
console.log('Raw cache size:', window.rawRequestsCache?.size);
console.log('Network entries:', window.store?.getState()?.network?.log?.length);
```

**예상 결과:**
- [ ] Raw cache size: **10 이상** (실제 gRPC 요청 수에 따라 다름)
- [ ] Network entries: **10 이상**

## 5단계: Repeat 기능 테스트

### 5-1. 네트워크 목록 확인

gRPC-Web DevTools 패널에서:
- [ ] 좌측에 gRPC 요청 목록이 표시됨
- [ ] 각 요청에 URL, Method, Status 정보 표시됨

### 5-2. 요청 선택 및 Repeat

- [ ] 목록에서 아무 gRPC 요청 클릭 (예: `opgwv1.OpGw/...`)
- [ ] 우측 상단에 **"Repeat"** 버튼이 활성화됨 (disabled 아님)
- [ ] "Repeat" 버튼 클릭

### 5-3. Repeat 성공 확인

**예상 결과:**
- [ ] ✅ Alert 창이 **뜨지 않음** (raw body가 있으므로)
- [ ] ✅ 네트워크 목록에 **새로운 항목** 추가됨
- [ ] ✅ Console에 새로운 `[DebuggerCapture] Captured gRPC request` 로그
- [ ] ✅ Raw cache size가 증가함

**실패 시:**
- [ ] ❌ Alert: "Cannot repeat request: No raw request body available"
  → Raw cache 문제, 위의 4-4 단계 확인

## 6단계: 추가 검증

### 6-1. 여러 요청 Repeat

- [ ] 다른 gRPC 요청 선택
- [ ] Repeat 버튼 클릭
- [ ] 여러 번 반복하여 안정성 확인

### 6-2. Edit 기능 확인 (있는 경우)

- [ ] Request Header 수정 가능
- [ ] Request Body 수정 가능
- [ ] 수정 후 Repeat 동작 확인

### 6-3. 페이지 새로고침 후 재테스트

- [ ] 페이지 새로고침 (F5)
- [ ] 노란색 배너 다시 표시됨
- [ ] 새로운 gRPC 요청들 캡처됨
- [ ] Repeat 기능 정상 작동

## ✅ 성공 기준

**모든 항목이 체크되어야 함:**

1. ✅ 노란색 "automated test software" 배너 표시
2. ✅ DebuggerCapture 초기화 로그 확인
3. ✅ gRPC 요청 캡처 로그 확인
4. ✅ Raw cache size > 0
5. ✅ Repeat 버튼 작동 (에러 없음)
6. ✅ 새 네트워크 항목 생성됨

## 🐛 문제 발생 시

### 문제 1: 노란색 배너가 안 보임

**진단:**
```javascript
// Console에서 실행
chrome.debugger.attach({tabId: chrome.devtools.inspectedWindow.tabId}, '1.3')
```

**해결:**
- DevTools를 닫고 다시 열기
- 확장 프로그램 새로고침 (`chrome://extensions`에서 새로고침 버튼)
- 다른 탭에 디버거가 연결되어 있는지 확인

### 문제 2: Raw cache size가 0

**진단:**
- Console에서 `[DebuggerCapture]` 로그 검색
- `[DebuggerCapture] Captured gRPC request` 로그가 있는지 확인

**해결:**
- 페이지 새로고침하여 gRPC 요청 재발생
- Network 탭에서 실제로 gRPC 요청 발생하는지 확인
- Content-Type 헤더 확인 (`application/grpc-web+proto` 등)

### 문제 3: Repeat 버튼이 비활성화됨

**진단:**
```javascript
// Console에서 실행
const selectedId = window.store.getState().network.selectedId;
console.log('Selected request ID:', selectedId);
console.log('Has raw request:', window.rawRequestsCache?.has(selectedId));
```

**해결:**
- 다른 요청 선택해보기
- Raw cache size 확인 (문제 2 참고)

## 📝 테스트 결과 기록

**테스트 일시:** _______________

**테스트 환경:**
- Chrome 버전: _______________
- macOS 버전: _______________

**결과:**
- [ ] ✅ 모든 테스트 통과
- [ ] ⚠️ 일부 문제 발생 (아래 기록)
- [ ] ❌ 테스트 실패

**문제 사항:**
```
(여기에 발생한 문제와 에러 메시지 기록)
```

**스크린샷:**
- [ ] 노란색 배너 스크린샷
- [ ] Console 로그 스크린샷
- [ ] Repeat 성공 스크린샷

## 📚 참고 문서

- `MANUAL_TEST_GUIDE.md` - 상세 수동 테스트 가이드
- `IMPLEMENTATION_SUMMARY.md` - 구현 개요
- `DEBUGGER_API_IMPLEMENTATION.md` - API 구현 상세

## 🎯 다음 단계

테스트 성공 시:
- [ ] Git commit 준비
- [ ] PR 생성 (필요 시)
- [ ] 사용자 문서 업데이트

테스트 실패 시:
- [ ] 에러 로그 수집
- [ ] 이슈 보고
- [ ] 디버깅 진행
