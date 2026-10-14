// Admin SPA (vanilla TS). Talks to the Worker /admin/* API with a bearer token kept in sessionStorage.

import { CATEGORY_LABELS, CONDITION_LABELS, MEASUREMENT_FIELDS } from '@kw/shared/types';
import type { Category, ConditionGrade, ShippingClass, PhotoKind } from '@kw/shared/types';
import { SHIPPING_CLASSES } from '@kw/shared/shipping';

type Item = any;
type Order = any;

const TOKEN_KEY = 'kw:admin:token';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const when = (unix: number) => new Date(unix * 1000).toLocaleString();

export function initAdmin(root: HTMLElement): void {
  const api = root.dataset.api!;
  const base = root.dataset.base!.replace(/\/$/, '');
  let token = sessionStorage.getItem(TOKEN_KEY);
  let tab: 'items' | 'orders' | 'channels' | 'log' = 'items';
  let editing: Item | null = null;
  let itemsFilter = 'all';

  async function call<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    const res = await fetch(`${api}/admin${path}`, { ...init, headers });
    if (res.status === 401) {
      token = null;
      sessionStorage.removeItem(TOKEN_KEY);
      renderLogin();
      throw new Error('Signed out');
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}` + (j.missing ? `: missing ${j.missing.join(', ')}` : ''));
    return j as T;
  }

  function notice(msg: string, kind: 'ok' | 'error' = 'ok') {
    const el = root.querySelector<HTMLElement>('[data-notice]');
    if (!el) return;
    el.className = `notice notice--${kind}`;
    el.textContent = msg;
    el.hidden = false;
    if (kind === 'ok') setTimeout(() => (el.hidden = true), 4000);
  }

  // ---------- login ----------
  function renderLogin() {
    root.innerHTML = `
      <h1>Admin</h1>
      <form class="form" style="max-width:360px;margin-top:24px" data-login>
        <div class="field"><label for="pw">Password</label><input class="input" id="pw" type="password" autocomplete="current-password" required></div>
        <button class="btn" type="submit">Sign in</button>
        <p class="small muted" data-login-error hidden></p>
      </form>`;
    root.querySelector('[data-login]')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = (root.querySelector('#pw') as HTMLInputElement).value;
      try {
        const r = await fetch(`${api}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || 'Wrong password');
        token = j.token;
        sessionStorage.setItem(TOKEN_KEY, token!);
        renderShell();
      } catch (err) {
        const el = root.querySelector<HTMLElement>('[data-login-error]')!;
        el.textContent = (err as Error).message;
        el.hidden = false;
      }
    });
  }

  // ---------- shell ----------
  function renderShell() {
    root.innerHTML = `
      <div class="admin__bar">
        <h1>Admin</h1>
        <div class="admin__tabs" data-tabs>
          <button data-tab="items">Items</button>
          <button data-tab="orders">To ship</button>
          <button data-tab="channels">Channels</button>
          <button data-tab="log">Log</button>
        </div>
        <span style="margin-left:auto" class="cluster">
          <button class="btn btn--ghost" data-rebuild>Rebuild site</button>
          <button class="btn btn--ghost" data-logout>Sign out</button>
        </span>
      </div>
      <p class="notice" data-notice hidden></p>
      <div data-view></div>`;
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        tab = b.dataset.tab as typeof tab;
        editing = null;
        renderTab();
      }),
    );
    root.querySelector('[data-logout]')!.addEventListener('click', () => {
      token = null;
      sessionStorage.removeItem(TOKEN_KEY);
      renderLogin();
    });
    root.querySelector('[data-rebuild]')!.addEventListener('click', async () => {
      await call('/rebuild', { method: 'POST' });
      notice('Rebuild requested. The site updates in ~2 minutes.');
    });
    if (new URLSearchParams(location.search).get('ebay') === 'connected') tab = 'channels';
    renderTab();
  }

  function view(): HTMLElement {
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
    return root.querySelector<HTMLElement>('[data-view]')!;
  }

  async function renderTab() {
    try {
      if (tab === 'items') await (editing ? renderEditor() : renderItems());
      else if (tab === 'orders') await renderOrders();
      else if (tab === 'channels') await renderChannels();
      else await renderLog();
    } catch (e) {
      if ((e as Error).message !== 'Signed out') notice((e as Error).message, 'error');
    }
  }

  // ---------- items ----------
  async function renderItems() {
    const v = view();
    v.innerHTML = '<p class="muted">Loading…</p>';
    const items: Item[] = await call('/items');
    const filtered = items.filter((i) => itemsFilter === 'all' || i.status === itemsFilter);
    v.innerHTML = `
      <div class="admin__bar">
        <button class="btn" data-new>+ New item</button>
        <select class="select" style="width:auto" data-items-filter>
          ${['all', 'draft', 'available', 'reserved', 'sold', 'archived'].map((s) => `<option value="${s}" ${s === itemsFilter ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <span class="small muted">${filtered.length} of ${items.length}</span>
      </div>
      <table>
        <thead><tr><th></th><th>Item</th><th>Size</th><th>Price</th><th>Status</th><th>Channels</th><th>Updated</th></tr></thead>
        <tbody>
          ${filtered
            .map(
              (i) => `<tr data-row="${i.id}">
            <td>${i.cover ? `<img class="thumb" src="${i.cover.small}" alt="">` : '<div class="thumb"></div>'}</td>
            <td><strong>${esc(i.brand)}</strong> ${esc(i.title)}<br><span class="small muted">${esc(i.sku)}</span></td>
            <td>${esc(i.size_label)}</td>
            <td>${usd(i.price_cents)}</td>
            <td><span class="pill pill--${i.status}">${i.status}</span></td>
            <td>${(i.channels || []).map((c: any) => `<span class="pill pill--${c.status === 'error' ? 'error' : c.status === 'listed' ? 'available' : ''}" title="${esc(c.last_error || c.listing_url || '')}">${esc(c.channel)}: ${c.status}</span>`).join(' ')}</td>
            <td class="small muted">${when(i.updated_at)}</td>
          </tr>`,
            )
            .join('') || '<tr><td colspan="7" class="muted">No items yet. Create the first one.</td></tr>'}
        </tbody>
      </table>`;
    v.querySelector('[data-new]')!.addEventListener('click', () => {
      editing = { id: null, status: 'draft', category: 'tops', condition_grade: 'very_good', shipping_class: 'tops', flaws: [], measurements: {}, photos: [], channels: [] };
      renderEditor();
    });
    v.querySelector<HTMLSelectElement>('[data-items-filter]')!.addEventListener('change', (e) => {
      itemsFilter = (e.target as HTMLSelectElement).value;
      renderItems();
    });
    v.querySelectorAll<HTMLElement>('[data-row]').forEach((tr) =>
      tr.addEventListener('click', async () => {
        editing = await call(`/items/${tr.dataset.row}`);
        renderEditor();
      }),
    );
  }

  // ---------- editor ----------
  async function renderEditor() {
    const v = view();
    const it = editing!;
    const cats = Object.keys(CATEGORY_LABELS) as Category[];
    const grades = Object.keys(CONDITION_LABELS) as ConditionGrade[];
    const classes = Object.keys(SHIPPING_CLASSES) as ShippingClass[];
    const f = (name: string, label: string, value: unknown, type = 'text', extra = '') =>
      `<div class="field"><label for="f-${name}">${label}</label><input class="input" id="f-${name}" name="${name}" type="${type}" value="${esc(value ?? '')}" ${extra}></div>`;
    const sel = (name: string, label: string, opts: [string, string][], value: unknown) =>
      `<div class="field"><label for="f-${name}">${label}</label><select class="select" id="f-${name}" name="${name}">${opts.map(([k, l]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
    const measFields = (MEASUREMENT_FIELDS[it.category as Category] || []).map((m) => f(`m_${m.key}`, `${m.label} (cm)`, it.measurements?.[m.key], 'number', 'step="0.5" min="0"')).join('');

    v.innerHTML = `
      <div class="admin__bar">
        <button class="btn btn--ghost" data-back>← Items</button>
        ${it.id ? `<span class="pill pill--${it.status}">${it.status}</span><span class="small muted">${esc(it.sku)} · <a href="${base}/item/${esc(it.slug)}" target="_blank">view page</a></span>` : '<span class="small muted">New draft</span>'}
      </div>
      <form class="form" data-item-form>
        <div class="form__row">
          ${f('brand', 'Brand', it.brand, 'text', 'required list="brands"')}
          ${f('title', 'Title (e.g. "Wool belted coat")', it.title, 'text', 'required')}
          ${sel('category', 'Category', cats.map((c) => [c, CATEGORY_LABELS[c]]), it.category)}
          ${f('subcategory', 'Subcategory (optional)', it.subcategory)}
        </div>
        <div class="form__row">
          ${f('size_label', 'Size on label', it.size_label, 'text', 'required')}
          ${f('size_system', 'Size system (US / IT / FR / UK)', it.size_system)}
          ${f('color', 'Color', it.color)}
          ${f('material', 'Material', it.material)}
        </div>
        <div class="form__row">
          ${sel('condition_grade', 'Condition grade', grades.map((g) => [g, CONDITION_LABELS[g]]), it.condition_grade)}
          ${f('price', 'Price (USD)', it.price_cents ? (it.price_cents / 100).toFixed(2) : '', 'number', 'step="0.01" min="1" required')}
          ${f('original_price', 'Original retail (USD, optional)', it.original_price_cents ? (it.original_price_cents / 100).toFixed(2) : '', 'number', 'step="0.01" min="0"')}
          ${sel('shipping_class', 'Shipping class', classes.map((c) => [c, `${SHIPPING_CLASSES[c].label} — ${usd(SHIPPING_CLASSES[c].cents)}`]), it.shipping_class)}
        </div>
        <div class="field"><label for="f-condition_notes">Condition notes (shown under the grade)</label><input class="input" id="f-condition_notes" name="condition_notes" value="${esc(it.condition_notes ?? '')}"></div>
        <div class="field"><label for="f-flaws">Flaws — one per line, honestly (e.g. "Faint scuff on left cuff, 1 cm")</label><textarea class="textarea" id="f-flaws" name="flaws" style="min-height:80px">${esc((it.flaws || []).map((x: any) => x.text).join('\n'))}</textarea></div>
        <div class="field"><label for="f-description">Description (Markdown)</label><textarea class="textarea" id="f-description" name="description_md">${esc(it.description_md ?? '')}</textarea></div>
        <fieldset style="border:1px solid var(--line);padding:16px;border-radius:2px"><legend class="small">Measurements (cm, optional — fill in any you have) — <span data-meas-cat>${esc(CATEGORY_LABELS[it.category as Category])}</span></legend><div class="form__row" data-meas>${measFields}</div></fieldset>
        <div class="actions">
          <button class="btn" type="submit" data-save>${it.id ? 'Save' : 'Create draft'}</button>
          ${it.id && it.status === 'draft' ? '<button class="btn" type="button" data-publish>Publish</button>' : ''}
          ${it.id && it.status === 'available' ? '<button class="btn btn--ghost" type="button" data-unpublish>Unpublish</button>' : ''}
          ${it.id && it.status === 'reserved' ? '<button class="btn btn--ghost" type="button" data-release>Release hold</button>' : ''}
          ${it.id && it.status !== 'sold' && it.status !== 'archived' ? '<button class="btn btn--ghost" type="button" data-sold>Mark sold elsewhere</button>' : ''}
          ${it.id && it.status === 'available' ? '<button class="btn btn--ghost" type="button" data-simulate>Simulate marketplace sale (mock)</button>' : ''}
          ${it.id && it.status !== 'archived' ? '<button class="btn btn--ghost btn--danger" type="button" data-archive>Archive</button>' : ''}
        </div>
      </form>
      <datalist id="brands"></datalist>
      <h2 style="margin-top:32px">Photos</h2>
      ${it.id ? `
        <p class="small muted">Drop files or click. Name files <code>studio_*.jpg</code> for Studio renderings, <code>flaw_*.jpg</code> for flaw close-ups; everything else is tagged "Actual item". Images are resized in your browser before upload.</p>
        <div class="drop" data-drop><input type="file" accept="image/*" multiple hidden data-file><span>Drop photos here or <u>choose files</u></span><div class="small" data-progress></div></div>
        <div class="photos" data-photos style="margin-top:16px"></div>
        <div class="small muted" style="margin-top:8px">Channels: ${(it.channels || []).map((c: any) => `${esc(c.channel)} · ${c.status}${c.listing_url ? ` · <a href="${esc(c.listing_url)}" target="_blank">listing</a>` : ''}${c.last_error ? ` · <span class="pill pill--error">${esc(c.last_error)}</span>` : ''}`).join('<br>') || 'none'}</div>`
        : '<p class="muted">Create the draft first, then add photos.</p>'}`;

    v.querySelector('[data-back]')!.addEventListener('click', () => {
      editing = null;
      renderItems();
    });
    const form = v.querySelector<HTMLFormElement>('[data-item-form]')!;
    form.querySelector<HTMLSelectElement>('[name=category]')!.addEventListener('change', (e) => {
      const c = (e.target as HTMLSelectElement).value as Category;
      v.querySelector('[data-meas-cat]')!.textContent = CATEGORY_LABELS[c];
      v.querySelector('[data-meas]')!.innerHTML = (MEASUREMENT_FIELDS[c] || []).map((m) => f(`m_${m.key}`, `${m.label} (cm)`, it.measurements?.[m.key], 'number', 'step="0.5" min="0"')).join('');
    });

    const collect = () => {
      const fd = new FormData(form);
      const g = (k: string) => (fd.get(k) as string | null)?.trim() ?? '';
      const measurements: Record<string, number> = {};
      for (const [k, val] of fd.entries()) if (k.startsWith('m_') && String(val).trim()) measurements[k.slice(2)] = Number(val);
      return {
        brand: g('brand'), title: g('title'), category: g('category'), subcategory: g('subcategory') || null,
        size_label: g('size_label'), size_system: g('size_system') || null, color: g('color') || null, material: g('material') || null,
        condition_grade: g('condition_grade'), condition_notes: g('condition_notes') || null,
        flaws: g('flaws').split('\n').map((s) => s.trim()).filter(Boolean).map((text) => ({ text })),
        description_md: g('description_md'), price_cents: Math.round(Number(g('price') || 0) * 100),
        original_price_cents: g('original_price') ? Math.round(Number(g('original_price')) * 100) : null,
        shipping_class: g('shipping_class'), measurements,
      };
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        editing = it.id ? await call(`/items/${it.id}`, { method: 'PATCH', body: JSON.stringify(collect()) }) : await call('/items', { method: 'POST', body: JSON.stringify(collect()) });
        editing = await call(`/items/${editing.id}`);
        notice('Saved.');
        renderEditor();
      } catch (err) {
        notice((err as Error).message, 'error');
      }
    });
    const act = async (sel: string, path: string, body?: unknown, confirmMsg?: string) => {
      v.querySelector(sel)?.addEventListener('click', async () => {
        if (confirmMsg && !confirm(confirmMsg)) return;
        try {
          await call(`/items/${it.id}`, { method: 'PATCH', body: JSON.stringify(collect()) });
          editing = await call(`/items/${it.id}/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
          editing = await call(`/items/${it.id}`);
          notice(`Done: ${path}.`);
          renderEditor();
        } catch (err) {
          notice((err as Error).message, 'error');
        }
      });
    };
    act('[data-publish]', 'publish');
    act('[data-unpublish]', 'unpublish');
    act('[data-release]', 'release-hold');
    act('[data-archive]', 'archive', undefined, 'Archive this item? It will be delisted everywhere.');
    v.querySelector('[data-sold]')?.addEventListener('click', async () => {
      const channel = prompt('Where did it sell? (poshmark / facebook / ebay / in person)', 'poshmark');
      if (!channel) return;
      const note = prompt('Note (optional: buyer, price)') ?? '';
      try {
        editing = await call(`/items/${it.id}/mark-sold`, { method: 'POST', body: JSON.stringify({ channel, note }) });
        editing = await call(`/items/${it.id}`);
        notice('Marked sold; other listings are being ended.');
        renderEditor();
      } catch (err) {
        notice((err as Error).message, 'error');
      }
    });
    v.querySelector('[data-simulate]')?.addEventListener('click', async () => {
      try {
        await call(`/channels/mock/simulate-sale/${it.id}`, { method: 'POST' });
        editing = await call(`/items/${it.id}`);
        notice('Mock marketplace sale ingested.');
        renderEditor();
      } catch (err) {
        notice((err as Error).message, 'error');
      }
    });

    if (it.id) {
      renderPhotos(v, it);
      const drop = v.querySelector<HTMLElement>('[data-drop]')!;
      const file = v.querySelector<HTMLInputElement>('[data-file]')!;
      drop.addEventListener('click', () => file.click());
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('is-over');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('is-over');
        if (e.dataTransfer?.files.length) uploadFiles(v, it, [...e.dataTransfer.files]);
      });
      file.addEventListener('change', () => file.files && uploadFiles(v, it, [...file.files]));
    }
  }

  function renderPhotos(v: HTMLElement, it: Item) {
    const box = v.querySelector<HTMLElement>('[data-photos]');
    if (!box) return;
    const kinds: PhotoKind[] = ['studio', 'actual', 'flaw'];
    box.innerHTML = (it.photos || [])
      .map(
        (p: any, i: number) => `<div class="photo ${p.is_cover ? 'is-cover' : ''}" data-photo="${p.id}">
          <img src="${p.small}" alt="">
          <select data-kind>${kinds.map((k) => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
          <div class="photo__actions">
            <button type="button" data-left title="Move left" ${i === 0 ? 'disabled' : ''}>←</button>
            <button type="button" data-cover title="Set as cover">★</button>
            <button type="button" data-right title="Move right" ${i === it.photos.length - 1 ? 'disabled' : ''}>→</button>
            <button type="button" data-del title="Delete">✕</button>
          </div></div>`,
      )
      .join('');
    box.querySelectorAll<HTMLElement>('[data-photo]').forEach((el) => {
      const id = el.dataset.photo!;
      const reload = async () => {
        editing = await call(`/items/${it.id}`);
        renderPhotos(v, editing);
      };
      el.querySelector<HTMLSelectElement>('[data-kind]')!.addEventListener('change', async (e) => {
        await call(`/photos/${id}`, { method: 'PATCH', body: JSON.stringify({ kind: (e.target as HTMLSelectElement).value }) });
        reload();
      });
      el.querySelector('[data-cover]')!.addEventListener('click', async () => {
        await call(`/photos/${id}`, { method: 'PATCH', body: JSON.stringify({ is_cover: true }) });
        reload();
      });
      el.querySelector('[data-del]')!.addEventListener('click', async () => {
        if (!confirm('Delete this photo?')) return;
        await call(`/photos/${id}`, { method: 'DELETE' });
        reload();
      });
      const move = (dir: number) => async () => {
        const ids = it.photos.map((p: any) => p.id);
        const i = ids.indexOf(id);
        ids.splice(i, 1);
        ids.splice(i + dir, 0, id);
        await call('/photos/reorder', { method: 'PATCH', body: JSON.stringify({ ids }) });
        reload();
      };
      el.querySelector('[data-left]')!.addEventListener('click', move(-1));
      el.querySelector('[data-right]')!.addEventListener('click', move(1));
    });
  }

  async function uploadFiles(v: HTMLElement, it: Item, files: File[]) {
    const prog = v.querySelector<HTMLElement>('[data-progress]')!;
    let n = 0;
    for (const file of files) {
      n++;
      prog.textContent = `Uploading ${n} of ${files.length}: ${file.name}`;
      try {
        const kind: PhotoKind = /^studio[_-]/i.test(file.name) ? 'studio' : /^flaw[_-]/i.test(file.name) ? 'flaw' : 'actual';
        const bmp = await createImageBitmap(file);
        const variants = await makeVariants(bmp);
        const meta = await call<{ id: string }>('/photos', { method: 'POST', body: JSON.stringify({ item_id: it.id, kind, width: variants.w, height: variants.h, alt: `${it.brand} ${it.title} — ${kind === 'studio' ? 'studio rendering' : kind === 'flaw' ? 'detail' : 'actual item'}` }) });
        for (const [suffix, blob] of Object.entries(variants.blobs)) {
          const res = await fetch(`${api}/admin/photos/${meta.id}/variant/${suffix}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': blob.type }, body: blob });
          if (!res.ok) throw new Error(`upload ${suffix} failed (${res.status})`);
        }
        await call(`/photos/${meta.id}/complete`, { method: 'POST' });
      } catch (err) {
        notice(`${file.name}: ${(err as Error).message}`, 'error');
      }
    }
    prog.textContent = '';
    editing = await call(`/items/${it.id}`);
    renderPhotos(v, editing);
  }

  async function makeVariants(bmp: ImageBitmap): Promise<{ w: number; h: number; blobs: Record<string, Blob> }> {
    const render = async (maxW: number, type: string, quality: number) => {
      const scale = Math.min(1, maxW / bmp.width);
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0, w, h);
      return canvas.convertToBlob({ type, quality });
    };
    const [l, m, s, j] = await Promise.all([render(1600, 'image/webp', 0.86), render(1000, 'image/webp', 0.84), render(480, 'image/webp', 0.8), render(1600, 'image/jpeg', 0.9)]);
    const scale = Math.min(1, 1600 / bmp.width);
    return { w: Math.round(bmp.width * scale), h: Math.round(bmp.height * scale), blobs: { '_1600.webp': l, '_1000.webp': m, '_480.webp': s, '_1600.jpg': j } };
  }

  // ---------- orders ----------
  async function renderOrders() {
    const v = view();
    v.innerHTML = '<p class="muted">Loading…</p>';
    const orders: Order[] = await call('/orders');
    const toShip = orders.filter((o) => o.status === 'paid');
    const rest = orders.filter((o) => o.status !== 'paid');
    const row = (o: Order) => `
      <tr>
        <td><strong>${esc(o.item?.brand)}</strong> ${esc(o.item?.title)}<br><span class="small muted">${esc(o.item?.sku)} · ${esc(o.channel)} · ${when(o.created_at)}</span></td>
        <td>${usd(o.total_cents)}<br><span class="small muted">ship ${usd(o.shipping_cents)} · tax ${usd(o.tax_cents)}</span></td>
        <td><div class="address">${esc(addr(o))}</div>${o.buyer_email ? `<span class="small">${esc(o.buyer_email)}</span>` : ''}<br><button class="btn btn--ghost" style="min-height:32px;padding:0 10px;margin-top:6px" data-copy="${esc(addr(o))}">Copy address</button></td>
        <td>${
          o.status === 'paid'
            ? `<form class="cluster" data-ship="${o.id}"><select class="select" name="carrier" style="width:auto"><option>USPS</option><option>UPS</option><option>FedEx</option></select><input class="input" name="tracking" placeholder="Tracking #" required style="width:170px"><button class="btn" style="min-height:40px">Mark shipped</button></form>`
            : `<span class="pill pill--${o.status === 'shipped' ? 'available' : 'error'}">${o.status}</span>${o.tracking_number ? `<br><span class="small">${esc(o.tracking_carrier)} ${esc(o.tracking_number)}</span>` : ''}`
        }</td>
      </tr>`;
    v.innerHTML = `
      <h2>To ship (${toShip.length})</h2>
      <table><thead><tr><th>Item</th><th>Paid</th><th>Ship to</th><th>Tracking</th></tr></thead><tbody>${toShip.map(row).join('') || '<tr><td colspan="4" class="muted">Nothing waiting. Nice.</td></tr>'}</tbody></table>
      <h2 style="margin-top:32px">History</h2>
      <table><thead><tr><th>Item</th><th>Paid</th><th>Ship to</th><th>Status</th></tr></thead><tbody>${rest.map(row).join('') || '<tr><td colspan="4" class="muted">No past orders.</td></tr>'}</tbody></table>`;
    v.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => b.addEventListener('click', () => navigator.clipboard.writeText(b.dataset.copy!).then(() => notice('Address copied.'))));
    v.querySelectorAll<HTMLFormElement>('[data-ship]').forEach((f) =>
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        try {
          await call(`/orders/${f.dataset.ship}/ship`, { method: 'POST', body: JSON.stringify({ carrier: fd.get('carrier'), tracking: fd.get('tracking') }) });
          notice('Marked shipped; buyer emailed.');
          renderOrders();
        } catch (err) {
          notice((err as Error).message, 'error');
        }
      }),
    );
  }

  const addr = (o: Order) => {
    const a = o.ship_to;
    if (!a) return o.channel === 'site' ? '(no address on file)' : `See ${o.channel} for the address`;
    return [a.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.postal_code}`, a.country].filter(Boolean).join('\n');
  };

  // ---------- channels ----------
  async function renderChannels() {
    const v = view();
    v.innerHTML = '<p class="muted">Loading…</p>';
    const data = await call<{ channels: any[]; listings: any[] }>('/channels');
    v.innerHTML = `
      <h2>Channels</h2>
      <table><thead><tr><th>Channel</th><th>Status</th><th></th></tr></thead><tbody>
        ${data.channels.map((c) => `<tr><td>${esc(c.name)}</td><td><span class="pill pill--${c.ok ? 'available' : 'error'}">${c.ok ? 'ok' : 'attention'}</span> <span class="small">${esc(c.detail)}</span></td>
          <td class="actions">${c.name === 'ebay' ? '<button class="btn btn--ghost" data-ebay-connect>Connect eBay</button><button class="btn btn--ghost" data-ebay-setup>Run eBay setup</button>' : ''}</td></tr>`).join('')}
      </tbody></table>
      <p style="margin-top:16px" class="actions"><button class="btn btn--ghost" data-poll>Poll marketplaces for sales now</button></p>
      <h2 style="margin-top:32px">Listings</h2>
      <table><thead><tr><th>Item</th><th>Channel</th><th>Status</th><th>Link / error</th><th>Synced</th></tr></thead><tbody>
        ${data.listings.map((l) => `<tr><td class="small">${esc(l.item_id)}</td><td>${esc(l.channel)}</td><td><span class="pill pill--${l.status === 'listed' ? 'available' : l.status === 'error' ? 'error' : ''}">${l.status}</span></td><td class="small">${l.listing_url ? `<a href="${esc(l.listing_url)}" target="_blank">listing</a>` : ''} ${esc(l.last_error || '')}</td><td class="small muted">${l.last_synced_at ? when(l.last_synced_at) : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No listings yet.</td></tr>'}
      </tbody></table>
      <p class="small muted" style="margin-top:16px">eBay goes live once the developer keys are set as Worker secrets and <code>CHANNELS=ebay</code>. Until then the mock channel records listings locally.</p>`;
    v.querySelector('[data-ebay-connect]')?.addEventListener('click', async () => {
      try {
        const r = await call<{ url: string }>('/channels/ebay/oauth/start');
        window.open(r.url, '_blank');
      } catch (err) {
        notice((err as Error).message, 'error');
      }
    });
    v.querySelector('[data-ebay-setup]')?.addEventListener('click', async () => {
      try {
        const r = await call('/channels/ebay/setup', { method: 'POST' });
        notice(`eBay setup complete: ${JSON.stringify(r)}`);
        renderChannels();
      } catch (err) {
        notice((err as Error).message, 'error');
      }
    });
    v.querySelector('[data-poll]')!.addEventListener('click', async () => {
      await call('/channels/poll', { method: 'POST' });
      notice('Polled.');
      renderChannels();
    });
  }

  // ---------- log ----------
  async function renderLog() {
    const v = view();
    const events: any[] = await call('/events');
    v.innerHTML = `<h2>Activity</h2><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Detail</th></tr></thead><tbody>
      ${events.map((e) => `<tr><td class="small muted">${when(e.ts)}</td><td>${esc(e.actor)}</td><td>${esc(e.kind)}</td><td class="small">${esc(e.item_id || '')}</td><td class="small">${esc(e.payload_json || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing yet.</td></tr>'}
    </tbody></table>`;
  }

  if (token) renderShell();
  else renderLogin();
}
