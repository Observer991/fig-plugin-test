// ── 타입 ─────────────────────────────────────────────────────────────────────

interface NodeSnap {
  id:   string;
  name: string;
  type: string;
  x: number; y: number;
  w: number; h: number;
  // 시각 속성
  visible:  boolean;
  opacity:  number;
  rotation: number;
  fills?:        string;
  strokes?:      string;
  effects?:      string;
  cornerRadius?: number;
  // 변수 연결
  boundVars?: string;
  // 텍스트 전용
  text?:       string;
  fontSize?:   number;
  fontFamily?: string;
  // 레이아웃 제약 & 정렬
  constraints?:       string;  // "H:LEFT,V:TOP"
  layoutAlign?:       string;  // 부모 오토레이아웃 내 정렬
  layoutGrow?:        number;  // flex grow (0 or 1)
  // 오토레이아웃 (프레임 자체)
  layoutMode?:          string;
  primaryAlignItems?:   string;
  counterAlignItems?:   string;
  padding?:             string;  // "top/right/bottom/left"
  itemSpacing?:         number;
  // 컴포넌트 시스템
  variantProps?:    string;  // COMPONENT 노드의 variant key=value
  componentProps?:  string;  // INSTANCE 노드의 override property:value
  children?: NodeSnap[];
}

interface Change {
  kind: 'ADDED' | 'REMOVED' | 'CHANGED';
  path: string;
  details: string[];
  nodeType: string;
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
  const urlMatch = s.match(/[?&]node-id=([^&#]+)/);
  if (urlMatch) return decodeURIComponent(urlMatch[1]).replace(/-/g, ':');
  if (/^[\w]+:\d+$/.test(s)) return s;
  if (/^[\w]+-\d+$/.test(s)) return s.replace(/-(\d+)$/, ':$1');
  return null;
}

// ── 헬퍼: 속성 직렬화 ────────────────────────────────────────────────────────

// RGB(0-1) → #RRGGBB
function toHex(c: RGB): string {
  return '#' + [c.r, c.g, c.b]
    .map(v => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

function serializePaint(p: Paint): string {
  if (p.type === 'SOLID') {
    const hex  = toHex(p.color);
    const opac = Math.round((p.opacity ?? 1) * 100);
    return opac < 100 ? `${hex}(${opac}%)` : hex;
  }
  if (p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL' ||
      p.type === 'GRADIENT_ANGULAR' || p.type === 'GRADIENT_DIAMOND') {
    const gp    = p as GradientPaint;
    const stops = gp.gradientStops.map(s => toHex(s.color)).join('-');
    return `그라디언트(${stops})`;
  }
  return p.type === 'IMAGE' ? '이미지' : p.type;
}

function serializePaints(paints: readonly Paint[]): string {
  return paints
    .filter(p => p.visible !== false)
    .map(serializePaint)
    .join('|') || 'none';
}

function serializeEffects(effects: readonly Effect[]): string {
  return effects.filter(e => e.visible !== false).map(e => {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      const s      = e as DropShadowEffect;
      const typeKR = e.type === 'DROP_SHADOW' ? '드롭섀도' : '이너섀도';
      return `${typeKR}(${toHex(s.color)},x${Math.round(s.offset.x)},y${Math.round(s.offset.y)},r${Math.round(s.radius)})`;
    }
    if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
      const typeKR = e.type === 'LAYER_BLUR' ? '레이어블러' : '배경블러';
      return `${typeKR}(r${Math.round((e as BlurEffect).radius)})`;
    }
    return e.type;
  }).join('|') || 'none';
}

// boundVars 문자열 → Map<field, varName>
function parseBoundVars(bv: string): Map<string, string> {
  const m = new Map<string, string>();
  if (!bv) return m;
  for (const pair of bv.split(';')) {
    const idx = pair.indexOf(':');
    if (idx > 0) m.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  return m;
}

function serializeBoundVars(node: SceneNode): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bv = (node as any).boundVariables as Record<string, unknown> | undefined;
  if (!bv) return '';
  const entries: string[] = [];
  for (const [field, alias] of Object.entries(bv)) {
    if (!alias) continue;
    if (Array.isArray(alias)) {
      (alias as Array<{ id?: string }>).forEach(a => {
        if (a?.id) {
          const v = figma.variables.getVariableById(a.id);
          entries.push(`${field}:${v ? v.name : a.id}`);
        }
      });
    } else {
      const a = alias as { id?: string };
      if (a?.id) {
        const v = figma.variables.getVariableById(a.id);
        entries.push(`${field}:${v ? v.name : a.id}`);
      }
    }
  }
  return entries.sort().join(';');
}

// ── 헬퍼: 스냅샷 ─────────────────────────────────────────────────────────────

function snapNode(node: SceneNode): NodeSnap {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = node as any;

  const snap: NodeSnap = {
    id:       node.id,
    name:     node.name,
    type:     node.type,
    x:        Math.round(node.x),
    y:        Math.round(node.y),
    w:        'width'  in node ? Math.round((node as LayoutMixin).width)  : 0,
    h:        'height' in node ? Math.round((node as LayoutMixin).height) : 0,
    visible:  node.visible,
    opacity:  Math.round((n.opacity  ?? 1)  * 100) / 100,
    rotation: Math.round((n.rotation ?? 0)  * 10)  / 10,
  };

  // 채우기 색상
  if ('fills' in node && n.fills !== figma.mixed && Array.isArray(n.fills)) {
    snap.fills = serializePaints(n.fills as Paint[]);
  }

  // 테두리
  if ('strokes' in node && Array.isArray(n.strokes) && n.strokes.length > 0) {
    const weight = typeof n.strokeWeight === 'number' ? `,w${Math.round(n.strokeWeight * 10) / 10}` : '';
    snap.strokes = serializePaints(n.strokes as Paint[]) + weight;
  }

  // 효과 (그림자·블러)
  if ('effects' in node && Array.isArray(n.effects) && n.effects.length > 0) {
    snap.effects = serializeEffects(n.effects as Effect[]);
  }

  // 모서리 반경
  if ('cornerRadius' in node && typeof n.cornerRadius === 'number') {
    snap.cornerRadius = Math.round(n.cornerRadius);
  }

  // 변수 연결
  const bv = serializeBoundVars(node);
  if (bv) snap.boundVars = bv;

  // 텍스트 전용
  if (node.type === 'TEXT') {
    const tn = node as TextNode;
    snap.text = tn.characters;
    if (tn.fontSize !== figma.mixed)
      snap.fontSize = tn.fontSize as number;
    if (tn.fontName !== figma.mixed) {
      const fn = tn.fontName as FontName;
      snap.fontFamily = `${fn.family} ${fn.style}`;
    }
  }

  // 제약 (constraints)
  if ('constraints' in node && n.constraints) {
    const c = n.constraints as { horizontal: string; vertical: string };
    snap.constraints = `H:${c.horizontal},V:${c.vertical}`;
  }

  // 오토레이아웃 (프레임 자체 설정)
  if ('layoutMode' in node && n.layoutMode && n.layoutMode !== 'NONE') {
    snap.layoutMode        = n.layoutMode as string;
    snap.primaryAlignItems = n.primaryAxisAlignItems as string | undefined;
    snap.counterAlignItems = n.counterAxisAlignItems as string | undefined;
    const pad = `${n.paddingTop ?? 0}/${n.paddingRight ?? 0}/${n.paddingBottom ?? 0}/${n.paddingLeft ?? 0}`;
    if (pad !== '0/0/0/0') snap.padding = pad;
    if (typeof n.itemSpacing === 'number' && n.itemSpacing !== 0) snap.itemSpacing = n.itemSpacing;
  }

  // 오토레이아웃 자식 정렬
  if (n.layoutAlign && n.layoutAlign !== 'INHERIT') snap.layoutAlign = n.layoutAlign as string;
  if (typeof n.layoutGrow === 'number' && n.layoutGrow !== 0) snap.layoutGrow = n.layoutGrow;

  // 배리언트 속성 (COMPONENT = 개별 variant 노드)
  if (node.type === 'COMPONENT' && n.variantProperties) {
    snap.variantProps = Object.entries(n.variantProperties as Record<string, string>)
      .map(([k, v]) => `${k}=${v}`).sort().join(',');
  }

  // 컴포넌트 인스턴스 속성 (INSTANCE = 배치된 인스턴스 override)
  if (node.type === 'INSTANCE' && n.componentProperties) {
    const cp = n.componentProperties as Record<string, { value: string | boolean }>;
    snap.componentProps = Object.entries(cp)
      .map(([k, p]) => `${k.split('#')[0]}:${p.value}`).sort().join(',');
  }

  // 자식 노드
  if ('children' in node) {
    snap.children = (node as ChildrenMixin).children.map(c => snapNode(c as SceneNode));
  }

  return snap;
}

// ── 헬퍼: 스냅샷 평탄화 ──────────────────────────────────────────────────────

function flatten(snap: NodeSnap, parentPath = ''): Map<string, { snap: NodeSnap; path: string }> {
  const map  = new Map<string, { snap: NodeSnap; path: string }>();
  const path = parentPath ? `${parentPath} / "${snap.name}"` : `"${snap.name}"`;
  map.set(snap.id, { snap, path });
  for (const child of snap.children ?? []) {
    for (const [id, val] of flatten(child, path)) map.set(id, val);
  }
  return map;
}

// ── 헬퍼: 신규 추가 노드의 초기 속성 요약 ────────────────────────────────────

function addedDetails(snap: NodeSnap): string[] {
  const d: string[] = [];
  if (snap.variantProps)   d.push(`배리언트: ${snap.variantProps}`);
  if (snap.componentProps) d.push(`컴포넌트 속성: ${snap.componentProps}`);
  if (snap.fills && snap.fills !== 'none') d.push(`채우기: ${snap.fills}`);
  if (snap.strokes && snap.strokes !== 'none') d.push(`테두리: ${snap.strokes}`);
  if (snap.w && snap.h)    d.push(`크기: ${snap.w}×${snap.h}`);
  if (snap.constraints)    d.push(`제약: ${snap.constraints}`);
  if (snap.text)           d.push(`텍스트: "${snap.text.length > 40 ? snap.text.slice(0, 40) + '…' : snap.text}"`);
  return d;
}

// ── 헬퍼: 스냅샷 비교 ────────────────────────────────────────────────────────

function compareSnapshots(before: NodeSnap, after: NodeSnap): Change[] {
  const bMap = flatten(before);
  const aMap = flatten(after);
  const changes: Change[] = [];

  for (const [id, { snap: a, path }] of aMap) {
    if (!bMap.has(id)) {
      changes.push({ kind: 'ADDED', path, details: addedDetails(a), nodeType: a.type });
    }
  }
  for (const [id, { snap: b, path }] of bMap) {
    if (!aMap.has(id)) {
      changes.push({ kind: 'REMOVED', path, details: [], nodeType: b.type });
    }
  }

  for (const [id, { snap: b }] of bMap) {
    const aEntry = aMap.get(id);
    if (!aEntry) continue;
    const { snap: a, path } = aEntry;
    const diffs: string[] = [];

    if (b.name !== a.name)
      diffs.push(`이름: "${b.name}" → "${a.name}"`);
    if (b.visible !== a.visible)
      diffs.push(`표시 여부: ${b.visible ? '표시' : '숨김'} → ${a.visible ? '표시' : '숨김'}`);
    if (b.opacity !== a.opacity)
      diffs.push(`불투명도: ${Math.round(b.opacity * 100)}% → ${Math.round(a.opacity * 100)}%`);
    if (b.x !== a.x || b.y !== a.y)
      diffs.push(`위치: (${b.x}, ${b.y}) → (${a.x}, ${a.y})`);
    if (b.w !== a.w || b.h !== a.h)
      diffs.push(`크기: ${b.w}×${b.h} → ${a.w}×${a.h}`);
    if (b.rotation !== a.rotation)
      diffs.push(`회전: ${b.rotation}° → ${a.rotation}°`);
    if (b.fills !== undefined && b.fills !== a.fills)
      diffs.push(`채우기: ${b.fills} → ${a.fills ?? 'none'}`);
    if (b.strokes !== undefined && b.strokes !== a.strokes)
      diffs.push(`테두리: ${b.strokes} → ${a.strokes ?? 'none'}`);
    if (b.effects !== undefined && b.effects !== a.effects)
      diffs.push(`효과: ${b.effects} → ${a.effects ?? 'none'}`);
    if (b.cornerRadius !== undefined && b.cornerRadius !== a.cornerRadius)
      diffs.push(`모서리 반경: ${b.cornerRadius ?? 0} → ${a.cornerRadius ?? 0}`);
    {
      const bBV = b.boundVars ?? '', aBV = a.boundVars ?? '';
      if (bBV !== aBV) {
        const bVars = parseBoundVars(bBV);
        const aVars = parseBoundVars(aBV);
        const varDiffs: string[] = [];
        for (const [field, aVal] of aVars) {
          const bVal = bVars.get(field);
          if (!bVal) varDiffs.push(`${field}[없음→${aVal}]`);
          else if (bVal !== aVal) varDiffs.push(`${field}[${bVal}→${aVal}]`);
        }
        for (const [field, bVal] of bVars) {
          if (!aVars.has(field)) varDiffs.push(`${field}[${bVal}→없음]`);
        }
        if (varDiffs.length) diffs.push(`변수 연결: ${varDiffs.join(', ')}`);
      }
    }
    if (b.text !== undefined && b.text !== a.text) {
      const clip = (s: string) => s.length > 40 ? s.slice(0, 40) + '…' : s;
      diffs.push(`텍스트: "${clip(b.text)}" → "${clip(a.text ?? '')}"`);
    }
    if (b.fontSize !== undefined && b.fontSize !== a.fontSize)
      diffs.push(`글자 크기: ${b.fontSize} → ${a.fontSize}`);
    if (b.fontFamily !== undefined && b.fontFamily !== a.fontFamily)
      diffs.push(`글꼴: ${b.fontFamily} → ${a.fontFamily}`);
    if ((b.layoutMode ?? '') !== (a.layoutMode ?? ''))
      diffs.push(`레이아웃: ${b.layoutMode ?? 'NONE'} → ${a.layoutMode ?? 'NONE'}`);
    if ((b.constraints ?? '') !== (a.constraints ?? ''))
      diffs.push(`제약: ${b.constraints ?? '-'} → ${a.constraints ?? '-'}`);
    if ((b.primaryAlignItems ?? '') !== (a.primaryAlignItems ?? ''))
      diffs.push(`기본축 정렬: ${b.primaryAlignItems ?? '-'} → ${a.primaryAlignItems ?? '-'}`);
    if ((b.counterAlignItems ?? '') !== (a.counterAlignItems ?? ''))
      diffs.push(`교차축 정렬: ${b.counterAlignItems ?? '-'} → ${a.counterAlignItems ?? '-'}`);
    if ((b.padding ?? '') !== (a.padding ?? ''))
      diffs.push(`패딩: ${b.padding ?? '0/0/0/0'} → ${a.padding ?? '0/0/0/0'}`);
    if ((b.itemSpacing ?? 0) !== (a.itemSpacing ?? 0))
      diffs.push(`간격: ${b.itemSpacing ?? 0} → ${a.itemSpacing ?? 0}`);
    if ((b.layoutAlign ?? '') !== (a.layoutAlign ?? ''))
      diffs.push(`정렬(부모 내): ${b.layoutAlign ?? 'INHERIT'} → ${a.layoutAlign ?? 'INHERIT'}`);
    if ((b.layoutGrow ?? 0) !== (a.layoutGrow ?? 0))
      diffs.push(`늘이기(grow): ${b.layoutGrow ?? 0} → ${a.layoutGrow ?? 0}`);
    if ((b.variantProps ?? '') !== (a.variantProps ?? ''))
      diffs.push(`배리언트: ${b.variantProps ?? '-'} → ${a.variantProps ?? '-'}`);
    if ((b.componentProps ?? '') !== (a.componentProps ?? ''))
      diffs.push(`컴포넌트 속성: ${b.componentProps ?? '-'} → ${a.componentProps ?? '-'}`);

    if (diffs.length > 0) changes.push({ kind: 'CHANGED', path, details: diffs, nodeType: a.type });
  }

  return changes;
}

// ── 헬퍼: 컨텍스트 경로 + 컴팩트 포맷 ──────────────────────────────────────

const VAR_FIELD_KR: Record<string, string> = {
  fills: '채우기', strokes: '테두리', opacity: '불투명도',
  width: '너비', height: '높이', itemSpacing: '간격',
  paddingLeft: '왼쪽 패딩', paddingRight: '오른쪽 패딩',
  paddingTop: '위쪽 패딩', paddingBottom: '아래쪽 패딩',
};

// '"A" / "B" / "C"' → "B > C" (마지막 2단계만, 이전은 … 생략)
function getContext(path: string): string {
  const segs = (path.match(/"([^"]+)"/g) ?? []).map(s => s.replace(/"/g, ''));
  if (segs.length === 0) return path;
  if (segs.length === 1) return segs[0];
  if (segs.length === 2) return `${segs[0]} > ${segs[1]}`;
  return `···${segs[segs.length - 2]} > ${segs[segs.length - 1]}`;
}

// detail 한 줄을 들여쓰기된 compact 형식으로 변환 (여러 줄 반환 가능)
function fmtDetail(detail: string): string[] {
  // 변수 연결: field[before→after], ... → 필드별 분리
  if (detail.startsWith('변수 연결:')) {
    const re = /(\w+)\[([^\]]+)→([^\]]+)\]/g;
    const lines: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(detail)) !== null) {
      const field = VAR_FIELD_KR[m[1]] ?? m[1];
      const from  = m[2].trim(), to = m[3].trim();
      if (from === '없음') lines.push(`    변수(${field}): 없음 → ${to}`);
      else if (to === '없음') lines.push(`    변수(${field}): ${from} → 해제`);
      else lines.push(`    변수(${field}): ${from} → ${to}`);
    }
    return lines.length ? lines : [`    ${detail}`];
  }
  // 일반: "label: value → value" 형태 그대로, 들여쓰기만 추가
  return [`    ${detail}`];
}

// ── 헬퍼: 히스토리 포맷팅 ────────────────────────────────────────────────────

function formatHistory(changes: Change[], targetName: string, ts: string): string {
  const bar = '═'.repeat(48);
  const added    = changes.filter(c => c.kind === 'ADDED');
  const removed  = changes.filter(c => c.kind === 'REMOVED');
  const modified = changes.filter(c => c.kind === 'CHANGED');

  const propCount = modified.reduce((s, c) => s + c.details.length, 0);
  const summary   = `노드 ${changes.length}개 영향 | 속성 ${propCount}건`;

  const lines: string[] = ['', bar, `세션 기록: ${ts}`, `대상: "${targetName}" | ${summary}`, bar, ''];

  if (changes.length === 0) {
    lines.push('변경 사항 없음');
    lines.push(bar);
    return lines.join('\n');
  }

  // ① 추가
  if (added.length > 0) {
    lines.push(`+ 추가 (${added.length}건)`);
    added.forEach(c => {
      const ctx  = getContext(c.path);
      const type = NODE_TYPE_KR[c.nodeType] ?? c.nodeType;
      lines.push(`  + ${ctx}  [${type}]`);
    });
    lines.push('');
  }

  // ② 삭제
  if (removed.length > 0) {
    lines.push(`- 삭제 (${removed.length}건)`);
    removed.forEach(c => {
      const ctx  = getContext(c.path);
      const type = NODE_TYPE_KR[c.nodeType] ?? c.nodeType;
      lines.push(`  - ${ctx}  [${type}]`);
    });
    lines.push('');
  }

  // ③ 속성 변경 — 노드별 블록
  if (modified.length > 0) {
    lines.push(`~ 속성 변경 (${modified.length}개 노드)`);
    lines.push('');
    modified.forEach(c => {
      const ctx  = getContext(c.path);
      const type = NODE_TYPE_KR[c.nodeType] ?? c.nodeType;
      lines.push(`  ■ ${ctx}  [${type}]`);
      c.details.forEach(d => fmtDetail(d).forEach(l => lines.push(l)));
      lines.push('');
    });
  }

  lines.push(bar);
  return lines.join('\n');
}

// ── 헬퍼: 텍스트 레이어 폰트 일괄 로드 ──────────────────────────────────────

async function loadAllFontsForNode(textNode: TextNode): Promise<void> {
  const len = textNode.characters.length;
  if (len === 0) { await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); return; }
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
  if (fonts.length === 0) await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  else await Promise.all(fonts.map(f => figma.loadFontAsync(f)));
}

// ── 헬퍼: 텍스트 레이어에 히스토리 추가 ─────────────────────────────────────

async function appendHistory(nodeId: string, content: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error('텍스트 레이어를 찾을 수 없습니다.');
  if (node.type !== 'TEXT') throw new Error(`텍스트 레이어가 아닙니다 (유형: ${node.type})`);
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
