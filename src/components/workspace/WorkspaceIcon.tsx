import { SvgIcon, type SvgIconProps } from '@mui/material';

/** A panel split into a header and two columns, the Workspaces mark. */
const WorkspaceIcon = (props: SvgIconProps) => (
  <SvgIcon {...props} viewBox="0 0 24 24">
    <path fill="none" stroke="currentColor" strokeWidth={2.2} d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M9 10v10" />
  </SvgIcon>
);

export default WorkspaceIcon;
