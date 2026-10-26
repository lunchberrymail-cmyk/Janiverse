type Json = Record<string, unknown>;

/**
 * Janiverse's independently authored standard base, using Loom's public block
 * and macro interface. This is not a copy of Lumiverse's stock prompt template.
 * The first block ID is retained so the editor can address the simple prompt
 * consistently. An empty preset ID means a local draft, never a native row.
 */
export function createCustomDefault() {
  function context(id: string, name: string, marker: string | null, content = ''): Json {
    return { id, name, marker, content, role: 'system', enabled: true, position: 'pre_history', depth: 0, isLocked: true, injectionTrigger: [], characterTagTrigger: [] };
  }
  return {
    id: '', name: 'Custom prompt (standard base)', provider: 'loom', engine: 'classic', cache_revision: 0,
    parameters: {
      samplerOverrides: { enabled: true, temperature: null, maxTokens: null, contextSize: null, topP: null, topK: null, frequencyPenalty: null, repetitionPenalty: null, streaming: true },
      customBody: { enabled: false, rawJson: '{}' },
    },
    // Omitted behavior prompts retain the native runtime's generation defaults.
    prompts: { completionSettings: { useSystemPrompt: true, assistantPrefill: '', sendInlineMedia: true, enableFunctionCalling: true } },
    metadata: { source: null, schemaVersion: 1, modelProfiles: {}, promptVariables: {}, _janiverse_standard_base: { version: 1 } },
    prompt_order: [
      { ...context('019e62a4-7dba-7001-a422-10836ade35dd', 'Global prompt', null, 'Continue the scene as {{char}}, using the character information and conversation below. Leave {{user}} in control of their own words and actions.'), isLocked: false },
      context('janiverse-standard-lore-before', 'Lore before character', 'world_info_before'),
      context('janiverse-standard-description', 'Character', 'char_description'),
      context('janiverse-standard-personality', 'Personality', 'char_personality'),
      context('janiverse-standard-scenario', 'Scenario', 'scenario'),
      context('janiverse-standard-persona', 'Your persona', 'persona_description'),
      context('janiverse-standard-examples', 'Character examples', 'dialogue_examples'),
      context('janiverse-standard-lore-after', 'Lore after character', 'world_info_after'),
      context('janiverse-standard-memory', 'Summary and memories', null, '{{loomSummary}}\n{{memories}}'),
      context('janiverse-standard-cortex', 'Memory Cortex', null, '{{if {{cortexActive}} = yes}}\n{{entities}}\n{{relationships}}\n{{arc}}\n{{memorySalience}}\n{{/if}}'),
      context('janiverse-standard-history', 'Conversation', 'chat_history'),
    ],
  };
}
