// ── DOM ──
const container = document.getElementById('drumContainer');
const itemsList = document.getElementById('itemsList');
const newItemInput = document.getElementById('newItemInput');
const addBtn = document.getElementById('addBtn');
const resetBtn = document.getElementById('resetBtn');
const resultDiv = document.getElementById('result');
const modal = document.getElementById('modal');
const modalName = document.getElementById('modalName');
const modalOkBtn = document.getElementById('modalOkBtn');

// ── Palette (light, pastel tones) ──
const PALETTE = [
  '#ff8a80', '#82b1ff', '#b9f6ca', '#ffe57f',
  '#ffab40', '#f48fb1', '#a7ffeb', '#b388ff',
  '#ff80ab', '#80deea',  '#ce93d8',
  '#c5e1a5', '#90caf9', '#80cbc4', '#fff59d', '#ef9a9a',
];

// ── Persistence (localStorage) ──
const STORAGE_KEY = 'barraban_used';
const ITEMS_KEY = 'barraban_items';

const DEFAULT_ITEMS = [
  'Алексей Галкин',
  'Артем Филиппов',
  'Кирилл Лобанов',
  'Николай Михалаки',
  'Сергей Абкарян',
  'Сергей Бубенцов',
];

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...usedSet]));
  } catch { /* file:// or private mode — ignore */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}

function saveItems() {
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  } catch { /* ignore */ }
}

function loadStoredItems() {
  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    if (!raw) return [...DEFAULT_ITEMS];
    return JSON.parse(raw);
  } catch { return [...DEFAULT_ITEMS]; }
}

// ── Audio ──
let audioCtx = null;
let lastClickTime = 0;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playClick() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  if (now - lastClickTime < 0.04) return; // не чаще 40 мс
  lastClickTime = now;

  const bufSize = Math.floor(audioCtx.sampleRate * 0.014);
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buf;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2200;
  filter.Q.value = 0.8;

  const gain = audioCtx.createGain();
  gain.gain.value = 0.28;

  src.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(now);
}

const selectedAudio = new Audio('sound/selected.wav');

function playTada() {
  selectedAudio.currentTime = 0;
  selectedAudio.play().catch(() => {});
}

// ── State ──
let items = loadStoredItems();
let colors = items.map((_, i) => PALETTE[i % PALETTE.length]);
let usedSet = loadState();   // winners already picked this week
let activeItems = [];         // items not yet used (for drum sectors)
let activeColors = [];
let drumMesh = null;
let pointerMesh = null;
let angularVelocity = 0;
let isPressed = false;
let decelerating = false;
let spinning = false;
let pendingWinner = null;     // winner waiting for modal OK
let lastSectorIndex = -1;

// ── Physics ──
const ACCELERATION = 20;
const MAX_VELOCITY = 20;
const FRICTION =8.0;

// ── Three.js setup ──
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f2f5);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 3.5, 6);
camera.lookAt(0, 0, 0.4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
container.insertBefore(renderer.domElement, container.firstChild);

// ── Lighting ──
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(3, 5, 4);
scene.add(dirLight);

const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
backLight.position.set(-2, 3, -3);
scene.add(backLight);

// ── Build drum ──

// Create a single texture for the entire top face with all sectors and text
function createTopFaceTexture() {
  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const n = activeItems.length;
  if (n === 0) return null;
  const sliceAngle = (2 * Math.PI) / n;

  // Draw sectors
  for (let i = 0; i < n; i++) {
    const startAngle = i * sliceAngle;
    const endAngle = startAngle + sliceAngle;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = activeColors[i];
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Draw text on each sector
  for (let i = 0; i < n; i++) {
    const midAngle = i * sliceAngle + sliceAngle / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(midAngle);

    const flip = midAngle > Math.PI / 2 && midAngle < 3 * Math.PI / 2;
    if (flip) {
      const textR = r * 0.6;
      ctx.translate(textR, 0);
      ctx.rotate(Math.PI);
      ctx.translate(-textR, 0);
    }

    const fontSize = Math.min(128, Math.max(20, 900 / Math.max(activeItems[i].length, 1)), sliceAngle * r * 0.4);
    ctx.font = `bold ${Math.round(fontSize)}px sans-serif`;
    ctx.fillStyle = '#333333';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textR = r * 0.6;
    ctx.strokeText(activeItems[i], textR, 0);
    ctx.fillText(activeItems[i], textR, 0);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBottomFaceTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const n = activeItems.length;
  if (n === 0) return null;
  const sliceAngle = (2 * Math.PI) / n;

  for (let i = 0; i < n; i++) {
    const startAngle = i * sliceAngle;
    const endAngle = startAngle + sliceAngle;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.closePath();
    const c = new THREE.Color(activeColors[i]).multiplyScalar(0.5);
    ctx.fillStyle = `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`;
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildDrum() {
  lastSectorIndex = -1;
  // Remove old drum
  if (drumMesh) {
    scene.remove(drumMesh);
    drumMesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
        } else {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      }
    });
  }
  if (pointerMesh) {
    scene.remove(pointerMesh);
  }

  // Recompute active items (exclude used)
  activeItems = [];
  activeColors = [];
  for (let i = 0; i < items.length; i++) {
    if (!usedSet.has(items[i])) {
      activeItems.push(items[i]);
      activeColors.push(colors[i]);
    }
  }

  updateStatusList();

  const n = activeItems.length;
  if (n === 0) return;

  const drumRadius = 2.5;
  const drumHeight = drumRadius * 2 / 10; // height/diameter = 1/10

  drumMesh = new THREE.Group();

  const sliceAngle = (2 * Math.PI) / n;
  const radialSegments = Math.max(64, n * 8);

  // ── Top face: single circle with full texture ──
  const topTexture = createTopFaceTexture();
  const topGeo = new THREE.CircleGeometry(drumRadius, 128);
  const topMat = new THREE.MeshStandardMaterial({
    map: topTexture,
    roughness: 0.4,
    metalness: 0.1,
  });
  const topMesh = new THREE.Mesh(topGeo, topMat);
  topMesh.position.y = drumHeight / 2;
  topMesh.rotation.x = -Math.PI / 2;
  drumMesh.add(topMesh);

  // ── Bottom face: single circle with darker texture ──
  const botTexture = createBottomFaceTexture();
  const botGeo = new THREE.CircleGeometry(drumRadius, 128);
  const botMat = new THREE.MeshStandardMaterial({
    map: botTexture,
    roughness: 0.5,
    metalness: 0.1,
  });
  const botMesh = new THREE.Mesh(botGeo, botMat);
  botMesh.position.y = -drumHeight / 2;
  botMesh.rotation.x = Math.PI / 2;
  drumMesh.add(botMesh);

  // ── Side (cylindrical edge) with colored segments ──
  for (let i = 0; i < n; i++) {
    const geo = new THREE.CylinderGeometry(
      drumRadius, drumRadius, drumHeight,
      Math.max(8, Math.ceil(radialSegments / n)),
      1, true,
      i * sliceAngle, sliceAngle
    );
    const darkerColor = new THREE.Color(activeColors[i]).multiplyScalar(0.6);
    const mat = new THREE.MeshStandardMaterial({
      color: darkerColor,
      roughness: 0.3,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    drumMesh.add(mesh);
  }

  // ── Center hub ──
  const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, drumHeight + 0.1, 32);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 });
  drumMesh.add(new THREE.Mesh(hubGeo, hubMat));

  // ── Rim rings (top and bottom edge) ──
  const rimGeo = new THREE.TorusGeometry(drumRadius, 0.03, 8, 64);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, metalness: 0.9, roughness: 0.1 });
  const rimTop = new THREE.Mesh(rimGeo, rimMat);
  rimTop.position.y = drumHeight / 2;
  rimTop.rotation.x = Math.PI / 2;
  drumMesh.add(rimTop);
  const rimBot = new THREE.Mesh(rimGeo.clone(), rimMat);
  rimBot.position.y = -drumHeight / 2;
  rimBot.rotation.x = Math.PI / 2;
  drumMesh.add(rimBot);

  // Tilt the drum slightly for better view
  drumMesh.rotation.x = 0.3;

  scene.add(drumMesh);

  // ── Pointer ──
  buildPointer(drumRadius, drumHeight);
}

function buildPointer(drumRadius, drumHeight) {
  // Arrow pointer: tip points inward toward drum center (-X), base outward (+X)
  const shape = new THREE.Shape();
  const s = 0.2;
  shape.moveTo(-s, 0);              // tip (toward drum)
  shape.lineTo(s * 1.5, -s * 0.8);  // back-bottom
  shape.lineTo(s * 1.5, s * 0.8);   // back-top
  shape.closePath();

  const extrudeSettings = { depth: 0.08, bevelEnabled: false };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  const mat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, metalness: 0.3, roughness: 0.4 });
  pointerMesh = new THREE.Mesh(geo, mat);

  // Position at drum edge (+X side), on top of the drum surface
  // The drum group is tilted by 0.3 rad around X, so we compute the world
  // position of the top-face edge at angle 0:
  const TILT = 0.3;
  const edgeX = drumRadius + 0.3;
  const edgeY = (drumHeight / 2) * Math.cos(TILT);
  const edgeZ = (drumHeight / 2) * Math.sin(TILT);

  pointerMesh.position.set(edgeX, edgeY, edgeZ);
  // Lay flat matching drum tilt: rotate so the shape lies on the tilted drum plane
  pointerMesh.rotation.set(-Math.PI / 2 + TILT, 0, 0);

  scene.add(pointerMesh);
}

// ── Raycasting for click detection ──
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function isOnDrum(event) {
  if (!drumMesh) return false;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(drumMesh.children, true);
  return intersects.length > 0;
}

// ── Winning item detection ──
function getWinningItem() {
  if (!drumMesh || activeItems.length === 0) return null;
  const n = activeItems.length;
  const sliceAngle = (2 * Math.PI) / n;
  let normalizedAngle = (drumMesh.rotation.y % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const index = Math.floor(normalizedAngle / sliceAngle) % n;
  return activeItems[index];
}

function showWinnerModal(name) {
  pendingWinner = name;
  modalName.textContent = name;
  modal.classList.remove('hidden');
  playTada();
}

function closeModal() {
  modal.classList.add('hidden');
  if (pendingWinner) {
    usedSet.add(pendingWinner);
    saveState();
    pendingWinner = null;
    angularVelocity = 0;
    buildDrum();
  }
}

// ── Status list ──
function updateStatusList() {
  itemsList.innerHTML = '';
  items.forEach((item, i) => {
    const li = document.createElement('li');
    if (usedSet.has(item)) li.classList.add('used');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.textContent = item;

    const checkBtn = document.createElement('button');
    checkBtn.className = 'item-check' + (usedSet.has(item) ? ' checked' : '');
    checkBtn.textContent = '✓';
    checkBtn.title = usedSet.has(item) ? 'Снять отметку' : 'Отметить как выпавшего';
    checkBtn.addEventListener('click', () => {
      if (usedSet.has(item)) {
        usedSet.delete(item);
      } else {
        usedSet.add(item);
      }
      saveState();
      buildDrum();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'item-delete';
    delBtn.textContent = '×';
    delBtn.title = 'Удалить';
    delBtn.addEventListener('click', () => {
      items.splice(i, 1);
      colors = items.map((_, idx) => PALETTE[idx % PALETTE.length]);
      usedSet.delete(item);
      saveItems();
      saveState();
      buildDrum();
    });

    li.appendChild(nameSpan);
    li.appendChild(checkBtn);
    li.appendChild(delBtn);
    itemsList.appendChild(li);
  });
}

// ── Add item ──
function addItem() {
  const name = newItemInput.value.trim();
  if (!name) return;
  items.push(name);
  colors = items.map((_, i) => PALETTE[i % PALETTE.length]);
  saveItems();
  newItemInput.value = '';
  buildDrum();
}

// ── Resize ──
function onResize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// ── Events ──
renderer.domElement.addEventListener('mousedown', (e) => {
  if (activeItems.length === 0) return;
  if (spinning && decelerating) return;
  if (!isOnDrum(e)) return;
  ensureAudio();
  isPressed = true;
  resultDiv.textContent = '';
  resultDiv.classList.remove('show');
});

renderer.domElement.addEventListener('mouseup', () => {
  if (isPressed) {
    isPressed = false;
    if (angularVelocity > 0) {
      decelerating = true;
    }
  }
});

renderer.domElement.addEventListener('mouseleave', () => {
  if (isPressed) {
    isPressed = false;
    if (angularVelocity > 0) {
      decelerating = true;
    }
  }
});

renderer.domElement.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (activeItems.length === 0) return;
  if (spinning && decelerating) return;
  ensureAudio();
  isPressed = true;
  resultDiv.textContent = '';
  resultDiv.classList.remove('show');
}, { passive: false });

renderer.domElement.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (isPressed) {
    isPressed = false;
    if (angularVelocity > 0) {
      decelerating = true;
    }
  }
}, { passive: false });

addBtn.addEventListener('click', addItem);
newItemInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(); });
resetBtn.addEventListener('click', () => {
  usedSet.clear();
  saveState();
  buildDrum();
});
modalOkBtn.addEventListener('click', closeModal);
window.addEventListener('resize', onResize);

// ── Animation loop ──
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);

  if (isPressed && !decelerating) {
    angularVelocity = Math.min(angularVelocity + ACCELERATION * dt, MAX_VELOCITY);
    spinning = true;
  }

  if (decelerating) {
    let speedRatio = angularVelocity / MAX_VELOCITY;

    if (speedRatio > 1) speedRatio = 1;
    if (speedRatio < 0) speedRatio = 0;

    currentFriction = FRICTION * (0.1 + 0.9 * speedRatio);

    angularVelocity -= currentFriction * dt;

    if (angularVelocity <= 0) {
      angularVelocity = 0;
      decelerating = false;
      spinning = false;
      const winner = getWinningItem();
      if (winner) showWinnerModal(winner);
    }
  }
  if (drumMesh) {
    drumMesh.rotation.y += angularVelocity * dt;

    if (spinning && activeItems.length > 0) {
      const n = activeItems.length;
      const sliceAngle = (2 * Math.PI) / n;
      const norm = ((drumMesh.rotation.y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const sectorIdx = Math.floor(norm / sliceAngle) % n;
      if (lastSectorIndex !== -1 && sectorIdx !== lastSectorIndex) {
        playClick();
      }
      lastSectorIndex = sectorIdx;
    }
  }

  renderer.render(scene, camera);
}

// ── Init ──
buildDrum();
onResize();
animate();
