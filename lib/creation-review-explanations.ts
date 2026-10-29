import type { CreationSafetyCategory } from './creation-safety';

// Policy guidance, not model evidence. Older reviews kept category labels only;
// never invent a quotation or a precise causal explanation.
export const CREATION_REVIEW_EXPLANATIONS: Record<CreationSafetyCategory, { title: string; detail: string }> = {
  'extremist-impersonation': { title: 'Nazi or extremist character', detail: 'Nazi personas and extremist leaders or roleplay are prohibited. Choose a different character; a disclaimer does not remove this restriction.' },
  'violent-extremism': { title: 'Violent extremism', detail: 'Checks for extremist recruitment, propaganda, glorification or assistance. Neutral historical discussion is different from promoting an extremist cause.' },
  'sexual-content-minors': { title: 'Sexual content involving minors', detail: 'Sexual exploitation, grooming and sexual content involving anyone under 18 are prohibited.' },
  'hateful-abuse': { title: 'Hateful or abusive behavior', detail: 'Checks for instructions promoting hatred, dehumanization or targeted abuse. Remove instructions encouraging this behavior.' },
  'credible-harm': { title: 'Help causing real harm', detail: 'Checks for encouragement or practical assistance with violence, dangerous drug use, abuse or crime.' },
  'fraud-impersonation': { title: 'Possible identity deception', detail: 'Checks for instructions to deceive people about identity, forge endorsements or commit fraud. Historical roleplay can stay in character and answer truthfully when asked about being AI; that alone is allowed.' },
  'privacy-abuse': { title: 'Misuse of private information', detail: 'Checks for exposing, collecting or exploiting personal information without permission. An ordinary reference to a person is not itself a violation.' },
  'living-person': { title: 'Living person as a character', detail: 'Personas of living real people are prohibited, including celebrities, private people and the creator. Choose an original character or an eligible historical figure.' },
  'recently-deceased-person': { title: 'Person deceased less than five years', detail: 'A real person must have been dead for at least five full years. An uncertain death date needs founder verification.' },
  'real-child-persona': { title: 'Real child as a character', detail: 'Recreating a real child as an interactive character is prohibited.' },
  'victim-persona': { title: 'Victim recreated as a companion', detail: 'Companion personas recreating murder, suicide or other tragedy victims are prohibited. Neutral discussion of history is different from recreating a victim as a companion.' },
  'notorious-harmful-persona': { title: 'Notorious harmful character', detail: 'Personas of notorious killers, abusers, dictators or cult leaders are prohibited. An ordinary historical figure is not prohibited merely for a debated legacy.' },
  'sexual-companion': { title: 'Sexual or romantic companion', detail: 'Sexual and romantic companion roleplay is outside this beta. Remove instructions creating that relationship.' },
  'self-harm': { title: 'Encouraging self-harm', detail: 'Encouraging suicide, self-harm or disordered eating is prohibited. Supportive, non-encouraging discussion is different.' },
  'coercive-dependency': { title: 'Manipulative relationship', detail: 'Checks for isolation, secrecy from family, exclusive emotional dependence or pressure to keep chatting.' },
  'false-professional': { title: 'False professional authority', detail: 'Checks for false credentials or claims to act as a doctor, therapist, lawyer or financial professional. Historical discussion does not itself claim present-day credentials.' },
  'controversial-identity': { title: 'Historical context for founder follow-up', detail: 'Ordinary historical complexity or a debated legacy alone should pass. This low-risk flag allows immediate use while the founder checks any remaining context.' },
  'portrait-provenance': { title: 'Portrait source or permission', detail: 'Questions about the image source or permission go to founder follow-up. This flag alone allows use; it is not proof of fraud and does not identify the person in the picture.' },
  'incomplete-coverage': { title: 'Content could not be checked completely', detail: 'The full content or file could not be assessed. Provide a readable, complete file or wait for the founder to inspect the original; unchecked material cannot be used.' },
};

export function creationReviewExplanation(category: string) {
  return Object.hasOwn(CREATION_REVIEW_EXPLANATIONS, category) ? CREATION_REVIEW_EXPLANATIONS[category as CreationSafetyCategory]
    : { title: 'Additional safety concern', detail: 'The reviewer raised a concern without a recognized explanation. The founder must inspect this exact version before making a decision.' };
}
