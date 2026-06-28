// Knowledge-graph extraction. Given a chunk of source text, return the
// entities and the typed relations between them. The enum + class shapes line
// up with the @kg/shared domain contracts so mapping is mechanical.

enum EntityType {
  Person
  Organization
  Location
  Concept
  Event
  Product
  Technology
  Other
}

class ExtractedEntity {
  name string @description("Canonical surface form, e.g. \"Mastra AI\".")
  type EntityType
  description string? @description("One short clause of context, if available.")
}

class ExtractedRelation {
  source string @description("name of the source entity")
  target string @description("name of the target entity")
  type string @description("UPPER_SNAKE machine label, e.g. BUILT_WITH")
  label string @description("human-readable label, e.g. \"built with\"")
}

class GraphExtraction {
  entities ExtractedEntity[]
  relations ExtractedRelation[]
}

function ExtractKnowledgeGraph(chunk: string) -> GraphExtraction {
  client Primary
  prompt #"
    You are a meticulous information-extraction engine building a knowledge graph.
    From the passage below, extract the salient entities and the directed,
    typed relations connecting them. Only use entities you actually find in the
    text. Prefer specific, canonical names. Keep relations grounded in the text.

    Passage:
    ---
    {{ chunk }}
    ---

    {{ ctx.output_format }}
  "#
}

test extract_basic {
  functions [ExtractKnowledgeGraph]
  args {
    chunk #"
      Mastra AI is a TypeScript framework for building agentic workflows.
      It was created by the team behind Gatsby and integrates with BoundaryML's
      BAML for typed LLM calls.
    "#
  }
}
