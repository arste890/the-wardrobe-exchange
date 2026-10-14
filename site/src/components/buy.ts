// Product page island: live availability overlay, policy gate, Stripe redirect.

type Status = 'available' | 'reserved' | 'sold' | 'draft' | 'archived';

export function initBuyBox(root: HTMLElement): void {
  const api = root.dataset.api!;
  const slug = root.dataset.slug!;
  const itemId = root.dataset.itemId!;
  const policyVersion = root.dataset.policyVersion!;
  const form = root.querySelector<HTMLFormElement>('[data-buy-form]')!;
  const ack = root.querySelector<HTMLInputElement>('[data-ack]')!;
  const btn = root.querySelector<HTMLButtonElement>('[data-buy-btn]')!;
  const err = root.querySelector<HTMLElement>('[data-buy-error]')!;
  const statusLine = root.querySelector<HTMLElement>('[data-status-line]')!;
  const soldPanel = root.querySelector<HTMLElement>('[data-sold-panel]')!;

  const setStatus = (status: Status, reservedUntil: number | null) => {
    const now = Math.floor(Date.now() / 1000);
    const reserved = status === 'reserved' && reservedUntil && reservedUntil > now;
    if (status === 'sold' || status === 'archived' || status === 'draft') {
      statusLine.innerHTML = '<span class="badge badge--sold">Sold</span>';
      form.hidden = true;
      soldPanel.hidden = false;
      return;
    }
    soldPanel.hidden = true;
    form.hidden = false;
    if (reserved) {
      const mins = Math.max(1, Math.ceil((reservedUntil - now) / 60));
      statusLine.innerHTML = `<span class="badge">In someone's cart — try again in ~${mins} min</span>`;
      btn.disabled = true;
      btn.textContent = 'Reserved by another shopper';
    } else {
      statusLine.innerHTML = '<span class="badge badge--ok">1 available · one of a kind</span>';
      btn.textContent = 'Buy now — secure checkout';
      btn.disabled = !ack.checked;
    }
  };

  const refresh = async () => {
    try {
      const r = await fetch(`${api}/api/items/${encodeURIComponent(slug)}/availability`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as { status: Status; reserved_until: number | null };
      setStatus(j.status, j.reserved_until);
    } catch {
      /* offline: keep prerendered state */
    }
  };

  ack.addEventListener('change', () => {
    if (!btn.textContent?.startsWith('Reserved')) btn.disabled = !ack.checked;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ack.checked) return;
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Starting secure checkout…';
    try {
      const r = await fetch(`${api}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, acknowledged_policies: true, policy_version: policyVersion }),
      });
      const j = (await r.json()) as { url?: string; error?: string; message?: string };
      if (r.ok && j.url) {
        window.location.href = j.url;
        return;
      }
      err.textContent = j.message || 'Checkout could not be started. Please try again.';
      err.hidden = false;
      if (r.status === 409) await refresh();
      else {
        btn.disabled = false;
        btn.textContent = 'Buy now — secure checkout';
      }
    } catch {
      err.textContent = 'Network problem — please check your connection and try again.';
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Buy now — secure checkout';
    }
  });

  // Share
  root.querySelector<HTMLButtonElement>('[data-share]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const data = { title: document.title, url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(location.href);
        b.textContent = 'Link copied';
        setTimeout(() => (b.textContent = 'Share'), 1500);
      }
    } catch {
      /* cancelled */
    }
  });

  if (new URLSearchParams(location.search).get('cancelled')) {
    err.textContent = 'Checkout cancelled — the piece is available again.';
    err.hidden = false;
  }

  refresh();
  setInterval(refresh, 30_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
}
