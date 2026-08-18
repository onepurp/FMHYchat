/**
 * Render Web Services receive public HTTP traffic only through this interface.
 * Keeping the value centralized makes the provider requirement explicit and testable.
 */
export function publicServerHost(): string {
  return "0.0.0.0";
}
