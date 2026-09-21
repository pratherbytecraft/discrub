import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { fetchGuilds, selectGuilds, selectGuildLoading } from '@features/guild/guildSlice';
import { selectAuthToken } from '@features/auth/authSlice';
import { addStatusEntry } from '@features/status/statusSlice';
import { t as translate } from '@/i18n';

/** The token a load is running for. Two surfaces mounting in the same commit both see "not loading" yet, so the store flag alone can't stop a double request. */
let inFlightToken: string | null = null;

/**
 * Loads the server list once when the signed-in user has none yet. Every
 * surface that shows servers calls this (the sidebar list, the Native rail,
 * the Operator queue), so a page load in any layout gets its servers. Before
 * 2.2.0 only the sidebar list loaded them, and layouts without it showed DMs
 * only after a refresh.
 */
export const useLoadGuilds = () => {
  const dispatch = useAppDispatch();
  const token = useAppSelector(selectAuthToken);
  const guildCount = useAppSelector(selectGuilds).length;
  const isLoading = useAppSelector(selectGuildLoading);
  // The ref stops the strict mode double fetch and a refetch for an account with no servers.
  const fetched = useRef(false);
  useEffect(() => {
    if (!token || guildCount > 0 || isLoading || fetched.current || inFlightToken === token) return;
    fetched.current = true;
    inFlightToken = token;
    dispatch(addStatusEntry({ level: 'info', message: translate('nav.loadingServers') }));
    dispatch(fetchGuilds(token))
      .unwrap()
      .then((result) => {
        dispatch(addStatusEntry({ level: 'info', message: translate('nav.loadedServers', { count: result.length }) }));
      })
      .catch(() => {
        // The rejected case in guildSlice already reports the error.
      })
      .finally(() => { inFlightToken = null; });
  }, [dispatch, token, guildCount, isLoading]);
};
