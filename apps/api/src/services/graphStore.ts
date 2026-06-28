import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DirectedGraph } from 'graphology';
import type { Entity, EntityType, KnowledgeGraph, Relation } from '@kg/shared';
import type { ExtractedEntity, ExtractedRelation } from '../llm/provider.js';

/** Node attributes stored on the graphology graph. */
interface NodeAttrs {
  label: string;
  type: EntityType;
  properties: Record<string, string>;
  sourceChunkIds: string[];
  salience: number;
}

/** Edge attributes stored on the graphology graph. */
interface EdgeAttrs {
  id: string;
  type: string;
  label: string;
  weight: number;
  sourceChunkIds: string[];
}

/** Stable, filesystem-safe id for an entity from its normalized identity. */
function entityId(type: EntityType, label: string): string {
  const norm = `${type}:${label.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  return 'ent_' + simpleHash(norm);
}

function relationId(sourceId: string, targetId: string, type: string): string {
  return 'rel_' + simpleHash(`${sourceId}->${targetId}:${type}`);
}

/** Short deterministic hex hash (djb2). */
function simpleHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return (h >>> 0).toString(16);
}

function mergeUnique(existing: string[], incoming: string[]): string[] {
  const set = new Set(existing);
  for (const v of incoming) set.add(v);
  return [...set];
}

/**
 * Knowledge graph store wrapping a graphology `DirectedGraph`.
 *
 * - Entities are deduped by normalized (type + label); provenance chunk ids and
 *   properties merge across mentions.
 * - Salience is degree centrality normalized to [0, 1].
 * - Exports to the @kg/shared `KnowledgeGraph` shape and persists to JSON.
 */
export class GraphStore {
  private graph = new DirectedGraph<NodeAttrs, EdgeAttrs>();

  constructor(private readonly dataDir: string) {}

  private get filePath(): string {
    return join(this.dataDir, 'graph.json');
  }

  get entityCount(): number {
    return this.graph.order;
  }

  get relationCount(): number {
    return this.graph.size;
  }

  /** Add or merge a single entity; returns its stable id. */
  upsertEntity(entity: ExtractedEntity, sourceChunkIds: string[] = []): string {
    const id = entityId(entity.type, entity.label);
    if (this.graph.hasNode(id)) {
      const attrs = this.graph.getNodeAttributes(id);
      this.graph.mergeNodeAttributes(id, {
        properties: { ...attrs.properties, ...(entity.properties ?? {}) },
        sourceChunkIds: mergeUnique(attrs.sourceChunkIds, sourceChunkIds),
      });
    } else {
      this.graph.addNode(id, {
        label: entity.label,
        type: entity.type,
        properties: { ...(entity.properties ?? {}) },
        sourceChunkIds: [...sourceChunkIds],
        salience: 0,
      });
    }
    return id;
  }

  /** Add or merge a relation between two already-known entity labels. */
  upsertRelation(relation: ExtractedRelation, sourceChunkIds: string[] = []): string | undefined {
    const sourceId = this.findIdByLabel(relation.sourceLabel);
    const targetId = this.findIdByLabel(relation.targetLabel);
    if (!sourceId || !targetId || sourceId === targetId) return undefined;

    const id = relationId(sourceId, targetId, relation.type);
    if (this.graph.hasDirectedEdge(sourceId, targetId)) {
      const edge = this.graph.directedEdge(sourceId, targetId);
      if (edge) {
        const attrs = this.graph.getEdgeAttributes(edge);
        this.graph.mergeEdgeAttributes(edge, {
          weight: Math.max(attrs.weight, relation.weight),
          sourceChunkIds: mergeUnique(attrs.sourceChunkIds, sourceChunkIds),
        });
        return attrs.id;
      }
    }
    this.graph.addDirectedEdgeWithKey(id, sourceId, targetId, {
      id,
      type: relation.type,
      label: relation.label,
      weight: relation.weight,
      sourceChunkIds: [...sourceChunkIds],
    });
    return id;
  }

  /** Look up an entity id from any known label (case-insensitive). */
  findIdByLabel(label: string): string | undefined {
    const norm = label.toLowerCase().replace(/\s+/g, ' ').trim();
    let found: string | undefined;
    this.graph.forEachNode((node, attrs) => {
      if (found) return;
      if (attrs.label.toLowerCase().replace(/\s+/g, ' ').trim() === norm) found = node;
    });
    return found;
  }

  /**
   * Merge an extracted sub-graph (from one chunk) into the store.
   * Relations are only added between entities present in this extraction.
   */
  mergeExtraction(
    entities: ExtractedEntity[],
    relations: ExtractedRelation[],
    sourceChunkIds: string[],
  ): void {
    for (const e of entities) this.upsertEntity(e, sourceChunkIds);
    for (const r of relations) this.upsertRelation(r, sourceChunkIds);
    this.recomputeSalience();
  }

  /**
   * Recompute salience from degree centrality, rescaled by the max so the
   * most-connected node trends toward 1 even on sparse graphs. Clamped to [0, 1].
   */
  recomputeSalience(): void {
    const n = this.graph.order;
    if (n === 0) return;
    if (n === 1) {
      this.graph.forEachNode((node) => this.graph.setNodeAttribute(node, 'salience', 1));
      return;
    }
    // Degree centrality = degree / (N-1), in [0, 1]; rescaled by the max so the
    // most-connected node trends toward 1 even on sparse graphs.
    const centrality = new Map<string, number>();
    let max = 0;
    this.graph.forEachNode((node) => {
      const c = this.graph.degree(node) / (n - 1);
      centrality.set(node, c);
      if (c > max) max = c;
    });
    this.graph.forEachNode((node) => {
      const c = centrality.get(node) ?? 0;
      const norm = max > 0 ? c / max : 0;
      this.graph.setNodeAttribute(node, 'salience', Math.max(0, Math.min(1, norm)));
    });
  }

  /** Get a single entity in shared-domain shape. */
  getEntity(id: string): Entity | undefined {
    if (!this.graph.hasNode(id)) return undefined;
    const a = this.graph.getNodeAttributes(id);
    return {
      id,
      label: a.label,
      type: a.type,
      properties: a.properties,
      sourceChunkIds: a.sourceChunkIds,
      salience: a.salience,
    };
  }

  /**
   * BFS neighborhood of `entityId` up to `depth` hops (directed edges traversed
   * in both directions). Returns the touched entities and the relations among
   * them in shared-domain shape.
   */
  neighbors(entityId: string, depth = 1): KnowledgeGraph {
    if (!this.graph.hasNode(entityId)) return { entities: [], relations: [] };

    const visited = new Set<string>([entityId]);
    let frontier: string[] = [entityId];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const node of frontier) {
        this.graph.forEachNeighbor(node, (neighbor) => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
          }
        });
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    const entities: Entity[] = [];
    for (const id of visited) {
      const e = this.getEntity(id);
      if (e) entities.push(e);
    }

    const relations: Relation[] = [];
    this.graph.forEachEdge((_edge, attrs, source, target) => {
      if (visited.has(source) && visited.has(target)) {
        relations.push({
          id: attrs.id,
          sourceId: source,
          targetId: target,
          type: attrs.type,
          label: attrs.label,
          weight: attrs.weight,
          sourceChunkIds: attrs.sourceChunkIds,
        });
      }
    });

    return { entities, relations };
  }

  /** Export the entire graph to the shared `KnowledgeGraph` shape. */
  toKnowledgeGraph(): KnowledgeGraph {
    const entities: Entity[] = [];
    this.graph.forEachNode((id, a) => {
      entities.push({
        id,
        label: a.label,
        type: a.type,
        properties: a.properties,
        sourceChunkIds: a.sourceChunkIds,
        salience: a.salience,
      });
    });
    const relations: Relation[] = [];
    this.graph.forEachEdge((_edge, a, source, target) => {
      relations.push({
        id: a.id,
        sourceId: source,
        targetId: target,
        type: a.type,
        label: a.label,
        weight: a.weight,
        sourceChunkIds: a.sourceChunkIds,
      });
    });
    return { entities, relations };
  }

  clear(): void {
    this.graph.clear();
  }

  /** Persist the serialized graphology graph to `${dataDir}/graph.json`. */
  async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.graph.export()), 'utf8');
  }

  /** Load a serialized graph from disk; no-op if the file is absent. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      const g = new DirectedGraph<NodeAttrs, EdgeAttrs>();
      g.import(data);
      this.graph = g;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.graph = new DirectedGraph<NodeAttrs, EdgeAttrs>();
        return;
      }
      throw err;
    }
  }
}
