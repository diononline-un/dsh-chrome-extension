/** Best-effort browser brand detection for status display. */
export function detectBrowser(): string {
  const ua = navigator.userAgent;
  const brands = (navigator as unknown as { userAgentData?: { brands?: Array<{ brand: string }> } })
    .userAgentData?.brands;
  if (brands) {
    for (const b of brands) {
      if (/brave/i.test(b.brand)) return "Brave";
      if (/edge/i.test(b.brand)) return "Edge";
      if (/opera|opr/i.test(b.brand)) return "Opera";
      if (/vivaldi/i.test(b.brand)) return "Vivaldi";
    }
  }
  if ((navigator as unknown as { brave?: unknown }).brave) return "Brave";
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Vivaldi/.test(ua)) return "Vivaldi";
  if (/Chromium/.test(ua)) return "Chromium";
  return "Chrome";
}
