import type { Meta, StoryObj } from '@storybook/react';
import { DonationLeaderboard as DonationLeaderboard } from '@pratherbytecraft/supporter';
import type { Donation } from '@pratherbytecraft/contributions';

const names = [
  'Hannah', 'Sunglasses', 'Rain', 'Charlie', 'Diana', 'Eve', 'Frank',
  'Grace', 'Hank', 'Ivy', 'Jack', 'Karen', 'Leo', 'Mona', 'Nate',
  'Olivia', 'Pete', 'Quinn', 'Rita', 'Sam', 'Tina', 'Uma', 'Vic', 'Wendy',
];

const monthsAgo = (months: number) =>
  new Date(Date.now() - months * 30 * 86400000).toISOString();

/**
 * Build 24 unique donors with varying amounts so that top 5% (ceil(24*0.05)=2)
 * shows meaningful entries on the leaderboard.
 */
const buildLargeDonorPool = (): Donation[] => {
  const donations: Donation[] = [];

  // Top donor: $200 total (big tip + subscription history)
  donations.push(
    { donorId: 'd1', transactionId: 't-d1-tip', timestamp: new Date().toISOString(), type: 'Tip', fromName: names[0], message: 'Best tool ever!', amount: 150, currency: 'USD' },
  );
  // Add 6 subscription payments for Hannah
  for (let m = 0; m < 6; m++) {
    donations.push({
      donorId: 'd1', transactionId: `t-d1-sub-${m}`, timestamp: monthsAgo(m),
      type: 'Monthly Tip', fromName: names[0], message: '', amount: 5, currency: 'USD',
    });
  }

  // Second donor: $100
  donations.push(
    { donorId: 'd2', transactionId: 't-d2', timestamp: new Date(Date.now() - 86400000).toISOString(), type: 'Tip', fromName: names[1], message: 'Great tool!', amount: 100, currency: 'USD' },
  );

  // Remaining 22 donors with decreasing amounts
  for (let i = 2; i < 24; i++) {
    donations.push({
      donorId: `d${i + 1}`,
      transactionId: `t-d${i + 1}`,
      timestamp: new Date(Date.now() - i * 86400000).toISOString(),
      type: i % 5 === 0 ? 'Monthly Tip' : 'Tip',
      fromName: names[i],
      message: i % 4 === 0 ? 'Thanks!' : '',
      amount: Math.max(3, 50 - i * 2),
      currency: 'USD',
    });
  }

  return donations;
};

const largeDonorPool = buildLargeDonorPool();

const meta: Meta<typeof DonationLeaderboard> = {
  title: 'Donations/DonationLeaderboard',
  component: DonationLeaderboard,
  tags: ['autodocs'],
  decorators: [(Story) => <div style={{ maxWidth: 300, height: 500, overflow: 'auto', padding: 16 }}><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof DonationLeaderboard>;

export const Top5Percent: Story = {
  name: 'Top 5% (24 donors, shows top 2)',
  args: { donations: largeDonorPool, visibleCount: 25 },
};

export const WithSubscribers: Story = {
  name: 'Top donors with subscription info',
  args: {
    donations: [
      // Top donor with subscription streak shown on leaderboard entry
      ...Array.from({ length: 8 }, (_, i) => ({
        donorId: 'd1', transactionId: `sub-${i}`, timestamp: monthsAgo(i),
        type: 'Monthly Tip' as const, fromName: 'Mega Supporter', message: '', amount: 10, currency: 'USD',
      })),
      // 19 more donors so top 5% = ceil(20*0.05) = 1, showing just the top subscriber
      ...Array.from({ length: 19 }, (_, i) => ({
        donorId: `d${i + 2}`, transactionId: `t${i + 2}`, timestamp: new Date(Date.now() - i * 86400000).toISOString(),
        type: 'Tip' as const, fromName: names[i + 2] || `Donor ${i + 2}`, message: '', amount: 5, currency: 'USD',
      })),
    ],
    visibleCount: 25,
  },
};

export const SingleDonor: Story = {
  args: {
    donations: [{ donorId: 'd1', transactionId: 't1', timestamp: new Date().toISOString(), type: 'Tip', fromName: 'Solo Supporter', message: 'Thanks!', amount: 100, currency: 'USD' }],
    visibleCount: 25,
  },
};

export const Empty: Story = {
  args: { donations: [], visibleCount: 25 },
};
