import { test, expect, type Page } from '@playwright/test';
import { VOICE_COLORS, type VoiceColor } from '@thevoice/platform-ui/voice-design';
import { siteStyle } from '../../lib/site-style';
import { CONVERSATION_PRESETS } from '../../lib/voice-settings';
import type { Site } from '../../lib/site-model';
import { carouselFixture } from './helpers/carousel-fixture';
import { websiteTaskFixture } from '../../fixtures/visitor-tasks';

const origin = 'http://127.0.0.1:3225';
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, { headers: { Origin: origin }, data });
  const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body;
}
async function read(page: Page, id: string): Promise<Site> { return (await (await page.request.get(`/api/sites/${id}`)).json()).site; }
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Workspace', exact: true });
const editor = (page: Page) => page.getByRole('region', { name: 'Site editor', exact: true });
async function save(page: Page) { const button = editor(page).getByRole('button', { name: 'Save draft', exact: true }); await button.click(); await expect(button).toBeDisabled(); }
async function studio(page: Page, site: Site) {
  await page.goto('/'); const picker = page.getByRole('combobox', { name: 'Current site', exact: true }); await expect(picker).toBeEnabled();
  if (await picker.inputValue() !== site.id) await picker.selectOption(site.id);
  await navigation(page).getByRole('button', { name: 'The Voice', exact: true }).click();
}

test('The Voice saves independent choices, keeps drafts private and previews all nine colors without provider calls', async ({ page, context }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [], external: string[] = [], voiceCalls: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route(/^https?:\/\//, route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  page.on('request', request => { if (/\/api\/visitor\/.*\/session$/.test(request.url())) voiceCalls.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let site: Site = (await post(page, '/api/sites', { name: 'Voice configuration fixture', slug: `voice-settings-${Date.now()}`, kind: 'general' })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, headline: 'A welcoming place to explore', description: 'Synthetic content for a local voice configuration check.', visitor: { ...site.draft.visitor, mode: 'both' }, style: { ...site.draft.style, palette: 'orchid', typography: 'literary', spacing: 'spacious', entry: 'website' } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const published = structuredClone(site.published), content = { ...site.draft, visitor: undefined, style: undefined, visitorSpeaksFirst: undefined, welcomeMessage: undefined };
  await studio(page, site);
  await expect(editor(page).getByRole('heading', { name: 'The Voice', exact: true })).toBeVisible();
  await expect(editor(page).getByText('GPT Live 1', { exact: true })).toBeVisible();
  await expect(editor(page).getByRole('button', { name: /^Website first/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page).getByRole('combobox', { name: 'Speaking voice' }).locator('option')).toHaveCount(14);
  await page.screenshot({ path: info.outputPath('voice-studio-desktop.png') });
  await page.getByRole('combobox', { name: 'Speaking voice' }).selectOption('willow');
  await page.getByRole('combobox', { name: 'Conversation language' }).selectOption('es');
  await page.getByRole('button', { name: /^Quiet Reserved/ }).click();
  await expect(page.getByRole('combobox', { name: 'Answer length' })).toHaveValue('minimal');
  await expect(page.getByRole('combobox', { name: 'Warmth', exact: true })).toHaveValue('reserved');
  await page.getByText('Conversation habits & pronunciation', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Listening acknowledgements' })).toHaveValue('none');
  await page.getByRole('textbox', { name: 'Pronunciation hints' }).fill('Acme: ACK-mee.');
  await page.screenshot({ path: info.outputPath('voice-conversation-habits.png') });
  await page.getByText('Conversation habits & pronunciation', { exact: true }).click();
  const preview = page.locator('.preview-scroll [data-visitor-site]');
  const palette = await preview.evaluate(el => getComputedStyle(el).getPropertyValue('--platform-accent'));
  for (const [id, color] of Object.entries(VOICE_COLORS)) {
    const choice = page.getByRole('button', { name: `${color.name} voice color`, exact: true }); await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    const expected = siteStyle({ ...site.draft, visitor: { ...site.draft.visitor!, conversation: { color: id as VoiceColor } } })['--voice-accent'];
    await expect(preview.locator('canvas[data-wave-color]')).toHaveAttribute('data-wave-color', expected);
    // Every publisher-selected hue retains the original transparent tails.
    await expect.poll(() => preview.locator('canvas[data-wave-color]').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d')!;
      const peak = (fraction: number) => {
        const pixels = context.getImageData(Math.round((canvas.width - 1) * fraction), 0, 1, canvas.height).data;
        let alpha = 0;
        for (let i = 3; i < pixels.length; i += 4) alpha = Math.max(alpha, pixels[i]);
        return alpha;
      };
      const center = peak(.5);
      return center > 80 && peak(0) < center * .1 && peak(1) < center * .1 && peak(.13) > peak(0) + 10 && peak(.87) > peak(1) + 10;
    }), `${id} waveform fades gradually at both ends`).toBe(true);
    expect(await preview.evaluate(el => getComputedStyle(el).getPropertyValue('--platform-accent'))).toBe(palette);
    await preview.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(preview.locator('.site-wave')).toHaveCount(0);
    const send = preview.getByRole('button', { name: 'Show me', exact: true });
    expect(await send.evaluate(el => getComputedStyle(el).getPropertyValue('--platform-accent').trim())).toBe(expected);
    await page.screenshot({ path: info.outputPath(`voice-${id}.png`) });
    await preview.getByRole('button', { name: 'Voice', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Ocean voice color', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Ocean voice color', exact: true })).toBeFocused();
  await page.getByRole('textbox', { name: 'Welcome message' }).fill('Bienvenidos. ¿Qué te gustaría explorar?');
  await page.getByRole('combobox', { name: 'Who speaks first?' }).selectOption('visitor');
  await expect(page.getByRole('textbox', { name: 'Welcome message' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Maximum voice session' }).selectOption('30');
  await page.getByRole('combobox', { name: 'End voice after inactivity' }).selectOption('30');
  await page.getByRole('spinbutton', { name: 'Daily voice task limit' }).fill('9');
  await editor(page).getByRole('button', { name: /^Voice invitation/ }).click();
  await save(page); site = await read(page, site.id);
  expect(site.draft.visitor?.conversation).toEqual({ ...CONVERSATION_PRESETS.quiet.settings, voice: 'willow', language: 'es', pronunciation: 'Acme: ACK-mee.', color: 'ocean' });
  expect(site.draft.visitor).toMatchObject({ openingExperience: 'voice', voiceSessionSeconds: 30, voiceIdleTimeoutSeconds: 30, voiceDailyLimit: 9 });
  expect(site.draft.style).toMatchObject({ palette: 'orchid', typography: 'literary', spacing: 'spacious', entry: 'website' });
  expect({ ...site.draft, visitor: undefined, style: undefined, visitorSpeaksFirst: undefined, welcomeMessage: undefined }).toEqual(content);
  expect(site.published).toEqual(published);
  await page.goto(`/s/${site.slug}`); await expect(page.locator('[data-ai-controls]')).toHaveAttribute('data-voice-color', 'amber');
  await studio(page, site);
  await expect(page.getByRole('combobox', { name: 'Speaking voice' })).toHaveValue('willow');
  await expect(page.getByRole('combobox', { name: 'Answer length' })).toHaveValue('minimal');
  await expect(editor(page).getByRole('button', { name: /^Voice invitation/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Ocean voice color', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Expressive Lively/ }).click(); await save(page);
  site = await read(page, site.id); expect(site.draft.visitor?.conversation).toMatchObject({ ...CONVERSATION_PRESETS.expressive.settings, voice: 'willow', language: 'es', color: 'ocean', pronunciation: 'Acme: ACK-mee.' });
  expect(site.draft.visitorSpeaksFirst).toBe(true); expect(site.draft.visitor?.voiceDailyLimit).toBe(9);
  await page.getByRole('button', { name: 'Mobile preview', exact: true }).click();
  await page.getByRole('region', { name: 'Voice color', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('voice-studio-embedded.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await editor(page).getByRole('heading', { name: 'The Voice', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('voice-studio-mobile.png') });
  await page.getByRole('region', { name: 'Voice color', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('voice-colors-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Publish locally', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish locally', exact: true })).not.toBeVisible();
  site = await read(page, site.id); expect(site.published).toEqual(site.draft);
  await page.goto(`/s/${site.slug}`); await expect(page.locator('[data-ai-controls]')).toHaveAttribute('data-voice-color', 'ocean');
  await expect(page.locator('[data-visitor-site]')).toHaveAttribute('data-opening-experience', 'voice');
  await page.getByRole('button', { name: 'Browse website', exact: true }).click();
  await expect(page.locator('[data-voice-dock]')).toHaveAttribute('data-started', 'true');
  await page.screenshot({ path: info.outputPath('voice-website-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('.site-wave')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('voice-chat-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1100 }); await studio(page, site);
  await page.getByRole('combobox', { name: 'How visitors interact' }).selectOption('off'); await save(page);
  site = await read(page, site.id); expect(site.draft.visitor?.enabled).toBe(false); expect(site.published?.visitor?.enabled).toBe(true);
  expect(site.draft.visitor?.conversation).toEqual(site.published?.visitor?.conversation);
  const other: Site = (await post(page, '/api/sites', { name: 'Independent voice fixture', slug: `other-voice-${Date.now()}`, kind: 'general' })).site;
  await studio(page, other);
  await expect(page.getByRole('combobox', { name: 'Speaking voice' })).toHaveValue('marin');
  await expect(page.getByRole('combobox', { name: 'Conversation language' })).toHaveValue('auto');
  await expect(page.getByRole('button', { name: 'Amber voice color', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page).getByRole('button', { name: /^Website first/ })).toHaveAttribute('aria-pressed', 'true');
  const theme = page.getByRole('switch', { name: 'Dark mode', exact: true });
  if (await theme.getAttribute('aria-checked') === 'true') await theme.click();
  await page.screenshot({ path: info.outputPath('voice-studio-light.png') });
  await studio(page, site);
  await expect(page.getByRole('combobox', { name: 'Speaking voice' })).toHaveValue('willow');
  await expect(page.getByRole('combobox', { name: 'How visitors interact' })).toHaveValue('off');
  await expect(page.getByRole('button', { name: 'Ocean voice color', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]); expect(external).toEqual([]); expect(voiceCalls).toEqual([]);
});

test('Voice and Chat controls stay centered on the divider without an outer bubble', async ({ page, context }, info) => {
  const voiceCalls: string[] = [];
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page.on('request', request => { if (/\/api\/visitor\/.*\/session$/.test(request.url())) voiceCalls.push(request.url()); });
  let site: Site = (await post(page, '/api/sites', { name: 'Conversation dock fixture', slug: `conversation-dock-${Date.now()}`, kind: 'general' })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    sections: Array.from({ length: 6 }, (_, index) => ({ id: `topic-${index}`, title: `Published topic ${index + 1}`, body: 'Synthetic published information for checking the controls while browsing a full page. '.repeat(4) })),
    visitor: { ...site.draft.visitor, mode: 'both', conversation: { ...site.draft.visitor?.conversation, color: 'jade' } }, style: { ...site.draft.style, entry: 'website' } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  const controls = page.getByRole('group', { name: 'Conversation mode' });
  for (const width of [345, 1440]) {
    await page.setViewportSize({ width, height: 931 });
    for (const mode of ['Voice', 'Chat', 'Voice']) {
      await controls.getByRole('button', { name: mode, exact: true }).click();
      await expect(controls.getByRole('button', { name: mode, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(controls).toHaveCSS('border-top-width', '0px'); await expect(controls).toHaveCSS('box-shadow', 'none');
      await expect(controls).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect.poll(() => controls.evaluate(element => {
        const bounds = element.getBoundingClientRect(), divider = element.closest('[data-ai-controls]')!.getBoundingClientRect().bottom;
        return Math.abs(bounds.y + bounds.height / 2 - divider);
      })).toBeLessThan(1);
      expect((await controls.getByRole('button', { name: mode, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: info.outputPath(`conversation-${mode.toLowerCase()}-${width}.png`) });
    }
    const before = await controls.boundingBox();
    await page.mouse.wheel(0, 500); await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await expect.poll(async () => Math.abs((await controls.boundingBox())!.y - before!.y)).toBeLessThan(1);
    await page.evaluate(() => scrollTo(0, 0));
  }
  expect(voiceCalls).toEqual([]);
});

test('greeting setup starts simply, reorders three topics and preserves settings through draft and publish', async ({ page, context }, info) => {
  const voiceCalls: string[] = [];
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page.on('request', request => { if (/\/api\/visitor\/.*\/session$/.test(request.url())) voiceCalls.push(request.url()); });
  let site: Site = (await post(page, '/api/sites', { name: 'Greeting settings fixture', slug: `greeting-settings-${Date.now()}`, kind: 'photographer' })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const published = structuredClone(site.published);
  await studio(page, site);
  const role = 'Be a thoughtful portfolio guide. Help clients understand the photography and compare sessions.';
  const roleField = page.getByRole('textbox', { name: 'Role and identity' });
  await expect(page.getByRole('region', { name: 'Assistant role', exact: true })).toContainText('up to three opening topics are separate');
  await roleField.fill(role);
  const welcome = page.getByRole('region', { name: 'Voice welcome', exact: true });
  await welcome.getByRole('combobox', { name: 'Who speaks first?' }).selectOption('assistant');
  await expect(welcome.getByRole('combobox', { name: /Greeting point/ })).toHaveCount(1);
  await expect(welcome.getByRole('textbox', { name: 'Welcome message' })).toBeVisible();
  const welcomeWords = 'Welcome. I can help you find a photography session that feels like you.';
  await welcome.getByRole('textbox', { name: 'Welcome message' }).fill(welcomeWords);
  await welcome.getByRole('combobox', { name: 'Greeting point 1' }).selectOption('source:section:weddings');
  const weddingChoice = await welcome.getByRole('combobox', { name: 'Greeting point 1' }).elementHandle();
  await expect(welcome).toContainText('A thoughtful, documentary approach');
  await welcome.getByRole('button', { name: 'Add another topic' }).click();
  await expect(welcome.getByRole('combobox', { name: 'Greeting point 2' }).locator('option[value="source:section:weddings"]')).toHaveAttribute('disabled', '');
  await welcome.getByRole('combobox', { name: 'Greeting point 2' }).selectOption('source:section:portraits');
  await welcome.getByRole('button', { name: 'Add another topic' }).click();
  await welcome.getByRole('combobox', { name: 'Greeting point 3' }).selectOption('custom');
  await welcome.getByRole('textbox', { name: 'Publisher-authored point 3' }).fill('Explore the neighborhood at your own pace.');
  await expect(welcome.getByRole('button', { name: 'Add another topic' })).toHaveCount(0);
  await welcome.getByRole('button', { name: 'Move topic 3 up' }).click();
  await expect(welcome.getByRole('textbox', { name: 'Publisher-authored point 2' })).toHaveValue('Explore the neighborhood at your own pace.');
  await welcome.getByRole('button', { name: 'Move topic 1 down' }).click();
  await welcome.getByRole('button', { name: 'Remove topic 3' }).click();
  await expect(welcome.getByRole('combobox', { name: /Greeting point/ })).toHaveCount(2);
  expect(await welcome.getByRole('combobox', { name: 'Greeting point 2' }).evaluate((element, original) => element === original, weddingChoice)).toBe(true);
  await welcome.getByText('Preview introduction', { exact: true }).click();
  const sequence = welcome.getByLabel('Spoken greeting text preview').getByRole('listitem');
  await expect(sequence).toHaveCount(4);
  await expect(sequence.first()).toContainText(welcomeWords);
  await expect(sequence.nth(1)).toContainText('Explore the neighborhood at your own pace.');
  await expect(sequence.nth(2)).toContainText('A thoughtful, documentary approach');
  await expect(sequence.last()).toContainText('What would you like to explore?');
  await expect(welcome.getByLabel('Spoken greeting text preview')).toContainText('Explore the neighborhood at your own pace.');
  await expect(welcome.getByLabel('Spoken greeting text preview')).not.toContainText(role);
  await welcome.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('greeting-studio-topics.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await welcome.getByRole('combobox', { name: 'Who speaks first?' }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const topicButtons = welcome.locator('li').getByRole('button');
  for (const button of await topicButtons.all()) {
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44); expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: info.outputPath('greeting-studio-mobile.png') });
  await welcome.getByRole('combobox', { name: 'Who speaks first?' }).selectOption('visitor');
  await expect(welcome.getByRole('combobox', { name: /Greeting point/ })).toHaveCount(0);
  await save(page);
  site = await read(page, site.id);
  expect(site.draft.greetingPoints).toEqual([{ kind: 'custom', text: 'Explore the neighborhood at your own pace.' }, { kind: 'source', id: 'section:weddings' }, null]);
  expect(site.draft.visitorSpeaksFirst).toBe(true);
  expect(site.draft.welcomeMessage).toBe(welcomeWords);
  expect(site.draft.visitor?.assistantPurpose).toBe(role);
  expect(site.published).toEqual(published);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await studio(page, site);
  await expect(roleField).toHaveValue(role);
  await welcome.getByRole('combobox', { name: 'Who speaks first?' }).selectOption('assistant');
  await expect(welcome.getByRole('textbox', { name: 'Welcome message' })).toHaveValue(welcomeWords);
  await expect(welcome.getByRole('textbox', { name: 'Publisher-authored point 1' })).toHaveValue('Explore the neighborhood at your own pace.');
  await expect(welcome.getByRole('combobox', { name: 'Greeting point 2' })).toHaveValue('source:section:weddings');
  await save(page);
  site = await read(page, site.id);
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  expect(site.published!.greetingPoints).toEqual(site.draft.greetingPoints);
  expect(site.published!.visitorSpeaksFirst).toBe(false);
  expect(site.published!.visitor?.assistantPurpose).toBe(role);
  expect(voiceCalls).toEqual([]);
});

test('greeting picker offers a small theme list and preserves previously selected qualified facts', async ({ page }) => {
  let site = await carouselFixture(page);
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    greetingPoints: [{ kind: 'fact', id: 'child-policy' }, { kind: 'entity', id: 'blue' }, null] } })).site;
  let failKnowledge = true;
  await page.route(`**/api/sites/${site.id}/knowledge?**`, route => failKnowledge
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic temporary failure' }) })
    : route.continue());
  await studio(page, site);
  const welcome = page.getByRole('region', { name: 'Voice welcome', exact: true });
  await welcome.getByRole('combobox', { name: 'Who speaks first?' }).selectOption('assistant');
  await expect(welcome).toContainText('Introduction topics could not load. Your saved choices are kept.');
  failKnowledge = false;
  await welcome.getByRole('button', { name: 'Try again', exact: true }).click();
  const choice = welcome.getByRole('combobox', { name: 'Greeting point 1' });
  await expect(choice).toHaveValue('fact:child-policy');
  await expect(choice.locator('optgroup[label="Previously selected"] option[value="entity:blue"]')).toHaveCount(1);
  await expect(choice.locator('optgroup[label="Previously selected"] option[value="fact:child-policy"]')).toHaveText('Clay Basics · Children may attend');
  const themes = choice.locator('optgroup[label="Introduction themes"] option');
  expect(await themes.count()).toBeLessThanOrEqual(8);
  await expect(choice.locator('optgroup[label="Introduction themes"] option[value^="fact:"]')).toHaveCount(0);
  await expect(choice.locator('optgroup[label="Introduction themes"] option[value="entity:blue"]')).toHaveCount(0);
  await expect(welcome.getByRole('searchbox')).toHaveCount(0);
  await expect(welcome).toContainText('A soft blue glaze');
  await expect(welcome).toContainText('Price: USD 35');
  await expect(welcome).toContainText('adult-accompaniment');
  await welcome.getByText('Preview introduction', { exact: true }).click();
  await expect(welcome.getByLabel('Spoken greeting text preview')).toContainText('under age: 12');
  await expect(welcome.getByLabel('Spoken greeting text preview')).toContainText('Blue Bowl');
  await welcome.getByRole('textbox', { name: 'Welcome message' }).fill('Welcome to Harbor Studio.');
  await save(page);
  const saved = await read(page, site.id);
  expect(saved.draft.greetingPoints).toEqual([{ kind: 'fact', id: 'child-policy' }, { kind: 'entity', id: 'blue' }, null]);
  expect(saved.published!.greetingPoints).toEqual(site.published!.greetingPoints);
});

test('greeting picker presents business themes from a large catalog without turning into an item browser', async ({ page, context }, info) => {
  const voiceCalls: string[] = [], errors: string[] = [], greetingUrls: URL[] = [];
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/\/api\/visitor\/.*\/session$/.test(request.url())) voiceCalls.push(request.url());
    if (request.url().includes('/greeting?')) greetingUrls.push(new URL(request.url()));
  });
  let site: Site = (await post(page, '/api/sites', { name: 'Greeting catalog fixture', slug: `greeting-catalog-${Date.now()}`, kind: 'general' })).site;
  const { records, memberships, relationships, publication, ...metadata } = websiteTaskFixture('services', 300);
  expect(publication).toBeTruthy();
  for (const [id, name, description] of [
    ['intro-story', 'Our story', 'We began as a small neighborhood design practice. Today our independent studio works with community organizations, bringing patient listening and thoughtful craft to every project.'],
    ['intro-team', 'Meet our team', 'Our team brings together designers, researchers and makers. We work closely with each client, sharing ideas early and refining them together throughout the design process.'],
    ['intro-approach', 'Our approach', 'Every collaboration begins with a conversation about what matters to you. We develop clear options, explain the tradeoffs and guide the work from first idea to a considered final result.'],
  ]) {
    records.push({ id, name, type: 'article', summary: description, aliases: [], assertions: [], blocks: [{ id: `${id}-body`, kind: 'paragraph', text: description }] });
    memberships.push({ collectionId: 'child', recordId: id });
  }
  let { review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'begin', siteRevision: site.revision, metadata });
  for (let offset = 0; offset < records.length; offset += 100) {
    const chunk = records.slice(offset, offset + 100), ids = new Set(chunk.map(record => record.id));
    ({ review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'append', reviewId: review.id, revision: review.revision,
      chunk: { records: chunk, memberships: memberships.filter(member => ids.has(member.recordId)), relationships: offset ? [] : relationships } }));
  }
  ({ review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'finish', reviewId: review.id, revision: review.revision }));
  site = (await post(page, `/api/sites/${site.id}/collections`, { action: 'apply', reviewId: review.id, revision: review.revision, siteRevision: site.revision })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    greetingPoints: [{ kind: 'record', id: 'record-00298' }, null, null] } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const published = structuredClone(site.published);
  let failThemes = true;
  await page.route(`**/api/sites/${site.id}/greeting?**`, route => failThemes && new URL(route.request().url()).searchParams.get('selectedOnly') !== 'true'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic temporary failure' }) })
    : route.continue());
  await studio(page, site);
  const welcome = page.getByRole('region', { name: 'Voice welcome', exact: true });
  await welcome.getByRole('combobox', { name: 'Who speaks first?' }).selectOption('assistant');
  const choice = welcome.getByRole('combobox', { name: 'Greeting point 1' });
  await expect(choice).toHaveValue('record:record-00298');
  await expect(welcome).toContainText('Introduction themes could not load. Your saved choices are kept.');
  failThemes = false;
  await welcome.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(choice.locator('optgroup[label="Introduction themes"] option[value="record:intro-story"]')).toHaveText('Our story');
  expect(await choice.locator('optgroup[label="Introduction themes"] option').count()).toBeLessThanOrEqual(8);
  await expect(choice.locator('optgroup[label="Introduction themes"] option[value^="record:record-"]')).toHaveCount(0);
  await expect(choice.locator('optgroup[label="Previously selected"] option')).toHaveCount(1);
  await expect(choice.locator('option[value="record:record-00298"]')).toHaveText('Studio design session 298');
  await expect(welcome).toContainText('Published detail for Studio design session 298.');
  await expect(welcome.getByRole('searchbox')).toHaveCount(0);
  await expect(welcome.getByRole('button', { name: /Load more/ })).toHaveCount(0);
  await welcome.getByRole('button', { name: 'Add another topic' }).click();
  await welcome.getByRole('combobox', { name: 'Greeting point 2' }).selectOption('record:intro-story');
  await welcome.getByRole('button', { name: 'Add another topic' }).click();
  await welcome.getByRole('combobox', { name: 'Greeting point 3' }).selectOption('record:intro-team');
  await welcome.getByRole('textbox', { name: 'Welcome message' }).fill('Welcome to our independent design practice.');
  await welcome.getByText('Preview introduction', { exact: true }).click();
  const preview = welcome.getByLabel('Spoken greeting text preview');
  await expect(preview.getByRole('listitem')).toHaveCount(5);
  await expect(preview).toContainText('Studio design session 298');
  await expect(preview).toContainText('We began as a small neighborhood design practice.');
  await expect(preview).toContainText('Our team brings together designers, researchers and makers.');
  await save(page); site = await read(page, site.id);
  expect(site.draft.greetingPoints).toEqual([{ kind: 'record', id: 'record-00298' }, { kind: 'record', id: 'intro-story' }, { kind: 'record', id: 'intro-team' }]);
  expect(site.published).toEqual(published);
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  expect(site.published!.greetingPoints).toEqual(site.draft.greetingPoints);
  await studio(page, site);
  await expect(choice).toHaveValue('record:record-00298');
  await expect(choice.locator('optgroup[label="Previously selected"] option[value="record:record-00298"]')).toHaveText('Studio design session 298');
  await page.setViewportSize({ width: 390, height: 844 });
  await choice.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('greeting-curated-themes-mobile.png') });
  expect(greetingUrls.length).toBeGreaterThan(0);
  expect(greetingUrls.every(url => !url.searchParams.has('q') && !url.searchParams.has('offset'))).toBe(true);
  expect(voiceCalls).toEqual([]); expect(errors).toEqual([]);
});
