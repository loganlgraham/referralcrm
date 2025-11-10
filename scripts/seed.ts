import 'dotenv/config';
import { connectMongo } from '../src/lib/mongoose';
import { Referral } from '../src/models/referral';
import { Agent } from '../src/models/agent';
import { LenderMC } from '../src/models/lender';
import { Payment } from '../src/models/payment';

async function main() {
  await connectMongo();

  await Promise.all([Referral.deleteMany({}), Agent.deleteMany({}), LenderMC.deleteMany({}), Payment.deleteMany({})]);

  const agents = await Agent.insertMany([
    {
      name: 'Alex Agent',
      email: 'alex.agent@aha.com',
      phone: '555-555-1001',
      statesLicensed: ['CO', 'UT'],
      zipCoverage: ['80202', '84060'],
      closings12mo: 12,
      closingRatePercentage: 68,
      npsScore: 86,
      avgResponseHours: 1.5,
      brokerage: 'AHA',
      markets: ['Denver', 'Park City']
    },
    {
      name: 'Jamie Broker',
      email: 'jamie.broker@aha.com',
      phone: '555-555-1002',
      statesLicensed: ['AZ'],
      zipCoverage: ['85004'],
      closings12mo: 9,
      closingRatePercentage: 54,
      npsScore: 90,
      avgResponseHours: 0.8,
      brokerage: 'AHA',
      markets: ['Phoenix']
    }
  ]);

  const lenders = await LenderMC.insertMany([
    {
      name: 'Morgan Consultant',
      email: 'morgan.consultant@afc.com',
      phone: '555-555-2001',
      nmlsId: '123456',
      licensedStates: ['CO', 'UT'],
      team: 'Rockies',
      region: 'Mountain'
    }
  ]);

  const referral = await Referral.create({
    borrower: {
      name: 'Taylor Borrower',
      email: 'taylor.borrower@example.com',
      phone: '555-555-3001'
    },
    source: 'MC',
    endorser: 'Morgan Consultant',
    clientType: 'Buyer',
    lookingInZip: '80202',
    borrowerCurrentAddress: '456 Elm St, Denver, CO 80211',
    propertyAddress: '123 Market St, Denver, CO 80202',
    stageOnTransfer: 'Initial Contact',
    loanFileNumber: 'LFN-1001',
    initialNotes: 'Prefers weekend showings.',
    assignedAgent: agents[0]._id,
    lender: lenders[0]._id,
    status: 'In Communication',
    commissionBasisPoints: 300,
    referralFeeBasisPoints: 2500,
    referralFeeDueCents: 337500,
    estPurchasePriceCents: 45000000,
    audit: [
      {
        actorId: agents[0]._id,
        actorRole: 'agent',
        field: 'status',
        previousValue: 'New Lead',
        newValue: 'In Communication',
        timestamp: new Date()
      }
    ]
  });

  await Payment.create({
    referralId: referral._id,
    status: 'under_contract',
    expectedAmountCents: referral.referralFeeDueCents
  });

  console.log('Seed data loaded');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
