import { useState, useMemo } from 'react';
import { Box, Typography, Chip, Collapse, keyframes } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  ExpandMore as ExpandMoreIcon,
  Whatshot as SubscriberIcon,
} from '@mui/icons-material';
import type { Donation } from 'discrub-core/types/discrub-types';
import { getTierInfo, getRelativeDate, getChipTextColor } from './donationUtils';
import { getTierSx } from './tierStyles';
import { glowLayerSx } from './glowLayer';

const flameFlicker = keyframes`
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.15); }
`;

// Flame tiers: orange → red → magenta → purple → blue → cyan (1-12+ months)
// The glow at rest sits on the card; the peak sits on a layer that fades in and out (2.2.2, see glowLayer.ts).
const makeGlow = (r: number, g: number, b: number, intensity: number) => ({
  rest: `0 0 ${4 + intensity * 3}px rgba(${r}, ${g}, ${b}, ${0.12 + intensity * 0.06}), inset 0 0 ${4 + intensity * 2}px rgba(${r}, ${g}, ${b}, ${0.02 + intensity * 0.015})`,
  peak: `0 0 ${10 + intensity * 5}px rgba(${r}, ${g}, ${b}, ${0.25 + intensity * 0.08}), inset 0 0 ${8 + intensity * 4}px rgba(${r}, ${g}, ${b}, ${0.04 + intensity * 0.02})`,
});

const FLAME_TIERS = [
  // 1-2mo: Ember (warm orange)
  { color: '#ff8a50', rgb: [255, 138, 80], intensity: 0, iconSize: 12, speed: '3s' },
  // 3-4mo: Blaze (deep orange)
  { color: '#ff5722', rgb: [255, 87, 34], intensity: 1, iconSize: 13, speed: '2.8s' },
  // 5-6mo: Fire (red)
  { color: '#f44336', rgb: [244, 67, 54], intensity: 2, iconSize: 14, speed: '2.5s' },
  // 7-8mo: Magma (magenta)
  { color: '#e91e63', rgb: [233, 30, 99], intensity: 3, iconSize: 15, speed: '2.2s' },
  // 9-10mo: Arcane (purple)
  { color: '#9c27b0', rgb: [156, 39, 176], intensity: 4, iconSize: 16, speed: '2s' },
  // 11-12+mo: Ascended (blue-cyan)
  { color: '#00bcd4', rgb: [0, 188, 212], intensity: 5, iconSize: 17, speed: '1.8s' },
];

function getFlameIntensity(months: number) {
  const tierIndex = Math.min(Math.floor((months - 1) / 2), FLAME_TIERS.length - 1);
  const tier = FLAME_TIERS[tierIndex];
  const [r, g, b] = tier.rgb;
  return {
    glow: makeGlow(r, g, b, tier.intensity),
    border: `rgba(${r}, ${g}, ${b}, ${0.3 + tier.intensity * 0.04})`,
    color: tier.color,
    iconSize: tier.iconSize,
    speed: tier.speed,
  };
}

function getRankColor(rank: number, accentFallback: string): string {
  if (rank === 1) return '#ffd700';
  if (rank === 2) return '#c0c0c0';
  if (rank === 3) return '#cd7f32';
  return accentFallback;
}

function getRankTextColor(rank: number): string {
  return rank <= 3 ? '#1a1a2e' : '#fff';
}

interface DonationCardProps {
  donation: Donation;
  /** All donations — used to count subscription streak for this donor */
  donations?: Donation[];
  index: number;
  /** Top supporter rank (1-5) if this donor is in the top 5 */
  supporterRank?: number;
  /** Start with the message expanded */
  initialExpanded?: boolean;
}

const DonationCard = ({ donation, donations, index, supporterRank, initialExpanded }: DonationCardProps) => {
  const [expanded, setExpanded] = useState(initialExpanded ?? false);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const tierInfo = getTierInfo(donation.amount);
  const tierSx = getTierSx(tierInfo.tier, isDark);
  const isSubscription = donation.type === 'Monthly Tip';

  // Count current streak — consecutive Monthly Tip payments without a 45+ day gap,
  // counting backwards from this transaction's date
  const streakMonths = useMemo(() => {
    if (!isSubscription || !donations) return 0;
    const thisDate = new Date(donation.timestamp).getTime();
    const GAP_THRESHOLD = 45 * 24 * 60 * 60 * 1000; // 45 days in ms

    // Get this donor's subscription payments up to this date, sorted newest first
    const subPayments = donations
      .filter((d) => d.donorId === donation.donorId && d.type === 'Monthly Tip' && new Date(d.timestamp).getTime() <= thisDate)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (subPayments.length === 0) return 0;

    // Count consecutive payments with no gap > 45 days
    let streak = 1;
    for (let i = 0; i < subPayments.length - 1; i++) {
      const current = new Date(subPayments[i].timestamp).getTime();
      const previous = new Date(subPayments[i + 1].timestamp).getTime();
      if (current - previous > GAP_THRESHOLD) break;
      streak++;
    }
    return streak;
  }, [donations, donation.donorId, donation.timestamp, isSubscription]);

  const cardFlame = isSubscription && streakMonths > 0 ? getFlameIntensity(streakMonths) : null;

  const card = (
    <Box
      sx={{
        ...tierSx as Record<string, unknown>,
        borderRadius: '8px',
        p: 1.5,
        position: 'relative',
        ...(cardFlame ? { borderColor: cardFlame.border, boxShadow: cardFlame.glow.rest } : {}),
        animation: index < 15 ? 'slide-in-bottom 0.3s ease forwards' : 'none',
        animationDelay: index < 15 ? `${index * 50}ms` : '0ms',
        opacity: index < 15 ? 0 : 1,
        cursor: donation.message ? 'pointer' : 'default',
      }}
      onClick={() => donation.message && setExpanded((prev) => !prev)}
    >
      {/* Top supporter ribbon */}
      {supporterRank && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            right: 40,
            backgroundColor: getRankColor(supporterRank, theme.palette.primary.main),
            color: getRankTextColor(supporterRank),
            fontSize: '0.55rem',
            fontWeight: 800,
            px: 0.75,
            py: 0.25,
            borderRadius: '0 0 4px 4px',
            letterSpacing: 0.5,
            lineHeight: 1,
            textTransform: 'uppercase',
          }}
        >
          #{supporterRank} Supporter
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0, mr: 1 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {donation.fromName}
          </Typography>
        </Box>
        <Chip
          label={`$${donation.amount}`}
          size="small"
          sx={{
            backgroundColor: tierInfo.color,
            color: getChipTextColor(tierInfo.tier),
            fontWeight: 700,
            fontSize: '0.75rem',
            height: 22,
          }}
        />
      </Box>

      {/* Subscriber ribbon — bottom left, symmetrical with rank ribbon top right */}
      {isSubscription && streakMonths > 0 && (() => {
        const flame = getFlameIntensity(streakMonths);
        return (
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 0.25,
              backgroundColor: flame.color,
              color: '#fff',
              fontSize: '0.55rem',
              fontWeight: 800,
              px: 0.75,
              py: 0.25,
              borderRadius: '4px 4px 0 0',
              letterSpacing: 0.5,
              lineHeight: 1,
              textTransform: 'uppercase',
            }}
          >
            <SubscriberIcon sx={{ fontSize: 10, color: '#fff', animation: `${flameFlicker} ${flame.speed} ease-in-out infinite` }} />
            {streakMonths} Month{streakMonths !== 1 ? 's' : ''}
          </Box>
        );
      })()}

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" sx={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
          {getRelativeDate(donation.timestamp)}
        </Typography>
        {donation.message && (
          <ExpandMoreIcon
            sx={{
              fontSize: 16,
              color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 200ms ease',
            }}
          />
        )}
      </Box>

      {donation.message && (
        <Collapse in={expanded}>
          <Typography
            variant="caption"
            sx={{ color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)', mt: 1, display: 'block', fontStyle: 'italic' }}
          >
            &ldquo;{donation.message}&rdquo;
          </Typography>
        </Collapse>
      )}
    </Box>
  );

  if (!cardFlame) return card;
  // The layer is a sibling, not a child: the tier styles clip the card's own overflow.
  return (
    <Box sx={{ position: 'relative', borderRadius: '8px' }}>
      {card}
      <Box
        aria-hidden
        data-testid="donation-card-glow"
        sx={{ ...glowLayerSx(cardFlame.speed, index < 15 ? `${index * 50 + 300}ms` : '0ms'), boxShadow: cardFlame.glow.peak }}
      />
    </Box>
  );
};

export default DonationCard;
