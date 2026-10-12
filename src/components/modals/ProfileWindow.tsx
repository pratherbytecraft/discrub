import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from '@features/user/userSlice';
import { selectCachedUserMap } from '@features/cache/cacheSlice';
import { useSignOut } from '@/hooks/useSignOut';
import UserProfileModal from './UserProfileModal';
import SignOutConfirmDialog from './SignOutConfirmDialog';

interface ProfileWindowProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The signed in user's profile window with Sign out (row 112): the same
 * window from the top bar's avatar, the Native user panel and the user
 * chip in Simple, Operator and Timeline.
 */
export default function ProfileWindow({ open, onClose }: ProfileWindowProps) {
  const currentUser = useAppSelector(selectCurrentUser);
  const cachedUserMap = useAppSelector(selectCachedUserMap);
  const signOut = useSignOut();
  return (
    <>
      <UserProfileModal
        open={open}
        onClose={onClose}
        onLogout={() => { onClose(); void signOut.requestSignOut(); }}
        user={currentUser}
        cachedUserMap={cachedUserMap}
        guildId={null}
      />
      <SignOutConfirmDialog open={signOut.confirmOpen} onClose={signOut.closeConfirm} onConfirm={signOut.signOut} stored={signOut.stored} />
    </>
  );
}
