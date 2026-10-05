import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Divider,
  Avatar,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  ContentCopy as CopyIcon,
  Verified as VerifiedIcon,
  Person as PersonIcon,
  AlternateEmail as MentionIcon,
  Logout as LogoutIcon,
} from '@mui/icons-material';
import type { User } from 'discrub-core/types/discord-types';
import type { ExportUserMap } from 'discrub-core/types/discrub-types';
import { getUserRoleColor } from '@/utils/roleColorUtils';
import { useAppDispatch } from '@/app/hooks';
import { showToast } from '@/features/status/statusSlice';
import TourButton from '@/components/welcome/TourButton';
import DialogCloseIcon from '@components/ui/DialogCloseIcon';
import { useTranslation } from 'react-i18next';

interface UserProfileModalProps {
  open: boolean;
  onClose: () => void;
  user: User | null;
  cachedUserMap?: ExportUserMap;
  guildId?: string | null;
  guildRoles?: { id: string; name: string; color: number; position: number; icon?: string | null; unicode_emoji?: string | null }[];
  /**
   * Quick-filter affordance (#129). When provided, a "Filter messages by
   * [name]" button renders just below the user header. Omit (e.g. from
   * TopBar where there's no channel context) to suppress the button.
   */
  onFilterByAuthor?: (user: User) => void;
  /**
   * Mirror of onFilterByAuthor for mentions. Renders a "Filter messages
   * mentioning [name]" button when provided.
   */
  onFilterByMentions?: (user: User) => void;
  /** Signs the current user out. Only TopBar passes it, so the button shows for your own profile only (2.2.4). */
  onLogout?: () => void;
}

/**
 * UserProfileModal Component
 * Displays comprehensive Discord user information in a Discord-style card layout
 */
const UserProfileModal = ({
  open,
  onClose,
  user,
  cachedUserMap,
  guildId,
  guildRoles = [],
  onFilterByAuthor,
  onFilterByMentions,
  onLogout,
}: UserProfileModalProps) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const theme = useTheme();

  if (!user) return null;

  // Get cached user data for display name and nickname
  const cachedUser = cachedUserMap?.[user.id];
  const guildData = guildId && cachedUser?.guilds?.[guildId];
  const serverNickname = (guildData && typeof guildData === 'object' && guildData.nick) || null;
  const displayName = cachedUser?.displayName || user.global_name || null;
  const username = user.username;

  // Helper: Get premium type label
  const getPremiumTypeLabel = (premiumType?: number): string => {
    switch (premiumType) {
      case 1:
        return 'Nitro Classic';
      case 2:
        return 'Nitro';
      case 3:
        return 'Nitro Basic';
      default:
        return 'None';
    }
  };

  // Helper: Get premium type color
  const getPremiumTypeColor = (premiumType?: number): string => {
    switch (premiumType) {
      case 1:
        return '#f47fff'; // Nitro Classic pink
      case 2:
        return '#ff73fa'; // Nitro purple-pink
      case 3:
        return '#b3b3ff'; // Nitro Basic blue-purple
      default:
        return theme.palette.text.disabled; // Default gray
    }
  };

  // Helper: Discord user flags bitfield
  const USER_FLAGS = {
    STAFF: 1 << 0,
    PARTNER: 1 << 1,
    HYPESQUAD: 1 << 2,
    BUG_HUNTER_LEVEL_1: 1 << 3,
    HYPESQUAD_ONLINE_HOUSE_1: 1 << 6,
    HYPESQUAD_ONLINE_HOUSE_2: 1 << 7,
    HYPESQUAD_ONLINE_HOUSE_3: 1 << 8,
    PREMIUM_EARLY_SUPPORTER: 1 << 9,
    BUG_HUNTER_LEVEL_2: 1 << 14,
    VERIFIED_BOT: 1 << 16,
    VERIFIED_DEVELOPER: 1 << 17,
    CERTIFIED_MODERATOR: 1 << 18,
    BOT_HTTP_INTERACTIONS: 1 << 19,
    ACTIVE_DEVELOPER: 1 << 22,
  };

  // Helper: Parse flags bitfield
  const getFlagLabels = (flags?: number): string[] => {
    if (!flags) return [];

    const labels: string[] = [];
    if (flags & USER_FLAGS.STAFF) labels.push('Discord Staff');
    if (flags & USER_FLAGS.PARTNER) labels.push('Partnered Server Owner');
    if (flags & USER_FLAGS.HYPESQUAD) labels.push('HypeSquad Events');
    if (flags & USER_FLAGS.BUG_HUNTER_LEVEL_1) labels.push('Bug Hunter Level 1');
    if (flags & USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_1) labels.push('HypeSquad Bravery');
    if (flags & USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_2) labels.push('HypeSquad Brilliance');
    if (flags & USER_FLAGS.HYPESQUAD_ONLINE_HOUSE_3) labels.push('HypeSquad Balance');
    if (flags & USER_FLAGS.PREMIUM_EARLY_SUPPORTER) labels.push('Early Supporter');
    if (flags & USER_FLAGS.BUG_HUNTER_LEVEL_2) labels.push('Bug Hunter Level 2');
    if (flags & USER_FLAGS.VERIFIED_BOT) labels.push('Verified Bot');
    if (flags & USER_FLAGS.VERIFIED_DEVELOPER) labels.push('Early Verified Bot Developer');
    if (flags & USER_FLAGS.CERTIFIED_MODERATOR) labels.push('Moderator Programs Alumni');
    if (flags & USER_FLAGS.BOT_HTTP_INTERACTIONS) labels.push('HTTP Interactions Bot');
    if (flags & USER_FLAGS.ACTIVE_DEVELOPER) labels.push('Active Developer');

    return labels;
  };

  // Helper: Generate avatar URL
  const getAvatarUrl = (user: User, size = 256): string => {
    if (!user.avatar) return '';
    const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=${size}`;
  };

  // Helper: Generate banner URL
  const getBannerUrl = (user: User, size = 600): string => {
    if (!user.banner) return '';
    const extension = user.banner.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${extension}?size=${size}`;
  };

  // Helper: Generate avatar decoration URL
  const getAvatarDecorationUrl = (user: User): string => {
    if (!user.avatar_decoration) return '';
    return `https://cdn.discordapp.com/avatar-decorations/${user.id}/${user.avatar_decoration}.png`;
  };

  // Helper: Convert accent color to hex
  const getAccentColorHex = (accentColor?: number | null): string => {
    if (!accentColor) return '#5865f2'; // Default Discord blurple
    return `#${accentColor.toString(16).padStart(6, '0')}`;
  };

  // Helper: Copy to clipboard
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    dispatch(showToast({ level: 'success', message: t('profile.copied', { label }) }));
  };

  const flagLabels = getFlagLabels(user.public_flags || user.flags);
  const roleColor = cachedUserMap ? getUserRoleColor(user.id, guildId || null, cachedUserMap, guildRoles) : null;

  // Resolve user's roles with names and colors for display
  const userRoleIds = guildData && typeof guildData === 'object' ? guildData.roles : [];
  const userRoles = guildRoles
    .filter((r) => userRoleIds.includes(r.id))
    .sort((a, b) => b.position - a.position);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          animation: 'fade-in-scale 300ms ease',
          backgroundColor: 'background.default',
          backgroundImage: 'none',
          borderRadius: '8px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <DialogTitle sx={{ p: 0, flexShrink: 0, position: 'relative', paddingBottom: '78px' }}>
        {/* Banner Section */}
        <Box
          sx={{
            width: '100%',
            height: '100px',
            background: user.banner
              ? `url(${getBannerUrl(user)}) center/cover no-repeat`
              : `linear-gradient(135deg, ${getAccentColorHex(user.accent_color)}, ${getAccentColorHex(user.accent_color)}dd)`,
            position: 'relative',
            borderRadius: '8px 8px 0 0',
          }}
        />
        <DialogCloseIcon onClose={onClose} label={t('profile.close')} />

        {/* Avatar Section */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <Box sx={{ position: 'relative' }}>
            <Avatar
              src={getAvatarUrl(user, 128)}
              sx={{
                width: 128,
                height: 128,
                border: `6px solid ${theme.palette.background.default}`,
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
              }}
            >
              {user.username?.[0]?.toUpperCase()}
            </Avatar>

            {/* Avatar decoration overlay */}
            {user.avatar_decoration && (
              <Box
                component="img"
                src={getAvatarDecorationUrl(user)}
                sx={{
                  position: 'absolute',
                  top: -8,
                  left: -8,
                  width: 144,
                  height: 144,
                  pointerEvents: 'none',
                }}
              />
            )}
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 0, overflow: 'auto', flex: '1 1 auto' }}>

        {/* Primary Identity Section */}
        <Box sx={{ textAlign: 'center', mb: 3, mt: '64px' }}>
          {/* Highest Priority Display Name */}
          <Typography variant="h5" sx={{ fontWeight: 700, color: roleColor || 'text.primary', mb: 0.5 }}>
            {serverNickname || displayName || username}
          </Typography>

          {/* Bot Badge */}
          {user.bot && (
            <Chip
              label="BOT"
              size="small"
              sx={{
                backgroundColor: 'primary.main',
                color: '#fff',
                fontWeight: 600,
              }}
            />
          )}
        </Box>

        {/* Quick-filter actions (#129). Rendered only when callbacks are
            provided — TopBar's profile click omits them since there's no
            channel context to filter against. Sits between Primary
            Identity and Names so users discover it before scrolling. */}
        {(onFilterByAuthor || onFilterByMentions) && (
          <Box
            data-testid="user-profile-filter-actions"
            sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}
          >
            {onFilterByAuthor && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PersonIcon />}
                onClick={() => onFilterByAuthor(user)}
                sx={{ textTransform: 'none' }}
              >
                {t('profile.filterBy', { name: serverNickname || displayName || username })}
              </Button>
            )}
            {onFilterByMentions && (
              <TourButton
                stepKey="profile-quick-filters"
                size="small"
                variant="outlined"
                startIcon={<MentionIcon />}
                onClick={() => onFilterByMentions(user)}
                sx={{ textTransform: 'none' }}
              >
                {t('profile.filterMentioning', { name: serverNickname || displayName || username })}
              </TourButton>
            )}
          </Box>
        )}

        <Divider sx={{ my: 2, borderColor: 'divider' }} />

        {/* Names Section */}
        <Box sx={{ mb: 3 }}>
          <Typography
            variant="subtitle2"
            sx={{ color: 'text.secondary', mb: 1.5, fontWeight: 600, fontSize: '12px' }}
          >
            {t('profile.names')}
          </Typography>

          {/* Server Nickname */}
          {guildId && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                {t('profile.serverNickname')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography
                  variant="body2"
                  sx={{
                    color: serverNickname ? 'text.secondary' : 'text.disabled',
                    fontStyle: serverNickname ? 'normal' : 'italic',
                    fontWeight: serverNickname ? 500 : 400,
                  }}
                >
                  {serverNickname || t('profile.notSet')}
                </Typography>
                {serverNickname && (
                  <Chip
                    label="PRIORITY 1"
                    size="small"
                    sx={{
                      ml: 1,
                      height: '18px',
                      backgroundColor: '#43b58133',
                      color: '#43b581',
                      border: '1px solid #43b58166',
                      fontSize: '10px',
                      fontWeight: 600,
                    }}
                  />
                )}
              </Box>
            </Box>
          )}

          {/* Display Name (Global) */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>
              {t('profile.displayName')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography
                variant="body2"
                sx={{
                  color: displayName ? 'text.secondary' : 'text.disabled',
                  fontStyle: displayName ? 'normal' : 'italic',
                  fontWeight: displayName ? 500 : 400,
                }}
              >
                {displayName || t('profile.notSet')}
              </Typography>
              {displayName && !serverNickname && (
                <Chip
                  label="PRIORITY 1"
                  size="small"
                  sx={{
                    ml: 1,
                    height: '18px',
                    backgroundColor: '#43b58133',
                    color: '#43b581',
                    border: '1px solid #43b58166',
                    fontSize: '10px',
                    fontWeight: 600,
                  }}
                />
              )}
              {displayName && serverNickname && (
                <Chip
                  label="PRIORITY 2"
                  size="small"
                  sx={{
                    ml: 1,
                    height: '18px',
                    backgroundColor: '#faa61a33',
                    color: '#faa61a',
                    border: '1px solid #faa61a66',
                    fontSize: '10px',
                    fontWeight: 600,
                  }}
                />
              )}
            </Box>
          </Box>

          {/* Username */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>
              {t('profile.username')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography
                variant="body2"
                sx={{ color: 'text.secondary', fontWeight: 500 }}
              >
                {username}#{user.discriminator}
              </Typography>
              <Tooltip title={t('profile.copyUsername')}>
                <IconButton
                  size="small"
                  onClick={() => handleCopy(`${username}#${user.discriminator}`, 'username')}
                  sx={{ color: 'text.secondary', p: 0.5 }}
                >
                  <CopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
              {!displayName && !serverNickname && (
                <Chip
                  label="PRIORITY 1"
                  size="small"
                  sx={{
                    ml: 1,
                    height: '18px',
                    backgroundColor: '#43b58133',
                    color: '#43b581',
                    border: '1px solid #43b58166',
                    fontSize: '10px',
                    fontWeight: 600,
                  }}
                />
              )}
              {(displayName || serverNickname) && (
                <Chip
                  label={serverNickname && displayName ? 'PRIORITY 3' : 'PRIORITY 2'}
                  size="small"
                  sx={{
                    ml: 1,
                    height: '18px',
                    backgroundColor: '#f0474733',
                    color: '#f04747',
                    border: '1px solid #f0474766',
                    fontSize: '10px',
                    fontWeight: 600,
                  }}
                />
              )}
            </Box>
          </Box>
        </Box>

        <Divider sx={{ my: 2, borderColor: 'divider' }} />

        {/* Account Details Section */}
        <Box sx={{ mb: 3 }}>
          <Typography
            variant="subtitle2"
            sx={{ color: 'text.secondary', mb: 1.5, fontWeight: 600, fontSize: '12px' }}
          >
            {t('profile.accountDetails')}
          </Typography>

          {/* User ID */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>
              {t('profile.userId')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography
                variant="body2"
                sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: '13px' }}
              >
                {user.id}
              </Typography>
              <IconButton
                size="small"
                onClick={() => handleCopy(user.id, t('profile.userId'))}
                sx={{ color: 'text.secondary' }}
              >
                <CopyIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          </Box>

          {/* Email (if available) */}
          {user.email && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                {t('profile.email')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {user.email}
                </Typography>
                {user.verified && (
                  <Tooltip title={t('profile.verified')}>
                    <VerifiedIcon sx={{ fontSize: 16, color: '#43b581' }} />
                  </Tooltip>
                )}
              </Box>
            </Box>
          )}

          {/* MFA Status */}
          {user.mfa_enabled !== undefined && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                2FA Enabled
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: user.mfa_enabled ? '#43b581' : '#f04747', fontWeight: 500 }}
              >
                {user.mfa_enabled ? t('profile.yes') : t('profile.no')}
              </Typography>
            </Box>
          )}

          {/* Premium Type */}
          {user.premium_type !== undefined && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                {t('profile.nitroStatus')}
              </Typography>
              <Chip
                label={getPremiumTypeLabel(user.premium_type)}
                size="small"
                sx={{
                  backgroundColor: `${getPremiumTypeColor(user.premium_type)}33`,
                  color: getPremiumTypeColor(user.premium_type),
                  border: `1px solid ${getPremiumTypeColor(user.premium_type)}66`,
                  fontWeight: 500,
                  fontSize: '12px',
                }}
              />
            </Box>
          )}
        </Box>

        {/* Badges & Flags Section */}
        {flagLabels.length > 0 && (
          <>
            <Divider sx={{ my: 2, borderColor: 'divider' }} />
            <Box sx={{ mb: 3 }}>
              <Typography
                variant="subtitle2"
                sx={{ color: 'text.secondary', mb: 1.5, fontWeight: 600, fontSize: '12px' }}
              >
                {t('profile.badges')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {flagLabels.map((flag, index) => (
                  <Chip
                    key={index}
                    label={flag}
                    size="small"
                    sx={{
                      backgroundColor: 'background.paper',
                      color: 'text.secondary',
                      border: '1px solid',
                      borderColor: 'primary.main',
                      fontSize: '11px',
                    }}
                  />
                ))}
              </Box>
            </Box>
          </>
        )}

        {/* Roles Section */}
        {userRoles.length > 0 && (
          <>
            <Divider sx={{ my: 2, borderColor: 'divider' }} />
            <Box sx={{ mb: 3 }}>
              <Typography
                variant="subtitle2"
                sx={{ color: 'text.secondary', mb: 1.5, fontWeight: 600, fontSize: '12px' }}
              >
                {t('profile.roles')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {userRoles.map((role) => {
                  const colorHex = role.color !== 0
                    ? '#' + role.color.toString(16).padStart(6, '0')
                    : undefined;
                  return (
                    <Chip
                      key={role.id}
                      label={role.name}
                      size="small"
                      sx={{
                        backgroundColor: colorHex ? `${colorHex}22` : 'background.paper',
                        color: colorHex || 'text.secondary',
                        border: '1px solid',
                        borderColor: colorHex ? `${colorHex}66` : 'divider',
                        fontSize: '11px',
                        fontWeight: 500,
                        '& .MuiChip-label': { px: 1 },
                      }}
                      icon={
                        role.icon ? (
                          <Box
                            component="img"
                            src={`https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.webp?size=20`}
                            sx={{ width: 14, height: 14, ml: 0.5, flexShrink: 0 }}
                          />
                        ) : role.unicode_emoji ? (
                          <Typography component="span" sx={{ fontSize: 12, ml: 0.5, lineHeight: 1 }}>
                            {role.unicode_emoji}
                          </Typography>
                        ) : colorHex ? (
                          <Box
                            sx={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              backgroundColor: colorHex,
                              ml: 0.5,
                              flexShrink: 0,
                            }}
                          />
                        ) : undefined
                      }
                    />
                  );
                })}
              </Box>
            </Box>
          </>
        )}

        {/* Profile Customization Section */}
        <Divider sx={{ my: 2, borderColor: 'divider' }} />
        <Box>
          <Typography
            variant="subtitle2"
            sx={{ color: 'text.secondary', mb: 1.5, fontWeight: 600, fontSize: '12px' }}
          >
            {t('profile.customization')}
          </Typography>

          {/* Accent Color */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>
              {t('profile.accentColor')}
            </Typography>
            {user.accent_color ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: '4px',
                    backgroundColor: getAccentColorHex(user.accent_color),
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                />
                <Typography
                  variant="body2"
                  sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: '13px' }}
                >
                  {getAccentColorHex(user.accent_color)}
                </Typography>
              </Box>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                {t('profile.notSet')}
              </Typography>
            )}
          </Box>

          {/* Banner Status */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>
              {t('profile.banner')}
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: user.banner ? '#43b581' : 'text.disabled', fontWeight: 500 }}
            >
              {user.banner ? t('profile.customBannerSet') : t('profile.notSet')}
            </Typography>
          </Box>

          {/* Avatar Decoration */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>
              {t('profile.avatarDecoration')}
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: user.avatar_decoration ? '#43b581' : 'text.disabled', fontWeight: 500 }}
            >
              {user.avatar_decoration ? t('profile.active') : t('profile.none')}
            </Typography>
          </Box>
        </Box>

      </DialogContent>

      <DialogActions
        sx={{
          backgroundColor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          p: 2,
          flexShrink: 0,
        }}
      >
        {onLogout && (
          <Button
            variant="outlined"
            color="error"
            onClick={onLogout}
            startIcon={<LogoutIcon />}
            data-testid="profile-logout"
            sx={{ mr: 'auto' }}
          >
            {t('topbar.logout')}
          </Button>
        )}
        <Button
          variant="outlined"
          onClick={onClose}
        >
          {t('profile.cancel')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UserProfileModal;
