import { Fragment } from "react";

/**
 * A search snippet from the backend: plain text with the matched words wrapped
 * in `<mark>…</mark>`. Rendered by splitting on those markers, so nothing else
 * in the note body is ever treated as HTML.
 */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/<mark>(.*?)<\/mark>/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}
