const SHAPES = {
  weekend: `
    <path fill="#244773" d="M6 12 32 5l11 27-28 9z"/>
    <path fill="#416cb6" d="M6 11h32l-3 25-7 7H3z"/>
    <path fill="#d3e0f3" d="M5.3 18h31.8l-2.3 17-7.5 7H2.6z"/>
    <path fill="#88a7d4" d="m27.3 42 1.1-8 6.4 1z"/>
    <path fill="#4772b6" d="m12 24 6 0-.6 5h-6zm10 0h6l-.6 5h-6z"/>`,
  budget: `
    <path fill="#568e7c" d="m4 16 27-12 7 13-32 4z"/>
    <path fill="#bacfb1" d="m12 17 25-9 6 13-31 6z"/>
    <path fill="#356e60" d="m4 17 38 1-3 22H7z"/>
    <path fill="#81aa91" d="m4 17 29 10 9-9z"/>
    <path fill="#b2cab3" d="m32 25 12-.5-1 7.5H31z"/>
    <circle cx="35" cy="28.5" r="1.4" fill="#356e60"/>`,
  sea: `
    <path fill="#e0a858" d="m29 4 6 21-16-1z"/>
    <path fill="#e3c890" d="m15 9 3 16-11 1z"/>
    <path fill="#c3d8cf" d="m5 25 36-3-16 11z"/>
    <path fill="#488e89" d="m2 23 23 8 19-10-9 16-20 2z"/>
    <path fill="#245d65" d="m2 23 23 8-10 8z"/>
    <path fill="#6ca8a2" d="m17 40 21-2-6 3z"/>`,
  hot: `
    <path fill="#b64439" d="M8 31 14 17 18 22 28 3 32 18 38 15 40 32 30 43 17 42Z"/>
    <path fill="#e48a54" d="M17 42 19 29 25 31 31 18 30 43Z"/>`,
  holidays: `
    <path fill="#497968" d="M24 3 9 22 15 22 4 38 43 38 32 22 38 22Z"/>
    <path fill="#83a48c" d="M24 3 24 38 4 38 18 23 9 22Z"/>
    <path fill="#795f49" d="M20 38h8v6h-8z"/>`,
  mountains: `
    <path fill="#66839c" d="M2 38 19 8 28 23 34 15 47 38Z"/>
    <path fill="#345670" d="M19 8 22 38 36 38Z"/>
    <path fill="#cbdfe4" d="M13 19 19 8 25 18 20 16 17 20Z"/>`,
  food: `
    <path fill="#a75e49" d="M3 21h42L34 37H14Z"/>
    <path fill="#d59a74" d="M3 21 28 28 14 37Z"/>
    <path fill="#784a40" d="M14 37h20l-3 4H17Z"/>
    <path fill="#838a91" d="M15 18 18 12 15 5 21 12 18 18ZM25 18l4-8-2-6 6 7-5 7Z"/>`,
  city2: `
    <path fill="#85612e" d="M16 16V8l3-3h10l3 3v8h-4V9h-8v7Z"/>
    <path fill="#d6a75e" d="M4 14h39v24l-4 4H7Z"/>
    <path fill="#ae803e" d="M4 14 15 21l-8 21Zm39 0v24l-4 4-4-24Z"/>`,
  recent: `
    <path fill="#506784" d="M14 4h20l11 12v16L32 44H15L3 33V16Z"/>
    <path fill="#8da6bf" d="M14 4 3 33l12 11 4-32Z"/>
    <path fill="#edf3f6" d="M22 12h4v12l9 5-2 3-11-6Z"/>`,
};

export function sticker(key) {
  return `<svg class="sticker" viewBox="0 0 48 48" aria-hidden="true">${SHAPES[key] ?? SHAPES.weekend}</svg>`;
}

// Какая наклейка у подборки главной.
export function rowSticker(row) {
  if (row.key.startsWith('weekend')) return 'weekend';
  if (row.key.startsWith('budget')) return 'budget';
  if (row.key === 'holidays') return row.title === 'Новогодние каникулы' ? 'holidays' : 'weekend';
  return SHAPES[row.key] ? row.key : 'weekend';
}
