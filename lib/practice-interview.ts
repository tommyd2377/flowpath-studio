import type { PracticeDefinition, PracticeView } from './practice-contract';

const questionLimit = 3;
const roleLimit = 80;
const questionLength = 240;
const feedbackLength = 360;

function boundedText(value: string, maxLength: number) {
  return typeof value === 'string' && value.length <= maxLength ? value.trim() : '';
}

export const interviewPractice: PracticeDefinition = {
  id: 'interview',
  name: 'Interview Practice',
  description: 'Rehearse for a role aloud with up to three questions and practical coaching after each answer.',
  instructions: [
    'Start only when the visitor asks to practice an interview. Explain aloud that this is a mock interview for coaching. Ask for a role if they have not given one. A generic job title and optional experience level are enough.',
    `Ask one short, role-specific question at a time. Use start with title set to the generic role (up to ${roleLimit} characters) and prompt set to the first question. For each later question use question with prompt. Each prompt must fit in ${questionLength} characters. Mix relevant behavioral and role-specific scenarios and avoid repeats.`,
    `After a substantive answer, use feedback with detail (up to ${feedbackLength} characters). Say one concrete thing that worked and one specific change to try, such as naming the action they took or adding a measurable result when available. Ground coaching in the answer and never invent experience. Do not send the answer or quote it in the tool payload.`,
    'Speak the question or feedback aloud after the corresponding action succeeds. Wait for the visitor to finish answering before giving feedback. After feedback, wait until they want the next question. If they ask to repeat or clarify, do that aloud without advancing. On a tool error, stay on the current step.',
    `After giving feedback on question ${questionLimit}, tell the visitor the drill is complete. If they want to stop early, use finish and acknowledge it aloud. Start a fresh drill only on request. Use empty strings for unused text fields and 0 for the unused score.`,
    'Give coaching about the content and structure of answers only. Do not score the visitor, make hiring decisions, or predict hiring outcomes. Invite hypothetical or anonymized examples. Do not request résumés, search for people, or ask for or repeat names, contact details, employer secrets, or protected or sensitive personal information.',
  ].join('\n'),
  create() {
    let phase: 'idle' | 'answer' | 'next' | 'complete' = 'idle';
    let answered = 0;
    let view: PracticeView = {
      title: 'Interview Practice',
      prompt: 'Say which role you want to practice for.',
      detail: '',
      progress: 'Ready',
    };

    return {
      state: () => ({ ...view }),
      apply(input) {
        switch (input.action) {
          case 'start': {
            if (phase === 'answer' || phase === 'next') return { ok: false, error: 'Finish the current interview before starting another.' };
            const title = boundedText(input.title, roleLimit);
            const prompt = boundedText(input.prompt, questionLength);
            if (!title || !prompt) return { ok: false, error: 'Provide a short role and one interview question.' };
            answered = 0;
            phase = 'answer';
            view = { title, prompt, detail: '', progress: `Question 1 of ${questionLimit}` };
            return { ok: true };
          }
          case 'question': {
            if (phase !== 'next') return { ok: false, error: 'A next question requires feedback on the current answer and an unfinished interview.' };
            const prompt = boundedText(input.prompt, questionLength);
            if (!prompt || prompt === view.prompt) return { ok: false, error: 'Provide one new, short interview question.' };
            phase = 'answer';
            view = { ...view, prompt, detail: '', progress: `Question ${answered + 1} of ${questionLimit}` };
            return { ok: true };
          }
          case 'feedback': {
            if (phase !== 'answer') return { ok: false, error: 'Feedback requires a current interview question.' };
            const detail = boundedText(input.detail, feedbackLength);
            if (!detail) return { ok: false, error: 'Provide brief, actionable coaching.' };
            answered++;
            phase = answered === questionLimit ? 'complete' : 'next';
            view = { ...view, detail, progress: `${answered} of ${questionLimit} answered` };
            return phase === 'complete' ? { ok: true, message: 'Interview practice complete.' } : { ok: true };
          }
          case 'finish':
            if (phase === 'idle' || phase === 'complete') return { ok: false, error: 'There is no active interview to finish.' };
            phase = 'complete';
            view = { ...view, prompt: 'Practice ended.', detail: '', progress: `${answered} of ${questionLimit} answered` };
            return { ok: true };
          default:
            return { ok: false, error: 'Unknown interview practice action.' };
        }
      },
    };
  },
};
