// ── 타입 ─────────────────────────────────────────────────────────────────────

interface NodeSnap {
  id:   string;
  name: string;
  type: string;
  x: number; y: number;
  w: number; h: number;
  text?: string;
  children?: NodeSnap[];
}

interface Change {
  kind: 'ADDED' | 'REMOVED' | 'CHANGED';
  path: string;
  details: string[];
}

// ── 상수 ─────────────────────────────────────────────────────────────────────

const NODE_TYPE_KR: Record<string, string> = {
  FRAME: '프레임', GROUP: '그룹', TEXT: '텍스트', RECTANGLE: '사각형',
  ELLIPSE: '원', LINE: '선', VECTOR: '벡터', COMPONENT: '컴포넌트',
  COMPONENT_SET: '컴포넌트 세트', INSTANCE: '인스턴스', SECTION: '섹션',
  BOOLEAN_OPERATION: '불린 연산', STAR: '별', POLYGON: '다각형',
};

// ── 상태 ─────────────────────────────────────────────────────────────────────

let isRecording      = false;
let targetNodeId:    string | null = null;
let textLayerNodeId: string | null = null;
let beforeSnapshot:  NodeSnap | null = null;

// ── UI 초기화 ─────────────────────────────────────────────────────────────────

figma.showUI(__html__, { width: 380, height: 520, title: 'Work Logger' });

(async () => {
  const savedTarget    = await figma.clientStorage.getAsync('targetNodeId')    as string | undefined;
  const savedTextLayer = await figma.clientStorage.getAsync('textLayerNodeId') as string | undefined;
  figma.ui.postMessage({ type: 'init-node-ids', targetNodeId: savedTarget ?? '', textLayerNodeId: savedTextLayer ?? '' });
})();

// ── 헬퍼: Figma URL → node-id 변환 ───────────────────────────────────────────

function parseNodeId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // Figma 샌드박스는 new URL() 미지원 — 정규식으로 직접 파싱
  // URL 예시: https://www.figma.com/design/FILE/name?node-id=123-456&t=…
  const urlMatch = s.match(/[?&]node-id=([^&#]+)/);
  if (urlMatch) {
    // %3A 등 URL 인코딩 해제 후 dash(-)를 colon(:)으로 변환
    return decodeURIComponent(urlMatch[1]).replace(/-/g, ':');
  }

  // 원시 node-id 직접 입력 ("123:456" 또는 "123-456", 인스턴스 "I123:456" 포함)
  if (/^[\w]+:\d+$/.test(s)) return s;
  if (/^[\w]+-\d+$/.test(s)) return s.replace(/-(\d+)$/, ':$1');

  return null;
}

// ── 헬퍼: 스냅샷 ─────────────────────────────────────────────────────────────

function snapNode(node: SceneNode): NodeSnap {
  const snap: NodeSnap = {
    id:   node.id,
    name: node.name,
    type: node.type,
    x: Math.round(node.x),
    y: Math.round(node.y),
    w: 'width'  in node ? Math.round((node as LayoutMixin).width)  : 0,
    h: 'height' in node ? Math.round((node as LayoutMixin).height) : 0,
  };
  if (node.type === 'TEXT') snap.text = (node as TextNode).characters;
  if ('children' in node) {
    snap.children = (node as ChildrenMixin).children
      .map(c => snapNode(c as SceneNode));
  }
  return snap;
}

// ── 헬퍼: 스냅샷 평탄화 (id → {snap, path}) ──────────────────────────────────

function flatten(snap: NodeSnap, parentPath = ''): Map<string, { snap: NodeSnap; path: string }> {
  const map  = new Map<string, { snap: NodeSnap; path: string }>();
  const path = parentPath ? `${parentPath} / "${snap.name}"` : `"${snap.name}"`;
  map.set(snap.id, { snap, path });
  for (const child of snap.children ?? []) {
    for (const [id, val] of flatten(child, path)) map.set(id, val);
  }
  return map;
}

// ── 헬퍼: 스냅샷 비교 ────────────────────────────────────────────────────────

function compareSnapshots(before: NodeSnap, after: NodeSnap): Change[] {
  const bMap = flatten(before);
  const aMap = flatten(after);
  const changes: Change[] = [];

  // 추가된 노드
  for (const [id, { snap: a, path }] of aMap) {
    if (!bMap.has(id)) {
      changes.push({ kind: 'ADDED', path, details: [`유형: ${NODE_TYPE_KR[a.type] ?? a.type}`] });
    }
  }

  // 삭제된 노드
  for (const [id, { snap: b, path }] of bMap) {
    if (!aMap.has(id)) {
      changes.push({ kind: 'REMOVED', path, details: [`유형: ${NODE_TYPE_KR[b.type] ?? b.type}`] });
    }
  }

  // 변경된 노드 (이름·위치·크기·텍스트)
  for (const [id, { snap: b }] of bMap) {
    const aEntry = aMap.get(id);
    if (!aEntry) continue;
    const { snap: a, path } = aEntry;
    const diffs: string[] = [];

    if (b.name !== a.name)
      diffs.push(`이름: "${b.name}" → "${a.name}"`);
    if (b.x !== a.x || b.y !== a.y)
      diffs.push(`위치: (${b.x}, ${b.y}) → (${a.x}, ${a.y})`);
    if (b.w !== a.w || b.h !== a.h)
      diffs.push(`크기: ${b.w}×${b.h} → ${a.w}×${a.h}`);
    if (b.text !== undefined && b.text !== a.text) {
      const clip = (s: string) => s.length > 40 ? s.slice(0, 40) + '…' : s;
      diffs.push(`텍스트: "${clip(b.text)}" → "${clip(a.text ?? '')}"`);
    }

    if (diffs.length > 0) changes.push({ kind: 'CHANGED', path, details: diffs });
  }

  return changes;
}

// ── 헬퍼: 자연어 변환 유틸 ───────────────────────────────────────────────────

// '"A" / "B" / "C"' 에서 마지막 노드 이름 반환
function lastSeg(path: string): string {
  const m = path.match(/"([^"]+)"/g);
  return m ? m[m.length - 1].replace(/"/g, '') : path;
}

// 직계 부모 이름 반환 (없으면 null)
function parentSeg(path: string): string | null {
  const m = path.match(/"([^"]+)"/g);
  return m && m.length >= 2 ? m[m.length - 2].replace(/"/g, '') : null;
}

// details 배열에서 노드 유형 추출
function typeLabel(details: string[]): string {
  const d = details.find(x => x.startsWith('유형:'));
  return d ? d.slice(4).trim() : '요소';
}

// 한국어 주격 조사 — 단어 끝음절 종성 유무로 이/가 결정
function ga(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xAC00 || code > 0xD7A3) return '가';
  return (code - 0xAC00) % 28 === 0 ? '가' : '이';
}

function addedSentence(c: Change): string {
  const name   = lastSeg(c.path);
  const parent = parentSeg(c.path);
  const type   = typeLabel(c.details);
  const p      = ga(type);
  if (parent) return `"${name}" ${type}${p} "${parent}" 안에 추가되었습니다.`;
  return `"${name}" ${type}${p} 추가되었습니다.`;
}

function removedSentence(c: Change): string {
  const name = lastSeg(c.path);
  const type = typeLabel(c.details);
  const p    = ga(type);
  return `"${name}" ${type}${p} 삭제되었습니다.`;
}

function changedSentences(c: Change): string[] {
  const name   = lastSeg(c.path);
  const result: string[] = [];

  for (const detail of c.details) {
    if (detail.startsWith('텍스트:')) {
      const m = detail.match(/텍스트: "([^"]*)" → "([^"]*)"/);
      result.push(m
        ? `"${name}"의 텍스트가 "${m[1]}"에서 "${m[2]}"로 수정되었습니다.`
        : `"${name}"의 텍스트 내용이 변경되었습니다.`);

    } else if (detail.startsWith('크기:')) {
      const m = detail.match(/크기: (\d+)×(\d+) → (\d+)×(\d+)/);
      result.push(m
        ? `"${name}"의 크기가 ${m[1]}×${m[2]}에서 ${m[3]}×${m[4]}로 조정되었습니다.`
        : `"${name}"의 크기가 변경되었습니다.`);

    } else if (detail.startsWith('위치:')) {
      const m = detail.match(/위치: \((-?\d+), (-?\d+)\) → \((-?\d+), (-?\d+)\)/);
      result.push(m
        ? `"${name}"의 위치가 (${m[1]}, ${m[2]})에서 (${m[3]}, ${m[4]})로 이동했습니다.`
        : `"${name}"의 위치가 변경되었습니다.`);

    } else if (detail.startsWith('이름:')) {
      const m = detail.match(/이름: "([^"]+)" → "([^"]+)"/);
      result.push(m
        ? `"${m[1]}"의 이름이 "${m[2]}"로 변경되었습니다.`
        : `"${name}"의 이름이 변경되었습니다.`);

    } else {
      result.push(`"${name}"에서 변경이 감지되었습니다: ${detail}`);
    }
  }
  return result;
}

// ── 헬퍼: 히스토리 포맷팅 ────────────────────────────────────────────────────

function formatHistory(changes: Change[], targetName: string, ts: string): string {
  const bar1 = '═'.repeat(44);
  const bar2 = '─'.repeat(44);

  const added    = changes.filter(c => c.kind === 'ADDED');
  const removed  = changes.filter(c => c.kind === 'REMOVED');
  const modified = changes.filter(c => c.kind === 'CHANGED');

  const lines: string[] = ['', bar1, `세션 기록: ${ts}`, `대상: "${targetName}"`, bar1, ''];

  if (changes.length === 0) {
    lines.push('이번 세션에서 변경된 내용이 없습니다.');
  } else {
    lines.push(`이번 세션에서 총 ${changes.length}건의 변경이 감지되었습니다.`, '');

    if (added.length > 0) {
      lines.push(`[신규 추가 — ${added.length}건]`);
      added.forEach(c => lines.push('  • ' + addedSentence(c)));
      lines.push('');
    }

    if (removed.length > 0) {
      lines.push(`[삭제 — ${removed.length}건]`);
      removed.forEach(c => lines.push('  • ' + removedSentence(c)));
      lines.push('');
    }

    if (modified.length > 0) {
      lines.push(`[속성 변경 — ${modified.length}건]`);
      modified.forEach(c => changedSentences(c).forEach(s => lines.push('  • ' + s)));
      lines.push('');
    }
  }

  lines.push(bar2);
  return lines.join('\n');
}

// ── 헬퍼: 텍스트 레이어 폰트 일괄 로드 ──────────────────────────────────────

async function loadAllFontsForNode(textNode: TextNode): Promise<void> {
  const len = textNode.characters.length;
  if (len === 0) {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    return;
  }
  const seen = new Set<string>();
  const fonts: FontName[] = [];
  for (let i = 0; i < len; i++) {
    const fn = textNode.getRangeFontName(i, i + 1);
    if (fn !== figma.mixed) {
      const f = fn as FontName;
      const key = `${f.family}::${f.style}`;
      if (!seen.has(key)) { seen.add(key); fonts.push(f); }
    }
  }
  if (fonts.length === 0) {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  } else {
    await Promise.all(fonts.map(f => figma.loadFontAsync(f)));
  }
}

// ── 헬퍼: 텍스트 레이어에 히스토리 추가 ─────────────────────────────────────

async function appendHistory(nodeId: string, content: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error('텍스트 레이어를 찾을 수 없습니다.');
  if (node.type !== 'TEXT') throw new Error(`선택한 노드가 텍스트 레이어가 아닙니다 (유형: ${node.type})`);

  const textNode = node as TextNode;
  await loadAllFontsForNode(textNode);

  const existing = textNode.characters;
  textNode.characters = existing ? existing + content : content;
}

// ── 헬퍼: 타임스탬프 ─────────────────────────────────────────────────────────

function getTimestamp(): string {
  return new Date().toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

// ── UI 메시지 핸들러 ──────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg: {
  type: string;
  url?: string;
  field?: string;
  targetNodeId?: string;
  textLayerNodeId?: string;
}) => {
  switch (msg.type) {

    // URL 유효성 검사 + 노드 정보 반환 (모니터링 대상 URL 입력용)
    case 'validate-node': {
      const nodeId = parseNodeId(msg.url ?? '');
      if (!nodeId) {
        figma.ui.postMessage({ type: 'selection-result', field: msg.field, ok: false, error: '유효한 Figma URL이 아닙니다.' });
        return;
      }
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        figma.ui.postMessage({ type: 'selection-result', field: msg.field, ok: false, error: '노드를 찾을 수 없습니다. URL을 다시 확인하세요.' });
        return;
      }
      figma.ui.postMessage({
        type: 'selection-result', field: msg.field, ok: true,
        nodeId, nodeName: (node as SceneNode).name, nodeType: node.type,
      });
      break;
    }

    // 현재 선택된 레이어를 해당 필드에 지정
    case 'use-selection': {
      const sel = figma.currentPage.selection;
      if (sel.length === 0) {
        figma.ui.postMessage({ type: 'selection-result', field: msg.field, ok: false, error: '선택된 레이어가 없습니다. Figma 캔버스에서 레이어를 먼저 선택하세요.' });
        return;
      }
      const node = sel[0];
      if (msg.field === 'textLayer' && node.type !== 'TEXT') {
        figma.ui.postMessage({ type: 'selection-result', field: msg.field, ok: false, error: `텍스트 레이어를 선택해야 합니다 (현재 선택: ${node.type})` });
        return;
      }
      figma.ui.postMessage({
        type: 'selection-result', field: msg.field, ok: true,
        nodeId: node.id, nodeName: node.name, nodeType: node.type,
      });
      break;
    }

    // 기록 시작: node ID를 직접 받아 스냅샷 촬영
    case 'start-recording': {
      const tNodeId  = msg.targetNodeId  ?? '';
      const tlNodeId = msg.textLayerNodeId ?? '';
      if (!tNodeId || !tlNodeId) {
        figma.ui.postMessage({ type: 'error', message: '모니터링 대상과 기록 레이어를 모두 지정해주세요.' });
        return;
      }
      const node = await figma.getNodeByIdAsync(tNodeId);
      if (!node) {
        figma.ui.postMessage({ type: 'error', message: '대상 노드에 접근할 수 없습니다.' });
        return;
      }

      targetNodeId    = tNodeId;
      textLayerNodeId = tlNodeId;
      await figma.clientStorage.setAsync('targetNodeId',    tNodeId);
      await figma.clientStorage.setAsync('textLayerNodeId', tlNodeId);

      beforeSnapshot = snapNode(node as SceneNode);
      isRecording    = true;
      figma.ui.postMessage({ type: 'recording-started', targetName: (node as SceneNode).name });
      break;
    }

    // 기록 종료: 비교 후 텍스트 레이어에 기록
    case 'stop-recording': {
      if (!isRecording || !beforeSnapshot || !targetNodeId || !textLayerNodeId) {
        figma.ui.postMessage({ type: 'error', message: '기록이 시작되지 않았습니다.' });
        return;
      }
      const node = await figma.getNodeByIdAsync(targetNodeId);
      if (!node) {
        figma.ui.postMessage({ type: 'error', message: '대상 노드를 찾을 수 없습니다.' });
        return;
      }

      const afterSnapshot = snapNode(node as SceneNode);
      const changes       = compareSnapshots(beforeSnapshot, afterSnapshot);
      const historyText   = formatHistory(changes, afterSnapshot.name, getTimestamp());

      try {
        await appendHistory(textLayerNodeId, historyText);
        isRecording    = false;
        beforeSnapshot = null;
        figma.ui.postMessage({ type: 'recording-stopped', changeCount: changes.length, history: historyText });
      } catch (err) {
        figma.ui.postMessage({ type: 'error', message: (err as Error).message });
      }
      break;
    }

    case 'close':
      figma.closePlugin();
      break;
  }
};
