// Only same-site paths are accepted as ?next=, so a crafted link cannot send a user to
// another site after signing in.
export function safeNext(value) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}
