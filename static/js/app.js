/**
 * ChipIn - Decentralized Money Gathering on Celestia
 *
 * Main application logic for the frontend.
 */

// ===== Global State =====
let appConfig = null;
let currentFilter = 'active';
let currentGatheringId = null;
let refreshInterval = null;

// ===== Initialization =====

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[ChipIn] Initializing...');

    // Load app configuration
    await loadConfig();

    // Load initial data
    await Promise.all([
        loadStats(),
        loadGatherings(),
        loadRecentActivity(),
    ]);

    // Check URL for gathering ID
    const path = window.location.pathname;
    const match = path.match(/\/g\/([a-zA-Z0-9]+)/);
    if (match) {
        showGatheringDetail(match[1]);
    }

    // Set up auto-refresh
    refreshInterval = setInterval(() => {
        loadStats();
        loadRecentActivity();
    }, 30000);

    // Set default end date (7 days from now)
    const endsAtInput = document.getElementById('create-ends-at');
    if (endsAtInput) {
        const defaultEnd = new Date();
        defaultEnd.setDate(defaultEnd.getDate() + 7);
        endsAtInput.value = defaultEnd.toISOString().slice(0, 16);
        endsAtInput.min = new Date().toISOString().slice(0, 16);
    }

    console.log('[ChipIn] Initialized');
});

// ===== API Functions =====

async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        const data = await response.json();
        if (data.success) {
            appConfig = data.config;
            console.log('[ChipIn] Config loaded:', appConfig);

            // Update creation fee display
            const createFee = document.getElementById('create-fee');
            if (createFee) {
                createFee.textContent = `${(appConfig.creation_fee_utia / 1_000_000).toFixed(2)} TIA`;
            }

            // Update min contribution
            const contributeMin = document.getElementById('contribute-min');
            if (contributeMin) {
                contributeMin.textContent = `Minimum: ${(appConfig.min_contribution_utia / 1_000_000).toFixed(1)} TIA`;
            }
        }
    } catch (error) {
        console.error('[ChipIn] Failed to load config:', error);
    }
}

async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        if (data.success) {
            document.getElementById('stat-active').textContent = data.stats.active_gatherings;
            document.getElementById('stat-raised').textContent = `${data.stats.total_raised_tia.toFixed(2)}`;
            document.getElementById('stat-contributors').textContent = data.stats.total_contributors;
            document.getElementById('stat-completed').textContent = data.stats.completed_gatherings;
        }
    } catch (error) {
        console.error('[ChipIn] Failed to load stats:', error);
    }
}

async function loadGatherings(status = null) {
    const container = document.getElementById('gatherings-container');
    const emptyState = document.getElementById('empty-state');

    try {
        const params = new URLSearchParams();
        if (status && status !== 'all') {
            params.set('status', status);
        }

        const response = await fetch(`/api/gatherings?${params}`);
        const data = await response.json();

        if (data.success) {
            const gatherings = data.gatherings;

            if (gatherings.length === 0) {
                container.innerHTML = '';
                emptyState.classList.remove('hidden');
            } else {
                emptyState.classList.add('hidden');
                container.innerHTML = gatherings.map((g, index) => renderGatheringCard(g, index === 0)).join('');

                // Start countdown timers
                startCountdowns();
            }
        }
    } catch (error) {
        console.error('[ChipIn] Failed to load gatherings:', error);
        container.innerHTML = `
            <div class="col-span-full text-center py-12">
                <p class="text-red-400">Failed to load gatherings. Please try again.</p>
            </div>
        `;
    }
}

async function loadRecentActivity() {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;

    try {
        const response = await fetch('/api/recent-contributions?limit=5');
        const data = await response.json();

        if (data.success && data.contributions.length > 0) {
            feed.innerHTML = data.contributions.map(renderActivityItem).join('');
        } else {
            feed.innerHTML = '<p class="text-dark-500 text-sm">No activity yet</p>';
        }
    } catch (error) {
        console.error('[ChipIn] Failed to load activity:', error);
    }
}

// ===== Rendering Functions =====

function renderGatheringCard(gathering, featured = false) {
    const progress = (gathering.current_amount / gathering.goal_amount) * 100;
    const progressCapped = Math.min(progress, 100);
    const currentTIA = (gathering.current_amount / 1_000_000).toFixed(2);
    const goalTIA = (gathering.goal_amount / 1_000_000).toFixed(2);
    const timeLeft = getTimeLeft(gathering.ends_at);
    const isExpired = timeLeft === 'Expired';
    const isCompleted = gathering.status === 'completed';

    const statusBadge = isCompleted
        ? '<span class="px-2 py-1 bg-green-500/20 text-green-400 text-xs font-medium rounded-full">Goal Reached!</span>'
        : isExpired
            ? '<span class="px-2 py-1 bg-red-500/20 text-red-400 text-xs font-medium rounded-full">Expired</span>'
            : '';

    const cardClass = featured
        ? 'md:col-span-2 lg:col-span-2'
        : '';

    return `
        <div class="glass rounded-2xl overflow-hidden card-hover cursor-pointer ${cardClass}" onclick="showGatheringDetail('${gathering.id}')">
            ${gathering.image_url ? `
                <div class="h-48 bg-dark-800 relative overflow-hidden">
                    <img src="${escapeHtml(gathering.image_url)}" alt="${escapeHtml(gathering.title)}" class="w-full h-full object-cover">
                    <div class="absolute inset-0 bg-gradient-to-t from-dark-900/80 to-transparent"></div>
                </div>
            ` : `
                <div class="h-32 bg-gradient-to-br from-celestia-600/20 to-purple-600/20 flex items-center justify-center">
                    <svg class="w-12 h-12 text-celestia-400/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                </div>
            `}

            <div class="p-6">
                <div class="flex items-start justify-between mb-3">
                    <h3 class="text-lg font-semibold line-clamp-2">${escapeHtml(gathering.title)}</h3>
                    ${statusBadge}
                </div>

                <p class="text-dark-400 text-sm mb-4 line-clamp-2">${escapeHtml(gathering.description)}</p>

                <!-- Progress Bar -->
                <div class="mb-4">
                    <div class="flex justify-between text-sm mb-2">
                        <span class="text-celestia-400 font-medium">${currentTIA} TIA</span>
                        <span class="text-dark-400">${goalTIA} TIA goal</span>
                    </div>
                    <div class="h-2 bg-dark-700 rounded-full overflow-hidden">
                        <div class="progress-bar h-full rounded-full ${isCompleted ? 'bg-green-500' : 'bg-gradient-to-r from-celestia-500 to-purple-500'}" style="width: ${progressCapped}%"></div>
                    </div>
                </div>

                <!-- Stats Row -->
                <div class="flex items-center justify-between text-sm">
                    <div class="flex items-center gap-4">
                        <div class="flex items-center gap-1 text-dark-400">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span>${gathering.contributor_count}</span>
                        </div>
                        <div class="flex items-center gap-1 text-dark-400">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span class="countdown-text" data-ends-at="${gathering.ends_at}">${timeLeft}</span>
                        </div>
                    </div>
                    <span class="text-celestia-400 font-medium">${progress.toFixed(0)}%</span>
                </div>
            </div>
        </div>
    `;
}

function renderActivityItem(contribution) {
    const amount = (contribution.amount / 1_000_000).toFixed(2);
    const time = getRelativeTime(contribution.created_at);
    const addr = formatAddress(contribution.contributor);

    return `
        <div class="flex items-center gap-3 py-2 border-b border-dark-700/50 last:border-0">
            <div class="w-8 h-8 rounded-full bg-gradient-to-br from-celestia-400 to-purple-500 flex items-center justify-center flex-shrink-0">
                <span class="text-xs font-bold">${contribution.contributor.charAt(9).toUpperCase()}</span>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm truncate">
                    <span class="font-medium text-celestia-400">${amount} TIA</span>
                    <span class="text-dark-400">from ${addr}</span>
                </p>
                <p class="text-xs text-dark-500">${time}</p>
            </div>
        </div>
    `;
}

function renderGatheringDetail(gathering) {
    const progress = (gathering.current_amount / gathering.goal_amount) * 100;
    const progressCapped = Math.min(progress, 100);
    const currentTIA = (gathering.current_amount / 1_000_000).toFixed(2);
    const goalTIA = (gathering.goal_amount / 1_000_000).toFixed(2);
    const remaining = ((gathering.goal_amount - gathering.current_amount) / 1_000_000).toFixed(2);
    const timeLeft = getTimeLeft(gathering.ends_at);
    const isExpired = timeLeft === 'Expired';
    const isCompleted = gathering.status === 'completed';
    const canContribute = !isExpired && !isCompleted;

    return `
        <div class="glass rounded-3xl overflow-hidden">
            ${gathering.image_url ? `
                <div class="h-64 md:h-80 bg-dark-800 relative overflow-hidden">
                    <img src="${escapeHtml(gathering.image_url)}" alt="${escapeHtml(gathering.title)}" class="w-full h-full object-cover">
                    <div class="absolute inset-0 bg-gradient-to-t from-dark-900 to-transparent"></div>
                </div>
            ` : ''}

            <div class="p-8">
                <div class="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
                    <div class="flex-1">
                        <h1 class="text-3xl font-bold mb-3">${escapeHtml(gathering.title)}</h1>
                        <p class="text-dark-300 text-lg">${escapeHtml(gathering.description)}</p>

                        <div class="flex items-center gap-4 mt-4 text-sm text-dark-400">
                            <span>Created by ${formatAddress(gathering.creator)}</span>
                            <span>•</span>
                            <span>${new Date(gathering.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>

                    ${canContribute ? `
                        <button onclick="showContributeModal('${gathering.id}', '${escapeHtml(gathering.title)}')" class="btn-primary px-8 py-4 rounded-xl font-semibold text-lg whitespace-nowrap">
                            Chip In Now
                        </button>
                    ` : `
                        <div class="px-6 py-3 rounded-xl ${isCompleted ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'} font-medium">
                            ${isCompleted ? 'Goal Reached!' : 'Ended'}
                        </div>
                    `}
                </div>

                <!-- Progress Section -->
                <div class="glass-light rounded-2xl p-6 mb-8">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
                        <div>
                            <div class="text-3xl font-bold text-celestia-400">${currentTIA}</div>
                            <div class="text-sm text-dark-400">TIA Raised</div>
                        </div>
                        <div>
                            <div class="text-3xl font-bold text-dark-200">${goalTIA}</div>
                            <div class="text-sm text-dark-400">TIA Goal</div>
                        </div>
                        <div>
                            <div class="text-3xl font-bold text-purple-400">${gathering.contributor_count}</div>
                            <div class="text-sm text-dark-400">Contributors</div>
                        </div>
                        <div>
                            <div class="text-3xl font-bold ${isExpired || isCompleted ? 'text-dark-500' : 'text-yellow-400'}">${timeLeft}</div>
                            <div class="text-sm text-dark-400">Time Left</div>
                        </div>
                    </div>

                    <div class="mb-2">
                        <div class="h-4 bg-dark-700 rounded-full overflow-hidden">
                            <div class="progress-bar h-full rounded-full ${isCompleted ? 'bg-green-500' : 'bg-gradient-to-r from-celestia-500 to-purple-500'}" style="width: ${progressCapped}%"></div>
                        </div>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span class="text-dark-400">${progress.toFixed(1)}% funded</span>
                        <span class="text-dark-400">${remaining > 0 ? `${remaining} TIA to go` : 'Goal reached!'}</span>
                    </div>
                </div>

                <!-- Share Link -->
                <div class="glass-light rounded-xl p-4 mb-8">
                    <div class="flex items-center gap-4">
                        <div class="flex-1">
                            <label class="block text-sm text-dark-400 mb-1">Share this gathering</label>
                            <input type="text" readonly value="${window.location.origin}/g/${gathering.id}" class="w-full bg-dark-800 border border-dark-700 rounded-lg px-3 py-2 text-sm font-mono text-dark-300" onclick="this.select()">
                        </div>
                        <button onclick="copyShareLink('${gathering.id}')" class="glass-light px-4 py-2 rounded-lg font-medium text-sm hover:bg-white/10 transition-colors">
                            Copy Link
                        </button>
                    </div>
                </div>

                <!-- Contributors -->
                <div>
                    <h3 class="text-xl font-semibold mb-4">Contributors (${gathering.contributions?.length || 0})</h3>
                    ${gathering.contributions?.length > 0 ? `
                        <div class="space-y-3">
                            ${gathering.contributions.map(renderContributionItem).join('')}
                        </div>
                    ` : `
                        <div class="text-center py-8 text-dark-500">
                            <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <p>No contributions yet. Be the first to chip in!</p>
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;
}

function renderContributionItem(contribution) {
    const amount = (contribution.amount / 1_000_000).toFixed(2);
    const time = getRelativeTime(contribution.created_at);

    return `
        <div class="glass-light rounded-xl p-4 flex items-center gap-4">
            <div class="w-12 h-12 rounded-full bg-gradient-to-br from-celestia-400 to-purple-500 flex items-center justify-center flex-shrink-0">
                <span class="text-lg font-bold">${contribution.contributor.charAt(9).toUpperCase()}</span>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="font-medium">${formatAddress(contribution.contributor)}</span>
                    <span class="text-celestia-400 font-bold">${amount} TIA</span>
                </div>
                ${contribution.message ? `<p class="text-dark-400 text-sm truncate">"${escapeHtml(contribution.message)}"</p>` : ''}
                <p class="text-xs text-dark-500 mt-1">${time}</p>
            </div>
        </div>
    `;
}

// ===== Filter Functions =====

function filterGatherings(status) {
    currentFilter = status;

    // Update filter button styles
    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.dataset.filter === status) {
            btn.classList.add('bg-celestia-600', 'text-white');
            btn.classList.remove('glass-light');
        } else {
            btn.classList.remove('bg-celestia-600', 'text-white');
            btn.classList.add('glass-light');
        }
    });

    loadGatherings(status);
}

// ===== Modal Functions =====

function showCreateModal() {
    if (!window.wallet.isConnected) {
        showNotification('Please connect your wallet first', 'warning');
        connectWallet();
        return;
    }

    document.getElementById('create-modal').classList.remove('hidden');
    document.getElementById('create-title').focus();
}

function hideCreateModal() {
    document.getElementById('create-modal').classList.add('hidden');
    document.getElementById('create-form').reset();
}

function showContributeModal(gatheringId, title) {
    if (!window.wallet.isConnected) {
        showNotification('Please connect your wallet first', 'warning');
        connectWallet();
        return;
    }

    document.getElementById('contribute-gathering-id').value = gatheringId;
    document.getElementById('contribute-title').textContent = `to ${title}`;
    document.getElementById('contribute-modal').classList.remove('hidden');
    document.getElementById('contribute-amount').focus();
}

function hideContributeModal() {
    document.getElementById('contribute-modal').classList.add('hidden');
    document.getElementById('contribute-form').reset();
}

function setContributeAmount(amount) {
    document.getElementById('contribute-amount').value = amount;
}

function showTxModal(title, message) {
    document.getElementById('tx-title').textContent = title;
    document.getElementById('tx-message').textContent = message;
    document.getElementById('tx-spinner').classList.remove('hidden');
    document.getElementById('tx-success').classList.add('hidden');
    document.getElementById('tx-error').classList.add('hidden');
    document.getElementById('tx-link').classList.add('hidden');
    document.getElementById('tx-close').classList.add('hidden');
    document.getElementById('tx-modal').classList.remove('hidden');
}

function updateTxModal(success, message, txHash = null) {
    document.getElementById('tx-spinner').classList.add('hidden');
    document.getElementById('tx-message').textContent = message;

    if (success) {
        document.getElementById('tx-success').classList.remove('hidden');
        document.getElementById('tx-title').textContent = 'Success!';

        if (txHash) {
            const link = document.getElementById('tx-link');
            link.href = `https://mocha.celenium.io/tx/${txHash}`;
            link.textContent = `View on Explorer: ${txHash.slice(0, 8)}...`;
            link.classList.remove('hidden');
        }
    } else {
        document.getElementById('tx-error').classList.remove('hidden');
        document.getElementById('tx-title').textContent = 'Transaction Failed';
    }

    document.getElementById('tx-close').classList.remove('hidden');
}

function hideTxModal() {
    document.getElementById('tx-modal').classList.add('hidden');
}

// ===== Gathering Detail =====

async function showGatheringDetail(gatheringId) {
    const detailView = document.getElementById('gathering-detail');
    const content = document.getElementById('gathering-detail-content');

    // Show loading state
    content.innerHTML = `
        <div class="flex justify-center py-12">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-celestia-500"></div>
        </div>
    `;
    detailView.classList.remove('hidden');

    // Update URL
    window.history.pushState({}, '', `/g/${gatheringId}`);
    currentGatheringId = gatheringId;

    try {
        const response = await fetch(`/api/gatherings/${gatheringId}`);
        const data = await response.json();

        if (data.success) {
            content.innerHTML = renderGatheringDetail(data.gathering);
        } else {
            content.innerHTML = `
                <div class="text-center py-12">
                    <p class="text-red-400 text-xl">Gathering not found</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('[ChipIn] Failed to load gathering:', error);
        content.innerHTML = `
            <div class="text-center py-12">
                <p class="text-red-400 text-xl">Failed to load gathering</p>
            </div>
        `;
    }
}

function hideGatheringDetail() {
    document.getElementById('gathering-detail').classList.add('hidden');
    window.history.pushState({}, '', '/');
    currentGatheringId = null;
}

function showMyGatherings() {
    if (!window.wallet.isConnected) {
        showNotification('Please connect your wallet first', 'warning');
        connectWallet();
        return;
    }

    // Filter by creator
    loadGatherings(null).then(() => {
        // Show only user's gatherings - need to implement server-side
        filterGatherings('all');
        showNotification('Showing your gatherings', 'info');
    });
}

// ===== Image Upload Helpers =====

async function handleImageSelect(input) {
    const file = input.files?.[0];
    if (!file) return;

    // Validate
    if (file.size > 1.5 * 1024 * 1024) {
        showNotification('Image too large (max 1.5MB)', 'error');
        input.value = '';
        return;
    }

    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
        showNotification('Invalid image type', 'error');
        input.value = '';
        return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('image-preview-img').src = e.target.result;
        document.getElementById('image-preview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);

    // Calculate and show fee
    const sizeKb = Math.ceil(file.size / 1024);
    try {
        const res = await fetch(`/api/blobs/pricing?size_kb=${sizeKb}`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('image-fee').textContent = `${data.pricing.amount_tia.toFixed(2)} TIA`;
            document.getElementById('image-fee-row').classList.remove('hidden');
        }
    } catch (e) {
        console.error('Failed to get image pricing:', e);
    }
}

function clearImagePreview() {
    document.getElementById('create-image').value = '';
    document.getElementById('image-preview').classList.add('hidden');
    document.getElementById('image-fee-row').classList.add('hidden');
}

// ===== Form Submissions =====

async function createGathering(event) {
    event.preventDefault();

    const title = document.getElementById('create-title').value.trim();
    const description = document.getElementById('create-description').value.trim();
    const goalTIA = parseFloat(document.getElementById('create-goal').value);
    const endsAt = new Date(document.getElementById('create-ends-at').value).toISOString();
    const imageInput = document.getElementById('create-image');
    const imageFile = imageInput?.files?.[0];

    if (!title || !description || !goalTIA || !endsAt) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }

    // Validate image if provided
    if (imageFile) {
        if (imageFile.size > 1.5 * 1024 * 1024) {
            showNotification('Image too large (max 1.5MB)', 'error');
            return;
        }
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(imageFile.type)) {
            showNotification('Invalid image type (PNG, JPG, GIF, WebP only)', 'error');
            return;
        }
    }

    const goalUtia = Math.floor(goalTIA * 1_000_000);

    hideCreateModal();

    let imageUrl = null;

    try {
        // STEP 1: Upload image first (if provided) - use 402 flow
        if (imageFile) {
            showTxModal('Uploading Image', 'Getting price quote...');

            // First request without payment to get 402 with required amount
            const quoteFormData = new FormData();
            quoteFormData.append('file', imageFile);
            // No payment fields - triggers 402

            const quoteRes = await fetch('/api/blobs/upload', {
                method: 'POST',
                body: quoteFormData,
            });

            if (quoteRes.status !== 402) {
                const errorData = await quoteRes.json();
                throw new Error(errorData.error || 'Failed to get image upload price');
            }

            const quoteData = await quoteRes.json();
            const paymentRequired = quoteData.payment_required;
            const imageCostUtia = paymentRequired.amount_utia;
            const payTo = paymentRequired.pay_to || appConfig.broker_address;

            document.getElementById('tx-message').textContent = 'Please approve the image upload transaction...';

            // Pay for image upload
            const imageTxResult = await signAndBroadcast(
                payTo,
                imageCostUtia,
                `ChipIn: Upload image for "${title}"`
            );

            document.getElementById('tx-message').textContent = 'Uploading image to Celestia...';

            // Retry with payment proof
            const formData = new FormData();
            formData.append('file', imageFile);
            formData.append('payment_tx_hash', imageTxResult.txhash);
            formData.append('user_address', window.wallet.address);
            formData.append('broker_address', payTo);
            formData.append('amount_utia', imageCostUtia.toString());

            const uploadRes = await fetch('/api/blobs/upload', {
                method: 'POST',
                body: formData,
            });

            const uploadData = await uploadRes.json();
            if (uploadData.success) {
                imageUrl = uploadData.blob_url;
                console.log('[ChipIn] Image uploaded:', uploadData.blob_id);
            } else {
                throw new Error(uploadData.error || 'Image upload failed');
            }
        }

        // STEP 2: Create gathering - use 402 flow
        showTxModal('Creating Gathering', 'Getting price quote...');

        // First request without payment to get 402 with required amount
        const quoteRes = await fetch('/api/gatherings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                description,
                goal_amount: goalUtia,
                ends_at: endsAt,
                creator: window.wallet.address,
                image_url: imageUrl,
                // No payment_proof - triggers 402
            }),
        });

        if (quoteRes.status !== 402) {
            // Unexpected - should get 402
            const errorData = await quoteRes.json();
            throw new Error(errorData.error || 'Failed to get price quote');
        }

        const quoteData = await quoteRes.json();
        const paymentRequired = quoteData.payment_required;
        const creationFeeUtia = paymentRequired.amount_utia;
        const payTo = paymentRequired.pay_to || appConfig.broker_address;

        document.getElementById('tx-message').textContent = 'Please approve the gathering creation transaction...';

        const txResult = await signAndBroadcast(
            payTo,
            creationFeeUtia,
            `ChipIn: Create gathering "${title}"`
        );

        document.getElementById('tx-message').textContent = 'Recording gathering on blockchain...';

        // Retry with payment proof
        const response = await fetch('/api/gatherings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                description,
                goal_amount: goalUtia,
                ends_at: endsAt,
                creator: window.wallet.address,
                image_url: imageUrl,
                payment_proof: {
                    payment_tx_hash: txResult.txhash,
                    user_address: window.wallet.address,
                    broker_address: payTo,
                    amount_utia: creationFeeUtia,
                },
            }),
        });

        const data = await response.json();

        if (data.success) {
            updateTxModal(true, 'Gathering created successfully!', txResult.txhash);

            // Refresh data
            setTimeout(() => {
                loadGatherings();
                loadStats();
                hideTxModal();
                showGatheringDetail(data.gathering.id);
            }, 2000);
        } else {
            throw new Error(data.error || 'Failed to create gathering');
        }

    } catch (error) {
        console.error('[ChipIn] Create gathering error:', error);
        updateTxModal(false, error.message || 'Failed to create gathering');
    }
}

async function submitContribution(event) {
    event.preventDefault();

    const gatheringId = document.getElementById('contribute-gathering-id').value;
    const amountTIA = parseFloat(document.getElementById('contribute-amount').value);
    const message = document.getElementById('contribute-message').value.trim();

    if (!amountTIA || amountTIA <= 0) {
        showNotification('Please enter a valid amount', 'error');
        return;
    }

    const amountUtia = Math.floor(amountTIA * 1_000_000);

    if (amountUtia < appConfig.min_contribution_utia) {
        showNotification(`Minimum contribution is ${(appConfig.min_contribution_utia / 1_000_000).toFixed(1)} TIA`, 'error');
        return;
    }

    hideContributeModal();
    showTxModal('Processing Contribution', 'Getting price quote...');

    try {
        // First request without payment to get 402 with required amount
        const quoteRes = await fetch(`/api/gatherings/${gatheringId}/contribute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: amountUtia,
                contributor: window.wallet.address,
                message: message,
                // No payment_proof - triggers 402
            }),
        });

        if (quoteRes.status !== 402) {
            const errorData = await quoteRes.json();
            throw new Error(errorData.error || 'Failed to get price quote');
        }

        const quoteData = await quoteRes.json();
        const paymentRequired = quoteData.payment_required;
        const storageFeeUtia = paymentRequired.amount_utia;
        const payTo = paymentRequired.pay_to || appConfig.broker_address;

        // Total payment = contribution amount + storage fee
        const totalPaymentUtia = amountUtia + storageFeeUtia;

        document.getElementById('tx-message').textContent = 'Please approve the transaction in your wallet...';

        // Sign and broadcast payment transaction
        const txResult = await signAndBroadcast(
            payTo,
            totalPaymentUtia,
            `ChipIn: ${message || 'Contribution'}`
        );

        // Update modal - payment sent, now waiting for OnChainDB confirmation
        document.getElementById('tx-message').textContent = 'Payment sent! Waiting for blockchain confirmation...';

        // Retry with payment proof
        const response = await fetch(`/api/gatherings/${gatheringId}/contribute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: amountUtia,
                contributor: window.wallet.address,
                message: message,
                payment_proof: {
                    payment_tx_hash: txResult.txhash,
                    user_address: window.wallet.address,
                    broker_address: payTo,
                    amount_utia: totalPaymentUtia,
                },
            }),
        });

        const data = await response.json();

        if (data.success) {
            updateTxModal(true, 'Contribution recorded successfully!', txResult.txhash);

            // Refresh data
            setTimeout(() => {
                loadGatherings();
                loadStats();
                loadRecentActivity();
                hideTxModal();

                // Refresh detail view if open
                if (currentGatheringId === gatheringId) {
                    showGatheringDetail(gatheringId);
                }
            }, 2000);
        } else {
            throw new Error(data.error || 'Failed to record contribution');
        }

    } catch (error) {
        console.error('[ChipIn] Contribution error:', error);
        updateTxModal(false, error.message || 'Failed to process contribution');
    }
}

// ===== Utility Functions =====

function getTimeLeft(endsAt) {
    const end = new Date(endsAt);
    const now = new Date();
    const diff = end - now;

    if (diff <= 0) return 'Expired';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function getRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

function formatAddress(addr, len = 6) {
    if (!addr) return '';
    if (addr.length <= len * 2) return addr;
    return `${addr.slice(0, len)}...${addr.slice(-4)}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function copyShareLink(gatheringId) {
    const url = `${window.location.origin}/g/${gatheringId}`;
    navigator.clipboard.writeText(url).then(() => {
        showNotification('Link copied to clipboard!', 'success');
    });
}

function showNotification(message, type = 'info') {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-xl font-medium z-50 transform transition-all duration-300 translate-y-4 opacity-0`;

    const colors = {
        success: 'bg-green-500 text-white',
        error: 'bg-red-500 text-white',
        warning: 'bg-yellow-500 text-dark-900',
        info: 'bg-celestia-500 text-white',
    };

    toast.className += ` ${colors[type] || colors.info}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-4', 'opacity-0');
    });

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.add('translate-y-4', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function startCountdowns() {
    // Update countdown texts every minute
    setInterval(() => {
        document.querySelectorAll('.countdown-text').forEach(el => {
            const endsAt = el.dataset.endsAt;
            if (endsAt) {
                el.textContent = getTimeLeft(endsAt);
            }
        });
    }, 60000);
}

// Handle browser back button
window.addEventListener('popstate', () => {
    const path = window.location.pathname;
    if (path === '/') {
        hideGatheringDetail();
    } else {
        const match = path.match(/\/g\/([a-zA-Z0-9]+)/);
        if (match) {
            showGatheringDetail(match[1]);
        }
    }
});
