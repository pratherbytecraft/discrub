import { UserDataEnrichmentService } from 'discrub-core/messages';
import { DiscordServiceAdapter } from 'discrub-core/messages';
import type { Message } from 'discrub-core/types/discord-types';
import type { ExportUserMap, AppSettings } from 'discrub-core/types/discrub-types';
import { DiscrubSetting } from 'discrub-core/discrub-enum';

/**
 * Progress callback type for user enrichment
 */
export type EnrichmentProgressCallback = (progress: {
  current: number;
  total: number;
  message: string;
}) => void;

/**
 * Status callback type for user enrichment
 */
export type EnrichmentStatusCallback = (status: string) => void;

/**
 * User Enrichment Service Wrapper
 * Wraps discrub-core's UserDataEnrichmentService for use in the web app
 */
class UserEnrichmentServiceWrapper {
  /**
   * Enrich user data for messages
   * Fetches display names and server nicknames based on settings
   *
   * @param messages - Messages to enrich user data for
   * @param guildId - Current guild ID (null for DMs)
   * @param token - Discord auth token
   * @param settings - App settings
   * @param existingUserMap - Existing cached user map
   * @param onProgress - Optional progress callback
   * @param onStatus - Optional status callback
   * @param failedUserIds - User IDs that previously returned 404 (skipped during enrichment)
   * @param shouldStop - Checked before each user; true ends the run with what it has
   * @returns Updated ExportUserMap with enriched data and any newly failed user IDs
   */
  async enrichMessages(
    messages: Message[],
    guildId: string | null,
    token: string,
    settings: AppSettings,
    existingUserMap: ExportUserMap,
    onProgress?: EnrichmentProgressCallback,
    onStatus?: EnrichmentStatusCallback,
    failedUserIds?: string[],
    shouldStop?: () => Promise<boolean>
  ): Promise<{ userMap: ExportUserMap; failedUserIds?: string[] }> {
    try {
      // Check if enrichment is enabled via settings
      const displayNameLookup = settings[DiscrubSetting.DISPLAY_NAME_LOOKUP] === 'true';
      const serverNicknameLookup = settings[DiscrubSetting.SERVER_NICKNAME_LOOKUP] === 'true';

      // If both are disabled, return existing map
      if (!displayNameLookup && !serverNicknameLookup) {
        return { userMap: existingUserMap };
      }

      // Create Discord service adapter for API client
      const apiClient = new DiscordServiceAdapter(settings);

      // Create enrichment service with config object
      const enrichmentService = new UserDataEnrichmentService({
        apiClient,
        token,
        settings: {
          displayNameLookup,
          serverNickNameLookup: serverNicknameLookup,
          userDataRefreshRate: parseInt(settings[DiscrubSetting.APP_USER_DATA_REFRESH_RATE] || '0'),
          reactionsEnabled: settings[DiscrubSetting.REACTIONS_ENABLED] === 'true',
        },
        existingUserMap,
        existingReactionMap: undefined,
        skipUserIds: failedUserIds,
        onProgress,
        onStatus,
        shouldStop,
      });

      // Enrich user data for messages
      const result = await enrichmentService.enrichUserData(messages, guildId);

      return {
        userMap: result.userMap,
        failedUserIds: result.failedUserIds,
      };
    } catch (error) {
      console.error('Failed to enrich user data:', error);
      return { userMap: existingUserMap };
    }
  }

  /**
   * Enrich user data for specific user IDs
   * Useful for selective enrichment
   *
   * @param userIds - Array of user IDs to enrich
   * @param guildId - Current guild ID (null for DMs)
   * @param token - Discord auth token
   * @param settings - App settings
   * @param existingUserMap - Existing cached user map
   * @param onProgress - Optional progress callback
   * @param onStatus - Optional status callback
   * @param failedUserIds - User IDs that previously returned 404 (skipped during enrichment)
   * @returns Updated ExportUserMap with enriched data and any newly failed user IDs
   */
  async enrichUserIds(
    userIds: string[],
    guildId: string | null,
    token: string,
    settings: AppSettings,
    existingUserMap: ExportUserMap,
    onProgress?: EnrichmentProgressCallback,
    onStatus?: EnrichmentStatusCallback,
    failedUserIds?: string[],
    shouldStop?: () => Promise<boolean>
  ): Promise<{ userMap: ExportUserMap; failedUserIds?: string[] }> {
    try {
      // Create minimal messages with just user IDs
      const messages: Message[] = userIds.map((userId) => ({
        id: userId,
        channel_id: '',
        author: {
          id: userId,
          username: '',
          discriminator: '',
          global_name: null,
          avatar: null,
        },
        content: '',
        timestamp: new Date().toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: 0,
      }));

      return await this.enrichMessages(
        messages,
        guildId,
        token,
        settings,
        existingUserMap,
        onProgress,
        onStatus,
        failedUserIds,
        shouldStop
      );
    } catch (error) {
      console.error('Failed to enrich user IDs:', error);
      return { userMap: existingUserMap };
    }
  }
}

// Export singleton instance
export const userEnrichmentService = new UserEnrichmentServiceWrapper();

// Export class for testing
export { UserEnrichmentServiceWrapper };
