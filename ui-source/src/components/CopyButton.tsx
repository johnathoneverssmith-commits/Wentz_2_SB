import { useEffect, useState } from "react";

/**
 * Copies a code and says whether it worked.
 *
 * The invite and reset codes each had their own Copy button, most of them
 * silent: on a phone that refuses clipboard access (or an older browser
 * with no clipboard API at all) a GM pressed it, pasted nothing, and had no
 * idea why. Now it says "Copied", or that they'll need to select the code.
 */
export function CopyButton({
  text,
  className = "btnlink sm",
  label = "Copy",
}: {
  text: string;
  className?: string;
  label?: string;
}) {
  const [state, setState] = useState<"ok" | "failed" | null>(null);
  // a new code is a new copy
  useEffect(() => setState(null), [text]);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (!navigator.clipboard) {
          setState("failed");
          return;
        }
        void navigator.clipboard.writeText(text).then(
          () => setState("ok"),
          () => setState("failed"),
        );
      }}
    >
      {state === "ok" ? "Copied" : state === "failed" ? "Couldn't copy — select the code" : label}
    </button>
  );
}

/**
 * A link that opens the lobby's Join tab with the code filled in.
 *
 * Inviting someone meant sending eight characters and directions to the
 * right tab; a link is one tap. (From the static site's address it forwards
 * to the league server's with the invite intact — `leagueOrigin.ts`.)
 */
export function inviteLink(code: string): string {
  return `${window.location.origin}/#/online?invite=${encodeURIComponent(code)}`;
}
