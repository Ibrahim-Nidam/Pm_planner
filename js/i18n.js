// Internationalization module (SPECS §0 rule 7)

const strings = {
  en: {
    appName: "PM Planner",
    loginTitle: "Sign in to PM Planner",
    username: "Username",
    password: "Password",
    signIn: "Sign In",
    loggingIn: "Signing in...",
    logout: "Sign Out",
    profile: "Profile",
    changePassword: "Change Password",
    newPassword: "New Password",
    confirmPassword: "Confirm Password",
    savePassword: "Save Password",
    passwordChangedSuccess: "Password changed successfully",
    mustChangePasswordBanner: "Please change your default password for security.",
    tonight: "Tonight",
    noPmTonight: "No PM scheduled for tonight.",
    startPm: "Start PM",
    endPm: "End PM",
    notes: "Notes",
    photos: "Photos",
    postponeReason: "Postpone Reason",
    postponeReasonPlaceholder: "Provide a mandatory reason for performing this PM on an alternate night...",
    overdue: "Overdue",
    scheduled: "Scheduled",
    inProgress: "In Progress",
    completed: "Completed",
    draft: "Draft",
    approved: "Approved",
    generateSchedule: "Generate Schedule",
    approveSchedule: "Approve Schedule",
    printSchedule: "Print",
    replanNeeded: "Needs Re-planning",
    day: "Day",
    night: "Night",
    rest: "Rest",
    terminal1: "Terminal 1",
    transit: "Transit",
    actions: "Actions",
    edit: "Edit",
    resetPassword: "Reset Password",
    deactivate: "Deactivate",
    activate: "Activate",
    addTechnician: "Add Technician",
    addMachine: "Add Machine",
    cancel: "Cancel",
    save: "Save",
    confirm: "Confirm"
  }
};

export const currentLang = 'en';

export function t(key) {
  return (strings[currentLang] && strings[currentLang][key]) || key;
}
