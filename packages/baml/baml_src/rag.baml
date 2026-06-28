// Grounded question answering over retrieved context. The model must answer
// ONLY from the provided context and report which entities it leaned on, so the
// frontend can highlight them on the graph (transparent "thought process").

class GroundedAnswer {
  answer string @description("Concise answer grounded strictly in the context.")
  used_entities string[] @description("Names of entities the answer relied on.")
  confidence float @description("Self-assessed confidence in [0,1].")
}

function AnswerQuestion(question: string, context: string) -> GroundedAnswer {
  client Primary
  prompt #"
    You are a careful research assistant. Answer the question using ONLY the
    context below. If the context is insufficient, say so plainly rather than
    guessing. Cite the entities you used by their names.

    Question:
    {{ question }}

    Context:
    ---
    {{ context }}
    ---

    {{ ctx.output_format }}
  "#
}

test answer_basic {
  functions [AnswerQuestion]
  args {
    question "What language is Mastra built in?"
    context "Mastra AI is a TypeScript framework for building agentic workflows."
  }
}
