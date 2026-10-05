'use client';

import { ContactAssignment, type Contact } from '@/components/referrals/contact-assignment';
import { IntroEmailsAction } from '@/components/referrals/intro-emails-action';
import { useRequestUpdate } from '@/components/referrals/request-update-button';
import { AutoReminderToggle } from '@/components/referrals/auto-reminder-toggle';
import { RailCard, RailDivided } from '@/components/referrals/referral-rail';

interface TeamCardProps {
  referral: any;
  viewerRole: string;
  isBothClientType: boolean;
  primarySide: 'buy' | 'sell';
  buySideContact: Contact | null;
  sellSideContact: Contact | null;
  mcContact: Contact | null;
  canAssignBuyAgent: boolean;
  canAssignSellAgent: boolean;
  canAssignPrimaryAgent: boolean;
  canAssignMc: boolean;
  onBuySideAgentContactChange?: (contact: Contact | null) => void;
  onSellSideAgentContactChange?: (contact: Contact | null) => void;
  onMcContactChange?: (contact: Contact | null) => void;
  pendingMcHelper?: string;
  showAgentCcField: boolean;
  showMcCcField: boolean;
}

/**
 * Who is working this referral plus the admin's outreach actions (intros, update requests,
 * automated reminders) in one rail card.
 */
export function TeamCard({
  referral,
  viewerRole,
  isBothClientType,
  primarySide,
  buySideContact,
  sellSideContact,
  mcContact,
  canAssignBuyAgent,
  canAssignSellAgent,
  canAssignPrimaryAgent,
  canAssignMc,
  onBuySideAgentContactChange,
  onSellSideAgentContactChange,
  onMcContactChange,
  pendingMcHelper,
  showAgentCcField,
  showMcCcField,
}: TeamCardProps) {
  const referralId = String(referral._id);
  const isAdmin = viewerRole === 'admin';
  const showMc = referral.clientType !== 'Seller';
  const primaryAgentContact = primarySide === 'sell' ? sellSideContact : buySideContact;

  const requestUpdate = useRequestUpdate({
    referralId,
    assignedAgent: primaryAgentContact,
    buySideAgent: buySideContact,
    sellSideAgent: sellSideContact,
    lastAutoReminderSentAt: referral.lastAutoReminderSentAt,
    lastManualReminderSentAt: referral.lastManualReminderSentAt,
    lastUpdateRequestResponseNotifiedAt: referral.lastUpdateRequestResponseNotifiedAt,
    autoRemindersEnabled: referral.autoUpdateRemindersEnabled || false,
    status: referral.status,
    lastPairedAt: referral.sla?.lastPairedAt,
    viewerRole,
  });

  return (
    <RailCard title="Team">
      <RailDivided>
        {isBothClientType ? (
          <>
            <ContactAssignment
              referralId={referralId}
              type="agent"
              side="buy"
              contact={buySideContact}
              canAssign={canAssignBuyAgent}
              onContactChange={onBuySideAgentContactChange}
            />
            <ContactAssignment
              referralId={referralId}
              type="agent"
              side="sell"
              contact={sellSideContact}
              canAssign={canAssignSellAgent}
              onContactChange={onSellSideAgentContactChange}
            />
          </>
        ) : (
          <ContactAssignment
            referralId={referralId}
            type="agent"
            side={primarySide}
            contact={primaryAgentContact}
            canAssign={canAssignPrimaryAgent}
            onContactChange={
              primarySide === 'sell' ? onSellSideAgentContactChange : onBuySideAgentContactChange
            }
          />
        )}
        {showMc ? (
          <ContactAssignment
            referralId={referralId}
            type="mc"
            contact={mcContact}
            canAssign={canAssignMc}
            onContactChange={onMcContactChange}
            pendingHelper={pendingMcHelper}
          />
        ) : null}
        {isAdmin ? (
          <div className="space-y-3">
            <p className="text-eyebrow text-foreground-subtle">Outreach</p>
            <IntroEmailsAction
              referral={referral}
              buyingAgent={buySideContact}
              sellingAgent={sellSideContact}
              mcContact={mcContact}
              showAgentCcField={showAgentCcField}
              showMcCcField={showMcCcField}
              secondaryAction={requestUpdate.trigger}
              statusSlot={
                <>
                  {requestUpdate.statusLine}
                  {requestUpdate.modal}
                </>
              }
            />
          </div>
        ) : null}
        {isAdmin ? (
          <AutoReminderToggle
            referralId={referralId}
            autoRemindersEnabled={referral.autoUpdateRemindersEnabled || false}
            viewerRole={viewerRole}
          />
        ) : null}
      </RailDivided>
    </RailCard>
  );
}
