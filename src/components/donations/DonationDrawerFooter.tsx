import { useMemo } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { FavoriteBorder as HeartIcon } from '@mui/icons-material';
import type { Donation } from 'discrub-core/types/discrub-types';
import { glowLayerSx } from './glowLayer';

interface DonationDrawerFooterProps {
  donations: Donation[];
}

const DonationDrawerFooter = ({ donations }: DonationDrawerFooterProps) => {
  const totalDollars = donations.reduce((sum, d) => sum + d.amount, 0);
  const uniqueDonors = useMemo(() => new Set(donations.map((d) => d.donorId)).size, [donations]);

  return (
    <Box
      sx={{
        px: 1.5,
        pt: 1,
        pb: 1.5,
        borderTop: 1,
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mb: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center' }}>
          {uniqueDonors} supporter{uniqueDonors !== 1 ? 's' : ''} {uniqueDonors !== 1 ? 'have' : 'has'} raised over ${Math.floor(totalDollars)} to
          keep these tools free, thank you!
        </Typography>
        <HeartIcon sx={{ fontSize: 14, color: '#ff5e5b' }} />
      </Box>
      <Button
        variant="contained"
        fullWidth
        href="https://ko-fi.com/prathercc"
        target="_blank"
        rel="noopener noreferrer"
        startIcon={
          <Box
            component="img"
            src="/kofi.svg"
            alt=""
            sx={{ width: 18, height: 18 }}
          />
        }
        sx={{
          backgroundColor: '#ff5e5b',
          color: '#fff',
          fontWeight: 700,
          textTransform: 'none',
          fontSize: '0.8rem',
          py: 0.75,
          boxShadow: '0 4px 16px rgba(255, 94, 91, 0.3)',
          position: 'relative',
          '&::after': {
            ...glowLayerSx('3s'),
            content: '""',
            boxShadow: '0 4px 24px rgba(255, 94, 91, 0.5), 0 0 8px rgba(255, 94, 91, 0.2)',
          },
          '&:hover': {
            backgroundColor: '#e5524f',
            boxShadow: '0 6px 24px rgba(255, 94, 91, 0.45)',
          },
        }}
      >
        Support on Ko-Fi
      </Button>
    </Box>
  );
};

export default DonationDrawerFooter;
