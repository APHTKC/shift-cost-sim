(() => {
  const picker = $('displayCurrency');
  const note = $('exchangeRateStatus');
  const reportNote = $('reportCurrency');
  const quoteLink = $('exchangeQuote');
  let request = 0;

  function paintCurrency(currency, quote) {
    displayCurrency = currency;
    displayRate = quote?.rate ?? 1;
    if (activeMode === 'scenario') {
      if (scLatest) scShow(scLatest);
    } else {
      renderResults();
    }
  }

  picker.addEventListener('change', async () => {
    const revision = ++request;
    const currency = picker.value;
    quoteLink.hidden = currency === 'TWD';
    if (currency === 'TWD') {
      paintCurrency(currency);
      note.textContent = '';
      reportNote.textContent = '金額以新台幣計';
      return;
    }
    quoteLink.href = 'https://www.google.com/finance/quote/TWD-' + currency;
    note.textContent = '正在取得 Google Finance 匯率…';
    try {
      const url = 'https://raw.githubusercontent.com/APHTKC/shift-cost-sim/exchange-rates/exchange-rates.json';
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      const quote = data.quotes?.[currency];
      const timestamp = Date.parse(quote?.quotedAt);
      if (data.base !== 'TWD' || data.source !== 'Google Finance' ||
          !Number.isFinite(quote?.rate) || quote.rate <= 0 || !Number.isFinite(timestamp)) {
        throw new Error('Invalid quote');
      }
      if (revision !== request) return;
      paintCurrency(currency, quote);
      const localTime = new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short',
      }).format(timestamp);
      const message = '1 TWD = ' + quote.rate + ' ' + currency + '｜Google Finance 報價時間（台灣）' + localTime;
      note.textContent = message;
      reportNote.textContent = message;
    } catch {
      if (revision !== request) return;
      picker.value = 'TWD';
      paintCurrency('TWD');
      note.textContent = '目前無法取得匯率，金額以新台幣顯示。';
      reportNote.textContent = '金額以新台幣計';
    }
  });
})();
