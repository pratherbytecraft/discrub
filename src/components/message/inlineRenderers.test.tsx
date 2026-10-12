import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Mock } from 'vitest';
import type { Attachment, Embed } from 'discrub-core/types/discord-types';
import { InlineAttachments, InlineEmbeds, InlineSticker, InlinePoll } from './inlineRenderers';
import { reserveMediaBox } from '@/utils/reserveMediaBox';

// Wrap the real helper in a spy so we can assert each media site reserves
// layout space with the right intrinsic dimensions + caps (#190), while
// still applying the real styles to the rendered element.
vi.mock('@/utils/reserveMediaBox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/reserveMediaBox')>();
  return { ...actual, reserveMediaBox: vi.fn(actual.reserveMediaBox) };
});

const reserveSpy = reserveMediaBox as unknown as Mock;

const attachment = (over: Partial<Attachment>): Attachment =>
  ({
    id: '1',
    filename: 'pic.png',
    content_type: 'image/png',
    url: 'https://cdn.discordapp.com/attachments/1/2/pic.png',
    proxy_url: 'https://media.discordapp.net/attachments/1/2/pic.png',
    size: 1234,
    width: 800,
    height: 600,
    ...over,
  }) as Attachment;

beforeEach(() => reserveSpy.mockClear());

describe('InlineAttachments media reservation (#190)', () => {
  it('reserves the box for an image attachment using its intrinsic size + 400x300 cap', () => {
    const { container } = render(<InlineAttachments attachments={[attachment({})]} />);
    expect(reserveSpy).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 600 }), 300, 400);
    expect(container.querySelector('img')).toBeInTheDocument();
  });

  it('reserves the box for a video attachment with the same cap', () => {
    render(
      <InlineAttachments
        attachments={[attachment({ filename: 'clip.mp4', content_type: 'video/mp4' })]}
      />,
    );
    expect(reserveSpy).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 600 }), 300, 400);
  });

  it('still renders (via fallback) when the attachment has no dimensions', () => {
    const { container } = render(
      <InlineAttachments attachments={[attachment({ width: undefined, height: undefined })]} />,
    );
    expect(reserveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ width: undefined, height: undefined }),
      300,
      400,
    );
    expect(container.querySelector('img')).toBeInTheDocument();
  });
});

describe('InlineEmbeds media reservation (#190)', () => {
  it('reserves the box for a full embed image (height-capped, container width)', () => {
    const embed = {
      type: 'rich',
      image: { url: 'https://example.com/i.png', width: 1000, height: 500 },
    } as unknown as Embed;
    render(<InlineEmbeds embeds={[embed]} />);
    // height cap 300, no width cap (container-width media)
    expect(reserveSpy).toHaveBeenCalledWith(expect.objectContaining({ width: 1000, height: 500 }), 300);
  });

  it('renders a card embed thumbnail as the fixed 64px corner thumb (#219 sweep)', () => {
    const embed = {
      type: 'link',
      title: 'Some page',
      thumbnail: { url: 'https://example.com/t.png', width: 200, height: 200 },
    } as unknown as Embed;
    const { container } = render(<InlineEmbeds embeds={[embed]} />);
    // Corner thumbs are fixed-size; no layout reservation call for them.
    expect(reserveSpy).not.toHaveBeenCalled();
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/t.png');
  });
});

describe('InlineEmbeds bare media embeds (#219)', () => {
  // Shapes taken from the live capture (tooling/captures/219-embeds.json).
  const bareImageEmbed = {
    type: 'image',
    url: 'https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/4x.webp',
    thumbnail: {
      url: 'https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/4x.webp',
      proxy_url: 'https://images-ext-1.discordapp.net/external/x/https/cdn.7tv.app/emote/4x.webp',
      width: 128,
      height: 128,
      content_type: 'image/webp',
    },
  } as unknown as Embed;

  const gifvEmbed = {
    type: 'gifv',
    url: 'https://tenor.com/view/tackle-mascot-gif-10629045',
    title: 'Tackle Mascot GIF - Tackle Mascot - Discover & Share GIFs',
    provider: { name: 'Tenor', url: 'https://tenor.co' },
    thumbnail: {
      url: 'https://media1.tenor.com/m/x/tackle-mascot.gif',
      width: 444,
      height: 250,
    },
    video: {
      url: 'https://media.tenor.com/x/tackle-mascot.mp4',
      proxy_url: 'https://images-ext-1.discordapp.net/external/x/tackle-mascot.mp4',
      width: 444,
      height: 250,
    },
  } as unknown as Embed;

  it('renders a bare image embed as primary inline media, no card chrome', () => {
    const { container } = render(<InlineEmbeds embeds={[bareImageEmbed]} />);
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', bareImageEmbed.thumbnail!.proxy_url);
    // Same size treatment as inline attachments (300 height / 400 width cap).
    expect(reserveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ width: 128, height: 128 }),
      300,
      400,
    );
    // No embed card: no MUI Card, no color stripe wrapper.
    expect(container.querySelector('.MuiCard-root')).not.toBeInTheDocument();
  });

  it('links the bare image to its source URL', () => {
    const { container } = render(<InlineEmbeds embeds={[bareImageEmbed]} />);
    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', bareImageEmbed.url);
  });

  it('renders a gifv embed as a muted looping video, ignoring its provider title', () => {
    const { container } = render(<InlineEmbeds embeds={[gifvEmbed]} />);
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('loop');
    expect(video).toHaveProperty('muted', true);
    expect(video).toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('src', gifvEmbed.video!.proxy_url);
    // Tenor's card-ish title/provider must NOT produce a card.
    expect(container.querySelector('.MuiCard-root')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('Tackle Mascot GIF');
  });

  it('falls back to the thumbnail (an actual .gif) when the gifv video is not directly playable', () => {
    const embed = {
      ...gifvEmbed,
      video: { url: 'https://tenor.com/embed/player/10629045', width: 444, height: 250 },
    } as unknown as Embed;
    const { container } = render(<InlineEmbeds embeds={[embed]} />);
    expect(container.querySelector('video')).not.toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src', gifvEmbed.thumbnail!.url);
  });

  it('keeps the card for an image-typed embed that carries real card content', () => {
    const embed = {
      ...bareImageEmbed,
      title: 'A bot made this',
      description: 'with actual card content',
    } as unknown as Embed;
    const { container } = render(<InlineEmbeds embeds={[embed]} />);
    expect(container.querySelector('.MuiCard-root')).toBeInTheDocument();
  });
});

describe('InlineSticker (#213)', () => {
  it('renders a PNG sticker as a CDN image', () => {
    render(<InlineSticker stickers={[{ id: '123', name: 'wave', format_type: 1 }]} />);
    const img = screen.getByAltText('wave') as HTMLImageElement;
    expect(img.src).toBe('https://media.discordapp.net/stickers/123.png');
  });

  it('uses the .gif variant for GIF stickers (format_type 4)', () => {
    render(<InlineSticker stickers={[{ id: '456', name: 'dance', format_type: 4 }]} />);
    const img = screen.getByAltText('dance') as HTMLImageElement;
    expect(img.src).toBe('https://media.discordapp.net/stickers/456.gif');
  });

  it('falls back to a labeled placeholder for Lottie stickers (format_type 3)', () => {
    render(<InlineSticker stickers={[{ id: '789', name: 'sparkle', format_type: 3 }]} />);
    expect(screen.queryByAltText('sparkle')).toBeNull(); // no <img>
    expect(screen.getByText('sparkle')).toBeInTheDocument();
  });

  it('renders nothing when there are no stickers', () => {
    const { container } = render(<InlineSticker stickers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every sticker when a message carries multiple', () => {
    render(
      <InlineSticker
        stickers={[
          { id: '1', name: 'wave', format_type: 1 },
          { id: '2', name: 'dance', format_type: 4 },
          { id: '3', name: 'sparkle', format_type: 3 },
        ]}
      />,
    );
    // Raster stickers render as <img>; the Lottie one degrades to a label.
    expect((screen.getByAltText('wave') as HTMLImageElement).src).toContain('/stickers/1.png');
    expect((screen.getByAltText('dance') as HTMLImageElement).src).toContain('/stickers/2.gif');
    expect(screen.getByText('sparkle')).toBeInTheDocument();
  });
});

describe('InlinePoll (#213)', () => {
  const poll = {
    question: { text: 'Best language?' },
    answers: [
      { answer_id: 1, poll_media: { text: 'TypeScript' } },
      { answer_id: 2, poll_media: { text: 'Rust' } },
    ],
  };

  it('renders the question and answer options', () => {
    render(<InlinePoll poll={poll} />);
    expect(screen.getByTestId('inline-poll')).toBeInTheDocument();
    expect(screen.getByText('Best language?')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('Rust')).toBeInTheDocument();
  });

  it('shows percentages and total votes when results are present', () => {
    render(
      <InlinePoll
        poll={{
          ...poll,
          results: { answer_counts: [{ id: 1, count: 3 }, { id: 2, count: 1 }] },
        }}
      />
    );
    expect(screen.getByText('75%')).toBeInTheDocument(); // 3 of 4
    expect(screen.getByText('25%')).toBeInTheDocument(); // 1 of 4
    expect(screen.getByText('4 votes')).toBeInTheDocument();
  });

  it('degrades to plain options when results are absent (no fabricated counts)', () => {
    render(<InlinePoll poll={poll} />);
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(screen.queryByText(/votes?$/)).toBeNull();
  });

  it('renders nothing for a null poll', () => {
    const { container } = render(<InlinePoll poll={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// Row 124: a stored row can hold something other than a list of attachments.
describe('InlineAttachments with a damaged row', () => {
  it('renders nothing when attachments is not a list', () => {
    const { container } = render(<InlineAttachments attachments={'x' as never} />);
    expect(container).toBeEmptyDOMElement();
  });
});
