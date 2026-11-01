import type { Meta, StoryObj } from '@storybook/react';
import { SubscriberList as SubscriberList } from '@pratherbytecraft/supporter';
import type { Donation } from '@pratherbytecraft/contributions';

const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
const monthsAgo = (months: number) => new Date(now.getTime() - months * 30 * 86400000).toISOString();

const generateSubPayments = (donorId: string, name: string, months: number, startMonthsAgo: number): Donation[] =>
  Array.from({ length: months }, (_, i) => ({
    donorId,
    transactionId: `${donorId}-sub-${i}`,
    timestamp: monthsAgo(startMonthsAgo - i),
    type: 'Monthly Tip' as const,
    fromName: name,
    message: '',
    amount: 5,
    currency: 'USD',
  }));

const meta: Meta<typeof SubscriberList> = {
  title: 'Donations/SubscriberList',
  component: SubscriberList,
  tags: ['autodocs'],
  decorators: [(Story) => <div style={{ maxWidth: 300, height: 500, overflow: 'auto', padding: 16 }}><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof SubscriberList>;

export const MixedActiveAndInactive: Story = {
  args: {
    donations: [
      // Active: 8 months (inferno) — latest payment 5 days ago
      ...generateSubPayments('d1', 'Hannah / JadeRQ', 8, 0),
      // Active: 3 months (blaze) — latest payment 10 days ago
      ...generateSubPayments('d2', 'Loyal Fan', 3, 0),
      // Active: 1 month (ember) — latest payment 20 days ago
      ...generateSubPayments('d3', 'New Subscriber', 1, 0),
      // Inactive: 5 months (was inferno) — latest payment 3 months ago
      ...generateSubPayments('d4', 'Past Champion', 5, 3),
      // Inactive: 2 months — latest payment 4 months ago
      ...generateSubPayments('d5', 'Former Supporter', 2, 4),
      // One-time tips (should not appear)
      { donorId: 'd6', transactionId: 'tip-1', timestamp: daysAgo(1), type: 'Tip', fromName: 'One-Timer', message: '', amount: 50, currency: 'USD' },
    ],
    visibleCount: 25,
  },
};

export const AllActive: Story = {
  args: {
    donations: [
      ...generateSubPayments('d1', 'Inferno User', 8, 0),
      ...generateSubPayments('d2', 'Blaze User', 4, 0),
      ...generateSubPayments('d3', 'Ember User', 1, 0),
    ],
    visibleCount: 25,
  },
};

export const AllInactive: Story = {
  args: {
    donations: [
      ...generateSubPayments('d1', 'Lapsed Gigabyte', 10, 6),
      ...generateSubPayments('d2', 'Lapsed Byte', 2, 4),
    ],
    visibleCount: 25,
  },
};

export const SingleActiveSubscriber: Story = {
  args: {
    donations: generateSubPayments('d1', 'Solo Monthly', 1, 0),
    visibleCount: 25,
  },
};

export const EmptyState: Story = {
  args: {
    donations: [],
    visibleCount: 25,
  },
};

export const InfernoStreak: Story = {
  name: 'Inferno Streak (6+ months, animated)',
  args: {
    donations: generateSubPayments('d1', 'Mega Supporter', 12, 0),
    visibleCount: 25,
  },
};
