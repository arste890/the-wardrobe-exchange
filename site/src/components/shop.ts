// Client-side filter/sort/search over prerendered product cards. State is mirrored in the URL.

export function initShop(): void {
  const root = document.querySelector<HTMLElement>('[data-shop-controls]');
  const grid = document.querySelector<HTMLElement>('[data-shop-grid]');
  if (!root || !grid) return;
  const cards = [...grid.querySelectorAll<HTMLElement>('[data-item]')];
  const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-filter]')];
  const count = root.querySelector<HTMLElement>('[data-result-count]');
  const empty = document.querySelector<HTMLElement>('[data-shop-empty]');

  const get = (k: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-filter="${k}"]`)!;

  // Hydrate from URL
  const params = new URLSearchParams(location.search);
  for (const el of inputs) {
    const k = el.dataset.filter!;
    const v = params.get(k === 'sold' ? 'status' : k);
    if (v === null) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = v === 'sold';
    else el.value = v;
  }

  const apply = () => {
    const q = get('search').value.trim().toLowerCase();
    const category = get('category').value;
    const size = get('size').value;
    const brand = get('brand').value;
    const price = get('price').value;
    const sort = get('sort').value;
    const showSold = (get('sold') as HTMLInputElement).checked;
    const [minS, maxS] = price.split('-');
    const min = minS ? Number(minS) : 0;
    const max = maxS ? Number(maxS) : Infinity;

    let shown = 0;
    const visible: HTMLElement[] = [];
    for (const c of cards) {
      const d = c.dataset;
      const p = Number(d.price);
      const ok =
        (!q || d.search!.includes(q)) &&
        (!category || d.category === category) &&
        (!size || d.size === size) &&
        (!brand || d.brand === brand) &&
        p >= min &&
        p <= max &&
        (showSold || d.status !== 'sold');
      c.hidden = !ok;
      if (ok) {
        shown++;
        visible.push(c);
      }
    }
    visible.sort((a, b) => {
      // Available pieces always ahead of sold ones.
      const sa = a.dataset.status === 'sold' ? 1 : 0;
      const sb = b.dataset.status === 'sold' ? 1 : 0;
      if (sa !== sb) return sa - sb;
      if (sort === 'price-asc') return Number(a.dataset.price) - Number(b.dataset.price);
      if (sort === 'price-desc') return Number(b.dataset.price) - Number(a.dataset.price);
      return Number(b.dataset.published) - Number(a.dataset.published);
    });
    visible.forEach((c, i) => (c.style.order = String(i)));
    if (count) count.textContent = shown === 1 ? '1 piece' : `${shown} pieces`;
    if (empty) empty.hidden = shown > 0;

    const next = new URLSearchParams();
    if (q) next.set('search', q);
    if (category) next.set('category', category);
    if (size) next.set('size', size);
    if (brand) next.set('brand', brand);
    if (price) next.set('price', price);
    if (sort !== 'new') next.set('sort', sort);
    if (showSold) next.set('status', 'sold');
    const qs = next.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  };

  inputs.forEach((el) => el.addEventListener(el instanceof HTMLInputElement && el.type === 'search' ? 'input' : 'change', apply));
  apply();
}
