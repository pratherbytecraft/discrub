import { useState, useRef } from 'react';
import {
  Box,
  Chip,
  Avatar,
  TextField,
  Typography,
  Autocomplete,
  CircularProgress,
  useTheme,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import type { ExportUserMap } from 'discrub-core/types/discrub-types';
import type { User } from 'discrub-core/types/discord-types';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectAuthToken } from '@features/auth/authSlice';
import { updateCachedUser, addFailedUserId, selectFailedUserIds } from '@features/cache/cacheSlice';
import { getDiscordService } from '@services/discordService';
import { useTranslation } from 'react-i18next';

interface UserPickerProps {
  selectedUserIds: string[];
  onChange: (userIds: string[]) => void;
  cachedUserMap: ExportUserMap;
  currentUserId: string;
  disabled?: boolean;
  label?: string;
}

interface UserOption {
  id: string;
  userName: string;
  displayName: string;
  avatar: string | null | undefined;
  isCurrentUser: boolean;
  isLookup?: false;
}

interface LookupOption {
  id: '__lookup__';
  displayName: string;
  isLookup: true;
  query: string;
}

type PickerOption = UserOption | LookupOption;

const isLookupOption = (option: PickerOption): option is LookupOption =>
  'isLookup' in option && option.isLookup === true;


const buildUserOptions = (
  cachedUserMap: ExportUserMap,
  currentUserId: string,
): UserOption[] => {
  return Object.entries(cachedUserMap)
    .map(([id, data]) => ({
      id,
      userName: data.userName || 'Unknown',
      displayName: data.displayName || data.userName || 'Unknown',
      avatar: data.avatar,
      isCurrentUser: id === currentUserId,
      isLookup: false as const,
    }))
    .sort((a, b) => {
      if (a.isCurrentUser) return -1;
      if (b.isCurrentUser) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
};

const getAvatarUrl = (userId: string, avatar: string | null | undefined) => {
  if (!avatar) return undefined;
  if (avatar.startsWith('http')) return avatar;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=32`;
};

const UserPicker = ({
  selectedUserIds,
  onChange,
  cachedUserMap,
  currentUserId,
  disabled = false,
  label,
}: UserPickerProps) => {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('userPicker.selectUsers');
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const token = useAppSelector(selectAuthToken);
  const failedUserIds = useAppSelector(selectFailedUserIds);

  const [inputValue, setInputValue] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  const userOptions = buildUserOptions(cachedUserMap, currentUserId);
  const selectedOptions = userOptions.filter((opt) => selectedUserIds.includes(opt.id));

  const handleRemoveUser = (userId: string) => {
    if (disabled) return;
    onChange(selectedUserIds.filter((id) => id !== userId));
  };

  const cacheUserFromDiscord = (user: User) => {
    const userData: ExportUserMap[string] = {
      userName: user.username,
      displayName: user.global_name,
      avatar: user.avatar,
      guilds: {},
      timestamp: Date.now(),
    };
    dispatch(updateCachedUser({ userId: user.id, userData }));
    return user.id;
  };

  const handleLookup = async (query: string) => {
    if (!query || !token) return;

    const isNumericId = /^\d+$/.test(query);
    if (!isNumericId) {
      setLookupError('Only User IDs are supported. Discord does not allow username lookups for user tokens.');
      return;
    }

    if (failedUserIds.includes(query)) {
      setLookupError(t('userPicker.notFoundCached'));
      return;
    }

    setLookupLoading(true);
    setLookupError(null);

    try {
      const discordService = getDiscordService();
      const response = await discordService.getUser(token, query);
      if (response.data) {
        const userId = cacheUserFromDiscord(response.data);
        if (!selectedUserIds.includes(userId)) {
          onChange([...selectedUserIds, userId]);
        }
        setInputValue('');
      } else if (response.status === 404) {
        dispatch(addFailedUserId(query));
        setLookupError(t('userPicker.notFound'));
      } else if (response.status === 403) {
        setLookupError(t('userPicker.accessDenied'));
      } else {
        setLookupError(t('userPicker.lookupFailed'));
      }
    } catch {
      setLookupError(t('userPicker.lookupFailed'));
    } finally {
      setLookupLoading(false);
    }
  };

  const filterOptions = (options: PickerOption[], state: { inputValue: string }): PickerOption[] => {
    const query = state.inputValue.trim();
    const lowerQuery = query.toLowerCase();

    // Filter cached users by input (still supports name/username matching
    // for users already in the cache — only server-side lookup is ID-only)
    const filtered = options.filter((opt) => {
      if (isLookupOption(opt)) return false;
      if (!lowerQuery) return true;
      return (
        opt.displayName.toLowerCase().includes(lowerQuery) ||
        opt.userName.toLowerCase().includes(lowerQuery) ||
        opt.id.includes(lowerQuery)
      );
    });

    // Append lookup option only for purely numeric input (a Discord ID)
    if (query && /^\d+$/.test(query)) {
      filtered.push({
        id: '__lookup__',
        displayName: t('userPicker.lookUpId', { query }),
        isLookup: true,
        query,
      });
    }

    return filtered;
  };

  const handleOptionSelect = (newValue: PickerOption[]) => {
    // Check if the lookup option was selected
    const lookupOpt = newValue.find(isLookupOption);
    if (lookupOpt) {
      handleLookup(lookupOpt.query);
      return;
    }

    // Normal cached user selection
    onChange(newValue.filter((opt): opt is UserOption => !isLookupOption(opt)).map((opt) => opt.id));
  };

  const getPlaceholder = () => {
    if (selectedUserIds.length > 0) return '';
    return t('userPicker.placeholder');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {resolvedLabel && (
        <Typography variant="subtitle2" color="text.secondary">
          {resolvedLabel}
        </Typography>
      )}

      {/* Unified autocomplete with integrated lookup */}
      {!disabled && (
        <Autocomplete
          ref={autocompleteRef}
          multiple
          size="small"
          options={userOptions as PickerOption[]}
          value={selectedOptions as PickerOption[]}
          onChange={(_, newValue) => handleOptionSelect(newValue)}
          inputValue={inputValue}
          onInputChange={(_, value, reason) => {
            if (reason !== 'reset') {
              setInputValue(value);
              if (lookupError) setLookupError(null);
            }
          }}
          filterOptions={filterOptions}
          getOptionLabel={(option) => {
            if (isLookupOption(option)) return option.displayName;
            return option.isCurrentUser
              ? t('userPicker.you', { name: option.displayName })
              : option.displayName;
          }}
          getOptionKey={(option) => option.id}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderOption={(props, option) => {
            const { key, ...restProps } = props;
            if (isLookupOption(option)) {
              return (
                <li
                  key={key}
                  {...restProps}
                  style={{ ...restProps.style, borderTop: `1px solid ${theme.palette.divider}` }}
                >
                  {lookupLoading ? (
                    <CircularProgress size={18} sx={{ mr: 1 }} />
                  ) : (
                    <SearchIcon sx={{ mr: 1, fontSize: 18, color: 'primary.main' }} />
                  )}
                  <Typography variant="body2" color="primary.main">
                    {option.displayName}
                  </Typography>
                </li>
              );
            }
            return (
              <li key={key} {...restProps}>
                <Avatar
                  src={getAvatarUrl(option.id, option.avatar)}
                  sx={{ width: 24, height: 24, mr: 1, fontSize: '0.75rem' }}
                >
                  {option.displayName[0]?.toUpperCase()}
                </Avatar>
                <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {option.displayName}
                    {option.isCurrentUser && (
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ ml: 0.5, color: 'primary.main' }}
                      >
                        {t('userPicker.youSuffix')}
                      </Typography>
                    )}
                  </Typography>
                  {option.userName !== option.displayName && (
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {option.userName}
                    </Typography>
                  )}
                </Box>
              </li>
            );
          }}
          renderTags={() => null}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={getPlaceholder()}
              size="small"
              error={Boolean(lookupError)}
              helperText={lookupError || t('userPicker.idHelp')}
            />
          )}
          disableCloseOnSelect
          loading={lookupLoading}
        />
      )}

      {/* Selected user chips */}
      {selectedUserIds.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {selectedUserIds.map((userId) => {
            const userData = cachedUserMap[userId];
            const displayName = userData?.displayName || userData?.userName || userId;
            const isCurrentUser = userId === currentUserId;
            return (
              <Chip
                key={userId}
                size="small"
                avatar={
                  <Avatar src={getAvatarUrl(userId, userData?.avatar)} sx={{ width: 20, height: 20 }}>
                    {(displayName as string)[0]?.toUpperCase()}
                  </Avatar>
                }
                label={isCurrentUser ? t('userPicker.you', { name: displayName }) : displayName}
                onDelete={disabled ? undefined : () => handleRemoveUser(userId)}
                variant="outlined"
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
};

export default UserPicker;
