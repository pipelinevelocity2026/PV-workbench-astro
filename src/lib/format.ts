const dateFormat = new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'})

export const formatDate = (iso: string) => dateFormat.format(new Date(iso))

/** "Updated" is shown only when the meaningful-modification date is a later day than publication. */
export function hasMeaningfulUpdate(publishedAt: string, modifiedAt?: string | null) {
  if (!modifiedAt) return false
  return new Date(modifiedAt).getTime() - new Date(publishedAt).getTime() >= 24 * 60 * 60 * 1000
}

export function paginationRange(current: number, total: number): (number | '…')[] {
  const pages = new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total))
  const sorted = [...pages].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('…')
    out.push(p)
  })
  return out
}
