function onImgError(img) {
  const src = img.src;
  if (!src || src.startsWith('data:')) { img.onerror = null; img.style.display = 'none'; return; }

  const base = window.API_BASE || '/api';
  if (src.includes(base + '/image-proxy')) {
    if (img.dataset.proxied) { img.onerror = null; img.style.display = 'none'; return; }
    img.dataset.proxied = '1';
    const qIdx = src.indexOf('?url=');
    if (qIdx !== -1) {
      const directUrl = decodeURIComponent(src.substring(qIdx + 5));
      if (directUrl) { img.src = directUrl; return; }
    }
  } else {
    if (img.dataset.direct) { img.onerror = null; img.style.display = 'none'; return; }
    img.dataset.direct = '1';
    img.src = base + '/image-proxy?url=' + encodeURIComponent(src);
    return;
  }

  img.onerror = null;
  img.style.display = 'none';
}
