const NODE_TYPE_KR: Record<string, string> = {
  FRAME: '프레임',
  GROUP: '그룹',
  TEXT: '텍스트',
  RECTANGLE: '사각형',
  ELLIPSE: '원',
  LINE: '선',
  VECTOR: '벡터',
  COMPONENT: '컴포넌트',
  COMPONENT_SET: '컴포넌트 세트',
  INSTANCE: '인스턴스',
  BOOLEAN_OPERATION: '불린 연산',
  STAR: '별',
  POLYGON: '다각형',
  SECTION: '섹션',
};

const PROP_KR: Record<string, string> = {
  name: '이름',
  width: '너비',
  height: '높이',
  x: 'X 위치',
  y: 'Y 위치',
  fills: '채우기',
  strokes: '선',
  effects: '효과',
  opacity: '불투명도',
  visible: '표시 여부',
  locked: '잠금',
  characters: '텍스트 내용',
  fontSize: '글자 크기',
  fontName: '글꼴',
  cornerRadius: '모서리 반경',
  layoutMode: '레이아웃 모드',
  rotation: '회전',
  blendMode: '혼합 모드',
  constraints: '제약 조건',
};

let isRecording = false;

figma.showUI(__html__, {
  width: 360,
  height: 460,
  title: 'Work Logger',
});

function isSceneNode(node: SceneNode | RemovedNode): node is SceneNode {
  return 'name' in node;
}

function getPageName(node: SceneNode): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let n: any = node;
  while (n) {
    if (n.type === 'PAGE') return n.name as string;
    n = n.parent ?? null;
  }
  return '(알 수 없음)';
}

function getTimestamp(): string {
  return new Date().toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatChange(change: DocumentChange): string | null {
  const ts = getTimestamp();
  try {
    switch (change.type) {
      case 'CREATE': {
        if (!isSceneNode(change.node)) return null;
        const typeName = NODE_TYPE_KR[change.node.type] ?? change.node.type;
        const pageName = getPageName(change.node);
        return `[${ts}] [생성] "${change.node.name}" (${typeName}) - 페이지: ${pageName}`;
      }
      case 'DELETE': {
        if (!isSceneNode(change.node)) return `[${ts}] [삭제] (노드 정보 없음)`;
        const typeName = NODE_TYPE_KR[change.node.type] ?? change.node.type;
        const pageName = getPageName(change.node);
        return `[${ts}] [삭제] "${change.node.name}" (${typeName}) - 페이지: ${pageName}`;
      }
      case 'PROPERTY_CHANGE': {
        if (!isSceneNode(change.node)) return null;
        const typeName = NODE_TYPE_KR[change.node.type] ?? change.node.type;
        const pageName = getPageName(change.node);
        const props = (change.properties as string[])
          .map(p => PROP_KR[p] ?? p)
          .join(', ');
        return `[${ts}] [변경] "${change.node.name}" (${typeName}) - 속성: ${props} - 페이지: ${pageName}`;
      }
      case 'STYLE_CREATE':
        return `[${ts}] [스타일 생성] "${change.style?.name ?? '이름 없음'}"`;
      case 'STYLE_DELETE':
        return `[${ts}] [스타일 삭제]`;
      case 'STYLE_PROPERTY_CHANGE':
        return `[${ts}] [스타일 변경] "${change.style?.name ?? '이름 없음'}"`;
      default:
        return null;
    }
  } catch {
    return `[${ts}] [변경 감지] (상세 정보 접근 불가)`;
  }
}

// 변경 항목을 UI로 전달 — 실제 파일 쓰기는 UI(FSAA)가 담당
function relayLog(entry: string): void {
  figma.ui.postMessage({ type: 'send-log', entry });
}

figma.on('documentchange', (event: DocumentChangeEvent) => {
  if (!isRecording) return;
  for (const change of event.documentChanges) {
    const entry = formatChange(change);
    if (entry) relayLog(entry);
  }
});

figma.ui.onmessage = async (msg: { type: string }) => {
  switch (msg.type) {
    case 'start-recording': {
      isRecording = true;
      const ts     = getTimestamp();
      const header = `\n${'='.repeat(60)}\n기록 시작: ${ts}\n${'='.repeat(60)}\n`;
      relayLog(header);
      figma.ui.postMessage({ type: 'recording-started' });
      break;
    }
    case 'stop-recording': {
      isRecording = false;
      const ts     = getTimestamp();
      relayLog(`기록 종료: ${ts}\n${'='.repeat(60)}\n`);
      figma.ui.postMessage({ type: 'recording-stopped' });
      break;
    }
    case 'close': {
      if (isRecording) {
        isRecording = false;
        relayLog(`기록 종료 (플러그인 닫힘): ${getTimestamp()}\n${'='.repeat(60)}\n`);
      }
      figma.closePlugin();
      break;
    }
  }
};
