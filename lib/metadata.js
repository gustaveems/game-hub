export async function fetchMetadata(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    const html = await resp.text();
    clearTimeout(timeout);

    const doc = new DOMParser().parseFromString(html, 'text/html');

    const title =
      getMeta(doc, 'og:title') ||
      doc.querySelector('title')?.textContent?.trim() || '';

    const description =
      getMeta(doc, 'og:description') ||
      getMeta(doc, 'description') || '';

    let thumbnail = getMeta(doc, 'og:image') || null;
    if (thumbnail && !thumbnail.startsWith('http')) {
      try {
        thumbnail = new URL(thumbnail, url).href;
      } catch { thumbnail = null; }
    }

    return { title, description, thumbnail };
  } catch (e) {
    console.warn('Game Hub: metadata fetch failed for', url, e);
    return { title: '', description: '', thumbnail: null };
  } finally {
    clearTimeout(timeout);
  }
}

function getMeta(doc, name) {
  const el =
    doc.querySelector(`meta[property="${name}"]`) ||
    doc.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute('content')?.trim() || '';
}
