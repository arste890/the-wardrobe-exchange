export function initGallery(root: HTMLElement): void {
  const main = root.querySelector<HTMLImageElement>('[data-gallery-main]');
  const kind = root.querySelector<HTMLElement>('[data-gallery-kind]');
  const thumbs = [...root.querySelectorAll<HTMLButtonElement>('[data-gallery-thumb]')];
  const lightbox = root.querySelector<HTMLDialogElement>('[data-lightbox]');
  const lbImg = root.querySelector<HTMLImageElement>('[data-lightbox-img]');
  const lbCap = root.querySelector<HTMLElement>('[data-lightbox-caption]');
  if (!main) return;

  let current = thumbs.findIndex((t) => t.classList.contains('is-active'));
  if (current < 0) current = 0;

  const show = (i: number) => {
    const t = thumbs[i];
    if (!t) return;
    current = i;
    main.src = t.dataset.large!;
    main.srcset = `${t.dataset.medium} 1000w, ${t.dataset.large} 1600w`;
    main.alt = t.dataset.alt ?? '';
    if (kind) kind.textContent = t.dataset.kindLabel ?? '';
    thumbs.forEach((b, j) => {
      b.classList.toggle('is-active', j === i);
      if (j === i) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  };

  thumbs.forEach((t, i) => t.addEventListener('click', () => show(i)));

  // Filter studio / actual
  root.querySelectorAll<HTMLButtonElement>('[data-gallery-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.galleryFilter!;
      root.querySelectorAll<HTMLButtonElement>('[data-gallery-filter]').forEach((b) => b.classList.toggle('is-active', b === btn));
      root.querySelectorAll<HTMLLIElement>('.gallery__thumbs li').forEach((li) => {
        li.hidden = f !== 'all' && li.dataset.kind !== f;
      });
      const visible = thumbs.findIndex((t) => !(t.parentElement as HTMLLIElement).hidden);
      if (visible >= 0 && (thumbs[current].parentElement as HTMLLIElement).hidden) show(visible);
    });
  });

  // Keyboard arrows on the main image / thumbs
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(nextVisible(current, 1));
    if (e.key === 'ArrowLeft') show(nextVisible(current, -1));
  });
  const nextVisible = (from: number, dir: number): number => {
    let i = from;
    for (let n = 0; n < thumbs.length; n++) {
      i = (i + dir + thumbs.length) % thumbs.length;
      if (!(thumbs[i].parentElement as HTMLLIElement).hidden) return i;
    }
    return from;
  };

  // Lightbox
  const open = () => {
    if (!lightbox || !lbImg) return;
    lbImg.src = thumbs[current]?.dataset.large ?? main.src;
    lbImg.alt = main.alt;
    if (lbCap) lbCap.textContent = `${thumbs[current]?.dataset.kindLabel ?? ''} · ${current + 1} / ${thumbs.length}`;
    lightbox.showModal();
  };
  root.querySelector('[data-gallery-open]')?.addEventListener('click', open);
  root.querySelector('[data-lightbox-close]')?.addEventListener('click', () => lightbox?.close());
  lightbox?.addEventListener('click', (e) => {
    if (e.target === lightbox) lightbox.close();
  });
  // Swipe on touch
  let x0 = 0;
  main.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  main.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) show(nextVisible(current, dx < 0 ? 1 : -1));
    },
    { passive: true },
  );
}
