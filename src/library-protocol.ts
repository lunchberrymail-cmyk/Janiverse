import type { CharacterCreateDTO, CharacterDTO, PersonaDTO } from 'lumiverse-spindle-types';

export type LibrarySave =
  | { operation: 'character.create'; input: CharacterCreateDTO }
  | { operation: 'persona.create'; input: { name: string; description: string } }
  | { operation: 'portrait.save'; characterId: string; uploadId: string; mimeType: string }
  | { operation: 'soundtrack.save'; characterId: string; track: string | null };
export type LibraryResult = CharacterDTO | PersonaDTO;
export const libraryChannel = 'janitor_bridge:library';
export type LibraryFailure = 'rejected' | 'unavailable' | 'unknown';
// Preserve the existing creator limit, including its original framing headroom.
export const portraitLimit = 10 * 1024 * 1024 - 64 * 1024;
