import type { ComponentType } from 'react'
import { template as onboardingClientReminder } from './onboarding-client-reminder'
import { template as onboardingOwnerEscalation } from './onboarding-owner-escalation'
import { template as onboardingUnassignedReminder } from './onboarding-unassigned-reminder'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'onboarding-client-reminder': onboardingClientReminder,
  'onboarding-owner-escalation': onboardingOwnerEscalation,
  'onboarding-unassigned-reminder': onboardingUnassignedReminder,
}
