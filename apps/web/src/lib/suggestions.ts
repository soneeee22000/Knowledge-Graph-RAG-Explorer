/** Starter questions for the sample passage users paste in when running locally. */
export const LOCAL_SUGGESTIONS: readonly string[] = [
  'What is Mistral AI and who founded it?',
  'How does the EU AI Act classify risk?',
  'How do knowledge graphs improve RAG?',
];

/** Starter questions for the fictional rail corpus the read-only demo seeds. */
export const DEMO_SUGGESTIONS: readonly string[] = [
  'Who chairs the board of the Valdane Transport Authority?',
  'Which company builds the trains that run on the Amber Line?',
  'Which depot services the trains of the Cobalt Line?',
];

/** The starter questions that match the corpus the backend serves. */
export function suggestionsFor(readOnly: boolean): readonly string[] {
  return readOnly ? DEMO_SUGGESTIONS : LOCAL_SUGGESTIONS;
}
