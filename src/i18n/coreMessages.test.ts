import { afterEach, describe, expect, it } from 'vitest';
import { coreMessages, resetCoreMessages } from 'discrub-core/messages';
import { applyLanguage } from './index';

describe('core message bridge (#124)', () => {
  afterEach(async () => {
    await applyLanguage('en');
    resetCoreMessages();
  });

  it('hands discrub-core German strings after a language switch and English again after switching back', async () => {
    await applyLanguage('de');
    expect(coreMessages().retrievedMessages(12)).toBe('12 Nachrichten geladen');
    expect(coreMessages().retrievingReactionUsers('fire', 2, 5, true)).toBe(
      'Reaktionsnutzer für fire werden geladen (2/5) [benutzerdefiniert]',
    );
    expect(coreMessages().noPermissionToModifyMessage()).toBe(
      'Du hast keine Berechtigung, diese Nachricht zu ändern!',
    );
    await applyLanguage('en');
    expect(coreMessages().retrievedMessages(12)).toBe('Retrieved 12 messages');
    expect(document.documentElement.lang).toBe('en');
  });

  it('sets the document language', async () => {
    await applyLanguage('de');
    expect(document.documentElement.lang).toBe('de');
  });

  // 2.2.9 (core 1.0.20): the plain text export's own words come from the app's catalog.
  it('hands discrub-core the plain text export wording in each language', async () => {
    const dash = String.fromCharCode(0x2014);
    expect(coreMessages().textAttachment('a.png', 'media/a.png')).toBe(`[Attachment: a.png ${dash} media/a.png]`);
    expect(coreMessages().textEdited('10:00')).toBe('edited 10:00');
    expect(coreMessages().unknownUser()).toBe('Unknown User');
    await applyLanguage('de');
    expect(coreMessages().textAttachment('a.png', 'media/a.png')).toBe(`[Anhang: a.png ${dash} media/a.png]`);
    expect(coreMessages().textForwarded()).toBe('[Weitergeleitet]');
    expect(coreMessages().textReplyTo('bob')).toBe('Antwort an @bob');
    await applyLanguage('zh');
    expect(coreMessages().textReactions(':fire: x2')).toBe('反应：:fire: x2');
    expect(coreMessages().textSystemEvent()).toBe('系统事件');
    expect(coreMessages().textBotTag()).toBe('[BOT]');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
