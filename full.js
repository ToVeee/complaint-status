function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

const socket = io('https://rekserver-production.up.railway.app');

const statusBadge = document.getElementById('status');
const complaintList = document.getElementById('complaintList');
const lookupView = document.getElementById('lookupView');
const resultView = document.getElementById('resultView');
const codeForm = document.getElementById('codeForm');
const codeInput = document.getElementById('codeInput');
const qrFileInput = document.getElementById('qrFileInput');
const lookupMessage = document.getElementById('lookupMessage');
const backBtn = document.getElementById('backBtn');

// ---------- state ----------
let latestHistory = [];   // cached copy of every complaint, refreshed whenever the server sends it
let historyLoaded = false;
let targetId = null;      // the tracking ID we're currently trying to show

// ---------- status presentation ----------
const STATUS_META = {
    Pending: { icon: '🟡', className: 'status-pending' },
    Resolved: { icon: '🟢', className: 'status-resolved' },
    Rejected: { icon: '🔴', className: 'status-rejected' }
};

function statusMeta(status) {
    return STATUS_META[status] || STATUS_META.Pending;
}

// ---------- connection ----------
socket.on('connect', () => {
    statusBadge.innerText = "🟢 Connected";
    statusBadge.className = "status-badge";
});

socket.on('disconnect', () => {
    statusBadge.innerText = "🔴 Disconnected";
    statusBadge.className = "status-badge disconnected";
});

// ---------- view switching ----------
function showResultView() {
    lookupView.style.display = 'none';
    resultView.style.display = 'block';
}

function showLookupView() {
    resultView.style.display = 'none';
    lookupView.style.display = 'block';
}

function setLookupMessage(text, isError) {
    lookupMessage.textContent = text;
    lookupMessage.className = 'lookup-message' + (isError ? ' error' : '');
}

function showRemovedMessage(text) {
    complaintList.innerHTML = `<div class="no-data">${esc(text)}</div>`;
}

// ---------- card rendering ----------
function renderComplaintCard(data) {
    const complaintId = data.trackingid || data.trackingId;
    const status = data.status || 'Pending';
    const meta = statusMeta(status);

    const card = document.createElement('div');
    card.className = 'ticket';
    card.id = complaintId;

    card.innerHTML = `
        <div class="ticket-head">
            <span class="ticket-label">Tracking Code</span>
            <span class="ticket-code">${esc(complaintId)}</span>
        </div>

        <div class="ticket-tear" aria-hidden="true"></div>

        <div class="ticket-status ${meta.className}">
            <span class="icon">${meta.icon}</span>
            <span class="word">${esc(status)}</span>
        </div>

        <dl class="ticket-details">
            <dt>Filed</dt><dd>${esc(data.date || 'N/A')}</dd>
            <dt>Category</dt><dd>${esc(data.category || 'N/A')}</dd>
            <dt>Section</dt><dd>${esc(data.section || 'N/A')}</dd>
            <dt>Filed by</dt><dd>${data.isAnonymous ? 'Anonymous' : esc(data.name || 'N/A')}</dd>
        </dl>

        <div class="ticket-narrative">
            <span class="ticket-label">Your Complaint</span>
            <p>${data.text ? esc(data.text) : '<em>No written details provided.</em>'}</p>
        </div>

        <div class="ticket-feedback">
            <span class="ticket-label">Feedback</span>
            <p>${data.feedback ? esc(data.feedback) : '<em>No feedback provided yet.</em>'}</p>
        </div>
    `;

    complaintList.innerHTML = '';
    complaintList.appendChild(card);
}

// ---------- lookup flow ----------
function normalizeCode(raw) {
    return raw.trim().toUpperCase();
}

function requestLookup(rawId) {
    const id = normalizeCode(rawId);
    if (!id) {
        setLookupMessage('Please enter a tracking code.', true);
        return;
    }
    targetId = id;
    codeInput.value = id;
    history.replaceState(null, '', '#' + id);

    if (historyLoaded) {
        resolveLookup();
    } else {
        setLookupMessage('Looking up your complaint…', false);
    }
}

function resolveLookup() {
    const match = latestHistory.find(c => (c.trackingid || c.trackingId) === targetId);
    if (match) {
        setLookupMessage('', false);
        renderComplaintCard(match);
        showResultView();
    } else {
        setLookupMessage('No complaint found for that code. Check for typos and try again.', true);
    }
}

codeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    requestLookup(codeInput.value);
});

backBtn.addEventListener('click', () => {
    targetId = null;
    history.replaceState(null, '', window.location.pathname);
    setLookupMessage('', false);
    codeInput.value = '';
    showLookupView();
    codeInput.focus();
});

// ---------- QR photo upload ----------
function decodeQRFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                if (code) {
                    resolve(code.data);
                } else {
                    reject(new Error("Couldn't find a QR code in that photo. Try a clearer, well-lit picture."));
                }
            };
            img.onerror = () => reject(new Error('That file could not be read as an image.'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('That file could not be read.'));
        reader.readAsDataURL(file);
    });
}

function extractTrackingId(decodedText) {
    const hashIndex = decodedText.indexOf('#');
    return hashIndex !== -1 ? decodedText.slice(hashIndex + 1).trim() : decodedText.trim();
}

qrFileInput.addEventListener('change', async () => {
    const file = qrFileInput.files[0];
    if (!file) return;
    setLookupMessage('Reading QR code…', false);
    try {
        const decoded = await decodeQRFromFile(file);
        const id = extractTrackingId(decoded);
        requestLookup(id);
    } catch (err) {
        setLookupMessage(err.message, true);
    } finally {
        qrFileInput.value = '';
    }
});

// ---------- socket events ----------
socket.on('complaintHistory', (historyArray) => {
    latestHistory = historyArray || [];
    historyLoaded = true;
    if (targetId) resolveLookup();
});

socket.on('newComplaint', (data) => {
    const id = data.trackingid || data.trackingId;
    latestHistory.push(data);
    if (targetId && id === targetId) {
        renderComplaintCard(data);
        showResultView();
    }
});

socket.on('statusUpdated', ({ trackingId, status, feedback }) => {
    if (trackingId !== targetId) return;
    const card = document.getElementById(trackingId);
    if (!card) return;

    const meta = statusMeta(status);
    const statusEl = card.querySelector('.ticket-status');
    statusEl.className = `ticket-status ${meta.className}`;
    statusEl.querySelector('.icon').textContent = meta.icon;
    statusEl.querySelector('.word').textContent = status;

    if (status === 'Resolved') {
        const feedbackEl = card.querySelector('.ticket-feedback p');
        feedbackEl.textContent = feedback ? feedback : 'No feedback provided yet.';
    }
});

socket.on('cardDeleted', ({ trackingId }) => {
    if (trackingId !== targetId) return;
    showRemovedMessage('This complaint record has been removed.');
});

// ---------- entry point ----------
if (window.location.hash) {
    requestLookup(window.location.hash.slice(1));
}