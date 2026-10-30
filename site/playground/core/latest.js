/** Page-side request ids: only the newest reply may update the display. */
export function createLatest() {
  let latest = 0;
  return {next: () => ++latest, isLatest: id => id === latest};
}
