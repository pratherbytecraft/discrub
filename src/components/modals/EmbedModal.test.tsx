import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import EmbedModal from './EmbedModal';
import { createMockMessage, createMockEmbed } from '../../test/fixtures';

const theme = createTheme({ palette: { mode: 'dark' } });
const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('EmbedModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    message: createMockMessage({
      embeds: [
        createMockEmbed({
          title: 'Test Title',
          description: 'Test description',
          url: 'https://example.com',
          fields: [
            { name: 'Field 1', value: 'Value 1' },
            { name: 'Field 2', value: 'Value 2' },
          ],
          footer: { text: 'Footer text' },
        }),
      ],
    }),
  };

  it('should return null when message is null', () => {
    const { container } = render(
      <EmbedModal open={true} onClose={vi.fn()} message={null} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('should return null when message has no embeds', () => {
    const { container } = render(
      <EmbedModal open={true} onClose={vi.fn()} message={createMockMessage({ embeds: [] })} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('should render dialog title with embed count', () => {
    render(<EmbedModal {...defaultProps} />);
    expect(screen.getByText('Embeds (1)')).toBeInTheDocument();
  });

  it('should render embed title as a link when url is provided', () => {
    render(<EmbedModal {...defaultProps} />);
    const link = screen.getByText('Test Title');
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com');
  });

  it('should render embed title as plain text when no url', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({ title: 'Plain Title', url: undefined })],
    });
    render(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    const title = screen.getByText('Plain Title');
    expect(title.closest('a')).toBeNull();
  });

  it('resolves mentions in the title, author name and footer text (2.2.7)', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({ title: 'Top posters in <#345>', url: undefined, author: { name: 'Stats for <@1541>' }, footer: { text: 'Asked by <@1541>' } })],
    });
    const formattingContext = { userMap: { '1541': { displayName: 'Prather Bytecraft' } }, channelMap: { '345': { name: 'general' } } };
    render(<EmbedModal open={true} onClose={vi.fn()} message={msg} formattingContext={formattingContext} />);
    const html = document.body.innerHTML;
    expect(html).toContain('Top posters in <span class="channel-mention">#general</span>');
    expect(html).toContain('Stats for <span class="user-mention">@Prather Bytecraft</span>');
    expect(html).toContain('Asked by <span class="user-mention">@Prather Bytecraft</span>');
    expect(html).not.toContain('&lt;#345&gt;');
  });

  it('should render embed description', () => {
    render(<EmbedModal {...defaultProps} />);
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('should render embed fields', () => {
    render(<EmbedModal {...defaultProps} />);
    expect(screen.getByText('Field 1')).toBeInTheDocument();
    expect(screen.getByText('Value 1')).toBeInTheDocument();
    expect(screen.getByText('Field 2')).toBeInTheDocument();
    expect(screen.getByText('Value 2')).toBeInTheDocument();
  });

  it('should render embed footer', () => {
    render(<EmbedModal {...defaultProps} />);
    expect(screen.getByText('Footer text')).toBeInTheDocument();
  });

  it('should render multiple embeds', () => {
    const msg = createMockMessage({
      embeds: [
        createMockEmbed({ title: 'Embed A' }),
        createMockEmbed({ title: 'Embed B' }),
      ],
    });
    render(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    expect(screen.getByText('Embeds (2)')).toBeInTheDocument();
    expect(screen.getByText('Embed A')).toBeInTheDocument();
    expect(screen.getByText('Embed B')).toBeInTheDocument();
  });

  it('should call onClose when Close button is clicked', () => {
    const onClose = vi.fn();
    render(<EmbedModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should render bold markdown in description', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({ description: '**bold text**' })],
    });
    renderWithTheme(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    const strong = document.querySelector('strong');
    expect(strong?.textContent).toBe('bold text');
  });

  it('should render masked links in description', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({ description: '[Click here](https://other-site.com/page)', url: undefined, title: undefined })],
    });
    renderWithTheme(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    const link = document.querySelector('a[href="https://other-site.com/page"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('Click here');
  });

  it('should render user mentions in description with formatting context', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({ description: 'Hello <@111222333>' })],
    });
    const ctx = { userMap: { '111222333': { userName: 'alice', displayName: 'Alice' } } };
    renderWithTheme(
      <EmbedModal open={true} onClose={vi.fn()} message={msg} formattingContext={ctx as any} />
    );
    expect(document.querySelector('.user-mention')?.textContent).toBe('@Alice');
  });

  it('should render channel mentions in field values', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({
        fields: [{ name: 'Info', value: 'See <#555555> for details' }],
      })],
    });
    const ctx = { userMap: {}, channelMap: { '555555': { name: 'general' } } };
    renderWithTheme(
      <EmbedModal open={true} onClose={vi.fn()} message={msg} formattingContext={ctx as any} />
    );
    expect(document.querySelector('.channel-mention')?.textContent).toBe('#general');
  });

  it('should show embed author name when present', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({ author: { name: 'Bot Author' } } as any)],
    });
    renderWithTheme(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    expect(screen.getByText('Bot Author')).toBeInTheDocument();
  });

  it('should render embed image', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({
        title: undefined,
        description: undefined,
        image: { url: 'https://i.imgur.com/test.png', proxy_url: 'https://images-ext.discord.net/test.png', width: 500, height: 300 },
      } as any)],
    });
    renderWithTheme(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    const img = screen.getByAltText('Embed image');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://images-ext.discord.net/test.png');
  });

  it('should render standalone thumbnail when no image or video', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({
        title: undefined,
        description: undefined,
        thumbnail: { url: 'https://i.imgur.com/thumb.png', proxy_url: 'https://images-ext.discord.net/thumb.png', width: 200, height: 200 },
      } as any)],
    });
    renderWithTheme(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    const img = screen.getByAltText('Embed thumbnail');
    expect(img).toBeInTheDocument();
  });

  it('should not render standalone thumbnail when video exists', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({
        title: undefined,
        description: undefined,
        thumbnail: { url: 'https://tenor.com/thumb.png', proxy_url: undefined, width: 200, height: 200 },
        video: { url: 'https://tenor.com/video.mp4', proxy_url: undefined, width: 400, height: 300 },
      } as any)],
    });
    renderWithTheme(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    expect(screen.queryByAltText('Embed thumbnail')).toBeNull();
    // Video should be rendered instead
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
  });

  it('should render video player for mp4 embeds', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({
        title: undefined,
        description: undefined,
        video: { url: 'https://cdn.discordapp.com/video.mp4', proxy_url: undefined, width: 400, height: 300 },
      } as any)],
    });
    renderWithTheme(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toContain('.mp4');
  });

  it('should render provider name', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({
        provider: { name: 'Tenor' },
      } as any)],
    });
    renderWithTheme(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    expect(screen.getByText('Tenor')).toBeInTheDocument();
  });

  it('should show colored left border from embed color', () => {
    const msg = createMockMessage({
      embeds: [createMockEmbed({ color: 0x5865f2 })],
    });
    renderWithTheme(<EmbedModal open={true} onClose={vi.fn()} message={msg} />);
    const card = document.querySelector('.MuiCard-root');
    expect(card).not.toBeNull();
  });
});
