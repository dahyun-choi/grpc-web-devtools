# chrome.debugger API 수동 테스트 가이드

## 준비

1. 빌드가 완료되었는지 확인:
```bash
ls -lh build/*.js | grep -E "index|manifest"
```

## 테스트 단계

### 1단계: 확장 프로그램 로드

1. Chrome 열기
2. `chrome://extensions` 접속
3. 우측 상단 "개발자 모드" 활성화
4. "압축해제된 확장 프로그램을 로드합니다" 클릭
5. 이 프로젝트의 `build` 디렉토리 선택

### 2단계: 테스트 페이지 열기

1. 새 탭에서 https://qa-privacy.shucle.com:15449/drt/management/stoppoint 접속
2. 로그인 필요 시 로그인

### 3단계: DevTools 열기

1. F12 키 또는 우클릭 → "검사"
2. DevTools 탭 목록에서 **"gRPC-Web DevTools"** 클릭

### 4단계: 노란색 배너 확인 ⚠️

브라우저 **상단**에 다음 배너가 표시되어야 함:
```
Chrome is being controlled by automated test software.
```

✅ 이 배너가 보이면 = chrome.debugger API 작동 중
❌ 배너가 안 보이면 = DebuggerCapture가 attach 실패

### 5단계: DevTools Console 로그 확인

DevTools 내의 Console 탭에서 다음 로그 확인:

**초기화 로그:**
```
[Index] Initializing DebuggerCapture for tab: XXX
[DebuggerCapture] Created for tab: XXX
[DebuggerCapture] Attaching debugger to tab: XXX
[DebuggerCapture] ✓ Debugger attached
[DebuggerCapture] ✓ Network domain enabled
[DebuggerCapture] ✓ Ready to capture requests
[Index] ✓ DebuggerCapture enabled
```

**gRPC 요청 캡처 로그 (페이지 새로고침 후):**
```
[DebuggerCapture] Captured gRPC request: {requestId: "...", url: "https://qa.shucle.com:15449/opgwv1.OpGw/...", method: "POST", hasPostData: true}
[DebuggerCapture] ✓ Captured raw request body: {requestId: "...", url: "...", bodyLength: XXX}
[DebuggerCapture] Raw request callback: ...
[Index] ✓ Cached raw request for ID: ... Cache size: X
```

### 6단계: Raw Cache 확인

Console에서 실행:
```javascript
// Store에서 raw cache 크기 확인
console.log('Network entries:', window.store?.getState()?.network?.log?.length);

// Raw request cache 확인
console.log('Raw cache size:', window.rawRequestsCache?.size || 'not available');
```

예상 결과:
- Network entries: 10+ (페이지의 gRPC 요청 수)
- Raw cache size: 10+ (캡처된 raw request body 수)

### 7단계: Repeat 기능 테스트

1. gRPC-Web DevTools 패널에서 네트워크 목록 확인
2. 아무 gRPC 요청 클릭
3. 우측 상단 "Repeat" 버튼 클릭
4. 새로운 네트워크 요청이 목록에 추가되는지 확인

**예상 결과:**
- ✅ Repeat 버튼 클릭 시 에러 없이 새 요청 생성
- ✅ 네트워크 목록에 새 항목 추가됨
- ✅ 동일한 gRPC method로 요청 발생

## 트러블슈팅

### 문제 1: 노란색 배너가 안 보임

**원인:** DebuggerCapture attach 실패

**확인:**
1. Console에서 에러 로그 확인
2. 다음 명령어 실행:
   ```javascript
   chrome.debugger.attach({tabId: chrome.devtools.inspectedWindow.tabId}, '1.3')
   ```

**해결:**
- DevTools를 닫고 다시 열기
- 확장 프로그램 새로고침 후 재시도
- 다른 탭에서 디버거가 연결되어 있는지 확인

### 문제 2: DebuggerCapture 로그가 안 보임

**원인:** index.js 로드 실패 또는 에러

**확인:**
1. Console에서 JavaScript 에러 확인
2. build/static/js/main.*.js 파일이 존재하는지 확인
3. manifest.json에 debugger 권한이 있는지 확인:
   ```bash
   grep debugger build/manifest.json
   ```

**해결:**
- 빌드 재실행: `npm run build`
- 확장 프로그램 다시 로드

### 문제 3: Raw cache size가 0

**원인:** gRPC 요청이 캡처되지 않음

**확인:**
1. 네트워크 탭에서 실제로 gRPC 요청이 발생하는지 확인
2. Content-Type 헤더 확인 (application/grpc-web 등)
3. Console에서 "Captured gRPC request" 로그 검색

**해결:**
- 페이지 새로고침하여 gRPC 요청 재발생
- DebuggerCapture.js의 isGrpc 조건 확인

### 문제 4: Repeat 버튼이 비활성화됨

**원인:** Raw request body가 캡처되지 않음

**확인:**
1. Console에서 raw cache 확인:
   ```javascript
   console.log('Has raw request:', window.rawRequestsCache?.has(SELECTED_REQUEST_ID));
   ```

**해결:**
- 위의 "문제 3" 해결 방법 참고
- 요청을 다시 발생시킨 후 테스트

## 성공 기준

✅ 노란색 배너 표시됨
✅ DebuggerCapture 초기화 로그 확인
✅ gRPC 요청 캡처 로그 확인
✅ Raw cache size > 0
✅ Repeat 버튼 작동 (에러 없이 새 요청 생성)

## 참고

- 노란색 배너는 정상입니다 (chrome.debugger 사용 시 필수)
- 다른 DevTools 기능(Network 탭 등)이 일부 제한될 수 있습니다
- 페이지를 닫으면 자동으로 debugger detach됩니다
