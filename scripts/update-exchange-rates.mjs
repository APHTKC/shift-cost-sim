import { writeFile } from 'node:fs/promises';

async function googleQuote(currency) {
  const url = 'https://www.google.com/finance/beta/quote/TWD-' + currency + '?hl=en';
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(currency + ' Google Finance HTTP ' + response.status);
  const html = await response.text();
  const pair = new RegExp('"TWD / ' + currency + '",3,null,\\[([0-9.eE+-]+),[^\\]]*\\],null,[^,]+,null,null,null,\\[(\\d{10})\\]');
  const match = html.match(pair);
  const rate = Number(match?.[1]);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(currency + ' Google Finance quote unavailable');
  return { rate, quotedAt: new Date(Number(match[2]) * 1000).toISOString() };
}

const [USD, JPY] = await Promise.all([googleQuote('USD'), googleQuote('JPY')]);
await writeFile(process.argv[2] ?? 'exchange-rates.json',
  JSON.stringify({ source: 'Google Finance', base: 'TWD', quotes: { USD, JPY } }, null, 2) + '\n');
