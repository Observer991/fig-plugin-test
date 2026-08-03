# Figma 플러그인 개발 가이드

## 요구사항

### 필수 도구
- **Node.js** v18 이상
- **npm** v8 이상 (Node.js에 포함)
- **Figma 데스크톱 앱** (플러그인 개발/테스트용, 브라우저 버전 불가)
- **Figma 계정** (무료 플랜 가능)

### 권장 도구
- **VS Code** (TypeScript 지원 최적)
- **TypeScript** v5 이상
- **Git**

---

## 프로젝트 구조

```
fig-plugin-test/
├── src/
│   ├── code.ts          # 플러그인 메인 로직 (Figma API 접근)
│   └── ui.html          # 플러그인 UI (선택적)
├── dist/
│   └── code.js          # 번들 결과물
├── manifest.json        # 플러그인 설정 파일 (필수)
├── package.json
├── tsconfig.json
└── webpack.config.js    # 번들러 설정
```

---

## 단계별 개발 절차

### 1단계: 프로젝트 초기화

```bash
npm init -y
```

### 2단계: 의존성 설치

```bash
# TypeScript 및 빌드 도구
npm install -D typescript webpack webpack-cli ts-loader

# Figma 플러그인 타입 정의
npm install -D @figma/plugin-typings

# CSS 번들링 (UI 사용 시)
npm install -D css-loader style-loader html-webpack-plugin
```

### 3단계: TypeScript 설정

`tsconfig.json` 생성:

```json
{
  "compilerOptions": {
    "target": "ES6",
    "lib": ["ES6"],
    "strict": true,
    "typeRoots": ["./node_modules/@figma/plugin-typings"]
  },
  "include": ["src/**/*.ts"]
}
```

### 4단계: Webpack 설정

`webpack.config.js` 생성:

```js
const path = require('path');

module.exports = {
  mode: 'development',
  devtool: 'inline-source-map',
  entry: {
    code: './src/code.ts',
  },
  module: {
    rules: [
      { test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
    ],
  },
  resolve: { extensions: ['.tsx', '.ts', '.js'] },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },
};
```

### 5단계: manifest.json 작성

Figma가 플러그인을 인식하는 핵심 파일:

```json
{
  "name": "My Figma Plugin",
  "id": "YOUR_PLUGIN_ID",
  "api": "1.0.0",
  "main": "dist/code.js",
  "ui": "src/ui.html",
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": []
  }
}
```

> **주의:** `id` 필드는 Figma 데스크톱 앱에서 플러그인을 등록할 때 자동 생성됩니다.

### 6단계: 플러그인 로직 작성

`src/code.ts`:

```typescript
// Figma API는 이 파일에서만 접근 가능
figma.showUI(__html__, { width: 300, height: 400 });

figma.ui.onmessage = (msg: { type: string; color?: string }) => {
  if (msg.type === 'create-rect') {
    const rect = figma.createRectangle();
    rect.x = 0;
    rect.y = 0;
    rect.width = 100;
    rect.height = 100;
    rect.fills = [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0 } }];
    figma.currentPage.appendChild(rect);
    figma.viewport.scrollAndZoomIntoView([rect]);
  }

  figma.closePlugin();
};
```

### 7단계: UI 작성 (선택)

`src/ui.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Plugin UI</title>
  <style>
    body { font-family: sans-serif; padding: 16px; }
    button { padding: 8px 16px; cursor: pointer; }
  </style>
</head>
<body>
  <h3>My Plugin</h3>
  <button id="create">사각형 생성</button>
  <script>
    document.getElementById('create').onclick = () => {
      parent.postMessage({ pluginMessage: { type: 'create-rect' } }, '*');
    };
  </script>
</body>
</html>
```

### 8단계: npm 스크립트 설정

`package.json`에 추가:

```json
{
  "scripts": {
    "build": "webpack --mode production",
    "watch": "webpack --watch"
  }
}
```

### 9단계: 빌드

```bash
npm run build
# 또는 개발 중 자동 빌드:
npm run watch
```

### 10단계: Figma에서 플러그인 로드

1. Figma 데스크톱 앱 실행
2. 임의의 파일 열기
3. 메뉴 → **Plugins** → **Development** → **Import plugin from manifest...**
4. 프로젝트의 `manifest.json` 파일 선택
5. 메뉴 → **Plugins** → **Development** → 플러그인 이름 클릭으로 실행

---

## 핵심 Figma API 개념

| 개념 | 설명 |
|------|------|
| `figma.currentPage` | 현재 열린 페이지 |
| `figma.createRectangle()` | 사각형 노드 생성 |
| `figma.createText()` | 텍스트 노드 생성 |
| `figma.createFrame()` | 프레임 노드 생성 |
| `figma.selection` | 현재 선택된 노드 배열 |
| `figma.ui.onmessage` | UI → 플러그인 메시지 수신 |
| `figma.ui.postMessage` | 플러그인 → UI 메시지 전송 |
| `figma.closePlugin()` | 플러그인 종료 |

---

## 주의사항

- `manifest.json`과 빌드된 `dist/code.js`는 항상 동기화 상태 유지
- Figma API는 `code.ts`(샌드박스 환경)에서만 실행 가능, UI HTML에서 직접 호출 불가
- 네트워크 요청 시 `manifest.json`의 `networkAccess.allowedDomains`에 도메인 추가 필요
- 플러그인 게시(publish)는 Figma Community를 통해 별도 심사 필요

---

## 참고 자료

- [Figma Plugin API 공식 문서](https://www.figma.com/plugin-docs/)
- [Figma Plugin Typings (GitHub)](https://github.com/figma/plugin-typings)
- [Figma Community Plugins](https://www.figma.com/community/plugins)
