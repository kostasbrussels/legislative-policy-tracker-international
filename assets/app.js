// ── State ────────────────────────────────────────────────────────────────────
const state = {
  index: [],
  threads: {},
  query: '',
  activeCategory: '',
  fuse: null,
  fuseEntries: [],
};

// ── Routing ──────────────────────────────────────────────────────────────────
function getRoute() {
  const hash = window.location.hash || '#/';
  if (hash.startsWith('#/thread/')) {
    return { view: 'detail', id: decodeURIComponent(hash.slice(9)) };
  }
  return { view: 'list' };
}

function navigate(path) {
  window.location.hash = path;
}

// ── Data ─────────────────────────────────────────────────────────────────────
async function loadIndex() {
  const res = await fetch('data/index.json');
  state.index = await res.json();
  // Sort by last_updated descending
  state.index.sort((a, b) => b.last_updated.localeCompare(a.last_updated));
}

async function loadThread(id) {
  if (state.threads[id]) return state.threads[id];
  const res = await fetch(`data/${id}.json`);
  if (!res.ok) throw new Error(`Thread not found: ${id}`);
  const data = await res.json();
  state.threads[id] = data;
  return data;
}

async function loadAllThreads() {
  await Promise.all(state.index.map(t => loadThread(t.id).catch(() => null)));
}

// ── Search index ─────────────────────────────────────────────────────────────
function buildSearchIndex() {
  state.fuseEntries = [];

  for (const meta of state.index) {
    const data = state.threads[meta.id];
    if (!data) continue;

    // Thread-level item
    state.fuseEntries.push({
      type: 'thread',
      id: meta.id,
      title: meta.title,
      searchText: [meta.title, meta.current_state, meta.category].join(' '),
      threadFlag: meta.flag,
      threadTitle: meta.title,
      currentState: meta.current_state,
    });

    // Entry-level items
    for (const entry of data.entries || []) {
      state.fuseEntries.push({
        type: 'entry',
        id: meta.id,
        title: entry.title,
        date: entry.date,
        searchText: [
          entry.title,
          entry.what_happened,
          entry.shopify_angle || '',
          (entry.tags || []).join(' '),
        ].join(' '),
        threadFlag: meta.flag,
        threadTitle: meta.title,
        what_happened: entry.what_happened,
        shopify_angle: entry.shopify_angle,
      });
    }
  }

  state.fuse = new Fuse(state.fuseEntries, {
    keys: ['searchText'],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true,
  });
}

// ── Render dispatcher ────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  const route = getRoute();

  if (route.view === 'detail') {
    renderDetail(app, route.id);
  } else if (state.query.length >= 2) {
    renderSearch(app);
  } else {
    renderList(app);
  }
}

// ── Thread list ──────────────────────────────────────────────────────────────
function renderList(app) {
  const filtered = state.activeCategory
    ? state.index.filter(t => t.category === state.activeCategory)
    : state.index;

  let html = `
    <div class="view-header">
      <h2>Policy Threads</h2>
      <span class="view-count">${filtered.length} thread${filtered.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="thread-grid">
  `;

  if (filtered.length === 0) {
    html = `
      <div class="no-results">
        <h3>No threads in this category</h3>
        <p>Try a different filter or add a new thread.</p>
      </div>`;
  } else {
    for (const t of filtered) {
      html += threadCardHtml(t);
    }
    html += '</div>';
  }

  app.innerHTML = html;

  app.querySelectorAll('.thread-card').forEach(card => {
    card.addEventListener('click', () => navigate(`#/thread/${card.dataset.id}`));
  });
}

function threadCardHtml(t) {
  return `
    <div class="thread-card" data-id="${escHtml(t.id)}" role="button" tabindex="0">
      <div class="thread-card-header">
        <div class="thread-title-row">
          <span class="flag">${t.flag}</span>
          <h3>${escHtml(t.title)}</h3>
        </div>
        <div class="thread-meta">
          <span class="category-pill">${escHtml(t.category)}</span>
        </div>
      </div>
      <p class="thread-current-state">${escHtml(t.current_state)}</p>
      ${t.next_milestone ? `<p class="next-milestone">↗ Next: ${escHtml(t.next_milestone)}</p>` : ''}
      <div class="thread-card-footer">
        <div class="thread-stats">
          <span>${t.entry_count} entries</span>
          <span>Updated ${formatDate(t.last_updated)}</span>
        </div>
      </div>
    </div>
  `;
}

// ── Thread detail ─────────────────────────────────────────────────────────────
async function renderDetail(app, id) {
  // Show loading while fetching
  app.innerHTML = '<div class="loading">Loading thread…</div>';

  let thread;
  try {
    thread = await loadThread(id);
  } catch {
    app.innerHTML = `
      <button class="back-btn" id="back-btn">← All threads</button>
      <div class="no-results"><h3>Thread not found</h3><p>Check the URL or go back to the list.</p></div>
    `;
    app.querySelector('#back-btn').addEventListener('click', () => navigate('#/'));
    return;
  }

  const meta = state.index.find(t => t.id === id) || {};
  const entries = [...(thread.entries || [])].sort((a, b) => b.date.localeCompare(a.date));

  let html = `
    <button class="back-btn" id="back-btn">← All threads</button>

    <div class="thread-detail-header">
      <div class="thread-detail-title">
        <span class="flag" style="font-size:28px">${meta.flag || ''}</span>
        <h2>${escHtml(thread.title)}</h2>
      </div>
      <div class="detail-badges">
        <span class="category-pill">${escHtml(meta.category || '')}</span>
      </div>
      <div class="state-block">
        <div class="state-label">Current state</div>
        <div class="state-text">${escHtml(meta.current_state || '')}</div>
      </div>
      ${meta.next_milestone ? `
        <div class="milestone-row">
          <span class="milestone-label">Next milestone:</span>
          <span class="milestone-text">${escHtml(meta.next_milestone)}</span>
        </div>
      ` : ''}
      <div class="detail-stats">
        <span>${entries.length} entries</span>
        <span>Last updated ${formatDate(meta.last_updated)}</span>
        ${entries.length > 0 ? `<span>Since ${entries[entries.length - 1].date.slice(0, 4)}</span>` : ''}
      </div>
    </div>

    <div class="timeline-header">
      <h3>Development timeline</h3>
      <span class="view-count">Most recent first</span>
    </div>
    <div class="timeline">
  `;

  let lastYear = null;
  for (const entry of entries) {
    const year = entry.date.slice(0, 4);
    if (year !== lastYear) {
      html += `
        <div class="year-marker">
          <div class="year-label">${year}</div>
          <div class="year-line"></div>
        </div>
      `;
      lastYear = year;
    }
    html += timelineEntryHtml(entry);
  }

  html += '</div>';
  app.innerHTML = html;

  app.querySelector('#back-btn').addEventListener('click', () => navigate('#/'));
}

function timelineEntryHtml(entry) {
  return `
    <div class="timeline-entry">
      <div class="entry-date">${formatDateShort(entry.date)}</div>
      <div class="entry-dot"></div>
      <div class="entry-card">
        <h4>${escHtml(entry.title)}</h4>
        <p class="entry-what">${escHtml(entry.what_happened)}</p>
        ${entry.shopify_angle ? `
          <div class="entry-shopify">
            <div class="entry-shopify-label">Policy signal</div>
            ${escHtml(entry.shopify_angle)}
          </div>
        ` : ''}
        ${entry.tags && entry.tags.length ? `
          <div class="entry-tags">
            ${entry.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ── Search ────────────────────────────────────────────────────────────────────
function renderSearch(app) {
  if (!state.fuse) {
    app.innerHTML = '<div class="loading">Building search index…</div>';
    return;
  }

  const results = state.fuse.search(state.query);

  let html = `
    <div class="search-results-header">
      <strong>${results.length}</strong> result${results.length !== 1 ? 's' : ''} for
      &ldquo;${escHtml(state.query)}&rdquo;
    </div>
  `;

  if (results.length === 0) {
    html += `<div class="no-results"><h3>No results</h3><p>Try different keywords.</p></div>`;
  } else {
    for (const r of results.slice(0, 60)) {
      const item = r.item;
      if (item.type === 'thread') {
        html += `
          <div class="search-result-item" data-id="${escHtml(item.id)}">
            <div class="search-result-thread">${item.threadFlag} ${escHtml(item.threadTitle)} — Thread overview</div>
            <div class="search-result-title">${escHtml(item.title)}</div>
            <div class="search-result-excerpt">${escHtml(truncate(item.currentState, 140))}</div>
          </div>
        `;
      } else {
        html += `
          <div class="search-result-item" data-id="${escHtml(item.id)}">
            <div class="search-result-thread">${item.threadFlag} ${escHtml(item.threadTitle)}</div>
            <div class="search-result-title">${escHtml(item.title)}</div>
            <div class="search-result-excerpt">${escHtml(truncate(item.what_happened, 150))}</div>
            ${item.shopify_angle ? `
              <div class="search-result-excerpt" style="color:#4f46e5;margin-top:4px">
                ↳ ${escHtml(truncate(item.shopify_angle, 120))}
              </div>
            ` : ''}
          </div>
        `;
      }
    }
  }

  app.innerHTML = html;

  app.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => navigate(`#/thread/${el.dataset.id}`));
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function truncate(str, len) {
  if (!str || str.length <= len) return str || '';
  return str.slice(0, len).trimEnd() + '…';
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  state.query = e.target.value.trim();
  // Clear hash to list view when searching
  if (state.query.length >= 2 && getRoute().view === 'detail') {
    history.replaceState(null, '', '#/');
  }
  render();
});

document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.target.value = '';
    state.query = '';
    render();
  }
});

document.getElementById('category-filters').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  document.querySelectorAll('#category-filters .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  state.activeCategory = pill.dataset.category;
  if (getRoute().view === 'detail') navigate('#/');
  render();
});

// Keyboard navigation for thread cards
document.getElementById('app').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.classList.contains('thread-card')) {
    navigate(`#/thread/${e.target.dataset.id}`);
  }
});

window.addEventListener('hashchange', render);

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    await loadIndex();
    await loadAllThreads();
    buildSearchIndex();
    render();
  } catch (err) {
    console.error('Init failed:', err);
    document.getElementById('app').innerHTML = `
      <div class="no-results">
        <h3>Failed to load data</h3>
        <p>Make sure you're serving this from a web server (not file://).<br>
           Try: <code>npx serve .</code> or <code>python3 -m http.server</code></p>
      </div>
    `;
  }
}

init();
