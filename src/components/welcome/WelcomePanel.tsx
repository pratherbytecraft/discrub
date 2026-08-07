import { useRef, useState } from 'react';
import { Box, Typography, Card, CardContent, CardActionArea, Button, Chip, Link } from '@mui/material';
import OnboardingGuideModal from '@components/modals/OnboardingGuideModal';
import {
  Storage as ServerIcon,
  Search as SearchIcon,
  FileDownload as ExportIcon,
  DeleteSweep as PurgeIcon,
  Forum as ForumIcon,
  BarChart as AnalyticsIcon,
  Settings as SettingsIcon,
  Palette as ThemeIcon,
  Terminal as StatusIcon,
  PauseCircle as PauseIcon,
  Explore as TourIcon,
  ArrowForward as ArrowIcon,
  GitHub as GitHubIcon,
  Star as StarIcon,
  PersonAdd as FollowIcon,
  FolderZip as PackageIcon,
} from '@mui/icons-material';

const GITHUB_PROFILE_URL = 'https://github.com/prathercc';
const GITHUB_REPO_URL = 'https://github.com/prathercc/discrub';

interface WelcomePanelProps {
  onStartTour: () => void;
}

interface FeatureCard {
  icon: React.ReactNode;
  title: string;
  description: string;
  id: string;
}

const GETTING_STARTED_STEPS = [
  { icon: <ServerIcon />, text: 'Select a server from the sidebar, or switch to the DMs tab' },
  { icon: <SearchIcon />, text: 'Browse channels and load messages — use search and filters to find specific content' },
  { icon: <ExportIcon />, text: 'Export messages in HTML, CSV, JSON, or media-only with 9 built-in presets' },
  { icon: <PurgeIcon />, text: 'Delete messages or remove reactions across one or multiple channels' },
];

const FEATURE_CARDS: FeatureCard[] = [
  {
    id: 'export',
    icon: <ExportIcon />,
    title: 'Export',
    description: 'HTML, CSV, JSON, or media-only. Discord layout template, 9 presets, per-type media selection, thread separation, and detailed reaction data.',
  },
  {
    id: 'purge',
    icon: <PurgeIcon />,
    title: 'Purge',
    description: 'Delete messages or remove reactions with user targeting. Multi-channel support, thread-aware discovery, and retain-attachments option.',
  },
  {
    id: 'search',
    icon: <SearchIcon />,
    title: 'Search & Filter',
    description: 'Search by content, date range, author, message type, or any combination. Automatically continues past 5,000 results.',
  },
  {
    id: 'forum',
    icon: <ForumIcon />,
    title: 'Forum Channels',
    description: 'Full support for forum and media channels. Browse threads, load messages, and export individually or in bulk.',
  },
  {
    id: 'package',
    icon: <PackageIcon />,
    title: 'Data Package',
    description: 'Drop in your Discord "Request All My Data" ZIP. Browse every server, channel, and DM in your archive. Optional rehydration fetches live reactions, replies, and CDN URLs.',
  },
  {
    id: 'analytics',
    icon: <AnalyticsIcon />,
    title: 'Analytics',
    description: 'Mention frequency, user engagement metrics, and CSV export. Skip replies option to exclude reply mentions.',
  },
  {
    id: 'settings',
    icon: <SettingsIcon />,
    title: 'Settings',
    description: 'Operation delays, export defaults, display format, purge behavior, and media type preferences — all customizable.',
  },
  {
    id: 'theme',
    icon: <ThemeIcon />,
    title: 'Themes',
    description: 'Switch between dark, light, and auto (system) themes. Exported HTML includes its own theme toggle.',
  },
  {
    id: 'status',
    icon: <StatusIcon />,
    title: 'Status Log',
    description: 'Terminal-style operation log with color-coded entries, real-time progress, and downloadable log file.',
  },
  {
    id: 'pause',
    icon: <PauseIcon />,
    title: 'Pause & Resume',
    description: 'All long-running operations support pause, resume, and cancel. Controls appear in the status bar.',
  },
];

const WelcomePanel = ({ onStartTour }: WelcomePanelProps) => {
  const featureCardsRef = useRef<HTMLDivElement>(null);
  const v1Ref = useRef<HTMLDivElement>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
  <>
    <Box
      sx={{
        height: '100%',
        overflow: 'auto',
        scrollBehavior: 'smooth',
        px: { xs: 2, sm: 4, md: 6 },
        py: 4,
      }}
    >
      {/* Header */}
      <Box sx={{ textAlign: 'center', mb: 5 }}>
        <Typography
          variant="h4"
          sx={{
            fontWeight: 700,
            background: (theme) =>
              theme.palette.mode === 'dark'
                ? 'linear-gradient(90deg, #ffffff, #d2d5f7)'
                : 'linear-gradient(90deg, #2e3338, #5865f2)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            mb: 1,
          }}
        >
          Welcome to Discrub
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 520, mx: 'auto' }}>
          A powerful Discord data management tool for exporting, searching, and managing your messages, reactions, and media.
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<TourIcon />}
            onClick={onStartTour}
            data-tour="start-tour"
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Take a Tour
          </Button>
          <Button
            variant="outlined"
            onClick={() => scrollTo(featureCardsRef)}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Explore Features
          </Button>
          <Button
            variant="outlined"
            onClick={() => scrollTo(v1Ref)}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Coming from Classic?
          </Button>
        </Box>

        <Box
          data-testid="welcome-github-actions"
          sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap', mt: 1.5 }}
        >
          <Button
            variant="outlined"
            size="small"
            startIcon={<StarIcon />}
            endIcon={<GitHubIcon sx={{ fontSize: 16 }} />}
            component="a"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ textTransform: 'none' }}
          >
            Star on GitHub
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<FollowIcon />}
            endIcon={<GitHubIcon sx={{ fontSize: 16 }} />}
            component="a"
            href={GITHUB_PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ textTransform: 'none' }}
          >
            Follow on GitHub
          </Button>
        </Box>
      </Box>

      {/* Getting Started */}
      <Box sx={{ mb: 5, maxWidth: 640, mx: 'auto' }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          Getting Started
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {GETTING_STARTED_STEPS.map((step, i) => (
            <Box
              key={i}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 1.5,
                borderRadius: 2,
                backgroundColor: 'action.hover',
                border: 1,
                borderColor: 'divider',
              }}
            >
              <Chip
                label={i + 1}
                size="small"
                color="primary"
                sx={{ fontWeight: 700, minWidth: 32 }}
              />
              <Box sx={{ color: 'primary.main', display: 'flex', alignItems: 'center' }}>
                {step.icon}
              </Box>
              <Typography variant="body2" color="text.primary">
                {step.text}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Feature Cards */}
      <Box ref={featureCardsRef} sx={{ mb: 5, maxWidth: 900, mx: 'auto', scrollMarginTop: 16 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          Features
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 2,
          }}
        >
          {FEATURE_CARDS.map((card) => (
            <Card
              key={card.id}
              variant="outlined"
              sx={{
                transition: 'all 200ms ease',
                '&:hover': {
                  borderColor: 'primary.main',
                  transform: 'translateY(-2px)',
                  boxShadow: (theme) => theme.customShadows?.elevation2 ?? '0 4px 12px rgba(0, 0, 0, 0.15)',
                },
              }}
            >
              <CardActionArea sx={{ height: '100%', cursor: 'default' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Box sx={{ color: 'primary.main' }}>{card.icon}</Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {card.title}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                    {card.description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      </Box>

      {/* Coming from v1 */}
      <Box
        ref={v1Ref}
        sx={{
          mb: 4,
          maxWidth: 640,
          mx: 'auto',
          scrollMarginTop: 16,
          p: 3,
          borderRadius: 2,
          border: 1,
          borderColor: 'divider',
          backgroundColor: 'action.hover',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <ArrowIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Coming from Discrub Classic?
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.6 }}>
          Welcome to the next major version of Discrub. Everything you know still works, plus forum channels,
          export presets, Discord layout HTML, analytics, bulk reaction removal, and much more.
          The extension version includes Discrub Classic as a built-in option — select your preferred version
          from the launcher splash screen.
        </Typography>
        <Link
          component="button"
          onClick={() => setGuideOpen(true)}
          sx={{ fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
        >
          Read the full migration guide
        </Link>
      </Box>
    </Box>

    <OnboardingGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
  </>
  );
};

export default WelcomePanel;
