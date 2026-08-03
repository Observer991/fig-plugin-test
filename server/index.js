const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// 헬스 체크
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 로그 기록
app.post('/log', (req, res) => {
  const { entry, filePath } = req.body;

  if (!entry || typeof entry !== 'string') {
    return res.status(400).json({ error: '유효한 로그 항목이 필요합니다.' });
  }
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: '파일 경로가 필요합니다.' });
  }

  const resolvedPath = path.resolve(filePath);
  const dir          = path.dirname(resolvedPath);

  if (!fs.existsSync(dir)) {
    return res.status(400).json({ error: `폴더가 존재하지 않습니다: ${dir}` });
  }

  try {
    fs.appendFileSync(resolvedPath, entry + '\n', 'utf8');
    const preview = entry.replace(/\n/g, ' ').slice(0, 80);
    console.log(`[기록] ${preview}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log('');
  console.log('Work Logger 서버 실행 중');
  console.log(`주소: http://localhost:${PORT}`);
  console.log('Figma 플러그인에서 [연결 테스트]를 눌러 확인하세요.');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`[오류] 포트 ${PORT}가 이미 사용 중입니다.`);
    console.error(`       다른 Work Logger 서버가 실행 중이거나,`);
    console.error(`       다른 프로그램이 해당 포트를 점유하고 있습니다.`);
    console.error('');
    console.error('해결 방법:');
    console.error(`  1. 이미 실행 중인 서버를 사용하세요 (http://localhost:${PORT})`);
    console.error(`  2. 다른 포트로 실행: PORT=3001 node server/index.js`);
    console.error('');
    process.exit(1);
  } else {
    console.error('[오류]', err.message);
    process.exit(1);
  }
});
