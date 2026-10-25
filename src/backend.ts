import type { SpindleAPI, LlmMessageDTO } from 'lumiverse-spindle-types';

type Action = 'enhance' | 'write' | 'summarize';
type Job = { id: string; abort: AbortController; timer: ReturnType<typeof setTimeout> };
const channel = 'janitor_bridge:composer';
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value : ''; }

/** Uses native prompt assembly and native credentialed generation; never changes a chat. */
export function setupComposerBackend(api: SpindleAPI) {
  const jobs = new Map<string, Job>();
  let disposed = false;
  const off = api.onFrontendMessage((payload, userId, frontendSessionId) => {
    const request = record(payload);
    if (disposed || request.type !== channel || !userId || !frontendSessionId) return;
    const id = text(request.id);
    if (!id || id.length > 160) return;
    const owner = `${userId}\0${frontendSessionId}`;
    if (request.command === 'cancel') {
      const job = jobs.get(owner);
      if (job?.id === id) { job.abort.abort(); clearTimeout(job.timer); jobs.delete(owner); }
      return;
    }
    if (request.command !== 'generate') return;
    const action = text(request.action) as Action;
    const chatId = text(request.chatId);
    const draft = text(request.draft);
    if (!['enhance', 'write', 'summarize'].includes(action) || !chatId || chatId.length > 200 || draft.length > 100_000) return;
    const prior = jobs.get(owner);
    if (prior) { prior.abort.abort(); clearTimeout(prior.timer); }
    const abort = new AbortController();
    const job: Job = { id, abort, timer: setTimeout(() => abort.abort(), 120_000) };
    jobs.set(owner, job);
    const current = () => !disposed && jobs.get(owner) === job && !abort.signal.aborted;
    const reply = (result: Record<string, unknown>) => api.sendToFrontend({ type: channel, id, chatId, ...result }, userId, { frontendSessionId });
    void (async () => {
      try {
        const granted = await api.permissions.getGranted();
        if (!current()) return;
        if (!granted.includes('generation') || !granted.includes('chats')) { reply({ error: 'permission' }); return; }
        const chat = await api.chats.get(chatId, userId);
        if (!current()) return;
        if (!chat) { reply({ error: 'chat-unavailable' }); return; }
        const metadata = record(chat.metadata);
        // Match native chat dispatch: a valid chat binding wins over the global selection.
        const pinned = text(metadata.connection_profile_id);
        const requested = text(request.connectionId);
        // Resolve concrete IDs directly: the native list projection is paginated.
        let connection = pinned ? await api.connections.get(pinned, userId) : null;
        if (!current()) return;
        if (!connection && requested && requested !== pinned) connection = await api.connections.get(requested, userId);
        if (!current()) return;
        if (!connection && requested) { reply({ error: 'connection-unavailable' }); return; }
        if (!connection) {
          const profiles = await api.connections.list(userId);
          if (!current()) return;
          connection = profiles.find(p => p.is_default) ?? profiles[0] ?? null;
        }
        if (!connection) { reply({ error: 'connection-unavailable' }); return; }
        const assembled = await api.generate.dryRun({ chatId, connectionId: connection.id,
          personaId: text(request.personaId) || undefined, presetId: text(request.presetId) || undefined, generationType: 'normal' }, userId);
        if (!current()) return;
        const latestGranted = await api.permissions.getGranted();
        if (!current()) return;
        if (!latestGranted.includes('generation') || !latestGranted.includes('chats')) { reply({ error: 'permission' }); return; }
        const instruction = action === 'enhance'
          ? 'You are helping the user edit their unsent roleplay message. Rewrite only the draft below to improve clarity, grammar, flow, and expressive detail while preserving its meaning, point of view, boundaries, and intended actions. Do not invent major actions or events. Do not answer as the character. Return only the improved user message, without a heading, explanation, or quotation wrapper.'
          : action === 'write'
            ? 'You are helping the user compose their next roleplay message, speaking as the user persona rather than the character. Use the conversation, persona, and any unsent draft as context. Write one natural next user turn. Do not write the character’s response, invent outcomes for other characters, or add a heading or explanation. Return only the suggested user message.'
            : 'Create a concise factual long-term memory summary of this conversation for future roleplay. Capture established identities, relationships, important events, current situation, promises, and unresolved threads. Include only facts supported by the conversation; distinguish plans from completed events. Preserve useful existing memory and remove repetition. Do not continue the roleplay. Return only the summary for the user to review.';
        const messages: LlmMessageDTO[] = [...assembled.messages,
          { role: 'system', content: instruction },
          { role: 'user', content: action === 'summarize' ? 'Summarize the conversation above for long-term memory.' : `Unsent user draft:\n${draft || '(No draft yet. Suggest a next user turn.)'}` }];
        const result = record(await api.generate.quiet({ type: 'quiet', userId, connection_id: connection.id,
          messages, parameters: { ...assembled.parameters, model: assembled.model }, signal: abort.signal }));
        if (!current()) return;
        const content = text(result.content).trim();
        if (!content) { reply({ error: 'empty' }); return; }
        reply({ content });
      } catch {
        if (!disposed && jobs.get(owner) === job) reply({ error: abort.signal.aborted ? 'cancelled' : 'generation-failed' });
      } finally {
        clearTimeout(job.timer);
        if (jobs.get(owner) === job) jobs.delete(owner);
      }
    })();
  });
  return () => { disposed = true; off(); for (const job of jobs.values()) { clearTimeout(job.timer); job.abort.abort(); } jobs.clear(); };
}

declare const spindle: SpindleAPI;
if (typeof spindle !== 'undefined') setupComposerBackend(spindle);
