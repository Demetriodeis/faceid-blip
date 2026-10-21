'use strict';

/* Fluxo: identificar -> (não achou) cadastrar -> identificar de novo.
   Todo o reconhecimento facial roda no navegador (face-api.js / TensorFlow.js);
   só o vetor de 128 números vai para a API. Nenhuma foto é enviada. */

const CFG = Object.assign(
  { supportWhatsapp: '', autoCloseMs: 3000, holdMsIdentify: 2000, holdMsEnroll: 1200 },
  window.FACEID_CONFIG || {}
);
// Limites de qualidade da imagem (ajustáveis em config.js > quality).
const QC = Object.assign(
  { minScore: 0.7, minLuma: 70, maxLuma: 205, minContrast: 28, minSharp: 30, minFrameLuma: 60 },
  CFG.quality || {}
);
const DEBUG = new URLSearchParams(location.search).has('debug');
const API = '/api';
const MODELS = '/models';

const params = new URLSearchParams(location.search);
const CONTACT_ID = params.get('id');
const SIG = params.get('sig') || '';

const $ = (id) => document.getElementById(id);
const video = $('video');
const guide = $('guide');
const ring = $('ring');
const ringLen = ring.getTotalLength();
ring.style.strokeDasharray = ringLen;
ring.style.strokeDashoffset = ringLen;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let detOpts;
let justEnrolled = false;

/* ---------- UI helpers ---------- */
function setStatus(title, desc, color) {
  $('title').textContent = title;
  $('title').style.color = color || '#fff';
  $('desc').textContent = desc;
}
function setProgress(pct) {
  ring.style.strokeDashoffset = ringLen - (Math.min(pct, 100) / 100) * ringLen;
}
function setGuide(state) {
  guide.classList.toggle('ok', state === 'ok');
  guide.classList.toggle('bad', state === 'bad');
}
function show(id) {
  for (const el of document.querySelectorAll('.overlay')) el.classList.remove('show');
  if (id) $(id).classList.add('show');
  $('statusBox').hidden = Boolean(id); // evita o texto de status vazar por trás dos painéis
}
function showBusy(title, desc) {
  $('busyTitle').textContent = title;
  $('busyDesc').textContent = desc || '';
  show('busy');
}
let autoCloseTimer = null;

/** Tenta fechar a janela. Só funciona em alguns navegadores; senão mostra a dica. */
function tryClose() {
  window.close();
  setTimeout(() => { $('closeHint').hidden = false; }, 400);
}

function stopCamera() {
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

function showResult({ ok, title, desc, wa, retry, close }) {
  const t = $('resTitle');
  t.textContent = title;
  t.className = ok ? 'ok' : 'err';
  $('resDesc').textContent = desc;
  const wab = $('waBtn');
  wab.hidden = !(wa && CFG.supportWhatsapp);
  if (!wab.hidden) wab.href = `https://wa.me/${String(CFG.supportWhatsapp).replace(/\D/g, '')}`;
  $('again').hidden = !retry;
  $('closeBtn').hidden = !close;
  $('closeHint').hidden = true;
  clearTimeout(autoCloseTimer);
  if (close && CFG.autoCloseMs > 0) autoCloseTimer = setTimeout(tryClose, CFG.autoCloseMs);
  show('result');
}

/* ---------- câmera e modelos ---------- */
/** Escolhe o backend do TensorFlow.js: WebGL (rápido) -> WASM -> CPU. */
async function initBackend() {
  const tf = faceapi.tf;
  if (tf.wasm && tf.wasm.setWasmPaths) tf.wasm.setWasmPaths('/lib/'); // binários .wasm ficam em /lib
  for (const name of ['webgl', 'wasm', 'cpu']) {
    try {
      if ((await tf.setBackend(name)) !== false) {
        await tf.ready();
        console.info('TensorFlow.js backend:', tf.getBackend());
        return tf.getBackend();
      }
    } catch (err) {
      console.warn('backend indisponível:', name, err && err.message);
    }
  }
  throw new Error('no_tf_backend');
}

async function loadModels() {
  await initBackend();
  detOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODELS),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODELS),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODELS),
  ]);
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('camera_unsupported');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  while (video.readyState < 2) await sleep(50);
}

/* ---------- detecção guiada ---------- */
const qCanvas = document.createElement('canvas');
qCanvas.width = qCanvas.height = 64;
const qCtx = qCanvas.getContext('2d', { willReadFrequently: true });

/** Mede luz, contraste e nitidez só na região do rosto (miniatura 64x64). */
function faceQuality(det) {
  const W = video.videoWidth;
  const H = video.videoHeight;
  const b = det.relativeBox;
  const sx = Math.max(0, b.x * W);
  const sy = Math.max(0, b.y * H);
  const sw = Math.min(b.width * W, W - sx);
  const sh = Math.min(b.height * H, H - sy);
  qCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 64, 64);
  const d = qCtx.getImageData(0, 0, 64, 64).data;
  const g = new Float32Array(64 * 64);
  let sum = 0;
  for (let i = 0; i < g.length; i++) {
    g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    sum += g[i];
  }
  const luma = sum / g.length;
  let v = 0;
  for (let i = 0; i < g.length; i++) v += (g[i] - luma) ** 2;
  const contrast = Math.sqrt(v / g.length);
  // nitidez: variância do laplaciano (borrado/movido = valor baixo)
  let n = 0;
  let m = 0;
  let m2 = 0;
  for (let y = 1; y < 63; y++) {
    for (let x = 1; x < 63; x++) {
      const i = y * 64 + x;
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - 64] - g[i + 64];
      n++;
      m += l;
      m2 += l * l;
    }
  }
  const sharp = m2 / n - (m / n) ** 2;
  return { score: det.score, luma, contrast, sharp };
}

function judgeQuality(det) {
  const q = faceQuality(det);
  if (DEBUG) {
    console.log('qualidade', { score: +q.score.toFixed(2), luma: Math.round(q.luma), contrast: Math.round(q.contrast), sharp: Math.round(q.sharp) });
  }
  if (q.luma < QC.minLuma) return { ok: false, msg: 'Ambiente escuro. Vá para um local mais iluminado', q };
  if (q.luma > QC.maxLuma) return { ok: false, msg: 'Luz forte demais. Evite luz direta no rosto', q };
  if (q.contrast < QC.minContrast) return { ok: false, msg: 'Pouca luz no rosto. Fique de frente para a luz', q };
  if (q.sharp < QC.minSharp) return { ok: false, msg: 'Imagem borrada. Segure o aparelho firme', q };
  if (q.score < QC.minScore) return { ok: false, msg: 'Rosto pouco nítido. Tire óculos escuros ou boné', q };
  return { ok: true, q };
}

/** Brilho médio do quadro inteiro (usado quando nenhum rosto é detectado). */
function frameLuma() {
  const c = frameLuma.c || (frameLuma.c = document.createElement('canvas'));
  c.width = 32;
  c.height = 24;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(video, 0, 0, 32, 24);
  const d = x.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4);
}

function judge(det) {
  if (!det) {
    const l = frameLuma();
    if (DEBUG) console.log('sem rosto; brilho do quadro', Math.round(l));
    if (l < QC.minFrameLuma) return { ok: false, msg: 'Ambiente escuro. Vá para um local mais iluminado' };
    if (l > QC.maxLuma) return { ok: false, msg: 'Luz forte demais. Evite luz direta na câmera' };
    return { ok: false, msg: 'Posicione o rosto em frente à câmera' };
  }
  const b = det.relativeBox;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  if (Math.abs(cx - 0.5) > 0.12 || Math.abs(cy - 0.5) > 0.14) return { ok: false, msg: 'Centralize o rosto' };
  if (b.width > 0.75) return { ok: false, msg: 'Afaste-se um pouco' };
  if (b.width < 0.28) return { ok: false, msg: 'Aproxime o rosto' };
  return judgeQuality(det);
}

/** Espera o rosto ficar bom e parado por `holdMs`. */
async function waitForStableFace(holdMs, title, desc) {
  let since = 0;
  setStatus(title, desc);
  for (;;) {
    const det = await faceapi.detectSingleFace(video, detOpts);
    const v = judge(det);
    if (v.ok) {
      if (!since) since = performance.now();
      setGuide('ok');
      const pct = ((performance.now() - since) / holdMs) * 100;
      setProgress(pct);
      setStatus(title, 'Segure firme...', '#00ffcc');
      if (pct >= 100) {
        setProgress(0);
        return;
      }
    } else {
      since = 0;
      setProgress(0);
      setGuide(det ? 'bad' : '');
      setStatus('Ajuste a posição', v.msg, det ? '#ff5555' : '#fff');
    }
    await sleep(90);
  }
}

async function captureDescriptor() {
  const r = await faceapi
    .detectSingleFace(video, detOpts)
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  if (!r) throw new Error('no_face');
  // confere de novo no quadro exato usado para o descritor
  const v = judge(r.detection);
  if (!v.ok) {
    const e = new Error('low_quality');
    e.userMsg = v.msg;
    throw e;
  }
  return Array.from(r.descriptor, (n) => Number(n.toFixed(5)));
}

/* ---------- API ---------- */
async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: CONTACT_ID, sig: SIG, ...body }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* corpo vazio */ }
  return { status: res.status, data };
}

/* ---------- fluxos ---------- */
async function identifyFlow() {
  show(null);
  setGuide('');
  await waitForStableFace(
    CFG.holdMsIdentify,
    justEnrolled ? 'Agora vamos confirmar' : 'Olhe para a câmera',
    'Posicione seu rosto no centro'
  );
  showBusy('Verificando...', 'Comparando com a base.');

  let descriptor;
  try {
    descriptor = await captureDescriptor();
  } catch (e) {
    return showResult({ ok: false, title: 'Não consegui ler o rosto', desc: e.userMsg || 'Tente novamente com boa iluminação.', retry: true });
  }

  const { status, data } = await post('/identify', { descriptor });

  if (status === 200 && data.match) {
    stopCamera(); // fluxo concluído: desliga a câmera
    return showResult({
      ok: true,
      title: `Olá, ${data.name}!`,
      desc: data.messageSent
        ? 'Identidade confirmada! Enviamos a continuação para o seu WhatsApp. Pode fechar esta janela e voltar para a conversa.'
        : 'Identidade confirmada! Feche esta janela e volte ao WhatsApp para continuar.',
      wa: true,
      close: true,
    });
  }
  if (status === 200) {
    if (justEnrolled) {
      return showResult({
        ok: false,
        title: 'Não foi possível confirmar',
        desc: 'Seu cadastro foi salvo, mas a leitura não bateu. Tente de novo em um local mais iluminado.',
        retry: true,
      });
    }
    $('nfTitle').textContent = 'Não encontramos seu cadastro';
    $('nfDesc').textContent = 'Você pode fazer o cadastro agora. Leva menos de um minuto.';
    $('goEnroll').hidden = false;
    return show('notFound');
  }
  if (status === 403) {
    return showResult({ ok: false, title: 'Link inválido', desc: 'Volte ao WhatsApp e solicite um novo link.', wa: true });
  }
  return showResult({ ok: false, title: 'Erro no servidor', desc: 'Tente novamente em instantes.', retry: true, wa: true });
}

const ENROLL_STEPS = [
  ['Captura 1 de 3', 'Olhe de frente'],
  ['Captura 2 de 3', 'Vire levemente para a esquerda'],
  ['Captura 3 de 3', 'Vire levemente para a direita'],
];

async function enrollFlow(name) {
  show(null);
  const descriptors = [];
  for (const [title, desc] of ENROLL_STEPS) {
    await waitForStableFace(CFG.holdMsEnroll, title, desc);
    try {
      descriptors.push(await captureDescriptor());
    } catch (e) {
      return showResult({ ok: false, title: 'Não consegui ler o rosto', desc: e.userMsg || 'Tente novamente com boa iluminação.', retry: true });
    }
    setGuide('');
    await sleep(500);
  }

  showBusy('Salvando cadastro...', 'Quase lá.');
  const { status, data } = await post('/enroll', { name, consent: true, descriptors });

  if (status === 201) {
    justEnrolled = true;
    return identifyFlow();
  }
  if (status === 409) {
    return showResult({
      ok: false,
      title: 'Rosto já cadastrado',
      desc: `Este rosto já consta na base${data.name ? ` como ${data.name}` : ''}. Vamos tentar identificar de novo.`,
      retry: true,
    });
  }
  if (status === 403) {
    return showResult({ ok: false, title: 'Link inválido', desc: 'Volte ao WhatsApp e solicite um novo link.', wa: true });
  }
  return showResult({ ok: false, title: 'Não foi possível cadastrar', desc: 'Tente novamente em instantes.', retry: true, wa: true });
}

/* ---------- eventos ---------- */
$('goEnroll').addEventListener('click', () => show('enrollForm'));
$('retry').addEventListener('click', () => identifyFlow());
$('again').addEventListener('click', () => identifyFlow());
$('closeBtn').addEventListener('click', tryClose);

const nameInput = $('name');
const consent = $('consent');
const startBtn = $('startEnroll');
function validateForm() {
  startBtn.disabled = !(nameInput.value.trim().length >= 2 && consent.checked);
}
nameInput.addEventListener('input', validateForm);
consent.addEventListener('change', validateForm);
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (startBtn.disabled) return;
  enrollFlow(nameInput.value.trim());
});

/* ---------- início ---------- */
(async function main() {
  if (!CONTACT_ID) {
    setStatus('Link inválido', 'Abra o link enviado no WhatsApp.', '#ff5555');
    return;
  }
  try {
    setStatus('Carregando...', 'Preparando a verificação');
    await loadModels();
    setStatus('Abrindo a câmera...', 'Permita o acesso quando solicitado');
    await startCamera();
    await identifyFlow();
  } catch (err) {
    console.error(err);
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
    showResult({
      ok: false,
      title: denied ? 'Câmera bloqueada' : 'Não foi possível iniciar',
      desc: denied
        ? 'Permita o uso da câmera nas configurações do navegador e abra o link novamente.'
        : 'Verifique sua conexão e se o navegador suporta câmera (use HTTPS).',
      wa: true,
    });
  }
})();
