import * as React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  contactName?: string
  companyName?: string
  stepNumber?: number
  stepName?: string
  portalUrl?: string
}

const GOLD = '#C9A24B'
const INK = '#141210'

const Email = ({
  contactName = 'there',
  companyName = 'your team',
  stepNumber = 0,
  stepName = 'a pending onboarding step',
  portalUrl = 'https://portal.trophihospitality.com',
}: Props) => (
  <Html lang="en">
    <Head />
    <Preview>
      {`Reminder: ${stepName} is waiting on ${companyName}`}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Heading style={brand}>TROPHI HOSPITALITY</Heading>
        </Section>
        <Heading style={h1}>Quick nudge on your onboarding</Heading>
        <Text style={p}>Hi {contactName},</Text>
        <Text style={p}>
          We're ready to keep {companyName}'s onboarding moving. Step{' '}
          {stepNumber} — <strong>{stepName}</strong> — is currently waiting on
          you.
        </Text>
        <Text style={p}>
          Completing this step now keeps your launch on schedule.
        </Text>
        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={portalUrl} style={button}>
            Open Client Portal
          </Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>
          Trophi Hospitality · Revenue growth for restaurants
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) =>
    `Reminder: Step ${d.stepNumber ?? ''} — ${d.stepName ?? 'onboarding'} is waiting on you`,
  displayName: 'Onboarding — Client Reminder (48h)',
  previewData: {
    contactName: 'Jane',
    companyName: "Darla's Sweet Treats",
    stepNumber: 4,
    stepName: 'Sign Contract & Authorization',
    portalUrl: 'https://portal.trophihospitality.com',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Helvetica, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const header = { borderBottom: `2px solid ${GOLD}`, paddingBottom: '12px', marginBottom: '24px' }
const brand = { color: GOLD, fontSize: '18px', letterSpacing: '2px', margin: 0 }
const h1 = { color: INK, fontSize: '22px', margin: '0 0 12px' }
const p = { color: INK, fontSize: '15px', lineHeight: '22px', margin: '0 0 12px' }
const button = {
  backgroundColor: INK,
  color: GOLD,
  padding: '12px 22px',
  borderRadius: '6px',
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: '14px',
}
const hr = { borderColor: '#eee', margin: '28px 0 12px' }
const footer = { color: '#888', fontSize: '12px' }
