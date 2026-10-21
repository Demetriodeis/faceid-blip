'use strict';

/* Fluxo: identificar -> (não achou) cadastrar -> identificar de novo.
   Todo o reconhecimento facial roda no navegador (face-api.js / TensorFlow.js);
   só o vetor de 128 números vai para a API. Nenhuma foto é enviada. */

const CFG = Object.assign(
  { supportWhatsapp: '', holdMsIdentify: 2000, holdMsEnroll: 1200 },
  window.FACEID_CONFIG || {}
);
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
function showResult({ ok, title, desc, wa, retry }) {
  const t = $('resTitle');
  t.textContent = title;
  t.className = ok ? 'ok' : 'err';
  $('resDesc').textContent = desc;
  const wab = $('waBtn');
  wab.hidden = !(wa && CFG.supportWhatsapp);
  if (!wab.hidden) wab.href = `https://wa.me/${String(CFG.supportWhatsapp).replace(/\D/g, '')}`;
  $('again').hidden = !retry;
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
function judge(det) {
  if (!det) return { ok: false, msg: 'Posicione o rosto em frente à câmera' };
  const b = det.relativeBox;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  if (Math.abs(cx - 0.5) > 0.12 || Math.abs(cy - 0.5) > 0.14) return { ok: false, msg: 'Centralize o rosto' };
  if (b.width > 0.75) return { ok: false, msg: 'Afaste-se um pouco' };
  if (b.width < 0.28) return { ok: false, msg: 'Aproxime o rosto' };
  return { ok: true };
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
  } catch {
    return showResult({ ok: false, title: 'Não consegui ler o rosto', desc: 'Tente novamente com boa iluminação.', retry: true });
  }

  const { status, data } = await post('/identify', { descriptor });

  if (status === 200 && data.match) {
    return showResult({
      ok: true,
      title: `Olá, ${data.name}!`,
      desc: data.messageSent
        ? 'Identidade confirmada. Enviamos a continuação para o seu WhatsApp.'
        : 'Identidade confirmada. Volte ao WhatsApp para continuar.',
      wa: true,
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
    } catch {
      return showResult({ ok: false, title: 'Não consegui ler o rosto', desc: 'Tente novamente com boa iluminação.', retry: true });
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
