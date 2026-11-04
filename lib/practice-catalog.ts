import { quizPractice } from './practice-quiz';
import { lessonsPractice } from './practice-lessons';
import { flashcardsPractice } from './practice-flashcards';
import { interviewPractice } from './practice-interview';
import type { PracticeId } from './practice-contract';

export const PRACTICE_CATALOG = [quizPractice, lessonsPractice, flashcardsPractice, interviewPractice];

export function practiceDefinition(id: PracticeId) {
  return PRACTICE_CATALOG.find(plugin => plugin.id === id);
}
