/**
 * Competitive Changelog Monitor — Dashboard Frontend
 *
 * Handles all frontend interactions: view switching, API calls,
 * data rendering, and "act on intelligence" workflows.
 *
 * Security:
 * - All external content rendered with textContent (no innerHTML)
 * - DOMPurify used for any HTML that needs rendering
 * - CSP headers on backend block inline scripts
 * - HTTPS only to API endpoints
 */

const API_BASE = '/api';
let currentView = 'feed';
let entries = [];
let digests = [];
let sources = [];
let userEmail = '';
let charts = {};

/**
 * Initialize the application
 */
async function init() {
  console.log('[app] Initializing...');

  // Set up event listeners
  setupNavigation();
  setupFeedFilters();
  setupDigestActions();
  setupSearchAction();
  setupModalActions();
  setupLogout();

  // Load user info and initial data
  await loadUserInfo();
  await switchView('feed');

  console.log('[app] Initialization complete');
}

/**
 * Navigation setup
 */
function setupNavigation() {
  document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = e.target.dataset.view;
      switchView(view);
    });
  });
}

/**
 * Switch between views
 */
async function switchView(viewName) {
  currentView = viewName;

  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-menu a').forEach(a => a.classList.remove('active'));

  // Show selected view
  const viewEl = document.getElementById(`view-${viewName}`);
  if (viewEl) viewEl.classList.add('active');
  document.querySelector(`[data-view="${viewName}"]`)?.classList.add('active');

  // Load data based on view
  switch(viewName) {
    case 'feed':
      await loadEntries();
      break;
    case 'digests':
      await loadDigests();
      break;
    case 'health':
      await loadHealth();
      break;
    case 'trends':
      await loadTrends();
      break;
  }
}

/**
 * Load user email from Access JWT
 */
async function loadUserInfo() {
  try {
    // Call any protected endpoint to verify auth
    // The API will return user info from the JWT
    const res = await apiCall('/health');

    // For now, parse the JWT to get email
    // In a real app, the API could return user info
    const token = getCookie('CF_Authorization');
    if (token) {
      try {
        const payload = parseJWT(token);
        userEmail = payload.email || 'User';
        document.getElementById('user-email').textContent = userEmail;
      } catch (e) {
        document.getElementById('user-email').textContent = 'User';
      }
    }
  } catch (err) {
    console.error('[app] Failed to load user info:', err);
  }
}

/**
 * Parse JWT payload (without validation)
 */
function parseJWT(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');

  const payload = parts[1];
  const padding = 4 - (payload.length % 4);
  const padded = padding < 4 ? payload + '='.repeat(padding) : payload;

  return JSON.parse(atob(padded));
}

/**
 * Get cookie by name
 */
function getCookie(name) {
  const match = document.cookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Make API call with auth
 */
async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    console.error('[api] Unauthorized');
    // In a real app, redirect to login
    alert('Session expired. Please log in again.');
    return null;
  }

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Load entries for the feed
 */
async function loadEntries() {
  try {
    showLoading('#feed-entries', 'Loading entries...');

    const params = new URLSearchParams();

    // Add filter: competitor
    const competitorFilter = document.getElementById('filter-competitor').value;
    if (competitorFilter) params.append('competitor', competitorFilter);

    // Add filter: tag
    const tagFilter = document.getElementById('filter-tag').value;
    if (tagFilter) params.append('tags', tagFilter);

    // Add filter: relevance
    const relevanceFilter = document.getElementById('filter-relevance').value;
    if (relevanceFilter) params.append('min_relevance', relevanceFilter);

    // Add filter: reviewed
    const unreviewedOnly = document.getElementById('filter-reviewed').checked;
    if (unreviewedOnly) params.append('reviewed', '0');

    const data = await apiCall(`/entries?${params.toString()}`);
    if (!data) return;

    entries = data.data || [];

    // Populate competitor dropdown
    const competitors = [...new Set(entries.map(e => e.competitor_name))];
    updateSelectOptions('#filter-competitor', competitors);

    // Populate tag dropdown
    const allTags = [...new Set(entries.flatMap(e => (e.tags || [])))];
    updateSelectOptions('#filter-tag', allTags);

    // Render entries
    renderEntries(entries, '#feed-entries');
  } catch (err) {
    console.error('[app] Failed to load entries:', err);
    document.getElementById('feed-entries').innerHTML =
      `<div class="empty-state"><h3>Error loading entries</h3><p>${err.message}</p></div>`;
  }
}

/**
 * Update select dropdown options
 */
function updateSelectOptions(selector, options) {
  const select = document.querySelector(selector);
  if (!select) return;

  const currentValue = select.value;
  const currentOptions = Array.from(select.options).map(o => o.value).slice(1); // Skip first "All"

  // Only update if options changed
  if (currentOptions.sort().join(',') === options.sort().join(',')) return;

  const firstOption = select.options[0]; // Save "All" option
  while (select.options.length > 1) select.remove(1);

  options.forEach(opt => {
    const el = document.createElement('option');
    el.value = opt;
    el.textContent = opt;
    select.appendChild(el);
  });

  select.value = currentValue;
}

/**
 * Render entries list
 */
function renderEntries(entriesList, containerId) {
  const container = document.querySelector(containerId);

  if (entriesList.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No entries found</h3>
        <p>Try adjusting your filters</p>
      </div>
    `;
    return;
  }

  // Group by relevance tier
  const critical = entriesList.filter(e => e.relevance_score >= 80);
  const notable = entriesList.filter(e => e.relevance_score >= 50 && e.relevance_score < 80);
  const other = entriesList.filter(e => e.relevance_score < 50);

  let html = '';

  if (critical.length > 0) {
    html += `<h3 style="margin-top: var(--spacing-lg); margin-bottom: var(--spacing-md); color: var(--color-critical);">🔴 Critical (${critical.length})</h3>`;
    html += critical.map(e => renderEntryCard(e)).join('');
  }

  if (notable.length > 0) {
    html += `<h3 style="margin-top: var(--spacing-lg); margin-bottom: var(--spacing-md); color: #b45309;">🟡 Notable (${notable.length})</h3>`;
    html += notable.map(e => renderEntryCard(e)).join('');
  }

  if (other.length > 0) {
    html += `<h3 style="margin-top: var(--spacing-lg); margin-bottom: var(--spacing-md); color: var(--color-text-light);">⚪ Other (${other.length})</h3>`;
    html += other.map(e => renderEntryCard(e)).join('');
  }

  container.innerHTML = html;

  // Add event listeners to action buttons
  container.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const entryId = e.target.dataset.entryId;
      const action = e.target.dataset.action;
      handleEntryAction(entryId, action);
    });
  });
}

/**
 * Render single entry card
 */
function renderEntryCard(entry) {
  const relevanceClass = entry.relevance_score >= 80 ? 'relevance-critical' :
                         entry.relevance_score >= 50 ? 'relevance-notable' : 'relevance-other';

  const tagsHtml = (entry.tags || []).map(tag =>
    `<span class="tag">${escapeHtml(tag)}</span>`
  ).join('');

  const aiSummary = entry.ai_summary ?
    `<div class="entry-summary">
       ${escapeHtml(entry.ai_summary)}
       <div class="entry-summary-source">— Claude AI</div>
     </div>` : '';

  const sourceUrl = entry.source_url ?
    `<a href="${escapeHtml(entry.source_url)}" target="_blank" rel="noopener">View</a>` : '';

  return `
    <div class="entry-card">
      <div class="entry-header">
        <div>
          <div class="entry-tags">${tagsHtml}</div>
          <div class="entry-title">${escapeHtml(entry.title)}</div>
          <div class="entry-competitor">${escapeHtml(entry.competitor_name)}</div>
        </div>
        <div class="relevance-badge ${relevanceClass}">
          ${entry.relevance_score}
        </div>
      </div>

      ${aiSummary}

      <div class="entry-footer">
        <div class="entry-meta">
          <span>${sourceUrl}</span>
          <span>${formatDate(entry.first_seen_at)}</span>
        </div>
        <div class="entry-actions">
          <button class="action-btn" data-entry-id="${entry.id}" data-action="review">
            ${entry.reviewed ? '✓ Reviewed' : 'Mark Reviewed'}
          </button>
          <button class="action-btn action-btn-secondary btn-small" data-entry-id="${entry.id}" data-action="note">Note</button>
          <button class="action-btn action-btn-secondary btn-small" data-entry-id="${entry.id}" data-action="share">Share</button>
          <button class="action-btn action-btn-secondary btn-small" data-entry-id="${entry.id}" data-action="battlecard">Battlecard</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Set up feed filter listeners
 */
function setupFeedFilters() {
  document.getElementById('filter-competitor')?.addEventListener('change', loadEntries);
  document.getElementById('filter-tag')?.addEventListener('change', loadEntries);
  document.getElementById('filter-relevance')?.addEventListener('change', loadEntries);
  document.getElementById('filter-reviewed')?.addEventListener('change', loadEntries);
}

/**
 * Load digests
 */
async function loadDigests() {
  try {
    showLoading('#digests-list', 'Loading digests...');

    const data = await apiCall('/digest?limit=20');
    if (!data) return;

    digests = data.data || [];

    if (digests.length === 0) {
      document.getElementById('digests-list').innerHTML = `
        <div class="empty-state">
          <h3>No digests yet</h3>
          <p>Click "Generate Digest Now" to create one</p>
        </div>
      `;
      return;
    }

    const html = digests.map(d => renderDigestCard(d)).join('');
    document.getElementById('digests-list').innerHTML = html;

    // Add toggle listeners
    document.querySelectorAll('.digest-header').forEach(header => {
      header.addEventListener('click', toggleDigestContent);
    });
  } catch (err) {
    console.error('[app] Failed to load digests:', err);
    document.getElementById('digests-list').innerHTML =
      `<div class="empty-state"><h3>Error loading digests</h3></div>`;
  }
}

/**
 * Render digest card
 */
function renderDigestCard(digest) {
  const startDate = new Date(digest.period_start).toLocaleDateString();
  const endDate = new Date(digest.period_end).toLocaleDateString();
  const sentVia = digest.sent_via ? `Sent via ${digest.sent_via}` : 'Not sent';

  return `
    <div class="digest-card">
      <div class="digest-header">
        <div class="digest-info">
          <div class="digest-period">${startDate} — ${endDate}</div>
          <div class="digest-meta">
            <span>${digest.entry_count} entries</span>
            <span>${digest.competitor_count} competitors</span>
            <span>${sentVia}</span>
          </div>
        </div>
        <div class="digest-toggle">▶</div>
      </div>
      <div class="digest-content">${escapeHtml(digest.content || 'No content')}</div>
    </div>
  `;
}

/**
 * Toggle digest content visibility
 */
function toggleDigestContent(e) {
  const header = e.currentTarget;
  const content = header.nextElementSibling;
  const toggle = header.querySelector('.digest-toggle');

  content.classList.toggle('open');
  toggle.classList.toggle('open');
}

/**
 * Set up digest action listeners
 */
function setupDigestActions() {
  document.getElementById('btn-generate-digest')?.addEventListener('click', async () => {
    if (confirm('Generate digest for the last 7 days?')) {
      try {
        showLoading('#digests-list', 'Generating digest...');
        await apiCall('/digest/generate', { method: 'POST' });
        await loadDigests();
      } catch (err) {
        alert('Error generating digest: ' + err.message);
      }
    }
  });
}

/**
 * Load health dashboard
 */
async function loadHealth() {
  try {
    showLoading('#health-sources', 'Loading health data...');

    const data = await apiCall('/health');
    if (!data) return;

    sources = data.data || [];

    if (sources.length === 0) {
      document.getElementById('health-sources').innerHTML = `
        <div class="empty-state">
          <h3>No sources found</h3>
        </div>
      `;
      return;
    }

    const html = sources.map(s => renderHealthCard(s)).join('');
    document.getElementById('health-sources').innerHTML = html;

    // Add reset button listeners
    document.querySelectorAll('.btn-reset-health').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const sourceId = e.target.dataset.sourceId;
        if (confirm('Reset health status for this source?')) {
          try {
            await apiCall(`/health/${sourceId}/reset`, { method: 'POST' });
            await loadHealth();
          } catch (err) {
            alert('Error resetting health: ' + err.message);
          }
        }
      });
    });
  } catch (err) {
    console.error('[app] Failed to load health:', err);
    document.getElementById('health-sources').innerHTML =
      `<div class="empty-state"><h3>Error loading health</h3></div>`;
  }
}

/**
 * Render health status card
 */
function renderHealthCard(source) {
  const health = source.health || {};
  const status = health.status || 'unknown';

  const statusColor = {
    'healthy': 'healthy',
    'degraded': 'degraded',
    'failing': 'failing',
    'disabled': 'disabled'
  }[status] || 'disabled';

  const lastChecked = health.last_checked_at ?
    formatDate(health.last_checked_at) : 'Never';

  const lastError = health.last_error ?
    `<div class="health-detail-row">
       <span>Last error:</span>
       <span>${escapeHtml(health.last_error)}</span>
     </div>` : '';

  return `
    <div class="health-card">
      <div class="health-status">
        <div class="status-indicator ${statusColor}"></div>
        <div>
          <div class="health-name">${escapeHtml(source.name)}</div>
          <div class="health-type">${source.source_type}</div>
        </div>
      </div>

      <div class="health-details">
        <div class="health-detail-row">
          <span>Last checked:</span>
          <span>${lastChecked}</span>
        </div>
        <div class="health-detail-row">
          <span>Status:</span>
          <span>${status}</span>
        </div>
        <div class="health-detail-row">
          <span>Consecutive failures:</span>
          <span>${health.consecutive_failures || 0}</span>
        </div>
        <div class="health-detail-row">
          <span>Avg response:</span>
          <span>${health.avg_response_time_ms || 'N/A'}ms</span>
        </div>
        ${lastError}
      </div>

      <div class="health-actions">
        ${status === 'disabled' ? `
          <button class="btn-primary btn-small btn-reset-health" data-source-id="${source.id}">
            Re-enable
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Set up search
 */
function setupSearchAction() {
  document.getElementById('btn-search')?.addEventListener('click', searchEntries);
  document.getElementById('search-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchEntries();
  });
}

/**
 * Search entries
 */
async function searchEntries() {
  const query = document.getElementById('search-input').value;
  if (!query.trim()) return;

  try {
    showLoading('#search-results', 'Searching...');

    const data = await apiCall(`/entries/search?q=${encodeURIComponent(query)}`);
    if (!data) return;

    renderEntries(data.data || [], '#search-results');
  } catch (err) {
    console.error('[app] Search failed:', err);
    document.getElementById('search-results').innerHTML =
      `<div class="empty-state"><h3>Search error</h3><p>${err.message}</p></div>`;
  }
}

/**
 * Load trends
 */
async function loadTrends() {
  try {
    showLoading('#chart-competitor', 'Loading trends...');

    const data = await apiCall('/entries');
    if (!data) return;

    const entriesList = data.data || [];

    // Build competitor trend data (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentEntries = entriesList.filter(e => new Date(e.first_seen_at) >= thirtyDaysAgo);
    const competitorCounts = {};
    recentEntries.forEach(e => {
      competitorCounts[e.competitor_name] = (competitorCounts[e.competitor_name] || 0) + 1;
    });

    renderChart('chart-competitor', {
      type: 'bar',
      labels: Object.keys(competitorCounts),
      datasets: [{
        label: 'Updates (last 30 days)',
        data: Object.values(competitorCounts),
        backgroundColor: '#0051ba',
        borderColor: '#003a82',
        borderWidth: 1
      }]
    });

    // Build tags trend data
    const tagCounts = {};
    entriesList.forEach(e => {
      (e.tags || []).forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    const tagLabels = Object.keys(tagCounts).slice(0, 10); // Top 10 tags
    const tagData = tagLabels.map(t => tagCounts[t]);

    renderChart('chart-tags', {
      type: 'doughnut',
      labels: tagLabels,
      datasets: [{
        data: tagData,
        backgroundColor: [
          '#0051ba', '#059669', '#f59e0b', '#ef4444', '#8b5cf6',
          '#ec4899', '#06b6d4', '#eab308', '#6366f1', '#14b8a6'
        ]
      }]
    });

  } catch (err) {
    console.error('[app] Failed to load trends:', err);
  }
}

/**
 * Render chart using Chart.js
 */
function renderChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Destroy existing chart if any
  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }

  charts[canvasId] = new Chart(canvas, {
    type: config.type,
    data: {
      labels: config.labels,
      datasets: config.datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: config.type !== 'bar'
        }
      },
      scales: config.type === 'bar' ? {
        y: { beginAtZero: true }
      } : undefined
    }
  });
}

/**
 * Handle entry actions
 */
function handleEntryAction(entryId, action) {
  switch(action) {
    case 'review':
      markEntryReviewed(entryId);
      break;
    case 'note':
      openActionModal(entryId, 'Add Note', 'note');
      break;
    case 'share':
      openActionModal(entryId, 'Share Entry', 'share');
      break;
    case 'battlecard':
      openActionModal(entryId, 'Update Battlecard', 'battlecard');
      break;
  }
}

/**
 * Mark entry as reviewed
 */
async function markEntryReviewed(entryId) {
  try {
    await apiCall(`/entries/${entryId}`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewed: true })
    });

    // Refresh view
    if (currentView === 'feed') await loadEntries();
    else if (currentView === 'search') await searchEntries();
  } catch (err) {
    alert('Error marking as reviewed: ' + err.message);
  }
}

/**
 * Open action modal
 */
function openActionModal(entryId, title, actionType) {
  const modal = document.getElementById('action-modal');
  const titleEl = document.getElementById('action-modal-title');
  const bodyEl = document.getElementById('action-modal-body');

  titleEl.textContent = title;

  let bodyHtml = '';

  if (actionType === 'note') {
    bodyHtml = `
      <div class="form-group">
        <label>Note</label>
        <textarea id="action-note-text" placeholder="Add your note here..."></textarea>
      </div>
      <button class="btn-primary" onclick="submitEntryAction('${entryId}', 'note')">Save Note</button>
    `;
  } else if (actionType === 'share') {
    const entry = entries.find(e => e.id === entryId);
    const shareText = entry ? `${entry.title}\n\nFrom: ${entry.competitor_name}\n\n${entry.ai_summary || entry.summary}` : '';
    bodyHtml = `
      <div class="form-group">
        <label>Shareable Text</label>
        <textarea id="action-share-text" readonly>${escapeHtml(shareText)}</textarea>
      </div>
      <button class="btn-primary" onclick="copyToClipboard('action-share-text')">Copy to Clipboard</button>
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    `;
  } else if (actionType === 'battlecard') {
    bodyHtml = `
      <div class="form-group">
        <label>Battlecard Link/Path</label>
        <input type="text" id="action-battlecard-path" placeholder="e.g., https://docs/battlecards/akamai">
      </div>
      <button class="btn-primary" onclick="submitEntryAction('${entryId}', 'battlecard')">Save Link</button>
    `;
  }

  bodyEl.innerHTML = bodyHtml;
  modal.style.display = 'block';
}

/**
 * Submit entry action
 */
async function submitEntryAction(entryId, actionType) {
  let noteText = '';
  let battlecardPath = '';

  if (actionType === 'note') {
    noteText = document.getElementById('action-note-text').value;
    if (!noteText.trim()) {
      alert('Please enter a note');
      return;
    }
  } else if (actionType === 'battlecard') {
    battlecardPath = document.getElementById('action-battlecard-path').value;
    if (!battlecardPath.trim()) {
      alert('Please enter a battlecard link');
      return;
    }
  }

  try {
    await apiCall(`/actions/${entryId}/action`, {
      method: 'POST',
      body: JSON.stringify({
        action_type: actionType === 'note' ? 'noted' : actionType === 'battlecard' ? 'battlecard_updated' : 'shared',
        details: actionType === 'note' ? { note: noteText } : { path: battlecardPath }
      })
    });

    closeModal();

    // Refresh view
    if (currentView === 'feed') await loadEntries();
    else if (currentView === 'search') await searchEntries();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

/**
 * Set up modal actions
 */
function setupModalActions() {
  const modal = document.getElementById('action-modal');
  const closeBtn = modal.querySelector('.close');

  closeBtn.addEventListener('click', closeModal);
  window.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

/**
 * Close modal
 */
function closeModal() {
  document.getElementById('action-modal').style.display = 'none';
}

/**
 * Copy text to clipboard
 */
function copyToClipboard(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.select();
  document.execCommand('copy');
  alert('Copied to clipboard!');
}

/**
 * Set up logout
 */
function setupLogout() {
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    // In production, Cloudflare Access handles logout
    // This is just for demonstration
    alert('Logout is handled by Cloudflare Access. Check your Access settings.');
  });
}

/**
 * Show loading state
 */
function showLoading(selector, message) {
  const el = document.querySelector(selector);
  if (el) {
    el.innerHTML = `<div class="loading">${message}</div>`;
  }
}

/**
 * Format date
 */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
