export function preferredEmbedVideoId(
  discoveredVideoId: unknown,
  domVideoId: unknown,
): string | null {
  return validVideoId(discoveredVideoId) ?? validVideoId(domVideoId);
}

function validVideoId(value: unknown): string | null {
  return typeof value === 'string' && /^[\w-]{11}$/.test(value) ? value : null;
}
