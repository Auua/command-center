import type { JournalPromptCategory } from '@command-center/contracts';

/**
 * Seeded `journal_prompts` (ADR-016). Upserted with `$setOnInsert` on boot,
 * so editing or deactivating a prompt in Atlas sticks across deploys, and a
 * prompt added here reaches every environment on the next boot. Text is per
 * locale (NFR-12); English is required.
 */
export interface JournalPromptSeed {
  id: string;
  category: JournalPromptCategory;
  text: { en: string };
}

export const JOURNAL_PROMPT_SEED: readonly JournalPromptSeed[] = [
  {
    id: 'day-shape',
    category: 'reflect',
    text: { en: 'What shaped today, more than you expected?' },
  },
  { id: 'unfinished', category: 'reflect', text: { en: 'What is still on your mind from today?' } },
  {
    id: 'again',
    category: 'reflect',
    text: { en: 'If you could replay one moment from today, which would it be?' },
  },
  { id: 'surprise', category: 'reflect', text: { en: 'What surprised you today?' } },
  {
    id: 'grateful-person',
    category: 'gratitude',
    text: { en: 'Who are you grateful for right now, and why?' },
  },
  {
    id: 'grateful-ordinary',
    category: 'gratitude',
    text: { en: 'What ordinary thing would you miss if it were gone?' },
  },
  {
    id: 'grateful-kindness',
    category: 'gratitude',
    text: { en: 'What kindness did you give or receive lately?' },
  },
  {
    id: 'grateful-place',
    category: 'gratitude',
    text: { en: 'Which place made you feel at home this week?' },
  },
  { id: 'growth-learned', category: 'growth', text: { en: 'What did today teach you?' } },
  {
    id: 'growth-differently',
    category: 'growth',
    text: { en: 'What would you do differently if today happened again?' },
  },
  {
    id: 'growth-proud',
    category: 'growth',
    text: { en: 'What are you quietly proud of this week?' },
  },
  {
    id: 'growth-next',
    category: 'growth',
    text: { en: 'What is one small step you want to take tomorrow?' },
  },
  {
    id: 'feelings-now',
    category: 'feelings',
    text: { en: 'How are you feeling right now, honestly?' },
  },
  {
    id: 'feelings-energy',
    category: 'feelings',
    text: { en: 'What gave you energy today, and what drained it?' },
  },
  {
    id: 'feelings-heavy',
    category: 'feelings',
    text: { en: 'Is anything feeling heavy? Write it down and leave it here.' },
  },
  { id: 'feelings-calm', category: 'feelings', text: { en: 'When did you feel calm today?' } },
];
