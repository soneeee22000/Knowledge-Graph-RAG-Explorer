import type { EntityType } from '@kg/shared';

export interface EntityVisual {
  /** Solid accent color for the node border / chip. */
  color: string;
  /** Translucent fill used for the node body. */
  fill: string;
  /** Short glyph rendered in the node + legend. */
  glyph: string;
  label: string;
}

/** A deterministic, accessible palette keyed by entity type. */
export const ENTITY_VISUALS: Record<EntityType, EntityVisual> = {
  person: { color: '#f472b6', fill: 'rgba(244,114,182,0.12)', glyph: '◍', label: 'Person' },
  organization: { color: '#60a5fa', fill: 'rgba(96,165,250,0.12)', glyph: '▣', label: 'Organization' },
  location: { color: '#34d399', fill: 'rgba(52,211,153,0.12)', glyph: '⬢', label: 'Location' },
  concept: { color: '#a78bfa', fill: 'rgba(167,139,250,0.12)', glyph: '✦', label: 'Concept' },
  event: { color: '#fbbf24', fill: 'rgba(251,191,36,0.12)', glyph: '◆', label: 'Event' },
  product: { color: '#22d3ee', fill: 'rgba(34,211,238,0.12)', glyph: '▲', label: 'Product' },
  technology: { color: '#f87171', fill: 'rgba(248,113,113,0.12)', glyph: '⚙', label: 'Technology' },
  other: { color: '#94a3b8', fill: 'rgba(148,163,184,0.12)', glyph: '●', label: 'Other' },
};

export function visualFor(type: EntityType): EntityVisual {
  return ENTITY_VISUALS[type] ?? ENTITY_VISUALS.other;
}
