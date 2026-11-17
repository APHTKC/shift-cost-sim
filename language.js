(() => {
  const storageKey = 'restaurant-site-language';
  const supported = ['zh-Hant', 'en', 'ja'];
  const requested = new URL(location.href).searchParams.get('lang');
  let language = 'zh-Hant';
  try { language = requested || localStorage.getItem(storageKey) || language; } catch {}
  if (!supported.includes(language)) language = 'zh-Hant';

  const terms = new Map();
  const templates = [];
  const textSources = new WeakMap();
  const attributeSources = new WeakMap();
  const translatable = /[\u3400-\u9fff]/;
  const placeholder = /\{(\d+)\}/g;
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function addCatalog(data) {
    for (const line of data.trim().split(/\r?\n/)) {
      const [source, en, ja] = line.split('\t');
      if (!source || !en || !ja) continue;
      const entry = { en, ja };
      if (!source.includes('{')) {
        terms.set(source, entry);
        continue;
      }
      const order = [...source.matchAll(placeholder)].map(match => Number(match[1]));
      const pattern = source.split(placeholder).filter((_, index) => index % 2 === 0).map(escapeRegex).join('(.+?)');
      templates.push({ pattern: new RegExp('^' + pattern + '$','s'), order, entry, specificity: source.replace(placeholder,'').length });
    }
    templates.sort((a, b) => b.specificity - a.specificity);
  }

  function translate(value, depth = 0) {
    if (typeof value !== 'string' || language === 'zh-Hant' || !translatable.test(value) || depth > 4) return value;
    const key = value.trim();
    const direct = terms.get(key);
    if (direct) return value.replace(key, () => direct[language]);
    if (/^(平日|假日) (外場|內場)[\d.]+%/.test(key)) {
      return key.split('；').map(item => {
        const parts = item.match(/^(平日|假日) (外場|內場)([\d.]+)%$/);
        return parts ? translate(parts[1]) + ' ' + translate(parts[2]) + ': ' + parts[3] + '%' : item;
      }).join(language === 'ja' ? '、' : '; ');
    }
    for (const { pattern, order, entry } of templates) {
      const match = pattern.exec(key);
      if (!match) continue;
      const values = new Map(order.map((key, index) => [key, match[index + 1]]));
      return value.replace(key, () => entry[language].replace(placeholder, (_, index) => translate(values.get(Number(index)), depth + 1)));
    }
    return value;
  }

  function updateText(node) {
    if (!node.parentElement || node.parentElement.closest('script, style, [data-untranslated]')) return;
    const current = node.nodeValue;
    const previous = textSources.get(node);
    const source = previous?.rendered === current ? previous.source : current;
    if (!translatable.test(source)) return;
    const rendered = translate(source);
    textSources.set(node, { source, rendered });
    if (current !== rendered) node.nodeValue = rendered;
  }

  function updateAttributes(node) {
    if (node.closest('[data-untranslated]')) return;
    const attributes = attributeSources.get(node) || {};
    for (const key of ['aria-label', 'title', 'placeholder']) {
      const current = node.getAttribute(key);
      const previous = attributes[key];
      const source = previous?.rendered === current ? previous.source : current;
      if (typeof source !== 'string' || !translatable.test(source)) continue;
      const rendered = translate(source);
      attributes[key] = { source, rendered };
      if (current !== rendered) node.setAttribute(key, rendered);
    }
    attributeSources.set(node, attributes);
  }

  function paint() {
    document.documentElement.lang = language;
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) updateText(walker.currentNode);
    document.querySelectorAll('[aria-label], [title], [placeholder]').forEach(updateAttributes);
    document.querySelectorAll('[data-language]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.language === language));
    });
    document.querySelectorAll('[data-site-page]').forEach(link => {
      const url = new URL(link.href);
      url.searchParams.set('lang', language);
      link.href = url;
    });
  }

  window.siteTranslate = translate;
  window.siteLanguage = () => language;

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      observer.disconnect();
      paint();
      observe();
    });
  });
  const observe = () => observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  const catalogs = ['dashboard-translations.tsv'];
  if (document.body.dataset.page === 'labor') catalogs.push('labor-translations.tsv');

  Promise.all(catalogs.map(async path => {
    const response = await fetch(new URL(path, document.baseURI));
    if (!response.ok) throw new Error('Could not load ' + path);
    return response.text();
  })).then(data => {
    data.forEach(addCatalog);
    document.querySelectorAll('[data-language]').forEach(button => {
      button.disabled = false;
      button.addEventListener('click', () => {
        language = button.dataset.language;
        const url = new URL(location.href);
        url.searchParams.set('lang', language);
        history.replaceState(null, '', url);
        try { localStorage.setItem(storageKey, language); } catch {}
        observer.disconnect();
        paint();
        observe();
      });
    });
    paint();
    observe();
  }).catch(error => {
    console.error(error);
    const status = document.querySelector('#languageError');
    if (status) status.hidden = false;
  });
})();
