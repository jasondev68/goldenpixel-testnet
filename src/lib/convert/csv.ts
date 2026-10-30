/** RFC 4180 CSV reading and writing with delimiter detection. */
export type CsvDelimiter = ',' | ';' | '\t' | '|'

export function detectDelimiter(text: string): CsvDelimiter {
  const sample = text.slice(0, 4000)
  const line = sample.split(/\r?\n/).find((l) => l.length > 0) ?? ''
  let best: CsvDelimiter = ','
  let bestCount = 0
  for (const d of [',', ';', '\t', '|'] as const) {
    let inQ = false
    let c = 0
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (ch === d && !inQ) c++
    }
    if (c > bestCount) {
      best = d
      bestCount = c
    }
  }
  return best
}

export function parseCsv(input: string, delimiter?: CsvDelimiter): { rows: string[][]; delimiter: CsvDelimiter } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const d = delimiter ?? detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQ = false
      } else field += ch
    } else if (ch === '"' && field === '') inQ = true
    else if (ch === d) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return { rows, delimiter: d }
}

export function toCsv(rows: string[][], delimiter: CsvDelimiter = ',', bom = true): string {
  const q = (v: string) => (v.includes(delimiter) || v.includes('"') || v.includes('\n') || v.includes('\r') ? `"${v.replace(/"/g, '""')}"` : v)
  return (bom ? '\uFEFF' : '') + rows.map((r) => r.map(q).join(delimiter)).join('\r\n') + (rows.length ? '\r\n' : '')
}
