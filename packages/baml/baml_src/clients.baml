// LLM client definitions. BAML decouples the prompt/function from the
// underlying provider, so the same function can run on a European-sovereign
// model, Claude, or GPT just by swapping the client.
//
// Keys are read from the environment at call time; nothing here requires a key
// at import/codegen time.

client<llm> Claude {
  provider anthropic
  options {
    model "claude-sonnet-4-6"
    api_key env.ANTHROPIC_API_KEY
    max_tokens 2048
  }
}

client<llm> GPT4o {
  provider openai
  options {
    model "gpt-4o"
    api_key env.OPENAI_API_KEY
    max_tokens 2048
  }
}

client<llm> Mistral {
  provider openai-generic
  options {
    base_url "https://api.mistral.ai/v1"
    model "mistral-large-latest"
    api_key env.MISTRAL_API_KEY
    max_tokens 2048
  }
}

// Primary client with automatic fallback: try Claude, then GPT-4o, then Mistral.
// Demonstrates resilient, provider-agnostic LLM integration.
client<llm> Primary {
  provider fallback
  options {
    strategy [Claude, GPT4o, Mistral]
  }
}
