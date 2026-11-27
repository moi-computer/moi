export function slugFromLabel(label: string, maxLength?: number): string {
  return label
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, maxLength)
    .replace(/^-|-$/g, '')
}

export function labelFromSlug(slug: string): string {
  const name = slug.replaceAll('-', ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}
