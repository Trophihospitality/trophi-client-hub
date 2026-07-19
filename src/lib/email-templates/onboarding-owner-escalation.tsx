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
  ownerName?: string
  companyName?: string
  contactName?: string
  stepNumber?: number
  stepName?: string
  detailUrl?: string
}

const GOLD = '#C9A24B'
const INK = '#141210'

const Email = ({
  ownerName = 'there',
  companyName = 'this client',
  contactName = 'the client contact',
  stepNumber = 0,
  stepName = 'a step',
  detailUrl = 'https://portal.trophihospitality.com',
}: Props) => (
  <Html lang="en">
    <Head />
    <Preview>{`${companyName} onboarding stalled — Step ${stepNumber}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Heading style={brand}>TROPHI HOSPITALITY</Heading>
        </Section>
        <Heading style={h1}>Escalation: onboarding needs a nudge</Heading>
        <Text style={p}>Hi {ownerName},</Text>
        <Text style={p}>
          <strong>{companyName}</strong> has been waiting on the client for 72+
          business hours at Step {stepNumber} — <strong>{stepName}</strong>.
        </Text>
        <Text style={p}>
          Client contact on file: {contactName}. A quick personal follow-up
          usually gets things moving.
        </Text>
        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={detailUrl} style={button}>
            Open Onboarding
          </Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>
          You'll keep getting this every 72 business hours until the step is
          complete.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) =>
    `Escalation: ${d.companyName ?? 'Client'} stalled at Step ${d.stepNumber ?? ''}`,
  displayName: 'Onboarding — Owner Escalation (72h)',
  previewData: {
    ownerName: 'Spiro',
    companyName: "Darla's Sweet Treats",
    contactName: 'Jane Doe',
    stepNumber: 4,
    stepName: 'Sign Contract & Authorization',
    detailUrl: 'https://portal.trophihospitality.com/onboarding/TRP-XXXXXX',
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
