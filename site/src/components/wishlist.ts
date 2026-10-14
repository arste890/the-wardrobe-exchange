// Wishlist stored in localStorage (per browser). Also wires the heart buttons and header count.

const KEY = 'kw:wishlist';

export function getWishlist(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function setWishlist(slugs: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(slugs)]));
  } catch {
    /* private mode */
  }
  document.dispatchEvent(new CustomEvent('kw:wishlist'));
}

export function toggleWishlist(slug: string): boolean {
  const list = getWishlist();
  const i = list.indexOf(slug);
  if (i >= 0) list.splice(i, 1);
  else list.push(slug);
  setWishlist(list);
  return i < 0;
}

export function initWishlistBadge(): void {
  const render = () => {
    const list = getWishlist();
    document.querySelectorAll<HTMLElement>('[data-wishlist-count]').forEach((el) => {
      el.textContent = String(list.length);
      el.hidden = list.length === 0;
    });
    document.querySelectorAll<HTMLButtonElement>('[data-wishlist-toggle]').forEach((btn) => {
      const on = list.includes(btn.dataset.wishlistToggle!);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? 'Remove from wishlist' : 'Save to wishlist');
    });
  };
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-wishlist-toggle]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    toggleWishlist(btn.dataset.wishlistToggle!);
  });
  document.addEventListener('kw:wishlist', render);
  render();
}
