// The audience join page with the session code filled in.
export function joinLinkFor(code, origin = window.location.origin) {
  return `${origin}/join?code=${encodeURIComponent(code)}`;
}
