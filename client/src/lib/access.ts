export function canLoadOperations(hasAdministratorSession: boolean) {
  return hasAdministratorSession;
}

export function operationsAccessNotice(hasAdministratorSession: boolean) {
  if (hasAdministratorSession) return null;
  return {
    heading: "Unlock Operations",
    detail: "Enter the administrator password to view aggregate protection health. Public FMHY search remains available without an account.",
    actionLabel: "Unlock Operations",
  };
}
