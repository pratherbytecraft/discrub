import type { Meta, StoryObj } from '@storybook/react';
import { Box, Stack, Typography } from '@mui/material';
import TourFootnote from './TourFootnote';

const meta: Meta<typeof TourFootnote> = {
  title: 'Welcome/TourFootnote',
  component: TourFootnote,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Footnote-style help marker for typography labels and section headers. ' +
          'Renders a small superscript `?` glyph that hugs the preceding text ' +
          'with no gap. Click opens the same tour-catalog popover used by ' +
          'TourButton. Use when an icon button would be too heavy for the ' +
          'surrounding text — paired with section titles, dialog labels, etc.',
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof TourFootnote>;

export const NextToSectionHeader: Story = {
  render: () => (
    <Box sx={{ p: 4 }}>
      <Typography variant="h6" sx={{ display: 'inline-flex', alignItems: 'center' }}>
        Refine
        <TourFootnote stepKey="refine-section" />
      </Typography>
      <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
        Narrow the messages already loaded in your feed, no API calls.
      </Typography>
    </Box>
  ),
};

export const InlineWithLabel: Story = {
  render: () => (
    <Box sx={{ p: 4 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography>Pause / Resume</Typography>
        <TourFootnote stepKey="pause-resume-controls" />
      </Stack>
    </Box>
  ),
};

export const ManyOnOneRow: Story = {
  render: () => (
    <Stack direction="row" spacing={3} alignItems="center" sx={{ p: 4 }}>
      <Typography variant="body2">
        Search<TourFootnote stepKey="search-filters" />
      </Typography>
      <Typography variant="body2">
        Refine<TourFootnote stepKey="refine-section" />
      </Typography>
      <Typography variant="body2">
        Presets<TourFootnote stepKey="export-presets" />
      </Typography>
    </Stack>
  ),
};
