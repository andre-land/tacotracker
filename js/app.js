'use strict';

/* ─── State ──────────────────────────────────────────────────── */
const state = {
  trucks:       [],          // persisted truck objects
  map:          null,        // Leaflet map instance
  markers:      new Map(),   // truckId → L.Marker
  isPinDrop:    false,       // picking a location on map
  pinCallback:  null,        // fn(latlng) called when user clicks map
  pendingPhotos:[],          // base64 strings staged in the form
  pendingRating:0,           // current star selection
};


/* ─── Persistence ────────────────────────────────────────────── */
function saveTrucks() {
  try { localStorage.setItem('taco-trucks', JSON.stringify(state.trucks)); }
  catch { showToast('⚠️ Storage full — some photos may not have saved.'); }
}

function loadTrucks() {
  try {
    const raw = localStorage.getItem('taco-trucks');
    state.trucks = raw ? JSON.parse(raw) : [];
  } catch {
    state.trucks = [];
  }
}


/* ─── Map ────────────────────────────────────────────────────── */
function initMap() {
  state.map = L.map('map', {
    center:      [34.0522, -118.2437],  // Default: Los Angeles
    zoom:        12,
    zoomControl: false,
  });

  L.control.zoom({ position: 'bottomright' }).addTo(state.map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(state.map);

  state.map.on('click', onMapClick);
}

function onMapClick(e) {
  if (!state.isPinDrop) return;
  const cb = state.pinCallback;
  exitPinDrop();
  cb && cb(e.latlng);
}


/* ─── Pin-drop mode ──────────────────────────────────────────── */
function enterPinDrop(callback) {
  state.isPinDrop   = true;
  state.pinCallback = callback;
  document.getElementById('pin-hint').classList.remove('hidden');
  document.getElementById('map').style.cursor = 'crosshair';
}

function exitPinDrop() {
  state.isPinDrop   = false;
  state.pinCallback = null;
  document.getElementById('pin-hint').classList.add('hidden');
  document.getElementById('map').style.cursor = '';
}


/* ─── Markers ────────────────────────────────────────────────── */
function makeIcon() {
  return L.divIcon({
    html:       '<div class="taco-marker">🌮</div>',
    className:  '',
    iconSize:   [44, 44],
    iconAnchor: [22, 22],
    popupAnchor:[0, -26],
  });
}

function addMarker(truck) {
  const marker = L.marker([truck.lat, truck.lng], { icon: makeIcon() })
    .addTo(state.map)
    .on('click', () => openDetailModal(truck.id));
  state.markers.set(truck.id, marker);
  return marker;
}

function removeMarker(id) {
  const m = state.markers.get(id);
  if (m) { state.map.removeLayer(m); state.markers.delete(id); }
}


/* ─── Sidebar list ───────────────────────────────────────────── */
function renderList() {
  const query    = document.getElementById('search').value.toLowerCase().trim();
  const filtered = state.trucks
    .filter(t =>
      t.name.toLowerCase().includes(query) ||
      (t.description && t.description.toLowerCase().includes(query))
    )
    .sort((a, b) => b.createdAt - a.createdAt);

  const countEl = document.getElementById('truck-count');
  countEl.textContent = `${filtered.length} truck${filtered.length !== 1 ? 's' : ''}`;

  const list = document.getElementById('truck-list');

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🌮</div>
        <p>${
          state.trucks.length === 0
            ? 'No taco trucks yet!\n\nClick <strong>+ Report Truck</strong> then\npick a spot on the map to get started.'
            : 'No trucks match your search.'
        }</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(t => {
    const thumb = t.photos?.length
      ? `<img src="${t.photos[0]}" alt="${esc(t.name)}" />`
      : '🌮';

    const ratingHtml = t.rating > 0
      ? '🌮'.repeat(t.rating)
      : '<span class="no-rating">Not rated</span>';

    const date = fmtDate(t.createdAt, { month:'short', day:'numeric', year:'numeric' });

    const descHtml = t.description
      ? `<p class="truck-desc">${esc(t.description.slice(0, 90))}${t.description.length > 90 ? '…' : ''}</p>`
      : '';

    return `
      <div class="truck-card" data-id="${t.id}" tabindex="0" role="button" aria-label="View ${esc(t.name)}">
        <div class="truck-thumb">${thumb}</div>
        <div class="truck-info">
          <h3 class="truck-name">${esc(t.name)}</h3>
          <div class="truck-rating">${ratingHtml}</div>
          ${descHtml}
          <p class="truck-date">${date}</p>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.truck-card').forEach(card => {
    const activate = () => {
      const truck = state.trucks.find(t => t.id === card.dataset.id);
      if (!truck) return;
      state.map.setView([truck.lat, truck.lng], 16, { animate: true });
      openDetailModal(truck.id);
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(); });
  });
}


/* ─── Add-truck form helpers ─────────────────────────────────── */
function resetForm() {
  document.getElementById('truck-form').reset();
  document.getElementById('f-lat').value  = '';
  document.getElementById('f-lng').value  = '';
  document.getElementById('f-rating').value = '0';
  document.getElementById('loc-text').textContent = 'No location set';
  document.getElementById('loc-text').classList.add('muted');
  document.getElementById('photo-previews').innerHTML = '';
  document.getElementById('name-error').classList.add('hidden');
  document.getElementById('loc-error').classList.add('hidden');
  state.pendingPhotos = [];
  state.pendingRating = 0;
  updateStars(0);
}

function setFormLocation(latlng, fromMapCenter = false) {
  document.getElementById('f-lat').value = latlng.lat.toFixed(6);
  document.getElementById('f-lng').value = latlng.lng.toFixed(6);
  const locText = document.getElementById('loc-text');
  locText.textContent = fromMapCenter
    ? `Map center (${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)})`
    : `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
  locText.classList.remove('muted');
  document.getElementById('loc-error').classList.add('hidden');
}

function openAddModal(latlng, fromMapCenter = false) {
  resetForm();
  if (latlng) setFormLocation(latlng, fromMapCenter);
  document.getElementById('add-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('f-name').focus(), 50);
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('modal-behind');
  document.getElementById('add-modal').classList.add('hidden');
  resetForm();
}


/* ─── Star rating ────────────────────────────────────────────── */
function updateStars(rating) {
  document.querySelectorAll('#stars .star').forEach(s => {
    const v = parseInt(s.dataset.v);
    s.classList.toggle('active', v <= rating);
    s.setAttribute('aria-pressed', v <= rating ? 'true' : 'false');
  });
}

function bindStars() {
  const group = document.getElementById('stars');
  group.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', () => {
      const v = parseInt(star.dataset.v);
      state.pendingRating = (state.pendingRating === v) ? 0 : v; // toggle off same
      document.getElementById('f-rating').value = state.pendingRating;
      updateStars(state.pendingRating);
    });
    star.addEventListener('mouseenter', () => updateStars(parseInt(star.dataset.v)));
  });
  group.addEventListener('mouseleave', () => updateStars(state.pendingRating));
}


/* ─── Photo handling ─────────────────────────────────────────── */
async function compressImage(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 900;
        let { width: w, height: h } = img;
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        else if (h > MAX)      { w = Math.round(w * MAX / h); h = MAX; }

        const canvas    = document.createElement('canvas');
        canvas.width    = w;
        canvas.height   = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addPhotos(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const data = await compressImage(file);
    const idx  = state.pendingPhotos.push(data) - 1;
    renderPhotoPreview(data, idx);
  }
}

function renderPhotoPreview(dataUrl, idx) {
  const wrap = document.createElement('div');
  wrap.className    = 'photo-preview-item';
  wrap.dataset.idx  = idx;
  wrap.innerHTML    = `
    <img src="${dataUrl}" alt="Taco photo" />
    <button type="button" class="remove-photo" aria-label="Remove photo">✕</button>`;
  document.getElementById('photo-previews').appendChild(wrap);
}

function reRenderPreviews() {
  const box = document.getElementById('photo-previews');
  box.innerHTML = '';
  state.pendingPhotos.forEach((d, i) => renderPhotoPreview(d, i));
}


/* ─── Form submission ────────────────────────────────────────── */
function handleFormSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('f-name').value.trim();
  const desc = document.getElementById('f-desc').value.trim();
  const lat  = parseFloat(document.getElementById('f-lat').value);
  const lng  = parseFloat(document.getElementById('f-lng').value);
  const rating = parseInt(document.getElementById('f-rating').value) || 0;

  let valid = true;
  if (!name) {
    document.getElementById('name-error').classList.remove('hidden');
    document.getElementById('f-name').focus();
    valid = false;
  }
  if (!lat || !lng) {
    document.getElementById('loc-error').classList.remove('hidden');
    if (valid) document.getElementById('pick-map-btn').focus();
    valid = false;
  }
  if (!valid) return;

  const truck = {
    id:          `tt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    name,
    description: desc,
    lat,
    lng,
    rating,
    photos:      [...state.pendingPhotos],
    createdAt:   Date.now(),
  };

  state.trucks.push(truck);
  saveTrucks();
  addMarker(truck);
  renderList();
  closeAddModal();
  state.map.setView([lat, lng], 16, { animate: true });
  showToast(`🌮 "${truck.name}" added to the map!`);
}


/* ─── Detail modal ───────────────────────────────────────────── */
function openDetailModal(id) {
  const truck = state.trucks.find(t => t.id === id);
  if (!truck) return;

  document.getElementById('detail-title').textContent = truck.name;

  const ratingHtml = truck.rating > 0
    ? '🌮'.repeat(truck.rating) + '<span style="opacity:.2">🌮</span>'.repeat(5 - truck.rating)
    : '<span style="color:#9ca3af;font-size:13px">Not rated</span>';

  const galleryHtml = truck.photos?.length
    ? `<div class="photo-gallery">${
        truck.photos.map((p, i) =>
          `<div class="gallery-item" data-src="${p}">
            <img src="${p}" alt="Taco photo ${i+1}" loading="lazy" />
          </div>`
        ).join('')
      }</div>`
    : '';

  const date = fmtDate(truck.createdAt, { year:'numeric', month:'long', day:'numeric' });

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-rating">${ratingHtml}</div>
    ${truck.description ? `<p class="detail-desc">${esc(truck.description)}</p>` : ''}
    ${galleryHtml}
    <div class="detail-meta">
      <span>📍 ${truck.lat.toFixed(5)}, ${truck.lng.toFixed(5)}</span>
      <span>📅 Reported ${date}</span>
    </div>
    <div class="detail-actions">
      <button id="d-goto"   class="btn btn-sm btn-outline">🗺️ Show on Map</button>
      <button id="d-delete" class="btn btn-sm btn-danger">🗑️ Remove Truck</button>
    </div>`;

  // Show on map
  document.getElementById('d-goto').onclick = () => {
    state.map.setView([truck.lat, truck.lng], 17, { animate: true });
    closeDetailModal();
  };

  // Delete
  document.getElementById('d-delete').onclick = () => {
    if (!confirm(`Remove "${truck.name}" from the map?`)) return;
    state.trucks = state.trucks.filter(t => t.id !== id);
    saveTrucks();
    removeMarker(id);
    renderList();
    closeDetailModal();
    showToast('Truck removed.');
  };

  // Photo lightbox
  document.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('click', () => openLightbox(item.dataset.src));
  });

  document.getElementById('detail-modal').classList.remove('hidden');
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
}


/* ─── Lightbox ───────────────────────────────────────────────── */
function openLightbox(src) {
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.innerHTML = `<button id="lightbox-close" aria-label="Close">✕</button><img id="lightbox-img" alt="Full size taco photo" />`;
    document.body.appendChild(lb);
    lb.addEventListener('click', e => { if (e.target === lb || e.target.id === 'lightbox-close') closeLightbox(); });
    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  }
  document.getElementById('lightbox-img').src = src;
  lb.classList.remove('hidden');
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.classList.add('hidden');
}


/* ─── Geolocation ────────────────────────────────────────────── */
function locateUser(onFound) {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }
  showToast('Finding your location…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      state.map.setView([lat, lng], 15, { animate: true });
      onFound && onFound({ lat, lng });
    },
    () => showToast('Could not get your location.'),
    { timeout: 8000 }
  );
}


/* ─── Toast ──────────────────────────────────────────────────── */
let _toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}


/* ─── Utilities ──────────────────────────────────────────────── */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function fmtDate(ts, opts) {
  return new Date(ts).toLocaleDateString('en-US', opts);
}


/* ─── Event bindings ─────────────────────────────────────────── */
function bindEvents() {

  /* Header: locate */
  document.getElementById('locate-btn').addEventListener('click', () => locateUser());

  /* Header: add truck — open form immediately, pre-fill map center */
  document.getElementById('add-btn').addEventListener('click', () => {
    openAddModal(state.map.getCenter(), true);
  });

  /* Cancel pin-drop */
  document.getElementById('cancel-pin').addEventListener('click', exitPinDrop);

  /* Add modal — close buttons */
  document.getElementById('add-close').addEventListener('click', closeAddModal);
  document.getElementById('form-cancel').addEventListener('click', closeAddModal);
  document.getElementById('add-backdrop').addEventListener('click', closeAddModal);

  /* Add modal — pick on map (hide modal temporarily) */
  document.getElementById('pick-map-btn').addEventListener('click', () => {
    document.getElementById('add-modal').classList.add('modal-behind');
    enterPinDrop(latlng => {
      document.getElementById('add-modal').classList.remove('modal-behind');
      document.getElementById('add-modal').classList.remove('hidden');
      setFormLocation(latlng);
    });
  });

  /* Add modal — use GPS */
  document.getElementById('use-gps-btn').addEventListener('click', () => {
    locateUser(({ lat, lng }) => {
      setFormLocation({ lat, lng });
    });
  });

  /* Stars */
  bindStars();

  /* Photo input */
  document.getElementById('photo-file').addEventListener('change', e => {
    addPhotos(Array.from(e.target.files));
    e.target.value = '';    // allow re-selecting same file
  });

  /* Remove photo (delegated) */
  document.getElementById('photo-previews').addEventListener('click', e => {
    const btn = e.target.closest('.remove-photo');
    if (!btn) return;
    const item = btn.closest('.photo-preview-item');
    const idx  = parseInt(item.dataset.idx);
    state.pendingPhotos.splice(idx, 1);
    reRenderPreviews();
  });

  /* Form submit */
  document.getElementById('truck-form').addEventListener('submit', handleFormSubmit);

  /* Name field — clear error on input */
  document.getElementById('f-name').addEventListener('input', () => {
    document.getElementById('name-error').classList.add('hidden');
  });

  /* Detail modal — close */
  document.getElementById('detail-close').addEventListener('click', closeDetailModal);
  document.getElementById('detail-backdrop').addEventListener('click', closeDetailModal);

  /* Search */
  document.getElementById('search').addEventListener('input', renderList);

  /* Keyboard shortcuts */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (state.isPinDrop) {
        exitPinDrop();
        /* If modal was hidden behind, bring it back */
        const m = document.getElementById('add-modal');
        if (m.classList.contains('modal-behind')) {
          m.classList.remove('modal-behind');
        }
      }
      closeDetailModal();
      closeLightbox();
    }
  });
}


/* ─── Init ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  loadTrucks();
  initMap();
  state.trucks.forEach(addMarker);
  renderList();
  bindEvents();

  /* Silently try to center on user's location */
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => state.map.setView([pos.coords.latitude, pos.coords.longitude], 13),
      () => {}   // fail silently
    );
  }
});
