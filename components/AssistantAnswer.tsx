import { RichAnswer } from '@thevoice/platform-ui/answer';

/** Prose stays inside the existing information surface and its history. */
export default function AssistantAnswer({ text }: { text: string }) {
  return <RichAnswer text={text}/>;
}
