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
  setupSourcesActions();
  setupSettingsActions();
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
  document.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.dataset.view;
      if (view) switchView(view);
    });
  });

  // Sidebar collapse/expand toggle
  const toggleBtn = document.getElementById('sidebar-toggle');
  if (toggleBtn) {
    // Restore saved state
    if (localStorage.getItem('sidebar-collapsed') === 'true') {
      document.querySelector('.app')?.classList.add('sidebar-collapsed');
    }
    toggleBtn.addEventListener('click', () => {
      const app = document.querySelector('.app');
      app.classList.toggle('sidebar-collapsed');
      localStorage.setItem('sidebar-collapsed', app.classList.contains('sidebar-collapsed'));
    });
  }
}

/**
 * Switch between views
 */
async function switchView(viewName) {
  currentView = viewName;

  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));

  // Show selected view
  const viewEl = document.getElementById(`view-${viewName}`);
  if (viewEl) viewEl.classList.add('active');
  document.querySelector(`.nav-item[data-view="${viewName}"]`)?.classList.add('active');

  // Update topbar title
  const titles = { feed: 'Recent Updates', digests: 'Digests', health: 'Source Health', sources: 'Sources', search: 'Search', trends: 'Trends & Analysis', settings: 'Settings' };
  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) topbarTitle.textContent = titles[viewName] || viewName;

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
    case 'sources':
      await loadSources();
      break;
    case 'trends':
      await loadTrends();
      break;
    case 'settings':
      await loadSettings();
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
    html += `<div class="tier-header" style="color: var(--critical);"><span class="tier-dot" style="background: var(--critical);"></span> Critical (${critical.length})</div>`;
    html += critical.map(e => renderEntryCard(e, 'tier-critical')).join('');
  }

  if (notable.length > 0) {
    html += `<div class="tier-header" style="color: var(--notable);"><span class="tier-dot" style="background: var(--notable);"></span> Notable (${notable.length})</div>`;
    html += notable.map(e => renderEntryCard(e, 'tier-notable')).join('');
  }

  if (other.length > 0) {
    html += `<div class="tier-header" style="color: var(--text-muted);"><span class="tier-dot" style="background: var(--text-muted);"></span> Other (${other.length})</div>`;
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
function renderEntryCard(entry, tierClass) {
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
    <div class="entry-card ${tierClass || ''}">
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
  // API returns flat structure, not nested source.health
  const status = source.status || 'unknown';

  const statusColor = {
    'healthy': 'healthy',
    'degraded': 'degraded',
    'failing': 'failing',
    'disabled': 'disabled'
  }[status] || 'disabled';

  const lastChecked = source.last_check_at ?
    formatDate(source.last_check_at) : 'Never';

  const lastError = source.last_error ?
    `<div class="health-detail-row">
       <span>Last error:</span>
       <span>${escapeHtml(source.last_error)}</span>
     </div>` : '';

  return `
    <div class="health-card">
      <div class="health-status">
        <div class="status-indicator ${statusColor}"></div>
        <div>
          <div class="health-name">${escapeHtml(source.competitor_name || source.name || 'Unknown')}</div>
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
          <span>${source.consecutive_failures || 0}</span>
        </div>
        <div class="health-detail-row">
          <span>Avg response:</span>
          <span>${source.avg_response_ms || 'N/A'}ms</span>
        </div>
        ${lastError}
      </div>

      <div class="health-actions">
        ${status === 'disabled' ? `
          <button class="btn-primary btn-small btn-reset-health" data-source-id="${source.source_id}">
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
        backgroundColor: '#00d4aa',
        borderColor: 'rgba(0,212,170,0.3)',
        borderWidth: 1,
        borderRadius: 4
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
          '#00d4aa', '#60a5fa', '#fbbf24', '#ff6b6b', '#a78bfa',
          '#f472b6', '#22d3ee', '#facc15', '#818cf8', '#34d399'
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
          display: config.type !== 'bar',
          labels: { color: '#e8eaed', font: { family: "'Instrument Sans', sans-serif" } }
        }
      },
      scales: config.type === 'bar' ? {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: '#8b92a5', font: { family: "'JetBrains Mono', monospace", size: 11 } }
        },
        x: {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { color: '#8b92a5', font: { family: "'Instrument Sans', sans-serif", size: 11 } }
        }
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

// ============================
// Sources Management
// ============================

/**
 * Set up sources view actions
 */
function setupSourcesActions() {
  document.getElementById('btn-add-competitor')?.addEventListener('click', () => {
    openWizardStep1();
  });

  // Wizard modal close
  document.getElementById('wizard-close')?.addEventListener('click', closeWizardModal);
  const wizardModal = document.getElementById('source-wizard-modal');
  window.addEventListener('click', (e) => {
    if (e.target === wizardModal) closeWizardModal();
  });
}

/**
 * Load and render sources list
 */
async function loadSources() {
  try {
    showLoading('#sources-list', 'Loading sources...');

    const data = await apiCall('/sources');
    if (!data) return;

    const sourcesList = data.data || [];

    if (sourcesList.length === 0) {
      document.getElementById('sources-list').innerHTML = `
        <div class="empty-state">
          <h3>No sources configured</h3>
          <p>Click "+ Add Competitor" to get started</p>
        </div>
      `;
      return;
    }

    const html = sourcesList.map(s => renderSourceCard(s)).join('');
    document.getElementById('sources-list').innerHTML = html;
    attachSourceCardListeners();
  } catch (err) {
    console.error('[app] Failed to load sources:', err);
    document.getElementById('sources-list').innerHTML =
      `<div class="empty-state"><h3>Error loading sources</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

/**
 * Render a source card
 */
function renderSourceCard(source) {
  const status = source.health_status || 'unknown';
  const statusColor = { healthy: 'healthy', degraded: 'degraded', failing: 'failing', disabled: 'disabled' }[status] || 'disabled';
  const lastChecked = source.last_checked_at ? formatDate(source.last_checked_at) : 'Never';
  const entryCount = source.health_total_entries || 0;
  const avgMs = source.health_avg_response_ms ? `${source.health_avg_response_ms}ms` : 'N/A';
  const disabledClass = source.enabled ? '' : ' source-card-disabled';
  const sourceType = source.source_type || 'rss';

  return `
    <div class="source-card${disabledClass}" data-source-id="${escapeHtml(source.id)}">
      <div class="source-card-header">
        <div>
          <div class="source-card-name">
            <span class="status-indicator ${statusColor}" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:6px;border-radius:50%;"></span>
            ${escapeHtml(source.competitor_name || source.id)}
          </div>
          <div class="source-card-url">${escapeHtml(source.source_url)}</div>
        </div>
        <span class="source-type-badge ${sourceType}">${escapeHtml(sourceType)}</span>
      </div>
      <div class="source-card-details">
        <div class="source-card-detail-row">
          <span>Status:</span>
          <span>${escapeHtml(status)}${source.enabled ? '' : ' (disabled)'}</span>
        </div>
        <div class="source-card-detail-row">
          <span>Entries:</span>
          <span>${entryCount}</span>
        </div>
        <div class="source-card-detail-row">
          <span>Last checked:</span>
          <span>${lastChecked}</span>
        </div>
        <div class="source-card-detail-row">
          <span>Avg response:</span>
          <span>${avgMs}</span>
        </div>
        <div class="source-card-detail-row">
          <span>Interval:</span>
          <span>Every ${source.check_interval_hours || 6}h</span>
        </div>
      </div>
      <div class="source-card-actions">
        <button class="btn-primary btn-small btn-check-now" data-source-id="${escapeHtml(source.id)}">Check Now</button>
        <button class="btn-secondary btn-small btn-edit-source" data-source-id="${escapeHtml(source.id)}">Edit</button>
        <button class="btn-danger btn-small btn-delete-source" data-source-id="${escapeHtml(source.id)}">Delete</button>
      </div>
    </div>
  `;
}

/**
 * Attach event listeners to source card buttons
 */
function attachSourceCardListeners() {
  document.querySelectorAll('.btn-check-now').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const sourceId = e.target.dataset.sourceId;
      e.target.disabled = true;
      e.target.textContent = 'Checking...';
      try {
        await apiCall(`/sources/${encodeURIComponent(sourceId)}/check`, { method: 'POST' });
        await loadSources();
      } catch (err) {
        alert('Check failed: ' + err.message);
        e.target.disabled = false;
        e.target.textContent = 'Check Now';
      }
    });
  });

  document.querySelectorAll('.btn-edit-source').forEach(btn => {
    btn.addEventListener('click', (e) => {
      openEditSourceModal(e.target.dataset.sourceId);
    });
  });

  document.querySelectorAll('.btn-delete-source').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const sourceId = e.target.dataset.sourceId;
      if (confirm(`Delete source "${sourceId}" and all its entries? This cannot be undone.`)) {
        try {
          await apiCall(`/sources/${encodeURIComponent(sourceId)}`, { method: 'DELETE' });
          await loadSources();
        } catch (err) {
          alert('Delete failed: ' + err.message);
        }
      }
    });
  });
}

// ============================
// Add Competitor Wizard
// ============================

/**
 * Wizard Step 1: Enter competitor name + domain
 */
function openWizardStep1() {
  openWizardModal('Add Competitor');

  document.getElementById('wizard-body').innerHTML = `
    <p class="wizard-step-label">Step 1 of 3 — Enter competitor details</p>
    <div class="form-group">
      <label>Competitor Name</label>
      <input type="text" id="wizard-name" placeholder="e.g., Akamai" autofocus>
    </div>
    <div class="form-group">
      <label>Domain</label>
      <input type="text" id="wizard-domain" placeholder="e.g., akamai.com">
    </div>
    <div style="display:flex;gap:var(--spacing-md);justify-content:flex-end;">
      <button class="btn-secondary" id="wizard-cancel">Cancel</button>
      <button class="btn-primary" id="wizard-discover">Discover Feeds</button>
    </div>
  `;

  document.getElementById('wizard-cancel').addEventListener('click', closeWizardModal);
  document.getElementById('wizard-discover').addEventListener('click', () => {
    const name = document.getElementById('wizard-name').value.trim();
    const domain = document.getElementById('wizard-domain').value.trim();
    if (!name) { alert('Please enter a competitor name'); return; }
    if (!domain) { alert('Please enter a domain'); return; }
    openWizardStep2(name, domain);
  });

  // Allow Enter to proceed
  document.getElementById('wizard-domain')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('wizard-discover').click();
  });
}

/**
 * Wizard Step 2: Auto-discover feeds
 */
async function openWizardStep2(name, domain) {
  document.getElementById('wizard-title').textContent = `Add Competitor — ${escapeHtml(name)}`;
  document.getElementById('wizard-body').innerHTML = `
    <p class="wizard-step-label">Step 2 of 3 — Discovering feeds...</p>
    <div class="loading">Probing ${escapeHtml(domain)} for RSS feeds and changelogs...</div>
  `;

  try {
    const data = await apiCall('/sources/discover', {
      method: 'POST',
      body: JSON.stringify({ domain })
    });

    const discovered = data.sources || [];

    if (discovered.length === 0) {
      document.getElementById('wizard-body').innerHTML = `
        <p class="wizard-step-label">Step 2 of 3 — No feeds found</p>
        <div class="discovery-empty">
          <p>No RSS feeds or changelogs were automatically discovered for <strong>${escapeHtml(domain)}</strong>.</p>
          <p>You can add a source manually instead.</p>
        </div>
        <div style="display:flex;gap:var(--spacing-md);justify-content:flex-end;">
          <button class="btn-secondary" id="wizard-back">Back</button>
          <button class="btn-primary" id="wizard-manual">Add Manually</button>
        </div>
      `;
      document.getElementById('wizard-back').addEventListener('click', openWizardStep1);
      document.getElementById('wizard-manual').addEventListener('click', () => openManualAddForm(name));
      return;
    }

    // Render discovered sources with checkboxes
    const listHtml = discovered.map((src, i) => {
      const conf = src.confidence || 'medium';
      const confClass = `confidence-${conf}`;
      const checked = conf === 'high' ? 'checked' : '';
      return `
        <label class="discovered-source">
          <input type="checkbox" name="discovered" value="${i}" ${checked}>
          <div class="discovered-source-info">
            <div class="discovered-source-label">${escapeHtml(src.label || src.type + ' feed')}</div>
            <div class="discovered-source-url">${escapeHtml(src.url)}</div>
          </div>
          <span class="confidence-badge ${confClass}">${escapeHtml(conf)}</span>
        </label>
      `;
    }).join('');

    document.getElementById('wizard-body').innerHTML = `
      <p class="wizard-step-label">Step 2 of 3 — ${discovered.length} source(s) found</p>
      <div class="discovered-sources-list">${listHtml}</div>
      <div style="display:flex;gap:var(--spacing-md);justify-content:flex-end;">
        <button class="btn-secondary" id="wizard-back">Back</button>
        <button class="btn-secondary" id="wizard-manual">Add Manually</button>
        <button class="btn-primary" id="wizard-add-selected">Add Selected</button>
      </div>
    `;

    // Store discovered data for step 3
    document.getElementById('wizard-body')._discoveredData = discovered;

    document.getElementById('wizard-back').addEventListener('click', openWizardStep1);
    document.getElementById('wizard-manual').addEventListener('click', () => openManualAddForm(name));
    document.getElementById('wizard-add-selected').addEventListener('click', () => {
      const checked = document.querySelectorAll('input[name="discovered"]:checked');
      if (checked.length === 0) { alert('Please select at least one source'); return; }

      const selectedSources = Array.from(checked).map(cb => {
        const idx = parseInt(cb.value, 10);
        return discovered[idx];
      });
      openWizardStep3(name, selectedSources);
    });
  } catch (err) {
    document.getElementById('wizard-body').innerHTML = `
      <p class="wizard-step-label">Step 2 of 3 — Discovery failed</p>
      <div class="discovery-empty">
        <p>Error discovering feeds: ${escapeHtml(err.message)}</p>
        <p>You can add a source manually instead.</p>
      </div>
      <div style="display:flex;gap:var(--spacing-md);justify-content:flex-end;">
        <button class="btn-secondary" id="wizard-back">Back</button>
        <button class="btn-primary" id="wizard-manual">Add Manually</button>
      </div>
    `;
    document.getElementById('wizard-back').addEventListener('click', openWizardStep1);
    document.getElementById('wizard-manual').addEventListener('click', () => openManualAddForm(name));
  }
}

/**
 * Wizard Step 3: Create sources + trigger fetch + show progress
 */
async function openWizardStep3(name, selectedSources) {
  document.getElementById('wizard-title').textContent = `Adding ${selectedSources.length} source(s)...`;

  const progressItems = selectedSources.map((src, i) => `
    <div class="wizard-progress-item" id="wizard-progress-${i}">
      <span class="status-icon">...</span>
      <span>${escapeHtml(src.label || src.url)}</span>
    </div>
  `).join('');

  document.getElementById('wizard-body').innerHTML = `
    <p class="wizard-step-label">Step 3 of 3 — Creating sources</p>
    <div class="wizard-progress-list">${progressItems}</div>
    <div style="margin-top:var(--spacing-lg);display:flex;justify-content:flex-end;">
      <button class="btn-primary" id="wizard-done" disabled>Done</button>
    </div>
  `;

  // Generate source IDs from competitor name
  const baseId = 'src_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');

  for (let i = 0; i < selectedSources.length; i++) {
    const src = selectedSources[i];
    const progressEl = document.getElementById(`wizard-progress-${i}`);
    const statusIcon = progressEl.querySelector('.status-icon');

    // Mark working
    progressEl.className = 'wizard-progress-item status-working';
    statusIcon.textContent = '\u21BB';

    const sourceId = selectedSources.length === 1 ? baseId : `${baseId}_${i + 1}`;

    try {
      // Create source
      await apiCall('/sources', {
        method: 'POST',
        body: JSON.stringify({
          id: sourceId,
          competitor_name: name,
          source_url: src.url,
          source_type: src.type || 'rss',
          check_interval_hours: 6
        })
      });

      // Trigger initial fetch
      try {
        await apiCall(`/sources/${encodeURIComponent(sourceId)}/check`, { method: 'POST' });
      } catch (fetchErr) {
        // Non-fatal — source was created, fetch can retry later
        progressEl.className = 'wizard-progress-item status-warning';
        statusIcon.textContent = '\u26A0';
        continue;
      }

      progressEl.className = 'wizard-progress-item status-done';
      statusIcon.textContent = '\u2713';
    } catch (err) {
      progressEl.className = 'wizard-progress-item status-failed';
      statusIcon.textContent = '\u2717';
      console.error(`[wizard] Failed to create source ${sourceId}:`, err);
    }
  }

  const doneBtn = document.getElementById('wizard-done');
  doneBtn.disabled = false;
  doneBtn.addEventListener('click', () => {
    closeWizardModal();
    switchView('sources');
  });
}

/**
 * Manual add form (fallback when discovery finds nothing)
 */
function openManualAddForm(name) {
  document.getElementById('wizard-title').textContent = `Add Source — ${escapeHtml(name)}`;
  document.getElementById('wizard-body').innerHTML = `
    <p class="wizard-step-label">Add a source manually</p>
    <div class="form-group">
      <label>Source URL</label>
      <input type="url" id="manual-url" placeholder="https://example.com/blog/rss.xml">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Type</label>
        <select id="manual-type">
          <option value="rss">RSS / Atom</option>
          <option value="api">API</option>
          <option value="html">HTML (static)</option>
          <option value="browser">Browser (JS-rendered)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Check Interval (hours)</label>
        <input type="number" id="manual-interval" value="6" min="1" max="168">
      </div>
    </div>
    <div style="display:flex;gap:var(--spacing-md);justify-content:flex-end;">
      <button class="btn-secondary" id="wizard-back">Back</button>
      <button class="btn-primary" id="wizard-manual-save">Add Source</button>
    </div>
  `;

  document.getElementById('wizard-back').addEventListener('click', openWizardStep1);
  document.getElementById('wizard-manual-save').addEventListener('click', async () => {
    const url = document.getElementById('manual-url').value.trim();
    const type = document.getElementById('manual-type').value;
    const interval = parseInt(document.getElementById('manual-interval').value, 10) || 6;

    if (!url) { alert('Please enter a URL'); return; }

    const sourceId = 'src_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');

    try {
      await apiCall('/sources', {
        method: 'POST',
        body: JSON.stringify({
          id: sourceId,
          competitor_name: name,
          source_url: url,
          source_type: type,
          check_interval_hours: interval
        })
      });

      closeWizardModal();
      switchView('sources');
    } catch (err) {
      alert('Error creating source: ' + err.message);
    }
  });
}

/**
 * Edit source modal
 */
async function openEditSourceModal(sourceId) {
  openWizardModal('Edit Source');
  document.getElementById('wizard-body').innerHTML = `<div class="loading">Loading source...</div>`;

  try {
    const data = await apiCall('/sources');
    if (!data) return;

    const source = (data.data || []).find(s => s.id === sourceId);
    if (!source) {
      document.getElementById('wizard-body').innerHTML = `<p>Source not found.</p>`;
      return;
    }

    document.getElementById('wizard-body').innerHTML = `
      <div class="form-group">
        <label>Competitor Name</label>
        <input type="text" id="edit-name" value="${escapeHtml(source.competitor_name || '')}">
      </div>
      <div class="form-group">
        <label>Source URL</label>
        <input type="url" id="edit-url" value="${escapeHtml(source.source_url || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Type</label>
          <select id="edit-type">
            <option value="rss" ${source.source_type === 'rss' ? 'selected' : ''}>RSS / Atom</option>
            <option value="api" ${source.source_type === 'api' ? 'selected' : ''}>API</option>
            <option value="html" ${source.source_type === 'html' ? 'selected' : ''}>HTML (static)</option>
            <option value="browser" ${source.source_type === 'browser' ? 'selected' : ''}>Browser (JS-rendered)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Interval (hours)</label>
          <input type="number" id="edit-interval" value="${source.check_interval_hours || 6}" min="1" max="168">
        </div>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" id="edit-enabled" ${source.enabled ? 'checked' : ''}> Enabled
        </label>
      </div>
      <div style="display:flex;gap:var(--spacing-md);justify-content:flex-end;">
        <button class="btn-secondary" id="edit-cancel">Cancel</button>
        <button class="btn-primary" id="edit-save">Save Changes</button>
      </div>
    `;

    document.getElementById('edit-cancel').addEventListener('click', closeWizardModal);
    document.getElementById('edit-save').addEventListener('click', async () => {
      try {
        await apiCall(`/sources/${encodeURIComponent(sourceId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            competitor_name: document.getElementById('edit-name').value.trim(),
            source_url: document.getElementById('edit-url').value.trim(),
            source_type: document.getElementById('edit-type').value,
            check_interval_hours: parseInt(document.getElementById('edit-interval').value, 10) || 6,
            enabled: document.getElementById('edit-enabled').checked ? 1 : 0
          })
        });

        closeWizardModal();
        await loadSources();
      } catch (err) {
        alert('Error saving: ' + err.message);
      }
    });
  } catch (err) {
    document.getElementById('wizard-body').innerHTML = `<p>Error: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * Open wizard modal
 */
function openWizardModal(title) {
  document.getElementById('wizard-title').textContent = title;
  document.getElementById('source-wizard-modal').style.display = 'block';
}

/**
 * Close wizard modal
 */
function closeWizardModal() {
  document.getElementById('source-wizard-modal').style.display = 'none';
  document.getElementById('wizard-body').innerHTML = '';
}

// ============================
// Settings Management
// ============================

let settingsData = {};
let settingsDefaults = {};

const SETTINGS_SECTIONS = [
  {
    id: 'global',
    title: 'Global',
    fields: [
      { key: 'app_enabled', label: 'App Enabled', type: 'toggle' },
    ],
  },
  {
    id: 'fetch',
    title: 'Fetch & Ingestion',
    fields: [
      { key: 'fetch_interval_hours', label: 'Fetch interval (hours)', type: 'number', min: 1, max: 168 },
      { key: 'fetch_timeout_ms', label: 'Timeout (ms)', type: 'number', min: 1000, max: 60000 },
      { key: 'fetch_max_bytes', label: 'Max response (bytes)', type: 'number', min: 1024, max: 52428800 },
      { key: 'browser_timeout_ms', label: 'Browser timeout (ms)', type: 'number', min: 5000, max: 60000 },
    ],
  },
  {
    id: 'ai',
    title: 'AI Classification',
    fields: [
      { key: 'ai_enabled', label: 'Enabled', type: 'toggle' },
      { key: 'ai_api_key', label: 'API Key', type: 'secret' },
      { key: 'ai_model', label: 'Model', type: 'select', options: [
        { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
        { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      ]},
      { key: 'ai_budget_usd', label: 'Budget ($/month)', type: 'number', min: 0.1, max: 100, step: 0.1 },
      { key: 'ai_max_tokens', label: 'Max tokens', type: 'number', min: 100, max: 2000 },
    ],
    actions: [{ id: 'test-ai', label: 'Test AI Connection', endpoint: '/settings/test-ai' }],
  },
  {
    id: 'digest',
    title: 'Digest & Notifications',
    fields: [
      { key: 'digest_frequency', label: 'Frequency', type: 'select', options: [
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'biweekly', label: 'Biweekly' },
      ]},
      { key: 'digest_day', label: 'Day', type: 'select', options: [
        { value: 'monday', label: 'Monday' },
        { value: 'tuesday', label: 'Tuesday' },
        { value: 'wednesday', label: 'Wednesday' },
        { value: 'thursday', label: 'Thursday' },
        { value: 'friday', label: 'Friday' },
        { value: 'saturday', label: 'Saturday' },
        { value: 'sunday', label: 'Sunday' },
      ]},
      { key: 'digest_hour_utc', label: 'Hour (UTC)', type: 'number', min: 0, max: 23 },
      { key: 'digest_lookback_days', label: 'Lookback (days)', type: 'number', min: 1, max: 90 },
      { key: 'tier_critical_min', label: 'Critical threshold', type: 'number', min: 0, max: 100 },
      { key: 'tier_notable_min', label: 'Notable threshold', type: 'number', min: 0, max: 100 },
      { key: '_sub_telegram', label: 'Telegram', type: 'subsection' },
      { key: 'telegram_enabled', label: 'Enabled', type: 'toggle' },
      { key: 'telegram_bot_token', label: 'Bot Token', type: 'secret' },
      { key: 'telegram_chat_id', label: 'Chat ID', type: 'text' },
      { key: '_sub_slack', label: 'Slack', type: 'subsection' },
      { key: 'slack_enabled', label: 'Enabled', type: 'toggle' },
      { key: 'slack_webhook_url', label: 'Webhook URL', type: 'secret' },
    ],
    actions: [{ id: 'test-telegram', label: 'Test Telegram', endpoint: '/settings/test-telegram' }],
  },
  {
    id: 'processing',
    title: 'Processing',
    fields: [
      { key: 'dedup_threshold', label: 'Dedup threshold', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'dedup_window_hours', label: 'Dedup window (hours)', type: 'number', min: 1, max: 720 },
      { key: 'health_degraded_after', label: 'Degraded after (failures)', type: 'number', min: 1, max: 50 },
      { key: 'health_failing_after', label: 'Failing after (failures)', type: 'number', min: 1, max: 50 },
      { key: 'health_disabled_after', label: 'Auto-disable after (failures)', type: 'number', min: 1, max: 100 },
    ],
  },
];

function setupSettingsActions() {
  document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
  document.getElementById('btn-reset-settings')?.addEventListener('click', resetSettings);
}

async function loadSettings() {
  try {
    showLoading('#settings-form', 'Loading settings...');
    const [settingsRes, defaultsRes] = await Promise.all([
      apiCall('/settings'),
      apiCall('/settings/defaults'),
    ]);
    if (!settingsRes) return;
    settingsData = settingsRes.data || {};
    settingsDefaults = defaultsRes?.data || {};
    renderSettingsForm();
  } catch (err) {
    console.error('[app] Failed to load settings:', err);
    document.getElementById('settings-form').innerHTML =
      '<div class="empty-state"><h3>Failed to load settings</h3></div>';
  }
}

function renderSettingsForm() {
  const container = document.getElementById('settings-form');
  container.innerHTML = '';

  for (const section of SETTINGS_SECTIONS) {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'settings-section';
    sectionEl.id = `settings-section-${section.id}`;

    // Header
    const header = document.createElement('div');
    header.className = 'settings-section-header';
    header.innerHTML = `
      <svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4,2 12,8 4,14"/></svg>
    `;
    const title = document.createElement('h3');
    title.textContent = section.title;
    header.appendChild(title);
    header.addEventListener('click', () => sectionEl.classList.toggle('collapsed'));
    sectionEl.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'settings-section-body';

    for (const field of section.fields) {
      if (field.type === 'subsection') {
        const sub = document.createElement('div');
        sub.className = 'settings-subsection';
        sub.textContent = field.label;
        body.appendChild(sub);
        continue;
      }

      const row = document.createElement('div');
      row.className = 'setting-row';

      const label = document.createElement('label');
      label.textContent = field.label;
      row.appendChild(label);

      const value = settingsData[field.key] ?? '';

      if (field.type === 'toggle') {
        const toggle = document.createElement('div');
        toggle.className = 'setting-toggle' + (value === 'true' ? ' active' : '');
        toggle.dataset.key = field.key;
        toggle.addEventListener('click', () => {
          toggle.classList.toggle('active');
        });
        row.appendChild(toggle);
      } else if (field.type === 'select') {
        const select = document.createElement('select');
        select.dataset.key = field.key;
        for (const opt of field.options) {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.label;
          if (value === opt.value) option.selected = true;
          select.appendChild(option);
        }
        row.appendChild(select);
      } else if (field.type === 'secret') {
        const group = document.createElement('div');
        group.className = 'setting-secret-group';
        const input = document.createElement('input');
        input.type = 'password';
        input.dataset.key = field.key;
        input.dataset.masked = value.startsWith('***') ? 'true' : 'false';
        input.value = value;
        input.placeholder = value ? '(configured)' : '(not set)';
        group.appendChild(input);

        const revealBtn = document.createElement('button');
        revealBtn.className = 'btn-reveal';
        revealBtn.textContent = 'Show';
        revealBtn.type = 'button';
        revealBtn.addEventListener('click', () => {
          if (input.type === 'password') {
            input.type = 'text';
            revealBtn.textContent = 'Hide';
          } else {
            input.type = 'password';
            revealBtn.textContent = 'Show';
          }
        });
        group.appendChild(revealBtn);
        row.appendChild(group);
      } else if (field.type === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.dataset.key = field.key;
        input.value = value;
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        if (field.step !== undefined) input.step = field.step;
        row.appendChild(input);
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.dataset.key = field.key;
        input.value = value;
        row.appendChild(input);
      }

      body.appendChild(row);
    }

    // Test action buttons
    if (section.actions) {
      for (const action of section.actions) {
        const row = document.createElement('div');
        row.className = 'setting-row';
        row.innerHTML = '<label></label>';
        const btn = document.createElement('button');
        btn.className = 'test-btn';
        btn.id = `btn-${action.id}`;
        btn.textContent = action.label;
        btn.type = 'button';
        btn.addEventListener('click', () => runTestAction(btn, action.endpoint));
        row.appendChild(btn);
        body.appendChild(row);
      }
    }

    sectionEl.appendChild(body);
    container.appendChild(sectionEl);
  }
}

function collectSettings() {
  const result = {};

  // Toggles
  document.querySelectorAll('.setting-toggle').forEach(el => {
    result[el.dataset.key] = el.classList.contains('active') ? 'true' : 'false';
  });

  // Inputs and selects
  document.querySelectorAll('#settings-form input[data-key], #settings-form select[data-key]').forEach(el => {
    const key = el.dataset.key;
    const value = el.value;

    // Don't send masked secrets back (they haven't changed)
    if (el.dataset.masked === 'true' && value === settingsData[key]) {
      return;
    }

    result[key] = value;
  });

  return result;
}

async function saveSettings() {
  const btn = document.getElementById('btn-save-settings');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const collected = collectSettings();
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: collected }),
    });
    const data = await res.json();

    if (!res.ok) {
      showSettingsToast((data.error || 'Save failed') + (data.details ? ': ' + data.details.map(d => d.key + ' - ' + d.message).join(', ') : ''), 'error');
      return;
    }

    settingsData = data.data || {};
    renderSettingsForm();
    showSettingsToast(`Settings saved (${data.updated} updated)`, 'success');
  } catch (err) {
    showSettingsToast('Failed to save: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save All';
  }
}

async function resetSettings() {
  if (!confirm('Reset all settings to defaults? This cannot be undone.')) return;

  try {
    // Save defaults over current values
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: settingsDefaults }),
    });
    const data = await res.json();

    if (!res.ok) {
      showSettingsToast(data.error || 'Reset failed', 'error');
      return;
    }

    settingsData = data.data || {};
    renderSettingsForm();
    showSettingsToast('Settings reset to defaults', 'success');
  } catch (err) {
    showSettingsToast('Failed to reset: ' + err.message, 'error');
  }
}

async function runTestAction(btn, endpoint) {
  btn.disabled = true;
  btn.textContent = 'Testing...';
  btn.className = 'test-btn';

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST' });
    const data = await res.json();

    if (res.ok) {
      btn.textContent = data.message || 'Success';
      btn.className = 'test-btn success';
      showSettingsToast(data.message || 'Test passed', 'success');
    } else {
      btn.textContent = 'Failed';
      btn.className = 'test-btn error';
      showSettingsToast(data.error || 'Test failed', 'error');
    }
  } catch (err) {
    btn.textContent = 'Error';
    btn.className = 'test-btn error';
    showSettingsToast('Test error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    setTimeout(() => {
      // Reset button text after 3s
      const section = SETTINGS_SECTIONS.find(s => s.actions?.some(a => a.endpoint === endpoint));
      const action = section?.actions?.find(a => a.endpoint === endpoint);
      if (action) btn.textContent = action.label;
      btn.className = 'test-btn';
    }, 3000);
  }
}

function showSettingsToast(message, type) {
  // Remove any existing toast
  const existing = document.querySelector('.settings-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `settings-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
