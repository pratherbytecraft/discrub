import { Box, Chip, Link, Typography } from '@mui/material';
import { GitHub as GitHubIcon, OpenInNew as OpenIcon } from '@mui/icons-material';
import { DEVELOPER } from './developer';

/**
 * The developer's card, pinned to the corkboard: round avatar, name with a
 * small DEV tag, and the Follow link underneath. No message body (#261,
 * owner mockup 2026-09-07): the photo and name introduce the person, the
 * link asks for the follow. That is why the Follow button lives here instead
 * of in the WelcomePanel action row.
 */

interface DeveloperCardProps {
  pin: React.ReactNode;
  tilt: number;
}

const DeveloperCard = ({ pin, tilt }: DeveloperCardProps) => (
  <Box
    data-testid="corkboard-developer"
    sx={{
      position: 'relative',
      width: { xs: '100%', sm: 270 },
      p: 2,
      pt: 2.25,
      borderRadius: 1,
      bgcolor: 'background.paper',
      color: 'text.primary',
      transform: `rotate(${tilt}deg)`,
      transition: 'transform 160ms ease, box-shadow 160ms ease',
      boxShadow: '0 6px 14px rgba(0,0,0,0.35)',
      '&:hover': {
        transform: `rotate(${tilt}deg) translateY(-3px)`,
        boxShadow: '0 10px 20px rgba(0,0,0,0.4)',
      },
    }}
  >
    {pin}
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
      <Box
        component="img"
        src={DEVELOPER.avatar}
        alt={`${DEVELOPER.name}'s avatar`}
        width={48}
        height={48}
        sx={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
      <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', lineHeight: 1.2 }}>
          <Typography component="span" sx={{ fontWeight: 600, fontSize: '0.95rem' }}>
            {DEVELOPER.name}
          </Typography>
          <Chip
            label="DEV"
            size="small"
            color="primary"
            sx={{ height: 16, fontSize: '0.6rem', fontWeight: 700, '& .MuiChip-label': { px: 0.6 } }}
          />
        </Box>
        <Link
          href={DEVELOPER.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          <GitHubIcon sx={{ fontSize: 16 }} /> Follow @{DEVELOPER.handle} <OpenIcon sx={{ fontSize: 14 }} />
        </Link>
      </Box>
    </Box>
  </Box>
);

export default DeveloperCard;
