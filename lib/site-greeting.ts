import type { SiteContent } from './site-model';

export const WELCOME_MESSAGE_MAX_LENGTH = 500;

export function defaultWelcomeMessage(name: string) {
  return `Hi, welcome to ${name}. I'm the site's AI assistant. What would you like to know?`;
}

export function getWelcomeMessage(content: Pick<SiteContent, 'name' | 'welcomeMessage'>) {
  return content.welcomeMessage?.trim() || defaultWelcomeMessage(content.name);
}
