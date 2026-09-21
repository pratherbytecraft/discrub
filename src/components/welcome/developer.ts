/**
 * Data behind the developer's line in the Bots menu and the follow stamp on the What's New dialog.
 *
 * The avatar is bundled (a 128px copy of the GitHub avatar) rather than
 * fetched from github.com so the board never shows a broken photo and the
 * app makes no extra network call at launch. Refresh the file by saving
 * `https://github.com/prathercc.png?size=128` over it.
 */
import avatar from '@/assets/developer-avatar.jpg';

export interface DeveloperEntry {
  name: string;
  /** GitHub login, shown with a leading @ in the follow link. */
  handle: string;
  avatar: string;
  profileUrl: string;
}

export const DEVELOPER: DeveloperEntry = {
  name: 'Aaron Prather',
  handle: 'prathercc',
  avatar,
  profileUrl: 'https://github.com/prathercc',
};
