import type { Meta, StoryObj } from '@storybook/react';
import { Box, Stack } from '@mui/material';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  CheckBox as CheckBoxIcon,
} from '@mui/icons-material';
import TourButton from './TourButton';

const meta: Meta<typeof TourButton> = {
  title: 'Welcome/TourButton',
  component: TourButton,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'ButtonGroup-rendered primary button with a sibling `?` icon that opens the ' +
          'tour catalog entry for the given stepKey. The most common surface for ' +
          'inline help — sits next to a feature affordance so users can click for ' +
          'context without leaving their flow. ' +
          '`hotkeyActionId` + `hotkeyLabel` opt the primary button into a ' +
          'HotkeyTooltip; `leadingButton` adds a sibling action (e.g. Copy) on ' +
          'the left of the group.',
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof TourButton>;

export const Basic: Story = {
  render: () => (
    <Box sx={{ p: 6 }}>
      <TourButton stepKey="search-filters" startIcon={<SearchIcon />}>
        Filters
      </TourButton>
    </Box>
  ),
};

export const WithBadge: Story = {
  render: () => (
    <Box sx={{ p: 6 }}>
      <TourButton stepKey="search-filters" badgeContent={3} startIcon={<SearchIcon />}>
        Filters
      </TourButton>
    </Box>
  ),
};

export const WithHotkey: Story = {
  render: () => (
    <Box sx={{ p: 6 }}>
      <TourButton
        stepKey="focus-button"
        hotkeyActionId="toggleFocus"
        hotkeyLabel="Toggle focus mode"
      >
        Focus
      </TourButton>
    </Box>
  ),
};

export const WithLeadingButton: Story = {
  render: () => (
    <Box sx={{ p: 6 }}>
      <TourButton
        stepKey="multi-select-toggle"
        leadingButton={
          <button
            type="button"
            style={{
              padding: '4px 12px',
              border: '1px solid currentColor',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <RefreshIcon fontSize="small" />
          </button>
        }
        startIcon={<CheckBoxIcon />}
      >
        Multi-select
      </TourButton>
    </Box>
  ),
};

export const ButtonRow: Story = {
  render: () => (
    <Stack direction="row" spacing={2} sx={{ p: 4 }}>
      <TourButton stepKey="search-filters">Filters</TourButton>
      <TourButton stepKey="export-presets">Presets</TourButton>
      <TourButton stepKey="focus-button">Focus</TourButton>
    </Stack>
  ),
};
