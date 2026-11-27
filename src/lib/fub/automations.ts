export type FubEnrollment = { id: number; automationId: number; name: string; status: string };
export type AutomationChoice = { id: number; name: string; previousId: number };
export type AutomationList = { personId: number; enrollments: FubEnrollment[]; choices: AutomationChoice[] };
export type ReferralAutomationList = AutomationList & { isAdmin: boolean; canStart: boolean };
