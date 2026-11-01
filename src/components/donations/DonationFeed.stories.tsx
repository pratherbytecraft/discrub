import type { Meta, StoryObj } from '@storybook/react';
import { DonationFeed as DonationFeed } from '@pratherbytecraft/supporter';
import type { Donation } from '@pratherbytecraft/contributions';

const generateDonations = (count: number): Donation[] =>
  Array.from({ length: count }, (_, i) => ({
    donorId: `donor-${i}`,
    transactionId: `tx-${i}`,
    timestamp: new Date(Date.now() - i * 86400000).toISOString(),
    type: i % 7 === 0 ? 'Monthly Tip' : 'Tip',
    fromName: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack'][i % 10],
    message: i % 3 === 0 ? 'Thank you for this awesome tool!' : '',
    amount: [3, 5, 10, 15, 20, 25, 50, 75, 100, 150][i % 10],
    currency: 'USD',
  }));

const meta: Meta<typeof DonationFeed> = {
  title: 'Donations/DonationFeed',
  component: DonationFeed,
  tags: ['autodocs'],
  decorators: [(Story) => <div style={{ maxWidth: 300, height: 500, overflow: 'auto', padding: 16 }}><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof DonationFeed>;

export const FewDonations: Story = {
  args: { donations: generateDonations(5), visibleCount: 25 },
};

export const ManyDonations: Story = {
  args: { donations: generateDonations(50), visibleCount: 25 },
};

export const AllTiers: Story = {
  args: {
    donations: [
      { donorId: 'd1', transactionId: 't1', timestamp: new Date().toISOString(), type: 'Tip', fromName: 'Gigabyte Donor', message: 'Incredible work!', amount: 150, currency: 'USD' },
      { donorId: 'd2', transactionId: 't2', timestamp: new Date(Date.now() - 86400000).toISOString(), type: 'Tip', fromName: 'Megabyte Donor', message: '', amount: 75, currency: 'USD' },
      { donorId: 'd3', transactionId: 't3', timestamp: new Date(Date.now() - 172800000).toISOString(), type: 'Tip', fromName: 'Kilobyte Donor', message: 'Great tool!', amount: 25, currency: 'USD' },
      { donorId: 'd4', transactionId: 't4', timestamp: new Date(Date.now() - 259200000).toISOString(), type: 'Tip', fromName: 'Byte Donor', message: '', amount: 10, currency: 'USD' },
      { donorId: 'd5', transactionId: 't5', timestamp: new Date(Date.now() - 345600000).toISOString(), type: 'Tip', fromName: 'Bit Donor', message: '', amount: 3, currency: 'USD' },
    ],
    visibleCount: 25,
  },
};

export const WithSubscribers: Story = {
  args: {
    donations: [
      { donorId: 'd1', transactionId: 't1', timestamp: new Date().toISOString(), type: 'Monthly Tip', fromName: 'Monthly Alice', message: '', amount: 5, currency: 'USD' },
      { donorId: 'd2', transactionId: 't2', timestamp: new Date().toISOString(), type: 'Tip', fromName: 'One-Time Bob', message: 'Thanks!', amount: 20, currency: 'USD' },
      { donorId: 'd1', transactionId: 't3', timestamp: new Date(Date.now() - 2592000000).toISOString(), type: 'Monthly Tip', fromName: 'Monthly Alice', message: '', amount: 5, currency: 'USD' },
    ],
    visibleCount: 25,
  },
};

export const FilterChipsWithMessages: Story = {
  name: 'Filter Chips (messages available)',
  args: {
    donations: [
      { donorId: 'd1', transactionId: 't1', timestamp: new Date().toISOString(), type: 'Monthly Tip', fromName: 'Subscriber', message: 'Love this tool!', amount: 5, currency: 'USD' },
      { donorId: 'd2', transactionId: 't2', timestamp: new Date(Date.now() - 86400000).toISOString(), type: 'Tip', fromName: 'Tipper', message: '', amount: 25, currency: 'USD' },
      { donorId: 'd3', transactionId: 't3', timestamp: new Date(Date.now() - 172800000).toISOString(), type: 'Tip', fromName: 'Commenter', message: 'Keep up the great work!', amount: 10, currency: 'USD' },
      { donorId: 'd4', transactionId: 't4', timestamp: new Date(Date.now() - 259200000).toISOString(), type: 'Monthly Tip', fromName: 'Monthly Dan', message: '', amount: 5, currency: 'USD' },
      { donorId: 'd5', transactionId: 't5', timestamp: new Date(Date.now() - 345600000).toISOString(), type: 'Tip', fromName: 'Silent Tipper', message: '', amount: 50, currency: 'USD' },
    ],
    visibleCount: 25,
  },
};

export const Empty: Story = {
  args: { donations: [], visibleCount: 25 },
};
