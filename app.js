const APP_VERSION = '1.2.0';
const DB_NAME = 'jugscan-db';
const DB_VERSION = 1;
const STORE_STORES = 'stores';
const STORE_RECORDS = 'records';

const PRIMARY_MACHINES = [
  'ファンキー2',
  'ネオアイム',
  'ハッピーV3',
  'マイジャグV',
  'ゴージャグ3'
];

const OTHER_MACHINES = [
  'マイジャグVI',
  'ジャグラーガールズSS',
  'ミスタージャグラー',
  'ウルトラミラクルジャグラー',
  'アイムジャグラーEX'
];

const MACHINE_ART = {
  'ファンキー2': 'assets/machine-funky.webp',
  'ネオアイム': 'assets/machine-neo.webp',
  'ハッピーV3': 'assets/machine-happy.webp',
  'マイジャグV': 'assets/machine-my5.webp',
  'ゴージャグ3': 'assets/machine-gogo3.webp'
};

const state = {
  db: null,
  currentStore: null,
  currentMachine: PRIMARY_MACHINES[0],
  sort: 'created',
  editingId: null,
  editingOriginalId: null,
  modalResolver: null,
  showAllStores: false
};

const $ = (id) => document.getElementById(id);
const els = {};

function localDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function displayDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const days = ['日','月','火','水','木','金','土'];
  const dt = new Date(y, m - 1, d);
  return `${y}/${m}/${d} (${days[dt.getDay()]})`;
}

function normalizeDigits(value) {
  return String(value ?? '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[^0-9]/g, '');
}

function toInt(value) {
  const n = Number.parseInt(normalizeDigits(value), 10);
  return Number.isFinite(n) ? n : 0;
}

function probabilityText(games, count) {
  if (!games || !count) return '—';
  return `1/${Math.round(games / count)}`;
}

function probabilityDenominator(games, count) {
  if (!games || !count) return Number.POSITIVE_INFINITY;
  return games / count;
}

function makeRecordId(date, storeId, machineNo) {
  return `${date}::${storeId}::${machineNo}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_STORES)) {
        const stores = db.createObjectStore(STORE_STORES, { keyPath: 'id' });
        stores.createIndex('name', 'name', { unique: false });
        stores.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        const records = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
        records.createIndex('date', 'date', { unique: false });
        records.createIndex('storeId', 'storeId', { unique: false });
        records.createIndex('dateStore', ['date', 'storeId'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txStore(storeName, mode = 'readonly') {
  return state.db.transaction(storeName, mode).objectStore(storeName);
}

function dbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const req = txStore(storeName, 'readwrite').put(value);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = txStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = txStore(storeName, 'readwrite').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = txStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getRecordsFor(date, storeId) {
  return new Promise((resolve, reject) => {
    const index = txStore(STORE_RECORDS).index('dateStore');
    const req = index.getAll(IDBKeyRange.only([date, storeId]));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function setupElements() {
  [
    'dateLabel','changeStoreBtn','storeScreen','scanScreen','historyScreen','newStoreName','startNewStoreBtn',
    'showAllStoresBtn','recentStores','emptyStores','currentStoreName','recordCount','primaryMachines','otherMachineSelect',
    'machineNo','games','bb','rb','note','regProbability','combinedProbability','registerBtn','cancelEditBtn','clearFormBtn',
    'listMachineTitle','recordsList','emptyRecords','historyDate','historyStoreSelect','historyList','emptyHistory','backToScanBtn',
    'navStores','navScan','navHistory','modalBackdrop','modalTitle','modalMessage','modalCancel','modalConfirm','toast'
  ].forEach(id => els[id] = $(id));
}

function setActiveNav(name) {
  const map = { stores: els.navStores, scan: els.navScan, history: els.navHistory };
  Object.values(map).forEach(btn => btn.classList.remove('active'));
  if (map[name]) map[name].classList.add('active');
}

function showScreen(name) {
  els.storeScreen.classList.toggle('active', name === 'stores');
  els.scanScreen.classList.toggle('active', name === 'scan');
  els.historyScreen.classList.toggle('active', name === 'history');
  els.changeStoreBtn.classList.toggle('hidden', !state.currentStore || name === 'stores');
  setActiveNav(name);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 1800);
}

function confirmModal({ title = '確認', message, confirmText = 'OK', danger = false }) {
  els.modalTitle.textContent = title;
  els.modalMessage.textContent = message;
  els.modalConfirm.textContent = confirmText;
  els.modalConfirm.classList.toggle('danger', danger);
  els.modalBackdrop.classList.remove('hidden');
  return new Promise(resolve => { state.modalResolver = resolve; });
}

function closeModal(result) {
  els.modalBackdrop.classList.add('hidden');
  if (state.modalResolver) {
    state.modalResolver(result);
    state.modalResolver = null;
  }
}

function renderMachineSelectors() {
  els.primaryMachines.innerHTML = '';
  PRIMARY_MACHINES.forEach(name => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'machine-btn';
    btn.innerHTML = `<img src="${MACHINE_ART[name]}" alt=""><span>${escapeHtml(name)}</span>`;
    btn.dataset.machine = name;
    btn.addEventListener('click', () => selectMachine(name));
    els.primaryMachines.appendChild(btn);
  });

  els.otherMachineSelect.innerHTML = '<option value="">機種を選択</option>' +
    OTHER_MACHINES.map(m => `<option value="${m}">${m}</option>`).join('');
  els.otherMachineSelect.addEventListener('change', () => {
    if (els.otherMachineSelect.value) selectMachine(els.otherMachineSelect.value);
  });
  updateMachineButtons();
}

function selectMachine(name) {
  state.currentMachine = name;
  state.editingId = null;
  state.editingOriginalId = null;
  updateMachineButtons();
  clearForm(false);
  renderRecords();
}

function updateMachineButtons() {
  [...els.primaryMachines.querySelectorAll('.machine-btn')].forEach(btn => {
    btn.classList.toggle('active', btn.dataset.machine === state.currentMachine);
  });
  if (OTHER_MACHINES.includes(state.currentMachine)) {
    els.otherMachineSelect.value = state.currentMachine;
  } else {
    els.otherMachineSelect.value = '';
  }
  els.listMachineTitle.textContent = state.currentMachine;
}

function sanitizeNumericInput(input) {
  const cleaned = normalizeDigits(input.value);
  if (input.value !== cleaned) input.value = cleaned;
}

function updateProbabilities() {
  ['machineNo','games','bb','rb'].forEach(id => sanitizeNumericInput(els[id]));
  const games = toInt(els.games.value);
  const bb = toInt(els.bb.value);
  const rb = toInt(els.rb.value);
  els.regProbability.textContent = probabilityText(games, rb);
  els.combinedProbability.textContent = probabilityText(games, bb + rb);
}

function clearForm(focus = true) {
  els.machineNo.value = '';
  els.games.value = '';
  els.bb.value = '';
  els.rb.value = '';
  els.note.value = '';
  state.editingId = null;
  state.editingOriginalId = null;
  els.registerBtn.classList.remove('save-mode'); els.registerBtn.setAttribute('aria-label','この台を登録'); els.registerBtn.innerHTML = '<span>＋ この台を登録</span>';
  els.cancelEditBtn.classList.add('hidden');
  updateProbabilities();
  if (focus) setTimeout(() => els.machineNo.focus(), 30);
}

async function addOrUseStore(name) {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) {
    showToast('店名を入力してください');
    els.newStoreName.focus();
    return;
  }
  const stores = await dbGetAll(STORE_STORES);
  let store = stores.find(s => s.name === clean);
  const now = Date.now();
  if (store) {
    store.lastUsedAt = now;
  } else {
    store = {
      id: `store_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name: clean,
      createdAt: now,
      lastUsedAt: now
    };
  }
  await dbPut(STORE_STORES, store);
  selectStore(store);
}

async function selectStore(store) {
  store.lastUsedAt = Date.now();
  await dbPut(STORE_STORES, store);
  state.currentStore = store;
  localStorage.setItem('jugscan-current-store-id', store.id);
  els.currentStoreName.textContent = store.name;
  els.newStoreName.value = '';
  clearForm(false);
  showScreen('scan');
  await renderRecords();
  renderStores();
  setTimeout(() => els.machineNo.focus(), 30);
}

async function renderStores() {
  const stores = (await dbGetAll(STORE_STORES)).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  els.emptyStores.classList.toggle('hidden', stores.length > 0);
  els.recentStores.innerHTML = '';
  const visible = state.showAllStores ? stores : stores.slice(0, 5);
  visible.forEach(store => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'store-item';
    btn.innerHTML = `<span>${escapeHtml(store.name)}<small>タップして開始</small></span><span class="chev">›</span>`;
    btn.addEventListener('click', () => selectStore(store));
    els.recentStores.appendChild(btn);
  });
  els.showAllStoresBtn.textContent = state.showAllStores ? '最近5件' : 'すべて表示';
  els.showAllStoresBtn.classList.toggle('hidden', stores.length <= 5);
  await populateHistoryStores(stores);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function validateForm() {
  const machineNo = normalizeDigits(els.machineNo.value);
  const games = toInt(els.games.value);
  const bb = toInt(els.bb.value);
  const rb = toInt(els.rb.value);
  if (!machineNo) return '台番号を入力してください';
  if (!games) return '累計Gを入力してください';
  if (bb + rb > games) return 'BB・RB回数が累計Gを超えています';
  return null;
}

async function saveCurrentRecord() {
  if (!state.currentStore) return;
  const error = validateForm();
  if (error) { showToast(error); return; }

  const date = localDateISO();
  const machineNo = normalizeDigits(els.machineNo.value);
  const newId = makeRecordId(date, state.currentStore.id, machineNo);
  const existing = await dbGet(STORE_RECORDS, newId);
  const now = Date.now();

  if (existing && newId !== state.editingOriginalId) {
    const overwrite = await confirmModal({
      title: '重複する台番号',
      message: `${machineNo}番台はすでに登録されています。\n現在のデータを上書きしますか？`,
      confirmText: '上書き'
    });
    if (!overwrite) return;
  }

  const prior = existing || (state.editingOriginalId ? await dbGet(STORE_RECORDS, state.editingOriginalId) : null);
  const record = {
    id: newId,
    date,
    storeId: state.currentStore.id,
    storeName: state.currentStore.name,
    machine: state.currentMachine,
    machineNo,
    games: toInt(els.games.value),
    bb: toInt(els.bb.value),
    rb: toInt(els.rb.value),
    note: els.note.value.trim(),
    createdAt: prior?.createdAt || now,
    updatedAt: now
  };

  if (state.editingOriginalId && state.editingOriginalId !== newId) {
    await dbDelete(STORE_RECORDS, state.editingOriginalId);
  }
  const resultMessage = existing && newId !== state.editingOriginalId
    ? '上書きしました'
    : state.editingOriginalId
      ? '更新しました'
      : '登録しました';
  await dbPut(STORE_RECORDS, record);
  clearForm(true);
  showToast(resultMessage);
  await renderRecords();
}

async function renderRecords() {
  if (!state.currentStore) return;
  const all = await getRecordsFor(localDateISO(), state.currentStore.id);
  els.recordCount.textContent = `${all.length}台`;
  const filtered = all.filter(r => r.machine === state.currentMachine);
  filtered.sort(recordSorter(state.sort));
  els.recordsList.innerHTML = '';
  els.emptyRecords.classList.toggle('hidden', filtered.length > 0);
  filtered.forEach(record => els.recordsList.appendChild(makeRecordCard(record, true)));
}

function recordSorter(sort) {
  return (a, b) => {
    if (sort === 'reg') {
      return probabilityDenominator(a.games, a.rb) - probabilityDenominator(b.games, b.rb) || Number(a.machineNo) - Number(b.machineNo);
    }
    if (sort === 'combined') {
      return probabilityDenominator(a.games, a.bb + a.rb) - probabilityDenominator(b.games, b.bb + b.rb) || Number(a.machineNo) - Number(b.machineNo);
    }
    if (sort === 'number') return Number(a.machineNo) - Number(b.machineNo);
    return (a.createdAt || 0) - (b.createdAt || 0);
  };
}

function makeRecordCard(record, editable) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'record-card';
  card.innerHTML = `
    <div class="record-top">
      <div class="record-metric machine"><small>台番</small><strong>${escapeHtml(record.machineNo)}</strong></div>
      <div class="record-metric games"><small>累計G</small><strong>${record.games}</strong></div>
      <div class="record-metric bb"><small>BB</small><strong>${record.bb}</strong></div>
      <div class="record-metric rb"><small>RB</small><strong>${record.rb}</strong></div>
    </div>
    <div class="record-bottom">
      <div class="reg-value"><small>REG</small><strong>${probabilityText(record.games, record.rb)}</strong></div>
      <div class="combined-value"><small>合算</small><strong>${probabilityText(record.games, record.bb + record.rb)}</strong></div>
      ${record.note ? `<div class="record-note">${escapeHtml(record.note)}</div>` : ''}
    </div>
    <div class="record-machine-name">${escapeHtml(record.machine)}${editable ? '<span class="edit-hint">タップで編集</span>' : ''}</div>`;
  if (editable) card.addEventListener('click', () => editRecord(record));
  return card;
}

function editRecord(record) {
  state.currentMachine = record.machine;
  updateMachineButtons();
  els.machineNo.value = record.machineNo;
  els.games.value = record.games;
  els.bb.value = record.bb;
  els.rb.value = record.rb;
  els.note.value = record.note || '';
  state.editingId = record.id;
  state.editingOriginalId = record.id;
  els.registerBtn.textContent = '✓ この台を更新';
  els.cancelEditBtn.classList.remove('hidden');
  updateProbabilities();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function populateHistoryStores(stores = null) {
  const list = stores || (await dbGetAll(STORE_STORES)).sort((a,b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  const current = els.historyStoreSelect.value;
  els.historyStoreSelect.innerHTML = list.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (current && list.some(s => s.id === current)) els.historyStoreSelect.value = current;
  else if (state.currentStore) els.historyStoreSelect.value = state.currentStore.id;
}

async function renderHistory() {
  const date = els.historyDate.value || localDateISO();
  const storeId = els.historyStoreSelect.value;
  if (!storeId) {
    els.historyList.innerHTML = '';
    els.emptyHistory.classList.remove('hidden');
    return;
  }
  const rows = await getRecordsFor(date, storeId);
  rows.sort((a,b) => a.machine.localeCompare(b.machine, 'ja') || Number(a.machineNo) - Number(b.machineNo));
  els.historyList.innerHTML = '';
  els.emptyHistory.classList.toggle('hidden', rows.length > 0);
  rows.forEach(r => els.historyList.appendChild(makeRecordCard(r, false)));
}

function bindEvents() {
  els.startNewStoreBtn.addEventListener('click', () => addOrUseStore(els.newStoreName.value));
  els.newStoreName.addEventListener('keydown', e => { if (e.key === 'Enter') addOrUseStore(els.newStoreName.value); });
  els.showAllStoresBtn.addEventListener('click', () => { state.showAllStores = !state.showAllStores; renderStores(); });
  els.changeStoreBtn.addEventListener('click', () => showScreen('stores'));
  ['machineNo','games','bb','rb'].forEach(id => els[id].addEventListener('input', updateProbabilities));
  els.registerBtn.addEventListener('click', saveCurrentRecord);
  els.cancelEditBtn.addEventListener('click', () => clearForm(true));
  els.clearFormBtn.addEventListener('click', () => clearForm(true));

  document.querySelectorAll('.sort-btn').forEach(btn => btn.addEventListener('click', () => {
    state.sort = btn.dataset.sort;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderRecords();
  }));

  els.navStores.addEventListener('click', () => showScreen('stores'));
  els.navScan.addEventListener('click', async () => {
    if (!state.currentStore) { showScreen('stores'); return; }
    showScreen('scan');
    await renderRecords();
  });
  els.navHistory.addEventListener('click', async () => {
    await populateHistoryStores();
    showScreen('history');
    await renderHistory();
  });
  els.backToScanBtn.addEventListener('click', async () => {
    if (!state.currentStore) showScreen('stores');
    else { showScreen('scan'); await renderRecords(); }
  });
  els.historyDate.addEventListener('change', renderHistory);
  els.historyStoreSelect.addEventListener('change', renderHistory);

  els.modalCancel.addEventListener('click', () => closeModal(false));
  els.modalConfirm.addEventListener('click', () => closeModal(true));
  els.modalBackdrop.addEventListener('click', e => { if (e.target === els.modalBackdrop) closeModal(false); });
}

async function restoreStore() {
  const id = localStorage.getItem('jugscan-current-store-id');
  if (!id) return false;
  const store = await dbGet(STORE_STORES, id);
  if (!store) return false;
  state.currentStore = store;
  els.currentStoreName.textContent = store.name;
  return true;
}

async function init() {
  setupElements();
  els.dateLabel.textContent = `${displayDate(localDateISO())}  v${APP_VERSION}`;
  els.historyDate.value = localDateISO();
  state.db = await openDb();
  renderMachineSelectors();
  bindEvents();
  await renderStores();
  await restoreStore();
  // 起動時は毎回、誤店舗入力を防ぐため店舗選択画面から開始する。
  showScreen('stores');

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init().catch(err => {
  console.error(err);
  alert('JUG SCANの起動に失敗しました。ページを再読み込みしてください。');
});
