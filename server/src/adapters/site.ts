export interface SiteRef {
  id: string;
  internalReference?: string;
  name?: string;
}

export interface SiteResolution<T extends SiteRef> {
  site?: T;
  warning?: string;
  error?: string;
}

/**
 * Single-site resolution (the supported 1.0 behavior). Exactly one site is
 * processed so device IDs can't collide and gateway/WAN selection is
 * deterministic:
 *   - a configured `siteId` must match (else an error),
 *   - one site → use it,
 *   - multiple sites + no `siteId` → deterministically pick the lowest id and
 *     warn (auto-resolve, not ambiguous-fail, so it still works out of the box).
 */
export function resolveSingleSite<T extends SiteRef>(
  sites: T[],
  siteId?: string
): SiteResolution<T> {
  if (!sites || sites.length === 0) return { error: 'No sites returned by the controller' };

  if (siteId) {
    const match = sites.find(s => s.id === siteId || s.internalReference === siteId);
    if (!match) {
      return { error: `Configured siteId "${siteId}" not found among ${sites.length} site(s)` };
    }
    return { site: match };
  }

  if (sites.length === 1) return { site: sites[0] };

  const chosen = [...sites].sort((a, b) => a.id.localeCompare(b.id))[0];
  return {
    site: chosen,
    warning:
      `Multiple sites (${sites.length}) found but no siteId configured; ` +
      `using "${chosen.name || chosen.id}". Set adapters.integrationApi.siteId to choose explicitly.`,
  };
}
